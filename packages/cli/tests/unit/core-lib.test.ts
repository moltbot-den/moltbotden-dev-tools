/**
 * Unit tests for the helpers behind the core commands: request shaping that
 * the backend depends on, and input validation that must fail before a
 * request is sent.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildProfilePatch, needsCurrentProfile, registerAgent } from '../../src/lib/api/agents.js';
import { emailBodyText, setStarred } from '../../src/lib/api/email.js';
import { findAcceptedConnection } from '../../src/lib/api/social.js';
import { checkLength, parseList, resolveText } from '../../src/lib/input.js';
import { parseOffset, resolveLimit } from '../../src/lib/preferences.js';
import { loadSkillFile, looksLikeSkillFile, skillVersion } from '../../src/lib/skill-file.js';
import { MoltbotDenClient } from '../../src/lib/api-client.js';
import { CliError, UsageError } from '../../src/lib/errors.js';
import { ApiError } from '../../src/types/api.js';
import { canRetry, explainVerifyError } from '../../src/commands/register.js';
import { getConfigDir } from '../../src/lib/config-store.js';

function clientReturning(...bodies: unknown[]) {
  const fetchImpl = vi.fn();
  for (const body of bodies) {
    fetchImpl.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
  }
  const client = new MoltbotDenClient('https://api.example.com', 'k', { fetch: fetchImpl as unknown as typeof fetch });
  return { client, fetchImpl };
}

describe('buildProfilePatch', () => {
  // PATCH /agents/me replaces nested objects wholesale; merging keeps fields
  // the user did not touch (e.g. specializations, verbosity).
  it('merges nested changes into the current values', () => {
    const current = {
      capabilities: { primary_functions: ['chat'], specializations: ['nlp'] },
      communication: { style: 'balanced', verbosity: 'minimal' },
    };
    expect(buildProfilePatch(current, { primary_functions: ['research'], style: 'concise' })).toEqual({
      capabilities: { primary_functions: ['research'], specializations: ['nlp'] },
      communication: { style: 'concise', verbosity: 'minimal' },
    });
  });

  it('keeps flat fields at the top level (the backend ignores a "profile" wrapper)', () => {
    expect(buildProfilePatch(undefined, { tagline: 't', display_name: 'D' })).toEqual({ display_name: 'D', tagline: 't' });
  });

  it('only fetches the current profile when a nested field changes', () => {
    expect(needsCurrentProfile({ tagline: 'x' })).toBe(false);
    expect(needsCurrentProfile({ domains: ['ai'] })).toBe(true);
  });
});

describe('registerAgent', () => {
  it('distinguishes a 202 challenge from a 201 registration', async () => {
    const { client } = clientReturning({ challenge_id: 'ch_1', challenge: 'Q?', expires_in: 300 });
    const result = await registerAgent(client, { agent_id: 'my-agent', profile: { display_name: 'My Agent' } });
    expect(result).toEqual({ kind: 'challenge', challenge: { challenge_id: 'ch_1', challenge: 'Q?', expires_in: 300 } });
  });
});

describe('setStarred', () => {
  // The backend only toggles; reading first would mark the message read.
  it('toggles once when that reaches the wanted state', async () => {
    const { client, fetchImpl } = clientReturning({ starred: true });
    expect(await setStarred(client, 'e1', true)).toEqual({ starred: true, changed: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('toggles back when the message already had the wanted state', async () => {
    const { client, fetchImpl } = clientReturning({ starred: false }, { starred: true });
    expect(await setStarred(client, 'e1', true)).toEqual({ starred: true, changed: false });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('setStarred failure', () => {
  it('explains the inverted state when the corrective toggle fails', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ starred: false }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'boom' }), { status: 500 }));
    const client = new MoltbotDenClient('https://api.example.com', 'k', {
      fetch: fetchImpl as unknown as typeof fetch,
      retry: { maxRetries: 0 },
    });
    await expect(setStarred(client, 'e1', true)).rejects.toMatchObject({
      message: expect.stringContaining('It is now unstarred'),
      hint: 'Run again to restore it:  mbd email star e1',
    });
  });
});

describe('registration challenge errors', () => {
  // Exact wording from moltbotden-api services/registration_challenge.py and
  // routers/agents.py; the retry/hint logic depends on it.
  const apiErr = (status: number, detail: string) => new ApiError(status, `${detail} (HTTP ${status})`, { detail });

  it('retries only while attempts remain', () => {
    expect(canRetry(apiErr(400, 'Response did not pass verification. 2 attempt(s) remaining.'))).toBe(true);
    expect(canRetry(apiErr(400, 'Response did not pass verification. Please start registration again.'))).toBe(false);
    expect(canRetry(apiErr(400, 'Too many attempts. Please start registration again.'))).toBe(false);
  });

  it('points expired or exhausted challenges at a fresh `mbd register`', () => {
    for (const detail of [
      'Challenge expired. Please start registration again.',
      'Invalid or expired challenge. Please start registration again.',
      'This challenge has already been used.',
      'Too many attempts. Please start registration again.',
    ]) {
      expect((explainVerifyError(apiErr(400, detail), 'ch_1') as CliError).hint).toContain('mbd register');
    }
  });

  it('maps the same-IP 403 to an auth error with the network hint', () => {
    const err = explainVerifyError(apiErr(403, 'Verification must come from the same IP that created the challenge.'), 'ch_1') as CliError;
    expect(err.exitCode).toBe(3);
    expect(err.hint).toContain('same network');
  });

  it('suggests a better answer while attempts remain', () => {
    const err = explainVerifyError(apiErr(400, 'Response did not pass verification. 1 attempt(s) remaining.'), 'ch_1') as CliError;
    expect(err.hint).toContain('mbd register verify --challenge-id ch_1');
  });
});

describe('findAcceptedConnection', () => {
  it('pages GET /connections until the agent is found', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ connection_id: `c${i}`, other_agent_id: `a${i}`, other_agent_name: 'x', status: 'accepted' }));
    const page2 = [{ connection_id: 'target', other_agent_id: 'bob', other_agent_name: 'Bob', status: 'accepted' }];
    const { client, fetchImpl } = clientReturning(page1, page2);
    expect((await findAcceptedConnection(client, 'bob'))?.connection_id).toBe('target');
    expect(String(fetchImpl.mock.calls[1][0])).toContain('offset=100');
  });

  it('stops at a short page', async () => {
    const { client, fetchImpl } = clientReturning([]);
    expect(await findAcceptedConnection(client, 'bob')).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('emailBodyText', () => {
  it('prefers body_text and falls back to readable text from body_html', () => {
    expect(emailBodyText({ body_text: 'plain', body_html: '<p>html</p>' })).toBe('plain');
    expect(emailBodyText({ body_text: null, body_html: '<p>Hi &amp; bye</p><p>Line 2</p>' })).toBe('Hi & bye\nLine 2');
  });
});

describe('input helpers', () => {
  it('refuses text given twice so nothing is silently ignored', async () => {
    await expect(resolveText({ words: ['a'], flag: { name: '--message', value: 'b' } })).rejects.toBeInstanceOf(UsageError);
  });

  it('joins positional words', async () => {
    expect(await resolveText({ words: ['hello', 'there'] })).toBe('hello there');
  });

  it('checks backend length limits', () => {
    expect(() => checkLength('x'.repeat(501), { max: 500, what: 'Den message' })).toThrow('at most 500');
    expect(() => checkLength('short', { min: 10, max: 2000, what: 'Answer' })).toThrow('at least 10');
  });

  it('normalizes comma lists the way the backend does (lowercase, trimmed)', () => {
    expect(parseList(' Research, code-review ,research,')).toEqual(['research', 'code-review']);
  });
});

describe('limits', () => {
  it('validates explicit limits against the endpoint maximum', async () => {
    await expect(resolveLimit('101', 100)).rejects.toThrow('between 1 and 100');
    expect(await resolveLimit('5', 100)).toBe(5);
  });

  it('uses the page_size preference, capped at the maximum', async () => {
    fs.mkdirSync(getConfigDir(), { recursive: true });
    fs.writeFileSync(path.join(getConfigDir(), 'config.json'), JSON.stringify({ preferences: { page_size: 80 } }));
    try {
      expect(await resolveLimit(undefined, 100)).toBe(80);
      expect(await resolveLimit(undefined, 50)).toBe(50);
    } finally {
      fs.rmSync(path.join(getConfigDir(), 'config.json'));
    }
  });

  it('rejects negative offsets', () => {
    expect(() => parseOffset('-1')).toThrow(UsageError);
  });
});

describe('skill file', () => {
  const LIVE = '---\nname: moltbotden\nversion: 7.0.0\n---\n# Skill';

  it('recognizes a real skill file and its version', () => {
    expect(looksLikeSkillFile(LIVE)).toBe(true);
    expect(looksLikeSkillFile('<!doctype html><html>')).toBe(false);
    expect(skillVersion(LIVE)).toBe('7.0.0');
  });

  // Windows git checkouts turn the bundled copy's LF into CRLF.
  it('handles CRLF line endings', () => {
    const crlf = LIVE.replace(/\n/g, '\r\n');
    expect(looksLikeSkillFile(crlf)).toBe(true);
    expect(skillVersion(crlf)).toBe('7.0.0');
  });

  it('uses the live copy when it is valid', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(LIVE, { status: 200 }));
    const skill = await loadSkillFile({ url: 'https://x/skill.md', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(skill).toMatchObject({ source: 'live', version: '7.0.0', content: LIVE });
  });

  it('falls back to the bundled copy (a valid skill file) when offline', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const skill = await loadSkillFile({ url: 'https://x/skill.md', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(skill.source).toBe('bundled');
    expect(looksLikeSkillFile(skill.content)).toBe(true);
    expect(skill.fallbackReason).toContain('could not reach');
  });
});
