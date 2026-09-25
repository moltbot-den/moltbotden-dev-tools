/**
 * Credential and API URL resolution.
 *
 * Regression guard: the global --api-url used to carry a default value, so
 * MOLTBOTDEN_API_URL and the URL stored with each agent were ignored and
 * staging/local keys were sent to production.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Command } from 'commander';
import { AuthManager, resolveApiUrl } from '../../src/lib/auth-manager.js';
import { resolveContext, resolveBaseUrl } from '../../src/lib/context.js';
import { writeConfigFile } from '../../src/lib/config-store.js';
import { makeTempDir } from '../helpers/temp-dir.js';

const DEFAULT = 'https://api.moltbotden.com';

beforeEach(() => {
  process.env.MOLTBOTDEN_CONFIG_DIR = makeTempDir('auth');
  delete process.env.MOLTBOTDEN_API_KEY;
  delete process.env.MOLTBOTDEN_API_URL;
});

async function storeAgent(apiUrl: string, preferences: Record<string, unknown> = {}) {
  await writeConfigFile({
    version: 1,
    currentAgentId: 'stored-agent',
    agents: {
      'stored-agent': { agentId: 'stored-agent', apiKey: 'stored-key', apiUrl, addedAt: '2026-01-01' },
    },
    preferences,
  });
}

/** Build a program shaped like cli.ts (global options, no defaults) and parse argv. */
function programWith(argv: string[]): Command {
  const program = new Command();
  program.option('--json').option('--verbose').option('--api-key <key>').option('--api-url <url>');
  program.command('noop').action(() => {});
  program.parse(['node', 'mbd', ...argv, 'noop']);
  return program;
}

describe('resolveApiUrl precedence: flag > env > stored > preference > default', () => {
  const stored = { url: 'https://stored.example', source: 'config' as const };

  it('uses the flag over everything', () => {
    process.env.MOLTBOTDEN_API_URL = 'https://env.example';
    expect(resolveApiUrl({ flag: 'https://flag.example/', stored, preference: 'https://pref.example' }))
      .toEqual({ apiUrl: 'https://flag.example', apiUrlSource: 'flag' });
  });

  it('uses MOLTBOTDEN_API_URL over stored and preference', () => {
    process.env.MOLTBOTDEN_API_URL = 'https://env.example';
    expect(resolveApiUrl({ stored, preference: 'https://pref.example' }).apiUrl).toBe('https://env.example');
  });

  it('uses the URL stored with the credentials over the preference', () => {
    expect(resolveApiUrl({ stored, preference: 'https://pref.example' }).apiUrl).toBe('https://stored.example');
  });

  it('uses the api_url preference, then the default', () => {
    expect(resolveApiUrl({ preference: 'https://pref.example' }).apiUrl).toBe('https://pref.example');
    expect(resolveApiUrl({})).toEqual({ apiUrl: DEFAULT, apiUrlSource: 'default' });
  });
});

describe('resolveContext', () => {
  it('sends a stored staging agent to its own URL, not production', async () => {
    await storeAgent('https://staging.example');
    const ctx = await resolveContext(programWith([]), { requireAuth: true });
    expect(ctx.apiKey).toBe('stored-key');
    expect(ctx.apiUrl).toBe('https://staging.example');
    expect(ctx.client.baseUrl).toBe('https://staging.example');
  });

  it('lets MOLTBOTDEN_API_URL override the stored URL', async () => {
    await storeAgent('https://staging.example');
    process.env.MOLTBOTDEN_API_URL = 'http://localhost:8000';
    const ctx = await resolveContext(programWith([]));
    expect(ctx.apiUrl).toBe('http://localhost:8000');
    expect(ctx.apiUrlSource).toBe('env');
  });

  it('lets --api-url override env and stored URL', async () => {
    await storeAgent('https://staging.example');
    process.env.MOLTBOTDEN_API_URL = 'http://localhost:8000';
    const ctx = await resolveContext(programWith(['--api-url', 'http://127.0.0.1:9']));
    expect(ctx.apiUrl).toBe('http://127.0.0.1:9');
  });

  it('resolves a URL even when not logged in', async () => {
    const ctx = await resolveContext(programWith(['--json']));
    expect(ctx.auth).toBeNull();
    expect(ctx.json).toBe(true);
    expect(ctx.apiUrl).toBe(DEFAULT);
  });

  it('throws an auth error (exit code 3) when auth is required but missing', async () => {
    await expect(resolveContext(programWith([]), { requireAuth: true })).rejects.toMatchObject({
      exitCode: 3,
      message: 'Not authenticated',
    });
  });

  it('prefers --api-key over MOLTBOTDEN_API_KEY over stored config', async () => {
    await storeAgent('https://staging.example');
    process.env.MOLTBOTDEN_API_KEY = 'env-key';
    expect((await resolveContext(programWith(['--api-key', 'flag-key']))).apiKey).toBe('flag-key');
    expect((await resolveContext(programWith([]))).apiKey).toBe('env-key');
  });

  it('login/register ignore the stored agent URL (a new key may target another env)', async () => {
    await storeAgent('https://staging.example', { api_url: 'https://pref.example' });
    expect(await resolveBaseUrl(programWith([]))).toBe('https://pref.example');
  });
});

describe('AuthManager storage', () => {
  it('keeps preferences when saving an agent', async () => {
    await storeAgent(DEFAULT, { telemetry: true });
    await AuthManager.saveAgent('second', 'k2', { apiUrl: DEFAULT });
    const config = await AuthManager.readConfig();
    expect(config.preferences).toEqual({ telemetry: true });
    expect(Object.keys(config.agents).sort()).toEqual(['second', 'stored-agent']);
    expect(config.currentAgentId).toBe('second');
  });

  it('returns null when there are no credentials anywhere', async () => {
    const cwd = process.cwd();
    process.chdir(makeTempDir('empty-cwd'));
    try {
      await expect(AuthManager.getAuth()).resolves.toBeNull();
    } finally {
      process.chdir(cwd);
    }
  });
});
