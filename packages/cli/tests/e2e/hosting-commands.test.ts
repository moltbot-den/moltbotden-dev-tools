/**
 * End-to-end tests for `mbd hosting` against a local mock API.
 *
 * These spawn the built CLI and assert what reaches the server and what the
 * user sees, for the behaviors that cost users money or data when wrong:
 * request bodies of create commands, destructive commands in --json mode,
 * feature-flag 503s, 402s, and --wait.
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

let api: MockApi;
let sandbox: string;

function run(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || k.startsWith('MOLTBOTDEN_') || k.startsWith('MBD_')) continue;
    env[k] = v;
  }
  Object.assign(env, {
    HOME: sandbox, USERPROFILE: sandbox, MOLTBOTDEN_CONFIG_DIR: path.join(sandbox, 'config'),
    MBD_NPM_REGISTRY: api.url, MBD_NO_UPDATE_CHECK: '1', NO_COLOR: '1', CI: '1',
  });
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI_PATH, '--api-url', api.url, ...args], { cwd: sandbox, env, timeout: 15_000, encoding: 'utf-8' },
      (error, stdout, stderr) => resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: error ? (typeof error.code === 'number' ? error.code : 1) : 0 }));
  });
}

/** Authenticated run. */
const mbd = (...args: string[]) => run([...args, '--api-key', 'moltbotden_sk_test']);
const bodyOf = (method: string, p: string) => {
  const req = api.requests.find((r) => r.method === method && r.path.split('?')[0] === p);
  return req ? (JSON.parse(req.body || 'null') as unknown) : undefined;
};
const envelope = (stderr: string) => (JSON.parse(stderr) as { error: { message: string; status: number | null; exit_code: number; hint?: string } }).error;

beforeAll(async () => {
  if (!fs.existsSync(CLI_PATH)) throw new Error('CLI not built. Run `npm run build` first.');
  api = await startMockApi();
});
afterAll(async () => { await api.close(); });
beforeEach(() => {
  api.reset();
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'mbd-hosting-e2e-'));
});

const VM = { id: 'vm-1', name: 'web', tier: 'nano', status: 'running', ip_address: '203.0.113.9', internal_ip: null, gcp_instance_name: 'mbd-x-web', gcp_zone: 'us-central1-a', image: 'ubuntu-2204-lts', ssh_public_key: null, created_at: '2026-09-01T00:00:00Z', started_at: null, stopped_at: null, error_message: null };

