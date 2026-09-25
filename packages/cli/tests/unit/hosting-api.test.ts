/**
 * Request shaping for every hosting endpoint.
 *
 * Every hosting command used to ship with a wrong path or body (OpenClaw under
 * /openclaw/instances, `engine` instead of `db_type`, `{domain}` instead of
 * `{hostname}`, a nonexistent image) because nothing checked what the client
 * actually sent. Each case below pins method + path + body to the shape the
 * server's Pydantic model accepts (moltbotden-api/models/hosting/*.py).
 */
import { describe, it, expect, vi } from 'vitest';
import { MoltbotDenClient } from '../../src/lib/api-client.js';
import { HostingApi } from '../../src/lib/api/hosting.js';

function setup(response: unknown = {}) {
  const fetchImpl = vi.fn().mockImplementation(async () =>
    new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } }));
  const client = new MoltbotDenClient('https://api.test', 'key', { fetch: fetchImpl as unknown as typeof fetch, sleep: async () => {} });
  const api = new HostingApi(client);
  const last = () => {
    const [url, init] = fetchImpl.mock.calls.at(-1) as [string, RequestInit];
    const u = new URL(url);
    return {
      method: init.method,
      path: u.pathname,
      query: Object.fromEntries(u.searchParams),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
  };
  return { api, last };
}

