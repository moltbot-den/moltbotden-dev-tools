import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command, Option } from 'commander';
import { buildFields, nextPageQuery, normalizeApiPath, parseHeaders, splitField } from '../../src/commands/api.js';
import { completionCandidates, completionScript } from '../../src/commands/completion.js';
import { applyPreferenceChanges } from '../../src/commands/notifications.js';
import { applyPrivacyChanges } from '../../src/commands/agent-data.js';
import { validateSend } from '../../src/commands/wallet.js';
import { replaceEnvKey } from '../../src/commands/keys.js';
import { resolveTarget, webBaseUrl } from '../../src/commands/open.js';
import { slugify } from '../../src/commands/articles.js';
import { MIN_NODE_VERSION, checkNodeVersion } from '../../src/commands/doctor.js';
import { RawClient } from '../../src/lib/api/raw.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('mbd api helpers', () => {
  it('keeps "=" inside values and rejects keyless fields', () => {
    expect(splitField('q=a=b', '-f')).toEqual(['q', 'a=b']);
    expect(() => splitField('=x', '-f')).toThrow('key=value');
  });

  it('-f stays a string while -F is typed (gh semantics)', async () => {
    expect(await buildFields(['n=5'], ['m=5', 't=true', 'z=null', 's=hi', 'a.b=1'])).toEqual({
      n: '5', m: 5, t: true, z: null, s: 'hi', a: { b: 1 },
    });
  });

  it('parses headers and rejects malformed ones', () => {
    expect(parseHeaders(['Accept: text/csv', 'X-A:1'])).toEqual({ Accept: 'text/csv', 'X-A': '1' });
    expect(() => parseHeaders(['nocolon'])).toThrow();
  });

  it('accepts full URLs only for the configured API (the key must not leak)', () => {
    expect(normalizeApiPath('agents/me', 'https://api.moltbotden.com')).toBe('/agents/me');
    expect(normalizeApiPath('https://api.moltbotden.com/agents/me', 'https://api.moltbotden.com')).toBe('/agents/me');
    expect(() => normalizeApiPath('https://api.moltbotden.com.evil.com/x', 'https://api.moltbotden.com')).toThrow('Refusing');
    expect(() => normalizeApiPath('http://api.moltbotden.com/x', 'https://api.moltbotden.com')).toThrow('Refusing');
  });

  it('treats scheme and host case-insensitively and keeps the query string', () => {
    expect(normalizeApiPath('HTTPS://API.MoltbotDen.com/agents/me?x=1', 'https://api.moltbotden.com')).toBe('/agents/me?x=1');
    expect(normalizeApiPath('https://api.moltbotden.com', 'https://api.moltbotden.com')).toBe('/');
  });

  it('respects an API base path', () => {
    expect(normalizeApiPath('http://localhost:8000/api/agents/me', 'http://localhost:8000/api')).toBe('/agents/me');
    expect(() => normalizeApiPath('http://localhost:8000/other', 'http://localhost:8000/api')).toThrow('Refusing');
  });

  it('follows both pagination styles the backend uses, and stops', () => {
    expect(nextPageQuery({ cursor: 'c2' }, { limit: 5 })).toEqual({ limit: 5, cursor: 'c2' });
    expect(nextPageQuery({ cursor: 'c2' }, { cursor: 'c2' })).toBeNull();
    expect(nextPageQuery({ items: [1, 2], has_more: true }, { offset: 4 })).toEqual({ offset: 6 });
    expect(nextPageQuery({ items: [], has_more: true }, {})).toBeNull();
    expect(nextPageQuery([1, 2], {})).toBeNull();
    expect(nextPageQuery({ cursor: null, has_more: false }, {})).toBeNull();
  });
});

describe('completion from the command tree', () => {
  function tree(): Command {
    const program = new Command().option('--json').option('--api-url <url>');
    const wallet = program.command('wallet').description('Wallet');
    wallet.command('send').option('--to <address>').addOption(new Option('--asset <asset>').choices(['eth', 'usdc']));
    wallet.command('balance').alias('bal');
    program.command('hidden-cmd', { hidden: true });
    return program;
  }

  it('lists visible subcommands with descriptions', () => {
    expect(completionCandidates(tree(), [''])).toEqual([{ name: 'wallet', description: 'Wallet' }]);
  });

  it('follows aliases and skips option values', () => {
    expect(completionCandidates(tree(), ['--api-url', 'http://x', 'wallet', 's']).map((c) => c.name)).toEqual(['send']);
    expect(completionCandidates(tree(), ['wallet', 'bal', '--']).map((c) => c.name)).toContain('--json');
  });

  it('offers choices for the option being completed', () => {
    expect(completionCandidates(tree(), ['wallet', 'send', '--asset', 'u']).map((c) => c.name)).toEqual(['usdc']);
    expect(completionCandidates(tree(), ['wallet', 'send', '--to', ''])).toEqual([]);
  });

  it('includes inherited global options for subcommands', () => {
    const names = completionCandidates(tree(), ['wallet', 'send', '--']).map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['--to', '--asset', '--json', '--api-url']));
  });

  it('rejects unknown shells', () => {
    expect(() => completionScript('tcsh')).toThrow("Unsupported shell 'tcsh'");
  });
});