describe('create commands send what the API accepts', () => {
  it('vm create defaults to the ubuntu-2204-lts image (the old default did not exist and failed after charging)', async () => {
    api.on('POST', '/v1/hosting/compute/vms', { status: 200, body: { id: 'vm-1', name: 'web', tier: 'nano', status: 'pending', gcp_instance_name: 'g', machine_type: 'e2-micro' } });
    const { code, stdout } = await mbd('--json', 'hosting', 'vm', 'create', '--name', 'web', '--tier', 'nano');
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ id: 'vm-1', status: 'pending' });
    expect(bodyOf('POST', '/v1/hosting/compute/vms')).toEqual({ name: 'web', tier: 'nano', image: 'ubuntu-2204-lts' });
  });

  it('vm create rejects an invalid tier before any request (it used to crash or 422 after prompting)', async () => {
    const { code, stderr } = await mbd('--json', 'hosting', 'vm', 'create', '--name', 'web', '--tier', 'mega');
    expect(code).toBe(2);
    expect(envelope(stderr).message).toContain('Invalid --tier "mega"');
    expect(api.requests).toHaveLength(0);
  });

  it('vm create --wait polls the VM until it is running and prints the final VM', async () => {
    api.on('POST', '/v1/hosting/compute/vms', { status: 200, body: { id: 'vm-1', name: 'web', tier: 'nano', status: 'pending', gcp_instance_name: 'g', machine_type: 'e2-micro' } });
    api.on('GET', '/v1/hosting/compute/vms/vm-1', { status: 200, body: VM });
    const { code, stdout } = await mbd('--json', 'hosting', 'vm', 'create', '--name', 'web', '--tier', 'nano', '--wait');
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ id: 'vm-1', status: 'running' });
  });

  it('vm start --wait fails with the server error when provisioning ends in error', async () => {
    api.on('POST', '/v1/hosting/compute/vms/vm-1/start', { status: 200, body: { status: 'starting' } });
    api.on('GET', '/v1/hosting/compute/vms/vm-1', { status: 200, body: { ...VM, status: 'error', error_message: 'zone exhausted' } });
    const { code, stderr } = await mbd('--json', 'hosting', 'vm', 'start', 'vm-1', '--wait');
    expect(code).toBe(1);
    expect(envelope(stderr).message).toContain('zone exhausted');
  });

  it('db create sends db_type (the API rejected `engine` with a 422 on every call)', async () => {
    api.on('POST', '/v1/hosting/databases', { status: 200, body: { id: 'db-1', name: 'app', db_type: 'postgres', plan: 'starter', status: 'pending' } });
    const { code } = await mbd('--json', 'hosting', 'db', 'create', '--name', 'app', '--type', 'postgres', '--plan', 'starter');
    expect(code).toBe(0);
    expect(bodyOf('POST', '/v1/hosting/databases')).toEqual({ name: 'app', db_type: 'postgres', plan: 'starter' });
  });

  it('db create refuses redis on the postgres-only starter plan before charging', async () => {
    const { code, stderr } = await mbd('--json', 'hosting', 'db', 'create', '--name', 'c', '--type', 'redis', '--plan', 'starter');
    expect(code).toBe(2);
    expect(envelope(stderr).message).toContain('does not offer redis');
    expect(api.requests).toHaveLength(0);
  });

  it('openclaw deploy sends the questionnaire the API requires', async () => {
    api.on('POST', '/v1/hosting/openclaw', { status: 200, body: { id: 'oc-1', plan: 'shared', status: 'pending_setup', channels: ['telegram'] } });
    const { code } = await mbd('--json', 'hosting', 'openclaw', 'deploy', '--plan', 'shared', '--llm-provider', 'anthropic',
      '--channels', 'telegram,discord', '--use-case', 'Answer questions about our docs', '--name', 'docs-bot', '--skills', 'search');
    expect(code).toBe(0);
    expect(bodyOf('POST', '/v1/hosting/openclaw')).toEqual({
      plan: 'shared', llm_provider: 'anthropic', channels: ['telegram', 'discord'],
      use_case: 'Answer questions about our docs', skills: ['search'], agent_name: 'docs-bot',
    });
  });

  it('openclaw deploy enforces the plan channel limit the API does not check', async () => {
    const { code, stderr } = await mbd('--json', 'hosting', 'openclaw', 'deploy', '--plan', 'shared', '--llm-provider', 'openai',
      '--channels', 'telegram,discord,slack,teams', '--use-case', 'Answer questions about our docs');
    expect(code).toBe(2);
    expect(envelope(stderr).message).toContain('at most 3 channels');
  });

  it('domains add sends hostname + domain_type and dns add posts to /records', async () => {
    api.on('POST', '/v1/hosting/domains', { status: 200, body: { id: 'd-1', hostname: 'bot.moltbotden.com', ssl_status: 'pending' } });
    api.on('POST', '/v1/hosting/domains/d-1/records', { status: 200, body: { id: 'r-1', record_type: 'A', name: 'bot.moltbotden.com', value: '1.2.3.4', ttl: 300, proxied: false } });
    expect((await mbd('--json', 'hosting', 'domains', 'add', 'Bot.MoltbotDen.com')).code).toBe(0);
    expect(bodyOf('POST', '/v1/hosting/domains')).toEqual({ hostname: 'bot.moltbotden.com', domain_type: 'subdomain' });
    expect((await mbd('--json', 'hosting', 'domains', 'dns', 'add', 'd-1', '--type', 'a', '--name', 'bot.moltbotden.com', '--value', '1.2.3.4', '--ttl', '300')).code).toBe(0);
    expect(bodyOf('POST', '/v1/hosting/domains/d-1/records')).toEqual({ record_type: 'A', name: 'bot.moltbotden.com', value: '1.2.3.4', ttl: 300, proxied: false });
  });

  it('billing topup sends exact cents and the chain', async () => {
    const tx = `0x${'ab'.repeat(32)}`;
    api.on('POST', '/v1/hosting/billing/topup', { status: 200, body: { status: 'credited', amount_cents: 2550, new_balance_cents: 2550, tx_hash: tx, chain: 'base' } });
    const { code } = await mbd('--json', 'hosting', 'billing', 'topup', '--tx-hash', tx, '--amount', '25.50');
    expect(code).toBe(0);
    expect(bodyOf('POST', '/v1/hosting/billing/topup')).toEqual({ tx_hash: tx, amount_cents: 2550, chain: 'base' });
  });

  it('billing checkout creates a subscription session with moltbotden.com return URLs', async () => {
    api.on('POST', '/v1/hosting/billing/checkout-session', { status: 200, body: { session_id: 'cs_1', url: 'https://checkout.stripe.com/x' } });
    const { code, stdout } = await mbd('--json', 'hosting', 'billing', 'checkout', 'vm', 'nano');
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ session_id: 'cs_1', url: 'https://checkout.stripe.com/x' });
    expect(bodyOf('POST', '/v1/hosting/billing/checkout-session')).toMatchObject({
      resource_type: 'vm', plan: 'nano',
      success_url: 'https://moltbotden.com/hosting/dashboard/billing?checkout=success',
      cancel_url: 'https://moltbotden.com/hosting/dashboard/billing?checkout=cancel',
    });
  });
});

