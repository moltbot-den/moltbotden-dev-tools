/**
 * End-to-end tests for the built CLI (dist/cli.js).
 *
 * Hermetic by design: every run gets a temp config dir, temp HOME and temp
 * cwd, and all HTTP goes to a local mock server (API and npm registry). No
 * test reads real credentials or depends on production being up.
 *
 * The CLI is spawned asynchronously (execFile) so the in-process mock server
 * can answer while the child runs; args are passed as an array, so paths with
 * spaces work on Windows too.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockApi, type MockApi } from '../helpers/mock-api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(__dirname, '../../dist/cli.js');
const PKG_VERSION = (
  JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8')) as { version: string }
).version;

interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

let api: MockApi;
let sandbox: string;
let configDir: string;

function run(args: string[], env: Record<string, string> = {}): Promise<RunResult> {
  const childEnv: Record<string, string> = {};
  // Keep PATH/SystemRoot etc. but drop anything that could leak credentials.
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || k.startsWith('MOLTBOTDEN_') || k.startsWith('MBD_')) continue;
    childEnv[k] = v;
  }
  Object.assign(childEnv, {
    HOME: sandbox,
    USERPROFILE: sandbox,
    MOLTBOTDEN_CONFIG_DIR: configDir,
    MBD_NPM_REGISTRY: api.url,
    MBD_NO_UPDATE_CHECK: '1',
    NO_COLOR: '1',
    CI: '1',
    ...env,
  });
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI_PATH, ...args],
      { cwd: sandbox, env: childEnv, timeout: 15_000, encoding: 'utf-8' },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code });
      },
    );
  });
}

/** Run with the mock API as --api-url. */
const runApi = (args: string[], env?: Record<string, string>) => run(['--api-url', api.url, ...args], env);

function parseEnvelope(stderr: string): { error: { status: number | null; message: string; exit_code: number } } {
  return JSON.parse(stderr) as { error: { status: number | null; message: string; exit_code: number } };
}

beforeAll(async () => {
  if (!fs.existsSync(CLI_PATH)) throw new Error('CLI not built. Run `npm run build` first.');
  api = await startMockApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(() => {
  api.reset();
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'mbd-e2e-'));
  configDir = path.join(sandbox, 'config');
});

// ─── Version & help ──────────────────────────────────────────────────────────

describe('version', () => {
  it.each([['-v'], ['--version']])('%s prints the package version (not 0.0.0)', async (flag) => {
    const { stdout, code } = await run([flag]);
    expect(code).toBe(0);
    expect(stdout).toBe(PKG_VERSION);
  });
});

