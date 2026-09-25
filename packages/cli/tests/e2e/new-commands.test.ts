/**
 * End-to-end tests for the command groups added in the CLI overhaul:
 * api, mcp, doctor, notifications, connections, interest, wallet, showcase,
 * articles, invites, keys, agent, open, and tree-driven completion.
 *
 * Each test runs dist/cli.js against the in-process mock API and asserts the
 * exact request the backend receives (method, path, query, body, headers),
 * because a wrong shape there is a silent production bug.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { startMockApi, type MockApi, type RecordedRequest } from '../helpers/mock-api.js';
import { CLI_PATH, makeSandbox, runCli, type Sandbox } from '../helpers/run-cli.js';

let api: MockApi;
let sb: Sandbox;
const KEY = 'moltbotden_sk_testkey000000000000';
const posix = process.platform !== 'win32';

/** Run authenticated against the mock API. */
const run = (args: string[], env: Record<string, string> = {}, input?: string) =>
  runCli(sb, ['--api-url', api.url, ...args], { MOLTBOTDEN_API_KEY: KEY, ...env }, { input });

const find = (method: string, pathPrefix: string): RecordedRequest | undefined =>
  api.requests.find((r) => r.method === method && r.path.split('?')[0] === pathPrefix);
const query = (r: RecordedRequest | undefined) => new URL(`http://x${r?.path ?? '/'}`).searchParams;
const body = (r: RecordedRequest | undefined) => JSON.parse(r?.body || 'null') as Record<string, unknown>;

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
afterEach(() => {
  fs.rmSync(sb.dir, { recursive: true, force: true });
});

// ─── Help ────────────────────────────────────────────────────────────────────

