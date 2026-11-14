/**
 * End-to-end tests for market, credits, ucp and pay (folded in from the Python
 * skill CLI). Each runs dist/cli.js against the in-process mock API and asserts
 * the exact request the backend receives. The money commands matter most: a
 * purchase must never leave the CLI without confirmation, and must send exactly
 * the quoted order.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { startMockApi, type MockApi, type RecordedRequest } from '../helpers/mock-api.js';
import { CLI_PATH, makeSandbox, runCli, type Sandbox } from '../helpers/run-cli.js';

let api: MockApi;
let sb: Sandbox;
const KEY = 'moltbotden_sk_testkey000000000000';

const run = (args: string[]) => runCli(sb, ['--api-url', api.url, ...args], { MOLTBOTDEN_API_KEY: KEY });
const find = (method: string, p: string): RecordedRequest | undefined =>
  api.requests.find((r) => r.method === method && r.path.split('?')[0] === p);
const query = (r: RecordedRequest | undefined) => new URL(`http://x${r?.path ?? '/'}`).searchParams;
const body = (r: RecordedRequest | undefined) => JSON.parse(r?.body || 'null') as Record<string, unknown>;
const toolCalls = () =>
  api.requests
    .filter((r) => r.method === 'POST' && r.path === '/mcp')
    .map((r) => body(r))
    .filter((j) => j.method === 'tools/call')
    .map((j) => j.params as { name: string; arguments: Record<string, unknown> });

/** One route answers initialize, initialized and tools/call with `payload` as the tool's text. */
const mcpTool = (payload: unknown) => {
  api.on('POST', '/mcp', {
    status: 200,
    headers: { 'MCP-Session-Id': 'sess-1' },
    body: { jsonrpc: '2.0', id: 1, result: { sessionId: 'sess-1', content: [{ type: 'text', text: JSON.stringify(payload) }] } },
  });
  api.on('DELETE', '/mcp', { status: 204 });
};

const QUOTE = { total_cents: 1150, unit_price_cents: 500, platform_fee_cents: 100, order_fee_cents: 50, currency: 'usd' };
const LISTING = { id: 'lst_1', title: 'Image pack', seller_id: 's1', price_cents: 500, currency: 'usd', category: 'media', description: 'd' };

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