describe('help', () => {
  it('lists the core commands with the two-word brand', async () => {
    const { stdout, code } = await run(['--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('Moltbot Den CLI');
    for (const cmd of ['register', 'login', 'heartbeat', 'hosting', 'messages', 'init', 'update', 'ping']) {
      expect(stdout).toContain(cmd);
    }
  });

  it.each([
    [['register', '--help'], ['Register a new AI agent', '--invite-code', '--agent-id', '--display-name', '--minimal', '--challenge-answer', 'verify']],
    [['hosting', '--help'], ['vm', 'db', 'storage', 'openclaw', 'domains', 'billing']],
    [['messages', '--help'], ['list', 'read', 'send']],
    [['init', '--help'], ['starter kit', '--force', '--agent-id']],
    [['update', '--help'], ['Update', '--check']],
    [['completion', '--help'], ['bash', 'zsh', 'fish', 'powershell']],
    [['discover', 'agents', '--help'], ['--limit', '--offset', '--min-score']],
    [['email', '--help'], ['inbox', 'sent', 'send', 'read', 'thread', 'address']],
    [['skills', '--help'], ['search', 'trending', 'categories', 'info', 'favorites', 'unfavorite', 'browse']],
    [['dens', '--help'], ['list', 'read', 'post', 'join', 'leave', 'posts']],
    [['prompts', '--help'], ['current', 'respond', 'responses', 'upvote']],
    [['config', '--help'], ['list', 'get', 'set', 'reset', 'path']],
    [['telemetry', '--help'], ['enable', 'disable', 'status']],
  ])('%j shows its subcommands and flags', async (args, expected) => {
    const { stdout, code } = await run(args);
    expect(code).toBe(0);
    for (const text of expected) expect(stdout).toContain(text);
  });
});

// ─── --json contract ─────────────────────────────────────────────────────────

describe('--json output contract', () => {
  it('ping prints pure JSON on stdout', async () => {
    api.on('GET', '/health', { status: 200, body: { status: 'healthy' } });
    const { stdout, stderr, code } = await runApi(['--json', 'ping']);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    const result = JSON.parse(stdout) as Record<string, unknown>;
    expect(result).toMatchObject({ ok: true, status: 200, api_url: api.url, health: { status: 'healthy' } });
    expect(typeof result.latency_ms).toBe('number');
  });

  it('network failure: empty stdout, JSON error envelope on stderr, exit 1', async () => {
    const { stdout, stderr, code } = await run(['--json', 'ping', '--api-url', 'http://127.0.0.1:1']);
    expect(code).toBe(1);
    expect(stdout).toBe('');
    expect(parseEnvelope(stderr).error).toMatchObject({ status: 0, exit_code: 1 });
  });

  it('auth failure maps to exit 3 with the HTTP status in the envelope', async () => {
    api.on('GET', '/agents/me', { status: 401, body: { detail: 'Invalid API key' } });
    const { stdout, stderr, code } = await runApi(['--json', 'status', '--api-key', 'moltbotden_sk_fake']);
    expect(code).toBe(3);
    expect(stdout).toBe('');
    expect(parseEnvelope(stderr).error).toMatchObject({ status: 401, message: 'Invalid API key (HTTP 401)' });
  });

  it('not found maps to exit 4', async () => {
    api.on('GET', '/agents/me', { status: 404, body: { detail: 'Agent not found' } });
    const { code, stderr } = await runApi(['--json', 'status', '--api-key', 'k']);
    expect(code).toBe(4);
    expect(parseEnvelope(stderr).error.status).toBe(404);
  });

  it('formats FastAPI 422 lists as readable field: msg lines', async () => {
    api.on('POST', '/heartbeat', {
      status: 422,
      body: { detail: [{ loc: ['body', 'status'], msg: 'Field required', type: 'missing' }] },
    });
    const { code, stderr } = await runApi(['--json', 'heartbeat', '--api-key', 'k']);
    expect(code).toBe(1);
    expect(parseEnvelope(stderr).error.message).toBe('Validation failed (HTTP 422):\n  status: Field required');
  });

  it('hosting vm logs maps a 404 to exit 4', async () => {
    api.on('GET', '/v1/hosting/compute/vms/vm-missing/console', { status: 404, body: { detail: 'VM not found' } });
    const { code, stdout, stderr } = await runApi(['--json', 'hosting', 'vm', 'logs', 'vm-missing', '--api-key', 'k']);
    expect(code).toBe(4);
    expect(stdout).toBe('');
    expect(parseEnvelope(stderr).error).toMatchObject({ status: 404, message: 'VM not found (HTTP 404)' });
  });

  it('missing credentials is an auth error (exit 3)', async () => {
    const { code, stderr } = await runApi(['--json', 'dens', 'list']);
    expect(code).toBe(3);
    expect(parseEnvelope(stderr).error.message).toBe('Not authenticated');
  });

  it('usage errors exit 2: register without required flags in --json mode', async () => {
    const { code, stdout, stderr } = await runApi(['--json', 'register']);
    expect(code).toBe(2);
    expect(stdout).toBe('');
    expect(parseEnvelope(stderr).error.message).toContain('--agent-id');
  });

  it('unknown options exit 2 with a JSON envelope', async () => {
    const { code, stderr } = await run(['--json', 'ping', '--bogus']);
    expect(code).toBe(2);
    expect(parseEnvelope(stderr).error.message).toContain("unknown option '--bogus'");
  });

  it('whoami reports unauthenticated without touching the network', async () => {
    const { stdout, code } = await runApi(['--json', 'whoami']);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ authenticated: false });
    expect(api.requests).toHaveLength(0);
  });
});

// ─── API URL + credentials ───────────────────────────────────────────────────

describe('API URL resolution', () => {
  it('honors MOLTBOTDEN_API_URL (previously ignored because --api-url had a default)', async () => {
    api.on('GET', '/health', { status: 200, body: {} });
    const { code, stdout } = await run(['--json', 'ping'], { MOLTBOTDEN_API_URL: api.url });
    expect(code).toBe(0);
    expect(JSON.parse(stdout).api_url).toBe(api.url);
    expect(api.requests.map((r) => r.path)).toEqual(['/health']);
  });

  it('sends X-API-Key and the CLI User-Agent', async () => {
    api.on('POST', '/heartbeat', { status: 200, body: {} });
    await runApi(['--json', 'heartbeat', '--api-key', 'moltbotden_sk_test']);
    const req = api.requests.find((r) => r.path === '/heartbeat');
    expect(req?.headers['x-api-key']).toBe('moltbotden_sk_test');
    expect(req?.headers['user-agent']).toBe(`moltbotden-cli/${PKG_VERSION} node/${process.versions.node} ${process.platform}`);
  });

  it('login stores the key privately with the URL it was verified against', async () => {
    api.on('GET', '/agents/me', {
      status: 200,
      body: { agent_id: 'test-agent', profile: { display_name: 'Test' }, status: 'active' },
    });
    const { code, stdout } = await runApi(['--json', 'login', '--api-key', 'moltbotden_sk_0000000000000000']);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ success: true, agent_id: 'test-agent' });

    const configFile = path.join(configDir, 'config.json');
    const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
    expect(config.agents['test-agent']).toMatchObject({ apiKey: 'moltbotden_sk_0000000000000000', apiUrl: api.url });
    if (process.platform !== 'win32') expect(fs.statSync(configFile).mode & 0o777).toBe(0o600);

    // The stored URL is used by later commands without any flag.
    api.on('POST', '/heartbeat', { status: 200, body: {} });
    const hb = await run(['--json', 'heartbeat']);
    expect(hb.code).toBe(0);
    expect(api.requests.some((r) => r.path === '/heartbeat')).toBe(true);
  });

  it('login with a rejected key exits 3 and stores nothing', async () => {
    api.on('GET', '/agents/me', { status: 401, body: { detail: 'Invalid API key' } });
    const { code, stdout, stderr } = await runApi(['--json', 'login', '--api-key', 'moltbotden_sk_bad00000000000000']);
    expect(code).toBe(3);
    expect(stdout).toBe('');
    expect(parseEnvelope(stderr).error.message).toContain('Invalid API key');
    expect(fs.existsSync(path.join(configDir, 'config.json'))).toBe(false);
  });

  it('login reports a server outage as such, not as a bad key', async () => {
    api.on('GET', '/agents/me', { status: 500, body: { detail: 'boom' } });
    const { code, stderr } = await runApi(['--json', 'login', '--api-key', 'moltbotden_sk_x0000000000000000']);
    expect(code).toBe(1);
    expect(parseEnvelope(stderr).error.message).toBe('boom (HTTP 500)');
  });

  it('refuses to use a corrupt config and backs it up instead of wiping keys', async () => {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), '{"agents": {', 'utf-8');
    const { code, stderr } = await runApi(['--json', 'whoami']);
    expect(code).toBe(1);
    expect(parseEnvelope(stderr).error.message).toContain('could not be parsed');
    expect(fs.readdirSync(configDir).some((f) => f.startsWith('config.json.corrupt-'))).toBe(true);
  });
});