describe('destructive commands never run unconfirmed', () => {
  it.each([
    [['hosting', 'vm', 'delete', 'vm-1']],
    [['hosting', 'db', 'delete', 'db-1']],
    [['hosting', 'db', 'reset-password', 'db-1']],
    [['hosting', 'storage', 'delete', 'b-1']],
    [['hosting', 'openclaw', 'delete', 'oc-1']],
    [['hosting', 'domains', 'remove', 'd-1']],
    [['hosting', 'domains', 'dns', 'remove', 'd-1', 'r-1']],
    [['hosting', 'vm', 'volumes', 'detach', 'vm-1', 'vol-1']],
    [['hosting', 'vm', 'rebuild', 'vm-1']],
    [['hosting', 'vm', 'stop', 'vm-1']],
    [['hosting', 'vm', 'resize', 'vm-1', '--tier', 'pro']],
    [['hosting', 'vm', 'ssh-keys', 'vm-1', '--key', 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl x']],
  ])('%j with --json but no --yes refuses (exit 2) and sends nothing', async (args) => {
    const { code, stdout, stderr } = await mbd('--json', ...args);
    expect(code).toBe(2);
    expect(stdout).toBe('');
    expect(envelope(stderr).hint).toContain('--yes');
    expect(api.requests).toHaveLength(0);
  });

  it('vm delete --yes reports that deletion started (it is asynchronous), not that it finished', async () => {
    api.on('DELETE', '/v1/hosting/compute/vms/vm-1', { status: 200, body: { status: 'deleting' } });
    const { code, stdout } = await mbd('hosting', 'vm', 'delete', 'vm-1', '--yes');
    expect(code).toBe(0);
    expect(stdout).toContain('Deletion of VM vm-1 started');
  });
});

describe('server-side errors are explained', () => {
  it('a feature-flag 503 says the service is not enabled on this server', async () => {
    api.on('GET', '/v1/hosting/compute/vms', { status: 503, body: { detail: 'Compute service is not yet available' } });
    const { code, stderr } = await mbd('--json', 'hosting', 'vm', 'list');
    expect(code).toBe(1);
    expect(envelope(stderr)).toMatchObject({ status: 503, message: "Hosting compute isn't enabled on this server yet." });
  });

  it('a 402 shows the balance and how to add funds', async () => {
    api.on('POST', '/v1/hosting/storage/buckets', { status: 402, body: { detail: 'Insufficient balance for starter plan (800 cents/mo)' } });
    api.on('GET', '/v1/hosting/accounts/me', { status: 200, body: { id: 'a', email: 'x@y.z', usdc_balance_cents: 120, status: 'active', created_at: '2026-01-01T00:00:00Z' } });
    const { code, stderr } = await mbd('--json', 'hosting', 'storage', 'create', '--name', 'files', '--plan', 'starter');
    expect(code).toBe(1);
    const e = envelope(stderr);
    expect(e.status).toBe(402);
    expect(e.message).toContain('Your balance is $1.20.');
    expect(e.hint).toContain('mbd hosting billing topup');
  });
});

describe('read commands use the real paths and fields', () => {
  it('openclaw list calls /v1/hosting/openclaw and shows agent_name', async () => {
    api.on('GET', '/v1/hosting/openclaw', { status: 200, body: { instances: [{ id: 'oc-123456789', plan: 'shared', status: 'running', agent_name: 'docs-bot', llm_provider: 'anthropic', channels: ['telegram'], skills: ['a'], last_active_at: null, created_at: '2026-09-01T00:00:00Z' }], count: 1 } });
    const { code, stdout } = await mbd('hosting', 'openclaw', 'list');
    expect(code).toBe(0);
    expect(stdout).toContain('docs-bot');
    expect(stdout).not.toContain('undefined');
  });

  it('billing status reads GET /billing and shows the balance in USD', async () => {
    api.on('GET', '/v1/hosting/billing', { status: 200, body: { account_id: 'a', usdc_balance_cents: 4200, stripe_customer_id: null, active_subscriptions: 0, subscriptions: [] } });
    const { code, stdout } = await mbd('hosting', 'billing', 'balance');
    expect(code).toBe(0);
    expect(stdout).toContain('$42.00');
  });

  it('billing history renders events and offers the next page', async () => {
    api.on('GET', '/v1/hosting/billing/history', { status: 200, body: { events: [{ id: 'e1', amount_cents: 2500, currency: 'usd', payment_method: 'usdc', event_type: 'topup', description: 'USDC top-up', created_at: '2026-09-01T00:00:00Z' }], count: 1 } });
    const { code, stdout } = await mbd('hosting', 'billing', 'history', '--limit', '1');
    expect(code).toBe(0);
    expect(stdout).toContain('+$25.00');
    expect(stdout).toContain('--offset 1');
  });

  it('vm ssh prints the agent user the VM is provisioned with (root login is disabled)', async () => {
    api.on('GET', '/v1/hosting/compute/vms/vm-1', { status: 200, body: VM });
    const { code, stdout } = await mbd('--json', 'hosting', 'vm', 'ssh', 'vm-1');
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ command: 'ssh agent@203.0.113.9' });
  });

  it('domains show renders hostname and records without crashing on the real document shape', async () => {
    api.on('GET', '/v1/hosting/domains/d-1', { status: 200, body: { id: 'd-1', hostname: 'bot.moltbotden.com', domain_type: 'subdomain', ssl_status: 'active', dns_records: [{ id: 'r-1', record_type: 'TXT', name: 'bot.moltbotden.com', value: 'hello', ttl: 3600, proxied: false }], target_ip: null, target_vm_id: null, created_at: '2026-09-01T00:00:00Z' } });
    const { code, stdout } = await mbd('hosting', 'domains', 'show', 'd-1');
    expect(code).toBe(0);
    expect(stdout).toContain('bot.moltbotden.com');
    expect(stdout).toContain('r-1');
  });

  it('hosting status works without credentials and reports platform health', async () => {
    api.on('GET', '/v1/hosting/status', { status: 200, body: { status: 'healthy', timestamp: '2026-09-24T00:00:00Z', services: { stripe: { status: 'ok' } } } });
    const { code, stdout } = await run(['--json', 'hosting', 'status']);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      platform: { status: 'healthy', timestamp: '2026-09-24T00:00:00Z', services: { stripe: { status: 'ok' } } },
      balance_cents: null,
      resources: null,
    });
  });

  it('hosting status marks a disabled service instead of failing the whole overview', async () => {
    api.on('GET', '/v1/hosting/status', { status: 200, body: { status: 'healthy', timestamp: '2026-09-24T00:00:00Z', services: {} } });
    api.on('GET', '/v1/hosting/accounts/me', { status: 200, body: { id: 'a', email: 'x@y.z', usdc_balance_cents: 0, status: 'active', created_at: '2026-01-01T00:00:00Z' } });
    api.on('GET', '/v1/hosting/compute/vms', { status: 200, body: { vms: [VM], count: 1 } });
    api.on('GET', '/v1/hosting/databases', { status: 503, body: { detail: 'Database service is not yet available' } });
    api.on('GET', '/v1/hosting/storage/buckets', { status: 200, body: { buckets: [], count: 0 } });
    api.on('GET', '/v1/hosting/openclaw', { status: 200, body: { instances: [], count: 0 } });
    const { code, stdout } = await mbd('--json', 'hosting', 'status');
    expect(code).toBe(0);
    const out = JSON.parse(stdout) as { balance_cents: number; resources: Record<string, unknown> };
    expect(out.balance_cents).toBe(0);
    expect(out.resources.vms).toEqual({ count: 1, running: 1 });
    expect(out.resources.databases).toEqual({ error: "Hosting databases isn't enabled on this server yet." });
  });
});