describe('help', () => {
  it.each([
    ['market', 'search'], ['market', 'fees'], ['market', 'order', 'create'], ['credits', 'balance'],
    ['credits', 'purchase'], ['ucp', 'checkout'], ['pay', 'call'], ['pay', 'discover'],
  ])('%s has an Examples block', async (...cmd) => {
    const { stdout, code } = await runCli(sb, [...cmd, '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('Examples');
  });
});

describe('mbd market', () => {
  it('search sends the filters the API reads and renders results', async () => {
    api.on('GET', '/marketplace/search', {
      status: 200,
      body: { results: [LISTING], total_results: 1, total_pages: 1, page: 1, limit: 5 },
    });
    const { stdout, code } = await run(['--json', 'market', 'search', 'image', 'pack', '--category', 'media', '--sort', 'rating', '--limit', '5']);
    expect(code).toBe(0);
    expect(JSON.parse(stdout).results[0].id).toBe('lst_1');
    const q = query(find('GET', '/marketplace/search'));
    expect(Object.fromEntries(q)).toEqual({ q: 'image pack', category: 'media', sort: 'rating', page: '1', limit: '5' });
  });

  it('search carries every filter the Python CLI had, under the names the API reads', async () => {
    api.on('GET', '/marketplace/search', { status: 200, body: { results: [], total_results: 0, total_pages: 0, page: 1, limit: 20 } });
    const { code } = await run([
      '--json', 'market', 'search', '--subcategory', 'code-generation', '--min-price', '0', '--max-price', '500',
      '--seller', 'agent-x', '--verified', '--min-rating', '4.5', '--tag', 'a', '--tag', 'b',
    ]);
    expect(code).toBe(0);
    expect(Object.fromEntries(query(find('GET', '/marketplace/search')))).toEqual({
      subcategory: 'code-generation', min_price: '0', max_price: '500', seller_id: 'agent-x', verified_seller: 'true',
      min_rating: '4.5', tags: 'a,b', sort: 'newest', page: '1', limit: '20',
    });
  });

  it('search rejects a rating outside 0 to 5 before any request', async () => {
    const { code } = await run(['market', 'search', '--min-rating', '9']);
    expect(code).toBe(2);
    expect(api.requests).toHaveLength(0);
  });

  it('fees quotes with the quantity', async () => {
    api.on('GET', '/marketplace/listings/lst_1/fees', { status: 200, body: QUOTE });
    const { code } = await run(['--json', 'market', 'fees', 'lst_1', '--quantity', '3']);
    expect(code).toBe(0);
    expect(query(find('GET', '/marketplace/listings/lst_1/fees')).get('quantity')).toBe('3');
  });

  it('order create refuses to buy without --yes when it cannot ask', async () => {
    // Why: a purchase must never go out unconfirmed in automation.
    api.on('GET', '/marketplace/listings/lst_1/fees', { status: 200, body: QUOTE });
    api.on('POST', '/marketplace/orders', { status: 200, body: { id: 'ord_1' } });
    const { code, stderr } = await run(['market', 'order', 'create', 'lst_1']);
    expect(code).toBe(2);
    expect(stderr).toContain('USD 11.50');
    expect(find('POST', '/marketplace/orders')).toBeUndefined();
  });

  it('order create with --yes posts exactly the quoted order, pinned to the quoted unit price', async () => {
    api.on('GET', '/marketplace/listings/lst_1/fees', { status: 200, body: QUOTE });
    api.on('POST', '/marketplace/orders', { status: 200, body: { id: 'ord_1', status: 'paid' } });
    const { stdout, code } = await run(['--json', 'market', 'order', 'create', 'lst_1', '--quantity', '2', '--yes']);
    expect(code).toBe(0);
    expect(JSON.parse(stdout).id).toBe('ord_1');
    const post = find('POST', '/marketplace/orders');
    expect(query(post).get('listing_id')).toBe('lst_1');
    expect(body(post)).toEqual({ quantity: 2, payment_method: 'credits', expected_unit_price_cents: 500 });
    expect(post?.headers['x-api-key']).toBe(KEY);
  });

  it('order create rejects mismatched payment flags before any request', async () => {
    const stripe = await run(['market', 'order', 'create', 'lst_1', '--payment-method', 'stripe', '--yes']);
    const proof = await run(['market', 'order', 'create', 'lst_1', '--payment-proof', '{}', '--yes']);
    expect([stripe.code, proof.code]).toEqual([2, 2]);
    expect(api.requests).toHaveLength(0);
  });

  it('order list sends status and paging', async () => {
    api.on('GET', '/marketplace/orders', { status: 200, body: { orders: [] } });
    const { code } = await run(['--json', 'market', 'order', 'list', '--status', 'paid']);
    expect(code).toBe(0);
    expect(Object.fromEntries(query(find('GET', '/marketplace/orders')))).toEqual({ status: 'paid', page: '1', limit: '20' });
  });
});

describe('mbd credits', () => {
  it('balance reads /credits/balance with the key', async () => {
    api.on('GET', '/credits/balance', { status: 200, body: { balance: 42 } });
    const { stdout, code } = await run(['--json', 'credits', 'balance']);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ balance: 42 });
    expect(find('GET', '/credits/balance')?.headers['x-api-key']).toBe(KEY);
  });

  const HASH = `0x${'a'.repeat(64)}`;
  const FROM = `0x${'b'.repeat(40)}`;

  it('purchase validates locally and never calls the API on bad input', async () => {
    const badHash = await run(['credits', 'purchase', '--tx-hash', '0x12', '--from', FROM, '--amount', '5', '--yes']);
    const badAmount = await run(['credits', 'purchase', '--tx-hash', HASH, '--from', FROM, '--amount', '0.5', '--yes']);
    expect([badHash.code, badAmount.code]).toEqual([2, 2]);
    expect(api.requests).toHaveLength(0);
  });

  it('purchase needs --yes when it cannot ask, then posts the registration', async () => {
    api.on('POST', '/credits/purchase', { status: 200, body: { purchase_id: 'p1', status: 'pending' } });
    const args = ['credits', 'purchase', '--tx-hash', HASH, '--from', FROM, '--amount', '5'];
    expect((await run(args)).code).toBe(2);
    expect(find('POST', '/credits/purchase')).toBeUndefined();
    const ok = await run(['--json', ...args, '--yes']);
    expect(ok.code).toBe(0);
    expect(body(find('POST', '/credits/purchase'))).toEqual({
      tx_hash: HASH, network: 'base', from_address: FROM, amount: '5', currency: 'USDC',
    });
  });
});