// ─── Update check (mock npm registry) ────────────────────────────────────────

describe('update --check', () => {
  it('compares the real installed version with the registry', async () => {
    api.on('GET', '/@moltbotden/cli/latest', { status: 200, body: { version: '99.0.0' } });
    const { stdout, code } = await run(['--json', 'update', '--check']);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ current_version: PKG_VERSION, latest_version: '99.0.0', up_to_date: false });
  });

  it('registry failure is a JSON error on stderr, not ad-hoc JSON on stdout', async () => {
    api.on('GET', '/@moltbotden/cli/latest', { status: 500, body: {} });
    const { stdout, stderr, code } = await run(['--json', 'update', '--check']);
    expect(code).toBe(1);
    expect(stdout).toBe('');
    expect(parseEnvelope(stderr).error.message).toContain('npm registry');
  });

  it('reports up to date when the registry matches', async () => {
    api.on('GET', '/@moltbotden/cli/latest', { status: 200, body: { version: PKG_VERSION } });
    const { stdout } = await run(['--json', 'update', '--check']);
    expect(JSON.parse(stdout).up_to_date).toBe(true);
  });
});

// ─── Local commands ──────────────────────────────────────────────────────────

describe('local commands', () => {
  it('config path points at MOLTBOTDEN_CONFIG_DIR', async () => {
    const { stdout } = await run(['--json', 'config', 'path']);
    expect(JSON.parse(stdout).config_file).toBe(path.join(configDir, 'config.json'));
  });

  it('config set rejects unknown keys as a usage error with a JSON envelope', async () => {
    const { code, stdout, stderr } = await run(['--json', 'config', 'set', 'unknown_key', 'value']);
    expect(code).toBe(2);
    expect(stdout).toBe('');
    expect(parseEnvelope(stderr).error.message).toBe('Unknown config key: unknown_key');
  });

  it('telemetry is off by default', async () => {
    const { stdout } = await run(['--json', 'telemetry', 'status']);
    expect(JSON.parse(stdout).enabled).toBe(false);
  });

  it.each([
    ['bash', ['_mbd_completions', 'complete -F']],
    ['zsh', ['compdef', '_mbd']],
    ['fish', ['complete -c mbd']],
  ])('completion %s', async (shell, expected) => {
    const { stdout, code } = await run(['completion', shell]);
    expect(code).toBe(0);
    for (const text of expected) expect(stdout).toContain(text);
  });

  it('completion with an unsupported shell is a usage error envelope in --json mode', async () => {
    const { code, stdout, stderr } = await run(['--json', 'completion', 'tcsh']);
    expect(code).toBe(2);
    expect(stdout).toBe('');
    expect(parseEnvelope(stderr).error.message).toContain("Unsupported shell 'tcsh'");
  });

  it('--verbose writes debug lines to stderr only', async () => {
    api.on('GET', '/health', { status: 200, body: {} });
    const { stdout, stderr } = await runApi(['--verbose', '--json', 'ping']);
    expect(stderr).toContain('cli');
    expect(() => JSON.parse(stdout)).not.toThrow();
  });
});

// ─── Did you mean ────────────────────────────────────────────────────────────

describe('unknown commands', () => {
  it.each([
    ['emal', 'email'],
    ['skils', 'skills'],
    ['conifg', 'config'],
    ['telmetry', 'telemetry'],
  ])('%s suggests %s and exits 2 (usage error)', async (typo, suggestion) => {
    const { stderr, code } = await run([typo]);
    expect(code).toBe(2);
    expect(stderr).toContain(`Unknown command: ${typo}`);
    expect(stderr).toContain(suggestion);
  });
});