describe('help', () => {
  // Every new command documents itself with runnable examples.
  it.each([
    ['api'], ['mcp', 'install'], ['mcp', 'status'], ['mcp', 'tools'], ['doctor'],
    ['notifications', 'list'], ['notifications', 'prefs'], ['connections', 'respond'], ['connections', 'export'],
    ['interest', 'outgoing'], ['wallet', 'send'], ['wallet', 'history'], ['showcase', 'create'],
    ['articles', 'submit'], ['invites', 'create'], ['keys', 'rotate'], ['agent', 'export'],
    ['agent', 'privacy', 'set'], ['open'], ['completion'],
  ])('%s %s has an Examples block', async (...cmd) => {
    const { stdout, code } = await runCli(sb, [...cmd.filter(Boolean), '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('Examples');
    expect(stdout).toContain('mbd ');
  });
});

// ─── api ─────────────────────────────────────────────────────────────────────

describe('mbd api', () => {
  it('-X GET sends fields as query params with the API key, and prints the raw body when piped', async () => {
    api.on('GET', '/notifications', { status: 200, body: { notifications: [], cursor: null } });
    const { stdout, code } = await run(['api', '-X', 'GET', '/notifications', '-f', 'limit=5', '-F', 'unread_only=true']);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ notifications: [], cursor: null });
    const req = find('GET', '/notifications');
    expect(query(req).get('limit')).toBe('5');
    expect(query(req).get('unread_only')).toBe('true');
    expect(req?.headers['x-api-key']).toBe(KEY);
  });

  it('fields switch the method to POST with a typed, nested JSON body', async () => {
    api.on('POST', '/showcase', { status: 201, body: { id: 'x' } });
    const { code } = await run(['api', 'showcase', '-f', 'title=Hello', '-F', 'meta.count=3', '-F', 'draft=false']);
    expect(code).toBe(0);
    const req = find('POST', '/showcase');
    expect(req?.headers['content-type']).toBe('application/json');
    expect(body(req)).toEqual({ title: 'Hello', meta: { count: 3 }, draft: false });
  });

  it('--input - sends stdin verbatim as the body', async () => {
    api.on('PATCH', '/agents/me', { status: 200, body: {} });
    await run(['api', '-X', 'PATCH', '/agents/me', '--input', '-'], {}, '{"profile":{"tagline":"hi"}}');
    expect(find('PATCH', '/agents/me')?.body).toBe('{"profile":{"tagline":"hi"}}');
  });

  it('--jq filters with real jq and prints strings raw', async () => {
    api.on('GET', '/agents/me', { status: 200, body: { profile: { display_name: 'Nova' }, tags: ['a', 'b'] } });
    const { stdout, code } = await run(['api', '/agents/me', '--jq', '.profile.display_name, (.tags | length)']);
    expect(code).toBe(0);
    expect(stdout).toBe('Nova\n2');
  });

  it('an invalid jq expression is a usage error (exit 2)', async () => {
    api.on('GET', '/agents/me', { status: 200, body: {} });
    const { code, stderr } = await run(['api', '/agents/me', '--jq', '.a | bad(']);
    expect(code).toBe(2);
    expect(stderr).toContain('--jq');
  });

  it('HTTP errors still print the body, and the exit code follows the status', async () => {
    const { stdout, code } = await run(['api', '/does-not-exist']);
    expect(code).toBe(4);
    expect(JSON.parse(stdout)).toEqual({ detail: 'Not Found' });
  });

  it('-i prints the status line and headers', async () => {
    api.on('GET', '/health', { status: 200, body: { ok: true }, headers: { 'x-test': 'yes' } });
    const { stdout } = await run(['api', '-i', '/health']);
    expect(stdout).toMatch(/^HTTP 200 OK/);
    expect(stdout).toContain('x-test: yes');
  });

  it('--paginate follows the cursor until it stops changing', async () => {
    api.on('GET', '/notifications', { status: 200, body: { notifications: [{ id: 'n1' }], cursor: 'c1' } });
    const { code } = await run(['api', '/notifications', '--paginate']);
    expect(code).toBe(0);
    const calls = api.requests.filter((r) => r.path.startsWith('/notifications'));
    expect(calls).toHaveLength(2);
    expect(query(calls[1]).get('cursor')).toBe('c1');
  });

  it.each([['-X', 'DELETE'], ['-X', 'HEAD'], ['-X', 'POST']])('--paginate is refused for %s %s (never repeat a write)', async (...flag) => {
    const { code, stderr } = await run(['api', ...flag, '/notifications', '--paginate']);
    expect(code).toBe(2);
    expect(stderr).toContain('--paginate only works with GET');
    expect(api.requests).toHaveLength(0);
  });

  it('refuses to send the API key to another host', async () => {
    const { code, stderr } = await run(['api', 'https://example.com/agents/me']);
    expect(code).toBe(2);
    expect(stderr).toContain('Refusing to send your API key');
    expect(api.requests).toHaveLength(0);
  });
});

// ─── mcp ─────────────────────────────────────────────────────────────────────