describe('mbd ucp', () => {
  it('checkout refuses without --yes and opens nothing', async () => {
    api.on('GET', '/marketplace/listings/lst_1', { status: 200, body: LISTING });
    mcpTool({ checkout_id: 'co_1' });
    const { code, stderr } = await run(['ucp', 'checkout', 'lst_1', '--quantity', '2']);
    expect(code).toBe(2);
    expect(stderr).toContain('USD 10.00');
    expect(toolCalls()).toHaveLength(0);
  });

  it('checkout with --yes calls ucp_create_checkout with the quantity', async () => {
    api.on('GET', '/marketplace/listings/lst_1', { status: 200, body: LISTING });
    mcpTool({ checkout_id: 'co_1' });
    const { stdout, code } = await run(['--json', 'ucp', 'checkout', 'lst_1', '--quantity', '2', '--yes']);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ checkout_id: 'co_1' });
    expect(toolCalls()).toEqual([{ name: 'ucp_create_checkout', arguments: { listing_id: 'lst_1', quantity: 2 } }]);
  });

  it('discover refuses a non-https URL locally', async () => {
    const { code } = await run(['ucp', 'discover', '--url', 'http://example.com']);
    expect(code).toBe(2);
    expect(api.requests).toHaveLength(0);
  });

  it('discover turns a platform refusal into a failure with the hint', async () => {
    mcpTool({ error: 'blocked host', hint: 'use a public host' });
    const { code, stderr } = await run(['ucp', 'discover', '--url', 'https://example.com']);
    expect(code).not.toBe(0);
    expect(stderr).toContain('blocked host');
  });
});

describe('mbd pay', () => {
  it('call requires a price cap', async () => {
    const { code } = await run(['pay', 'call', '--url', 'https://api.example.com/x', '--yes']);
    expect(code).toBe(2);
    expect(api.requests).toHaveLength(0);
  });

  it('call refuses without --yes and pays nothing', async () => {
    mcpTool({ success: true });
    const { code, stderr } = await run(['pay', 'call', '--url', 'https://api.example.com/x', '--max-price-cents', '25']);
    expect(code).toBe(2);
    expect(stderr).toContain('USD 0.25');
    expect(toolCalls()).toHaveLength(0);
  });

  it('call with --yes sends the cap and body to x402_pay_and_call', async () => {
    mcpTool({ success: true, price_paid_cents: 20 });
    const { code } = await run([
      '--json', 'pay', 'call', '--url', 'https://api.example.com/x', '--method', 'POST',
      '--body', '{"q":1}', '--max-price-cents', '25', '--yes',
    ]);
    expect(code).toBe(0);
    expect(toolCalls()).toEqual([
      { name: 'x402_pay_and_call', arguments: { url: 'https://api.example.com/x', method: 'POST', body: { q: 1 }, max_price_cents: 25 } },
    ]);
  });

  it('call surfaces a failed payment as an error', async () => {
    mcpTool({ success: false, error: 'price above cap', hint: 'raise the cap' });
    const { code, stderr } = await run(['pay', 'call', '--url', 'https://api.example.com/x', '--max-price-cents', '25', '--yes']);
    expect(code).not.toBe(0);
    expect(stderr).toContain('price above cap');
  });

  it('call rejects a body that is not a JSON object', async () => {
    const { code } = await run(['pay', 'call', '--url', 'https://api.example.com/x', '--max-price-cents', '25', '--body', '[1]', '--yes']);
    expect(code).toBe(2);
    expect(api.requests).toHaveLength(0);
  });

  it('discover passes the query and filters', async () => {
    mcpTool({ results: [] });
    const { code } = await run(['--json', 'pay', 'discover', 'image', 'generation', '--max-price-cents', '50', '--limit', '5']);
    expect(code).toBe(0);
    expect(toolCalls()).toEqual([
      { name: 'x402_discover', arguments: { query: 'image generation', max_price_cents: 50, limit: 5 } },
    ]);
  });
});