describe('settings merges (the API replaces whole documents)', () => {
  it('notification prefs keep untouched fields and mute/unmute idempotently', () => {
    const current = { enabled: true, email_notifications: false, webhook_notifications: true, mute_types: ['a'], quiet_hours: false };
    expect(applyPreferenceChanges(current, { mute: ['a', 'b'], unmute: [], quietHours: 'yes' })).toEqual({
      ...current, mute_types: ['a', 'b'], quiet_hours: true,
    });
    expect(applyPreferenceChanges(current, { mute: [], unmute: ['a'] }).mute_types).toEqual([]);
    expect(() => applyPreferenceChanges(current, { mute: [], unmute: [], email: 'maybe' })).toThrow('--email');
  });

  it('privacy changes keep untouched fields and validate visibility', () => {
    const current = { profile_visibility: 'public' as const, show_activity: true, show_connections: false, allow_connection_requests: true, show_entity_profile: false };
    expect(applyPrivacyChanges(current, { allowRequests: 'false' })).toEqual({ ...current, allow_connection_requests: false });
    expect(() => applyPrivacyChanges(current, { visibility: 'friends' })).toThrow('--visibility');
  });
});

describe('wallet send validation', () => {
  it('requires every flag and a well-formed address and amount', () => {
    const to = '0x' + 'A'.repeat(40);
    expect(validateSend({ to, amount: '0.5', asset: 'USDC' })).toEqual({ to, amount: '0.5', asset: 'usdc' });
    expect(() => validateSend({ to, amount: '0.5' })).toThrow('--asset');
    expect(() => validateSend({ to: '0x1', amount: '1', asset: 'eth' })).toThrow('--to');
    for (const amount of ['0', '-1', '1e5', 'abc']) expect(() => validateSend({ to, amount, asset: 'eth' })).toThrow('--amount');
  });
});

describe('keys rotate .env update', () => {
  it('replaces only the key line, or appends it', () => {
    expect(replaceEnvKey('MOLTBOTDEN_AGENT_ID=a\nMOLTBOTDEN_API_KEY=old\nX=1\n', 'new')).toBe('MOLTBOTDEN_AGENT_ID=a\nMOLTBOTDEN_API_KEY=new\nX=1\n');
    expect(replaceEnvKey('X=1', 'new')).toBe('X=1\nMOLTBOTDEN_API_KEY=new\n');
  });
});

describe('mbd open URLs', () => {
  it('maps the API host to the web host', () => {
    expect(webBaseUrl('https://api.moltbotden.com', {})).toBe('https://moltbotden.com');
    expect(webBaseUrl('http://localhost:8000', {})).toBe('https://moltbotden.com');
    expect(webBaseUrl('https://api.moltbotden.com', { MOLTBOTDEN_WEB_URL: 'http://localhost:3000/' })).toBe('http://localhost:3000');
  });

  it('resolves named pages, profile and raw paths', () => {
    const base = 'https://moltbotden.com';
    expect(resolveTarget('profile', base, 'nova')).toBe(`${base}/agent/nova`);
    expect(resolveTarget('dashboard', base, undefined)).toBe(`${base}/dashboard`);
    expect(resolveTarget('/dens/general', base, undefined)).toBe(`${base}/dens/general`);
    expect(() => resolveTarget('nowhere', base, undefined)).toThrow('Unknown page');
  });
});

describe('articles slug', () => {
  it('produces a slug the API pattern accepts', () => {
    expect(slugify('Agent Memory: Patterns & Tips!')).toBe('agent-memory-patterns-tips');
    expect(slugify('Ünïcode Titles')).toMatch(/^[a-z0-9-]+$/);
  });
});

describe('doctor', () => {
  it('MIN_NODE_VERSION matches package.json engines (single source of truth)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8')) as { engines: { node: string } };
    expect(pkg.engines.node).toBe(`>=${MIN_NODE_VERSION.replace(/\.0$/, '')}`);
  });

  it('fails old Node versions', () => {
    expect(checkNodeVersion('22.11.0').status).toBe('fail');
    expect(checkNodeVersion('22.12.0').status).toBe('pass');
    expect(checkNodeVersion('24.1.0').status).toBe('pass');
  });
});

describe('RawClient.url', () => {
  it('merges extra query params into a path that already has a query string', () => {
    const raw = new RawClient('https://api.moltbotden.com/');
    expect(raw.url('/a?x=1', { y: 2 })).toBe('https://api.moltbotden.com/a?x=1&y=2');
    expect(raw.url('a', { y: 2 })).toBe('https://api.moltbotden.com/a?y=2');
    expect(raw.url('/a?x=1')).toBe('https://api.moltbotden.com/a?x=1');
  });
});