describe('mbd mcp', () => {
  const mcpRoute = () => {
    // One route answers initialize, notifications/initialized and tools/list.
    api.on('POST', '/mcp', {
      status: 200,
      headers: { 'MCP-Session-Id': 'sess-1' },
      body: { jsonrpc: '2.0', id: 1, result: { sessionId: 'sess-1', tools: [{ name: 'agent_search', description: 'Find agents' }] } },
    });
    api.on('DELETE', '/mcp', { status: 204 });
  };

  it('tools runs the full session handshake and closes the session', async () => {
    mcpRoute();
    const { stdout, code } = await run(['--json', 'mcp', 'tools']);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual([{ name: 'agent_search', description: 'Find agents' }]);

    const posts = api.requests.filter((r) => r.method === 'POST' && r.path === '/mcp').map((r) => ({ ...r, json: body(r) }));
    expect(posts.map((p) => p.json.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list']);
    expect(posts[0].headers['x-api-key']).toBe(KEY);
    // The server rejects non-initialize calls without these two headers.
    expect(posts[2].headers['mcp-session-id']).toBe('sess-1');
    expect(posts[2].headers['mcp-protocol-version']).toBe('2025-11-25');
    expect(posts[1].json).not.toHaveProperty('id'); // notifications carry no id
    expect(find('DELETE', '/mcp')?.headers['mcp-session-id']).toBe('sess-1');
  });

  it('status reports health and tool count', async () => {
    mcpRoute();
    api.on('GET', '/mcp/health', { status: 200, body: { status: 'healthy', protocol_version: '2025-11-25', active_sessions: 3, service: 'mcp' } });
    const { stdout, code } = await run(['--json', 'mcp', 'status']);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ status: 'healthy', session_ok: true, tool_count: 1, endpoint: `${api.url}/mcp` });
  });

  it('install --client cursor merges into an existing config, backs it up, and writes 0600', async () => {
    const file = path.join(sb.home, '.cursor', 'mcp.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ mcpServers: { other: { url: 'https://other/mcp' } }, theme: 'dark' }));
    const { stdout, code } = await run(['--json', 'mcp', 'install', '--client', 'cursor']);
    expect(code).toBe(0);
    const result = JSON.parse(stdout);
    expect(result).toMatchObject({ client: 'cursor', path: file, auth: 'api-key' });
    const config = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(config.theme).toBe('dark');
    expect(config.mcpServers.other).toEqual({ url: 'https://other/mcp' });
    expect(config.mcpServers.moltbotden).toEqual({ url: `${api.url}/mcp`, headers: { Authorization: `Bearer ${KEY}` } });
    expect(fs.existsSync(result.backup)).toBe(true);
    if (posix) expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('install refuses to overwrite a config it cannot parse', async () => {
    const file = path.join(sb.home, '.codeium', 'windsurf', 'mcp_config.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{ // not json');
    const { code, stderr } = await run(['mcp', 'install', '--client', 'windsurf']);
    expect(code).toBe(1);
    expect(stderr).toContain('left untouched');
    expect(fs.readFileSync(file, 'utf-8')).toBe('{ // not json');
  });

  it('install --client vscode --scope project writes .vscode/mcp.json and gitignores it', async () => {
    fs.writeFileSync(path.join(sb.dir, '.gitignore'), 'node_modules\n');
    const { code } = await run(['mcp', 'install', '--client', 'vscode', '--scope', 'project']);
    expect(code).toBe(0);
    const config = JSON.parse(fs.readFileSync(path.join(sb.dir, '.vscode', 'mcp.json'), 'utf-8'));
    expect(config.servers.moltbotden).toMatchObject({ type: 'http', url: `${api.url}/mcp` });
    expect(fs.readFileSync(path.join(sb.dir, '.gitignore'), 'utf-8')).toContain('.vscode/mcp.json');
  });

  it('install --oauth writes no key and needs no login', async () => {
    const { code } = await runCli(sb, ['--api-url', api.url, 'mcp', 'install', '--client', 'codex', '--oauth']);
    expect(code).toBe(0);
    const toml = fs.readFileSync(path.join(sb.home, '.codex', 'config.toml'), 'utf-8');
    expect(toml).toBe(`[mcp_servers.moltbotden]\nurl = "${api.url}/mcp"\n`);
  });

  it('install --client claude-code falls back to ~/.claude.json when the claude CLI is absent', async () => {
    const { code } = await run(['mcp', 'install', '--client', 'claude-code'], { PATH: path.join(sb.dir, 'empty-bin') });
    expect(code).toBe(0);
    const config = JSON.parse(fs.readFileSync(path.join(sb.home, '.claude.json'), 'utf-8'));
    expect(config.mcpServers.moltbotden).toEqual({ type: 'http', url: `${api.url}/mcp`, headers: { Authorization: `Bearer ${KEY}` } });
  });

  it.runIf(posix)('install --client claude-code uses "claude mcp add" when claude is on PATH', async () => {
    const bin = path.join(sb.dir, 'bin');
    const log = path.join(sb.dir, 'claude-args.log');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\necho "$@" >> "${log}"\n`, { mode: 0o755 });
    const { code } = await run(['mcp', 'install', '--client', 'claude-code'], { PATH: bin });
    expect(code).toBe(0);
    const calls = fs.readFileSync(log, 'utf-8').trim().split('\n');
    expect(calls[0]).toBe('mcp remove moltbotden --scope user');
    expect(calls[1]).toBe(`mcp add --transport http --scope user moltbotden ${api.url}/mcp --header Authorization: Bearer ${KEY}`);
    expect(fs.existsSync(path.join(sb.home, '.claude.json'))).toBe(false);
  });

  it('install rejects a scope the client does not have', async () => {
    const { code, stderr } = await run(['mcp', 'install', '--client', 'claude-desktop', '--scope', 'project']);
    expect(code).toBe(2);
    expect(stderr).toContain('no project-scoped config');
  });
});

// ─── doctor ──────────────────────────────────────────────────────────────────

describe('mbd doctor', () => {
  it('passes with a valid key and reachable API; --json is one document', async () => {
    api.on('GET', '/health', { status: 200, body: {}, headers: { Date: new Date().toUTCString() } });
    api.on('GET', '/agents/me', { status: 200, body: { agent_id: 'nova', status: 'active' } });
    api.on('GET', '/@moltbotden/cli/latest', { status: 200, body: { version: '0.0.1' } });
    const { stdout, code } = await run(['--json', 'doctor'], { MBD_NPM_REGISTRY: api.url });
    expect(code).toBe(0);
    const report = JSON.parse(stdout);
    expect(report.ok).toBe(true);
    const byId = Object.fromEntries(report.checks.map((c: { id: string; status: string }) => [c.id, c.status]));
    expect(byId).toMatchObject({ node: 'pass', auth: 'pass', api: 'pass', clock: 'pass', update: 'pass', mcp: 'warn' });
  });

  it('exits 1 with a fix when the API rejects the key', async () => {
    api.on('GET', '/health', { status: 200, body: {} });
    api.on('GET', '/agents/me', { status: 401, body: { detail: 'Invalid API key' } });
    const { stdout, code } = await run(['doctor'], { MBD_NPM_REGISTRY: api.url });
    expect(code).toBe(1);
    expect(stdout).toContain('✗ Credentials');
    expect(stdout).toContain('fix: mbd login');
  });

  it.runIf(posix)('flags a world-readable config file', async () => {
    fs.mkdirSync(sb.configDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(sb.configDir, 0o700);
    fs.writeFileSync(path.join(sb.configDir, 'config.json'), '{}', { mode: 0o644 });
    fs.chmodSync(path.join(sb.configDir, 'config.json'), 0o644);
    api.on('GET', '/health', { status: 200, body: {} });
    api.on('GET', '/agents/me', { status: 200, body: {} });
    const { stdout, code } = await run(['--json', 'doctor'], { MBD_NPM_REGISTRY: api.url });
    expect(code).toBe(1);
    const perms = JSON.parse(stdout).checks.find((c: { id: string }) => c.id === 'config-perms');
    expect(perms).toMatchObject({ status: 'fail' });
    expect(perms.fix).toContain('chmod 600');
  });
});

// ─── notifications ───────────────────────────────────────────────────────────

describe('mbd notifications', () => {
  it('list passes filters and shows a next-page command', async () => {
    api.on('GET', '/notifications', {
      status: 200,
      body: {
        notifications: [{ id: 'n1', agent_id: 'me', type: 'dm_received', title: 'New message', body: 'hi', read: false, priority: 'high', created_at: new Date().toISOString() }],
        total: 5, unread_count: 1, cursor: 'n1',
      },
    });
    const { stdout, code } = await run(['notifications', 'list', '--unread', '--limit', '1']);
    expect(code).toBe(0);
    expect(stdout).toContain('New message');
    expect(stdout).toContain('mbd notifications list --unread --limit 1 --cursor n1');
    const q = query(find('GET', '/notifications'));
    expect(q.get('unread_only')).toBe('true');
    expect(q.get('limit')).toBe('1');
  });

  it('prefs sends the full document so unspecified settings are not reset', async () => {
    // PATCH /notifications/preferences replaces the whole model: a partial
    // body would silently reset email/webhook to their defaults.
    api.on('GET', '/notifications/preferences', {
      status: 200,
      body: { enabled: true, email_notifications: false, webhook_notifications: false, mute_types: ['promotion'], quiet_hours: true },
    });
    api.on('PATCH', '/notifications/preferences', { status: 200, body: { status: 'updated', enabled: true, email_notifications: false, webhook_notifications: false, mute_types: ['promotion', 'post_like'], quiet_hours: true } });
    const { code } = await run(['--json', 'notifications', 'prefs', '--mute', 'post_like']);
    expect(code).toBe(0);
    expect(body(find('PATCH', '/notifications/preferences'))).toEqual({
      enabled: true, email_notifications: false, webhook_notifications: false, mute_types: ['promotion', 'post_like'], quiet_hours: true,
    });
  });

  it('read-all and read <id> hit the right endpoints', async () => {
    api.on('POST', '/notifications/read-all', { status: 200, body: { status: 'ok', marked: 3 } });
    api.on('POST', '/notifications/n%201/read', { status: 200, body: { status: 'read' } });
    expect((await run(['notifications', 'read-all'])).stdout).toContain('Marked 3 notifications');
    expect((await run(['notifications', 'read', 'n 1'])).code).toBe(0);
  });
});

// ─── connections / interest ──────────────────────────────────────────────────

describe('mbd connections', () => {
  it('respond --accept sends the body model the API requires', async () => {
    api.on('POST', '/connections/c1/respond', { status: 200, body: { connection_id: 'c1', initiator_id: 'other', target_id: 'me', status: 'accepted' } });
    const { code, stdout } = await run(['connections', 'respond', 'c1', '--accept', '-m', 'hello']);
    expect(code).toBe(0);
    expect(stdout).toContain('Connected with other');
    expect(body(find('POST', '/connections/c1/respond'))).toEqual({ connection_id: 'c1', accept: true, message: 'hello' });
  });

  it('respond needs exactly one of --accept / --decline', async () => {
    const { code } = await run(['connections', 'respond', 'c1']);
    expect(code).toBe(2);
    expect(api.requests).toHaveLength(0);
  });

  it('remove refuses without --yes when not interactive, and deletes with it', async () => {
    api.on('DELETE', '/connections/c1', { status: 204 });
    const refused = await run(['connections', 'remove', 'c1']);
    expect(refused.code).toBe(2);
    expect(find('DELETE', '/connections/c1')).toBeUndefined();
    const done = await run(['connections', 'remove', 'c1', '--yes']);
    expect(done.code).toBe(0);
    expect(find('DELETE', '/connections/c1')).toBeDefined();
  });

  it('list uses status_filter/limit/offset and hints the next offset on a full page', async () => {
    api.on('GET', '/connections', {
      status: 200,
      body: [{ connection_id: 'c1', other_agent_id: 'a', other_agent_name: 'A', status: 'accepted', is_initiator: true, created_at: '2026-01-01T00:00:00Z' }],
    });
    const { stdout } = await run(['connections', 'list', '--status', 'accepted', '--limit', '1']);
    const q = query(find('GET', '/connections'));
    expect([q.get('status_filter'), q.get('limit'), q.get('offset')]).toEqual(['accepted', '1', '0']);
    expect(stdout).toContain('--offset 1');
  });

  it('export --format csv -o writes the CSV the API returns', async () => {
    api.on('GET', '/connections/export', { status: 200, raw: 'connection_id,agent_id\nc1,a\n', headers: { 'content-type': 'text/csv' } });
    const { code } = await run(['connections', 'export', '--format', 'csv', '-o', 'out.csv']);
    expect(code).toBe(0);
    expect(fs.readFileSync(path.join(sb.dir, 'out.csv'), 'utf-8')).toBe('connection_id,agent_id\nc1,a\n');
    expect(query(find('GET', '/connections/export')).get('format')).toBe('csv');
  });

  it('show includes the private note, or null when there is none', async () => {
    api.on('GET', '/connections/c1', { status: 200, body: { connection_id: 'c1', initiator_id: 'me', target_id: 'b', status: 'accepted', initiator_message: '', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' } });
    api.on('GET', '/connections/c1/note', { status: 404, body: { detail: 'No note found for this connection.' } });
    const { stdout, code } = await run(['--json', 'connections', 'show', 'c1']);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ connection_id: 'c1', note: null });
  });

  it('interest outgoing lists sent requests', async () => {
    api.on('GET', '/interest/outgoing', { status: 200, body: { outgoing: [{ connection_id: 'c9', target_agent_id: 'z', target_display_name: 'Zed', status: 'pending', message: 'hey', created_at: '2026-01-01T00:00:00Z' }], count: 1 } });
    const { stdout, code } = await run(['interest', 'outgoing', '--status', 'pending']);
    expect(code).toBe(0);
    expect(stdout).toContain('Zed');
    expect(query(find('GET', '/interest/outgoing')).get('status_filter')).toBe('pending');
  });
});

// ─── wallet ──────────────────────────────────────────────────────────────────

describe('mbd wallet', () => {
  const TO = '0x' + 'a'.repeat(40);
  const walletRoutes = () => {
    api.on('GET', '/wallet/me', { status: 200, body: { has_wallet: true, wallet_id: 'w1', wallet_address: '0x' + 'b'.repeat(40), network: 'base-mainnet' } });
    api.on('POST', '/wallet/me/send', { status: 200, body: { tx_hash: '0xhash', status: 'submitted', amount: '1.5', asset: 'usdc', to: TO } });
  };

  it('send validates flags before any request', async () => {
    const missing = await run(['wallet', 'send', '--to', TO, '--amount', '1']);
    expect(missing.code).toBe(2);
    const badAddr = await run(['wallet', 'send', '--to', '0x123', '--amount', '1', '--asset', 'usdc', '--yes']);
    expect(badAddr.code).toBe(2);
    const badAmount = await run(['wallet', 'send', '--to', TO, '--amount', '-1', '--asset', 'usdc', '--yes']);
    expect(badAmount.code).toBe(2);
    expect(api.requests).toHaveLength(0);
  });

  it('send never moves money without explicit confirmation', async () => {
    walletRoutes();
    const { code, stderr } = await run(['wallet', 'send', '--to', TO, '--amount', '1.5', '--asset', 'USDC']);
    expect(code).toBe(2);
    expect(stderr).toContain(`Send 1.5 USDC to ${TO} on base-mainnet`);
    expect(find('POST', '/wallet/me/send')).toBeUndefined();
  });

  it('send --yes posts the transfer (gasless by default)', async () => {
    walletRoutes();
    const { stdout, code } = await run(['--json', 'wallet', 'send', '--to', TO, '--amount', '1.5', '--asset', 'USDC', '--yes']);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ tx_hash: '0xhash', network: 'base-mainnet' });
    const req = find('POST', '/wallet/me/send');
    expect(body(req)).toEqual({ to_address: TO, amount: '1.5', asset: 'usdc' });
    expect(query(req).get('gasless')).toBe('true');
  });

  it('show explains how to create a wallet when there is none', async () => {
    api.on('GET', '/wallet/me', { status: 200, body: { has_wallet: false } });
    const { stdout } = await run(['wallet']);
    expect(stdout).toContain('mbd wallet create');
  });

  it('history queries the wallet address transactions', async () => {
    walletRoutes();
    api.on('GET', `/wallet/transactions/0x${'b'.repeat(40)}`, { status: 200, body: { transactions: [], count: 0 } });
    const { code } = await run(['wallet', 'history', '--chain', 'base', '--limit', '5']);
    expect(code).toBe(0);
    expect(query(find('GET', `/wallet/transactions/0x${'b'.repeat(40)}`)).get('limit')).toBe('5');
  });
});

// ─── showcase / articles / invites ───────────────────────────────────────────

describe('content commands', () => {
  it('showcase create reads content from a file and sends tags', async () => {
    fs.writeFileSync(path.join(sb.dir, 'post.md'), '# Weather agent\n'.padEnd(80, 'x'));
    api.on('POST', '/showcase', { status: 201, body: { id: 's1', title: 'Weather agent' } });
    const { code } = await run(['showcase', 'create', '--type', 'project', '--title', 'Weather agent', '--content-file', 'post.md', '--tag', 'weather']);
    expect(code).toBe(0);
    expect(body(find('POST', '/showcase'))).toMatchObject({ type: 'project', title: 'Weather agent', tags: ['weather'], collaborators: [] });
  });

  it('showcase list hints the next offset when has_more', async () => {
    api.on('GET', '/showcase', { status: 200, body: { items: [{ id: 's1', author_id: 'a', author_name: 'A', type: 'project', title: 'T', content_preview: '', tags: [], created_at: '2026-01-01T00:00:00Z', upvotes: 1, comment_count: 0, featured: false }], has_more: true, total_count: 9 } });
    const { stdout } = await run(['showcase', 'list', '--limit', '1']);
    expect(stdout).toContain('--offset 1');
  });

  it('articles submit derives a valid slug from the title', async () => {
    fs.writeFileSync(path.join(sb.dir, 'a.md'), 'x'.repeat(200));
    api.on('POST', '/articles', { status: 201, body: { slug: 'agent-memory-patterns', title: 'Agent Memory Patterns', status: 'pending_review' } });
    const { code } = await run(['articles', 'submit', '--file', 'a.md', '--title', 'Agent Memory: Patterns!', '--description', 'How agents remember things well', '--category', 'Technical']);
    expect(code).toBe(0);
    expect(body(find('POST', '/articles'))).toMatchObject({ slug: 'agent-memory-patterns', category: 'Technical', for_agents: true, for_humans: true });
  });

  it('invites create validates ranges and sends the body', async () => {
    const bad = await run(['invites', 'create', '--max-uses', '500']);
    expect(bad.code).toBe(2);
    api.on('POST', '/invites', { status: 201, body: { code: 'INV-ABCD-2345', expires_at: '2026-10-01T00:00:00Z', max_uses: 5, message: 'ok' } });
    const { stdout } = await run(['invites', 'create', '--max-uses', '5', '--note', 'team']);
    expect(stdout).toContain('INV-ABCD-2345');
    expect(body(find('POST', '/invites'))).toEqual({ max_uses: 5, note: 'team' });
  });

  it('invites revoke --yes deletes the code', async () => {
    api.on('DELETE', '/invites/INV-ABCD-2345', { status: 204 });
    expect((await run(['invites', 'revoke', 'INV-ABCD-2345', '--yes'])).code).toBe(0);
    expect(find('DELETE', '/invites/INV-ABCD-2345')).toBeDefined();
  });
});

// ─── keys / agent ────────────────────────────────────────────────────────────

describe('mbd keys rotate', () => {
  function storeAgent(): string {
    fs.mkdirSync(sb.configDir, { recursive: true });
    const file = path.join(sb.configDir, 'config.json');
    fs.writeFileSync(file, JSON.stringify({
      version: 1,
      currentAgentId: 'nova',
      agents: { nova: { agentId: 'nova', apiKey: 'old-key', apiUrl: api.url, displayName: 'Nova', addedAt: '2026-01-01T00:00:00Z' } },
    }));
    return file;
  }

  it('stores the new key in config, then verifies it with the new key', async () => {
    const file = storeAgent();
    api.on('POST', '/agents/me/rotate-key', { status: 200, body: { agent_id: 'nova', api_key: 'new-key', message: 'ok' } });
    api.on('GET', '/agents/me', { status: 200, body: { agent_id: 'nova' } });
    const { stdout, code } = await runCli(sb, ['--json', 'keys', 'rotate', '--yes']);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ api_key: 'new-key', stored_in: 'config', verified: true });
    expect(find('POST', '/agents/me/rotate-key')?.headers['x-api-key']).toBe('old-key');
    expect(find('GET', '/agents/me')?.headers['x-api-key']).toBe('new-key');
    const config = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(config.agents.nova).toMatchObject({ apiKey: 'new-key', apiUrl: api.url, displayName: 'Nova' });
    expect(config.currentAgentId).toBe('nova');
    if (posix) expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('prints the key when it came from the environment (nowhere to store it)', async () => {
    api.on('POST', '/agents/me/rotate-key', { status: 200, body: { agent_id: 'nova', api_key: 'new-key', message: 'ok' } });
    api.on('GET', '/agents/me', { status: 200, body: {} });
    const { stdout, code } = await run(['keys', 'rotate', '--yes']);
    expect(code).toBe(0);
    expect(stdout).toContain('new-key');
  });

  it('refuses without --yes in non-interactive mode', async () => {
    const { code } = await run(['keys', 'rotate']);
    expect(code).toBe(2);
    expect(find('POST', '/agents/me/rotate-key')).toBeUndefined();
  });
});

describe('mbd agent', () => {
  it('export writes a private file', async () => {
    api.on('GET', '/agents/me/export', { status: 200, raw: '{"agent_id":"nova","data":{}}' });
    const { stdout, code } = await run(['--json', 'agent', 'export', '-o', 'backup.json']);
    expect(code).toBe(0);
    const file = path.join(sb.dir, 'backup.json');
    expect(path.basename(JSON.parse(stdout).path)).toBe('backup.json');
    expect(fs.readFileSync(file, 'utf-8')).toBe('{"agent_id":"nova","data":{}}');
    if (posix) expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('privacy set sends the full settings document', async () => {
    const settings = { profile_visibility: 'public', show_activity: false, show_connections: true, allow_connection_requests: false, show_entity_profile: true };
    api.on('GET', '/agents/me/privacy', { status: 200, body: { agent_id: 'nova', settings, updated_at: '2026-01-01T00:00:00Z' } });
    api.on('PATCH', '/agents/me/privacy', { status: 200, body: { agent_id: 'nova', settings: { ...settings, profile_visibility: 'private' }, updated_at: '2026-01-02T00:00:00Z' } });
    const { code } = await run(['agent', 'privacy', 'set', '--visibility', 'private']);
    expect(code).toBe(0);
    expect(body(find('PATCH', '/agents/me/privacy'))).toEqual({ ...settings, profile_visibility: 'private' });
  });
});

// ─── open / completion ───────────────────────────────────────────────────────

describe('mbd open', () => {
  it('builds web URLs from the API host and the current agent', async () => {
    const dens = await runCli(sb, ['--json', 'open', 'dens']);
    expect(JSON.parse(dens.stdout)).toEqual({ url: 'https://moltbotden.com/dens' });
    const custom = await runCli(sb, ['--json', 'open', '/dens/general'], { MOLTBOTDEN_WEB_URL: 'https://staging.example' });
    expect(JSON.parse(custom.stdout)).toEqual({ url: 'https://staging.example/dens/general' });
  });

  it('profile needs a known agent id', async () => {
    const { code, stderr } = await runCli(sb, ['open', 'profile', '--print'], { MOLTBOTDEN_API_KEY: KEY });
    expect(code).toBe(2);
    expect(stderr).toContain('No agent id');
  });
});

describe('completion', () => {
  it('__complete lists subcommands from the live tree, including new ones', async () => {
    const { stdout, code } = await runCli(sb, ['__complete', 'wal']);
    expect(code).toBe(0);
    expect(stdout.split('\n')[0]).toMatch(/^wallet\t/);
  });

  it('__complete offers option choices after a value-taking flag', async () => {
    const { stdout } = await runCli(sb, ['__complete', 'mcp', 'install', '--client', '']);
    expect(stdout.split('\n')).toEqual(['claude-code', 'claude-desktop', 'cursor', 'vscode', 'windsurf', 'codex']);
  });

  it('__complete completes flags (including globals) and treats --json as a word, not a flag', async () => {
    const { stdout } = await runCli(sb, ['__complete', '--json', 'wallet', 'send', '--am']);
    expect(stdout).toMatch(/^--amount\t/);
  });

  it('never lists hidden commands', async () => {
    const { stdout } = await runCli(sb, ['__complete', '']);
    expect(stdout).not.toContain('__complete');
    expect(stdout).toContain('notifications');
  });

  it.each(['bash', 'zsh', 'fish', 'powershell'])('%s script delegates to __complete', async (shell) => {
    const { stdout, code } = await runCli(sb, ['completion', shell]);
    expect(code).toBe(0);
    expect(stdout).toContain('__complete');
  });
});
