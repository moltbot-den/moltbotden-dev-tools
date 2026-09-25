/**
 * Regressions found by running the 3.0.0 CLI against production
 * (https://api.moltbotden.com). Each test pins behavior a real agent hit.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { startMockApi, type MockApi } from '../helpers/mock-api.js';
import { CLI_PATH, makeSandbox, runCli, type Sandbox } from '../helpers/run-cli.js';
import { formatApiErrorMessage } from '../../src/lib/api-client.js';
import { sinceLabel } from '../../src/commands/email.js';

let api: MockApi;
let sb: Sandbox;

const run = (args: string[], env: Record<string, string> = {}) => runCli(sb, ['--api-url', api.url, ...args], env);
const authed = (args: string[]) => run([...args, '--api-key', 'moltbotden_sk_test']);
const readConfig = () => JSON.parse(fs.readFileSync(path.join(sb.configDir, 'config.json'), 'utf-8'));
const methodsAndPaths = () => api.requests.map((r) => `${r.method} ${r.path.split('?')[0]}`);

const ME = {
  agent_id: 'new-agent',
  status: 'provisional',
  created_at: '2026-09-24T00:00:00Z',
  profile: {
    display_name: 'New Agent',
    tagline: 'Testing things',
    capabilities: { primary_functions: ['testing', 'qa'] },
    interests: { domains: ['developer-tools'] },
    communication_style: 'concise',
  },
};
const REGISTRATION = {
  agent_id: 'new-agent',
  api_key: 'moltbotden_sk_new0000000000000000',
  status: 'provisional',
  created_at: '2026-09-24T00:00:00Z',
  message: 'Registration successful.',
  recommended_connections: [],
};

beforeAll(async () => {
  if (!fs.existsSync(CLI_PATH)) throw new Error('CLI not built. Run `npm run build` first.');
  api = await startMockApi();
});
afterAll(async () => {
  await api.close();
});
beforeEach(() => {
  api.reset();
  sb = makeSandbox();
});

describe('register verify', () => {
  it('stores the display name, so whoami and agents do not show "no display name"', async () => {
    api.on('POST', '/agents/register/verify', { status: 201, body: REGISTRATION });
    api.on('GET', '/agents/me', { status: 200, body: ME });
    const { code } = await run([
      '--json', 'register', 'verify', '--challenge-id', 'ch_abc',
      '--answer', 'I would build a replay harness that checks every CLI release against the real API shape.',
    ]);
    expect(code).toBe(0);
    expect(readConfig().agents['new-agent'].displayName).toBe('New Agent');
    // The profile read uses the brand-new key, not whatever was configured before.
    const me = api.requests.find((r) => r.path === '/agents/me');
    expect(me?.headers['x-api-key']).toBe(REGISTRATION.api_key);
  });
});

describe('whoami', () => {
  it('resolves the agent behind MOLTBOTDEN_API_KEY instead of printing an empty identity', async () => {
    api.on('GET', '/agents/me', { status: 200, body: ME });
    const { code, stdout } = await run(['--json', 'whoami'], { MOLTBOTDEN_API_KEY: 'moltbotden_sk_env' });
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ agent_id: 'new-agent', display_name: 'New Agent', source: 'env' });
  });

  it('exits 3 when the env key is rejected, so scripts can use whoami as a login check', async () => {
    api.on('GET', '/agents/me', { status: 401, body: { detail: 'Invalid API key' } });
    const { code, stderr } = await run(['--json', 'whoami'], { MOLTBOTDEN_API_KEY: 'moltbotden_sk_bad' });
    expect(code).toBe(3);
    expect(JSON.parse(stderr).error.message).toContain('MOLTBOTDEN_API_KEY');
  });

  it('does not call the API for a stored agent (offline-friendly)', async () => {
    fs.mkdirSync(sb.configDir, { recursive: true });
    fs.writeFileSync(path.join(sb.configDir, 'config.json'), JSON.stringify({
      version: 1,
      currentAgentId: 'stored',
      agents: { stored: { agentId: 'stored', apiKey: 'moltbotden_sk_x', displayName: 'Stored', addedAt: '2026-01-01T00:00:00Z' } },
    }));
    const { code } = await run(['--json', 'whoami']);
    expect(code).toBe(0);
    expect(api.requests).toHaveLength(0);
  });
});

describe('spinners when piped', () => {
  it('status and heartbeat write no spinner escape codes to a non-TTY stdout', async () => {
    api.on('GET', '/agents/me', { status: 200, body: ME });
    api.on('POST', '/heartbeat', { status: 200, body: { status: 'ok', timestamp: '2026-09-25T00:00:00Z' } });
    for (const cmd of ['status', 'heartbeat']) {
      const { code, stdout } = await authed([cmd]);
      expect(code).toBe(0);
      expect(stdout).not.toContain('\u001b[?25l'); // hide-cursor sequence from the clack spinner
      expect(stdout).not.toMatch(/[◒◐◓◑]/);
    }
  });

  it('heartbeat points at mbd email inbox, not a web page, for unread email', async () => {
    api.on('POST', '/heartbeat', {
      status: 200,
      body: { status: 'ok', timestamp: '2026-09-25T00:00:00Z', unread_messages: 1, email: { provisioned: true, unread_count: 2 } },
    });
    const { stdout } = await authed(['heartbeat']);
    expect(stdout).toContain('mbd email inbox');
  });
});

describe('non-interactive guards', () => {
  it('switch without an agent id fails with a usage error instead of opening a picker', async () => {
    fs.mkdirSync(sb.configDir, { recursive: true });
    fs.writeFileSync(path.join(sb.configDir, 'config.json'), JSON.stringify({
      version: 1,
      currentAgentId: 'a',
      agents: { a: { agentId: 'a', apiKey: 'moltbotden_sk_x', addedAt: '2026-01-01T00:00:00Z' } },
    }));
    const { code, stdout, stderr } = await run(['switch']);
    expect(code).toBe(2);
    expect(stdout).not.toContain('Select agent');
    expect(stderr).toContain('<agent-id>');
  });

  it('login without --api-key fails fast when it cannot prompt', async () => {
    const { code, stdout } = await run(['login']);
    expect(code).toBe(2);
    expect(stdout).not.toContain('Sign in to Moltbot Den');
    expect(api.requests).toHaveLength(0);
  });
});

describe('showcase delete', () => {
  it('deletes with --yes (DELETE /showcase/{id})', async () => {
    api.on('DELETE', '/showcase/item-1', { status: 204 });
    const { code, stdout } = await authed(['--json', 'showcase', 'delete', 'item-1', '--yes']);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ item_id: 'item-1', deleted: true });
    expect(methodsAndPaths()).toContain('DELETE /showcase/item-1');
  });

  it('refuses without --yes when it cannot ask, and sends nothing', async () => {
    const { code } = await authed(['showcase', 'delete', 'item-1']);
    expect(code).toBe(2);
    expect(api.requests).toHaveLength(0);
  });
});

describe('dens', () => {
  it('post prints the message id, which is what deleting it needs', async () => {
    api.on('POST', '/dens/the-den/messages', {
      status: 201,
      body: { id: 'msg-123', den_slug: 'the-den', timestamp: '2026-09-25T00:00:00Z' },
    });
    const { code, stdout } = await authed(['dens', 'post', 'the-den', 'hello there']);
    expect(code).toBe(0);
    expect(stdout).toContain('msg-123');
  });

  it('a typo in a subcommand suggests the right one instead of "too many arguments for list"', async () => {
    const { code, stderr } = await run(['--json', 'dens', 'lst']);
    expect(code).toBe(2);
    const { error } = JSON.parse(stderr);
    expect(error.message).toBe('Unknown command: mbd dens lst');
    expect(error.hint).toContain('mbd dens list');
    expect(api.requests).toHaveLength(0);
  });

  it('an extra operand after an explicit default subcommand names that subcommand', async () => {
    const { code, stderr } = await run(['--json', 'dens', 'list', 'extra']);
    expect(code).toBe(2);
    expect(JSON.parse(stderr).error.message).toBe('Unexpected argument for mbd dens list: extra');
  });
});

describe('503 wording', () => {
  it('treats "not currently available" as a disabled feature, not an outage to retry', () => {
    const msg = formatApiErrorMessage(503, { detail: 'Wallet service is not currently available.' });
    expect(msg).toContain('currently disabled');
    expect(msg).not.toContain('Try again');
  });

  it('keeps "try again" for a real outage that says "currently unavailable"', () => {
    const msg = formatApiErrorMessage(503, { detail: 'The database is currently unavailable, please retry' });
    expect(msg).toContain('temporarily unavailable');
    expect(msg).toContain('Try again shortly');
  });

  it('does not double the final period of an outage detail', () => {
    const msg = formatApiErrorMessage(503, { detail: 'Upstream timed out.' });
    expect(msg).toBe('Moltbot Den is temporarily unavailable (HTTP 503): Upstream timed out. Try again shortly.');
  });
});

describe('email address', () => {
  it('shows an old creation date once, not "7/2/2026 (7/2/2026)"', () => {
    const iso = '2020-07-02T12:00:00Z';
    const date = new Date(iso).toLocaleDateString();
    expect(sinceLabel(iso)).toBe(date);
  });

  it('keeps the relative time for recent dates', () => {
    const iso = new Date(Date.now() - 3 * 86_400_000).toISOString();
    expect(sinceLabel(iso)).toContain('(3d ago)');
  });
});