describe('HostingApi request shapes', () => {
  const cases: Array<[string, (api: HostingApi) => Promise<unknown>, { method: string; path: string; body?: unknown; query?: Record<string, string> }]> = [
    // OpenClaw lives at /v1/hosting/openclaw, not /openclaw/instances (that routed to GET /{id} and 404ed).
    ['list OpenClaw', (a) => a.listOpenClaw({ limit: 10 }), { method: 'GET', path: '/v1/hosting/openclaw', query: { limit: '10' } }],
    ['get OpenClaw', (a) => a.getOpenClaw('oc-1'), { method: 'GET', path: '/v1/hosting/openclaw/oc-1' }],
    ['restart OpenClaw', (a) => a.restartOpenClaw('oc-1'), { method: 'POST', path: '/v1/hosting/openclaw/oc-1/restart' }],
    ['OpenClaw logs', (a) => a.getOpenClawLogs('oc-1', 500), { method: 'GET', path: '/v1/hosting/openclaw/oc-1/logs', query: { limit: '500' } }],
    ['delete OpenClaw', (a) => a.deleteOpenClaw('oc-1'), { method: 'DELETE', path: '/v1/hosting/openclaw/oc-1' }],
    ['update OpenClaw config (PATCH)', (a) => a.updateOpenClaw('oc-1', { channels: ['slack'] }), { method: 'PATCH', path: '/v1/hosting/openclaw/oc-1', body: { channels: ['slack'] } }],
    // Databases: the API requires db_type; `engine` was a 422 on every create.
    ['create database', (a) => a.createDatabase({ name: 'app', db_type: 'postgres', plan: 'starter' }),
      { method: 'POST', path: '/v1/hosting/databases', body: { name: 'app', db_type: 'postgres', plan: 'starter' } }],
    // The only way to obtain a Postgres connection string.
    ['reset DB password', (a) => a.resetDatabasePassword('db-1'), { method: 'POST', path: '/v1/hosting/databases/db-1/reset-password' }],
    ['DB metrics', (a) => a.getDatabaseMetrics('db-1'), { method: 'GET', path: '/v1/hosting/databases/db-1/metrics' }],
    ['DB backups', (a) => a.listDatabaseBackups('db-1'), { method: 'GET', path: '/v1/hosting/databases/db-1/backups' }],
    // Domains: DomainCreate takes hostname + domain_type; records live under /records with record_type.
    ['add domain', (a) => a.addDomain({ hostname: 'x.moltbotden.com', domain_type: 'subdomain', target_vm_id: 'vm-1' }),
      { method: 'POST', path: '/v1/hosting/domains', body: { hostname: 'x.moltbotden.com', domain_type: 'subdomain', target_vm_id: 'vm-1' } }],
    ['add DNS record', (a) => a.addDnsRecord('d-1', { record_type: 'A', name: 'x.moltbotden.com', value: '1.2.3.4', ttl: 300, proxied: false }),
      { method: 'POST', path: '/v1/hosting/domains/d-1/records', body: { record_type: 'A', name: 'x.moltbotden.com', value: '1.2.3.4', ttl: 300, proxied: false } }],
    ['remove DNS record', (a) => a.removeDnsRecord('d-1', 'r-1'), { method: 'DELETE', path: '/v1/hosting/domains/d-1/records/r-1' }],
    // Billing: GET /billing (not /billing/balance), /checkout-session, /portal, /topup.
    ['billing status', (a) => a.getBilling(), { method: 'GET', path: '/v1/hosting/billing' }],
    ['billing history', (a) => a.getBillingHistory({ event_type: 'topup', limit: 5, offset: 10 }),
      { method: 'GET', path: '/v1/hosting/billing/history', query: { event_type: 'topup', limit: '5', offset: '10' } }],
    ['billing portal', (a) => a.getBillingPortal(), { method: 'GET', path: '/v1/hosting/billing/portal' }],
    ['checkout session', (a) => a.createCheckoutSession({ resource_type: 'vm', plan: 'nano', success_url: 'https://moltbotden.com/a', cancel_url: 'https://moltbotden.com/b' }),
      { method: 'POST', path: '/v1/hosting/billing/checkout-session', body: { resource_type: 'vm', plan: 'nano', success_url: 'https://moltbotden.com/a', cancel_url: 'https://moltbotden.com/b' } }],
    ['USDC top-up', (a) => a.topupUsdc({ tx_hash: `0x${'a'.repeat(64)}`, amount_cents: 2500, chain: 'base' }),
      { method: 'POST', path: '/v1/hosting/billing/topup', body: { tx_hash: `0x${'a'.repeat(64)}`, amount_cents: 2500, chain: 'base' } }],
    // VMs: no hard-coded image (the old default did not exist on GCE); extras.
    ['create VM', (a) => a.createVM({ name: 'web', tier: 'nano', image: 'ubuntu-2204-lts' }),
      { method: 'POST', path: '/v1/hosting/compute/vms', body: { name: 'web', tier: 'nano', image: 'ubuntu-2204-lts' } }],
    ['list VMs', (a) => a.listVMs({ status: 'running', limit: 20 }), { method: 'GET', path: '/v1/hosting/compute/vms', query: { status: 'running', limit: '20' } }],
    ['VM console', (a) => a.getVMConsole('vm-1'), { method: 'GET', path: '/v1/hosting/compute/vms/vm-1/console', query: {} }],
    ['VM ssh keys', (a) => a.setVMSshKeys('vm-1', ['ssh-ed25519 AAAA x']), { method: 'PUT', path: '/v1/hosting/compute/vms/vm-1/ssh-keys', body: { ssh_public_keys: ['ssh-ed25519 AAAA x'] } }],
    ['attach volume', (a) => a.attachVolume('vm-1', { size_gb: 50, disk_type: 'pd-ssd' }), { method: 'POST', path: '/v1/hosting/compute/vms/vm-1/volumes', body: { size_gb: 50, disk_type: 'pd-ssd' } }],
    ['detach volume', (a) => a.detachVolume('vm-1', 'vol-1'), { method: 'DELETE', path: '/v1/hosting/compute/vms/vm-1/volumes/vol-1' }],
    ['snapshot volume', (a) => a.snapshotVolume('vm-1', 'vol-1'), { method: 'POST', path: '/v1/hosting/compute/vms/vm-1/volumes/vol-1/snapshot' }],
    ['firewall rule', (a) => a.addFirewallRule({ vm_id: 'vm-1', direction: 'ingress', protocol: 'tcp', port_range: '443' }),
      { method: 'POST', path: '/v1/hosting/networking/firewalls', body: { vm_id: 'vm-1', direction: 'ingress', protocol: 'tcp', port_range: '443' } }],
    // Storage: no `region` (the API ignores it; buckets have no region choice).
    ['create bucket', (a) => a.createBucket({ name: 'files', plan: 'starter' }), { method: 'POST', path: '/v1/hosting/storage/buckets', body: { name: 'files', plan: 'starter' } }],
    ['account update', (a) => a.updateAccount({ wallet_address: '0xabc' }), { method: 'PATCH', path: '/v1/hosting/accounts/me', body: { wallet_address: '0xabc' } }],
    // Added by the backend in moltbotden #647/#649.
    ['resize VM', (a) => a.resizeVM('vm-1', 'pro'), { method: 'POST', path: '/v1/hosting/compute/vms/vm-1/resize', body: { tier: 'pro' } }],
    ['rebuild VM', (a) => a.rebuildVM('vm-1', 'ubuntu-2204-lts'), { method: 'POST', path: '/v1/hosting/compute/vms/vm-1/rebuild', body: { image: 'ubuntu-2204-lts' } }],
    ['list firewall rules', (a) => a.listFirewallRules(), { method: 'GET', path: '/v1/hosting/networking/firewalls' }],
    ['reveal DB credentials', (a) => a.revealDatabaseCredentials('db-1'), { method: 'POST', path: '/v1/hosting/databases/db-1/credentials' }],
    ['restore DB', (a) => a.restoreDatabase('db-1', { backup_id: '123', target_name: 'copy' }),
      { method: 'POST', path: '/v1/hosting/databases/db-1/restore', body: { backup_id: '123', target_name: 'copy' } }],
    ['signed URL', (a) => a.createSignedUrl('b-1', { object_name: 'a/b.txt', method: 'PUT', expires_in_seconds: 600, content_type: 'text/plain' }),
      { method: 'POST', path: '/v1/hosting/storage/buckets/b-1/signed-url', body: { object_name: 'a/b.txt', method: 'PUT', expires_in_seconds: 600, content_type: 'text/plain' } }],
    ['wallet link message', (a) => a.getWalletLinkMessage('0xabc'), { method: 'GET', path: '/v1/hosting/accounts/me/wallet-link-message', query: { address: '0xabc' } }],
    ['platform status', (a) => a.platformStatus(), { method: 'GET', path: '/v1/hosting/status' }],
  ];

  it.each(cases)('%s', async (_name, call, expected) => {
    const { api, last } = setup();
    await call(api);
    const sent = last();
    expect(sent.method).toBe(expected.method);
    expect(sent.path).toBe(expected.path);
    if ('body' in expected) expect(sent.body).toEqual(expected.body);
    if (expected.query) expect(sent.query).toEqual(expected.query);
  });

  it('URL-encodes IDs so a crafted ID cannot change the route', async () => {
    const { api, last } = setup();
    await api.getVM('../billing');
    expect(last().path).toBe('/v1/hosting/compute/vms/..%2Fbilling');
  });
});