describe('credentials, signed URLs and wallet linking', () => {
  it('db credentials prints the one-time connection string', async () => {
    api.on('POST', '/v1/hosting/databases/db-1/credentials', { status: 200, body: { connection_string: 'postgresql://u:p@h:5432/d' } });
    const { code, stdout } = await mbd('--json', 'hosting', 'db', 'credentials', 'db-1');
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ connection_string: 'postgresql://u:p@h:5432/d' });
  });

  it('db credentials after the one-time reveal points to reset-password instead of a bare 410', async () => {
    api.on('POST', '/v1/hosting/databases/db-1/credentials', { status: 410, body: { detail: 'Initial credentials were already shown.' } });
    const { code, stderr } = await mbd('--json', 'hosting', 'db', 'credentials', 'db-1');
    expect(code).toBe(1);
    const e = envelope(stderr);
    expect(e.message).toContain('already shown once');
    expect(e.hint).toContain('mbd hosting db reset-password db-1');
  });

  it('db restore sends the backup id and new name, and rejects a non-numeric backup id first', async () => {
    const bad = await mbd('--json', 'hosting', 'db', 'restore', 'db-1', '--backup', 'abc', '--name', 'copy');
    expect(bad.code).toBe(2);
    expect(api.requests).toHaveLength(0);
    api.on('POST', '/v1/hosting/databases/db-1/restore', { status: 200, body: { restore_id: 'db-2', target_db_id: 'db-2', source_db_id: 'db-1', backup_id: '42', target_name: 'copy', status: 'pending' } });
    const { code } = await mbd('--json', 'hosting', 'db', 'restore', 'db-1', '--backup', '42', '--name', 'copy');
    expect(code).toBe(0);
    expect(bodyOf('POST', '/v1/hosting/databases/db-1/restore')).toEqual({ backup_id: '42', target_name: 'copy' });
  });

  it('storage url requests a signed URL for one object with the chosen method and lifetime', async () => {
    api.on('POST', '/v1/hosting/storage/buckets/b-1/signed-url', { status: 200, body: { url: 'https://storage.googleapis.com/x?sig', method: 'PUT', object_name: 'a.txt', expires_at: '2026-09-25T00:10:00Z' } });
    const { code, stdout } = await mbd('--json', 'hosting', 'storage', 'url', 'b-1', 'a.txt', '--method', 'put', '--expires', '600');
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ url: 'https://storage.googleapis.com/x?sig' });
    expect(bodyOf('POST', '/v1/hosting/storage/buckets/b-1/signed-url')).toEqual({ object_name: 'a.txt', method: 'PUT', expires_in_seconds: 600 });
  });

  it('storage url refuses a lifetime over the 1 hour the API allows', async () => {
    const { code } = await mbd('--json', 'hosting', 'storage', 'url', 'b-1', 'a.txt', '--expires', '7200');
    expect(code).toBe(2);
    expect(api.requests).toHaveLength(0);
  });

  it('account link-wallet without --signature returns the text to sign and changes nothing', async () => {
    const addr = `0x${'a'.repeat(40)}`;
    api.on('GET', '/v1/hosting/accounts/me/wallet-link-message', { status: 200, body: { address: addr, message: 'Link wallet to account acc-1' } });
    const { code, stdout } = await mbd('--json', 'hosting', 'account', 'link-wallet', addr);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ address: addr, message: 'Link wallet to account acc-1' });
    expect(api.requests.some((r) => r.method === 'PATCH')).toBe(false);
  });

  it('account link-wallet --signature sends the address with its proof', async () => {
    const addr = `0x${'a'.repeat(40)}`;
    const sig = `0x${'b'.repeat(130)}`;
    api.on('PATCH', '/v1/hosting/accounts/me', { status: 200, body: { status: 'updated' } });
    const { code } = await mbd('--json', 'hosting', 'account', 'link-wallet', addr, '--signature', sig);
    expect(code).toBe(0);
    expect(bodyOf('PATCH', '/v1/hosting/accounts/me')).toEqual({ wallet_address: addr, wallet_signature: sig });
  });

  it('vm resize sends the new tier', async () => {
    api.on('POST', '/v1/hosting/compute/vms/vm-1/resize', { status: 200, body: { status: 'resizing', from_tier: 'nano', to_tier: 'pro', new_machine_type: 'e2-standard-2' } });
    const { code } = await mbd('--json', 'hosting', 'vm', 'resize', 'vm-1', '--tier', 'pro', '--yes');
    expect(code).toBe(0);
    expect(bodyOf('POST', '/v1/hosting/compute/vms/vm-1/resize')).toEqual({ tier: 'pro' });
  });

  it('vm resize --wait does not report success on a stopped VM (the resize task always ends running)', async () => {
    api.on('POST', '/v1/hosting/compute/vms/vm-1/resize', { status: 200, body: { status: 'resizing', from_tier: 'nano', to_tier: 'pro', new_machine_type: 'e2-standard-2' } });
    api.on('GET', '/v1/hosting/compute/vms/vm-1', { status: 200, body: { ...VM, status: 'stopped' } });
    const { code, stderr } = await mbd('--json', 'hosting', 'vm', 'resize', 'vm-1', '--tier', 'pro', '--yes', '--wait', '--timeout', '1');
    expect(code).toBe(1);
    expect(envelope(stderr).message).toContain('Timed out');
  });

  it('openclaw config enforces the instance\'s own plan limit before sending', async () => {
    api.on('GET', '/v1/hosting/openclaw/oc-1', { status: 200, body: { id: 'oc-1', plan: 'shared', status: 'running', channels: [], skills: [] } });
    const { code, stderr } = await mbd('--json', 'hosting', 'openclaw', 'config', 'oc-1', '--channels', 'telegram,discord,slack,teams');
    expect(code).toBe(2);
    expect(envelope(stderr).message).toContain('shared plan allows at most 3 channels');
    expect(api.requests.some((r) => r.method === 'PATCH')).toBe(false);
  });
});
