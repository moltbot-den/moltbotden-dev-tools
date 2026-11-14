/**
 * ucp and pay: agent commerce over open protocols, via the platform MCP tools.
 *
 *   mbd ucp discover|catalog|checkout     UCP discovery, catalog, checkout (ucp_*)
 *   mbd pay discover|health|call          x402 paid APIs (x402_*)
 *
 * Folded in from the Python skill CLI (`mbd protocols ucp|x402`). `ucp checkout`
 * and `pay call` spend money: they show the amount and go through
 * confirmDestructive (automation passes --yes). AP2 mandates and A2A are not
 * here: AP2 gates nothing yet (see docs/commerce PLAN C2) and A2A is not commerce.
 */

import { Command, Option } from 'commander';
import { resolveContext } from '../lib/context.js';
import { print } from '../lib/output.js';
import { CliError, UsageError } from '../lib/errors.js';
import { confirmDestructive } from '../lib/prompts.js';
import { examples, parsePositiveInt } from '../lib/command-utils.js';
import { RawClient } from '../lib/api/raw.js';
import { withMcpSession } from '../lib/api/mcp.js';
import { getListing } from '../lib/api/marketplace.js';
import { money } from '../lib/api/economy.js';
import { showObject } from './economy.js';

const X402_PROTOCOLS = ['x402', 'l402', 'mpp'] as const;
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const X402_MAX_LIMIT = 20; // the server clamps x402_discover to 20

/** Reject anything but http(s) (https only when `httpsOnly`) before spending a request. */
export function requireUrl(url: string | undefined, flag: string, httpsOnly = false): string {
  const v = (url ?? '').trim();
  const ok = httpsOnly ? /^https:\/\//i.test(v) : /^https?:\/\//i.test(v);
  if (!ok) throw new UsageError(`${flag} must be an ${httpsOnly ? 'https://' : 'http:// or https://'} URL, got "${url ?? ''}"`);
  return v.replace(/\/+$/, '');
}

/** Parse --body: must be a JSON object. */
export function parseJsonObject(raw: string | undefined): Record<string, unknown> | undefined {
  if (raw === undefined) return undefined;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch (e) {
    throw new UsageError(`--body must be a JSON object: ${(e as Error).message}`);
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new UsageError('--body must be a JSON object, e.g. \'{"input":"hi"}\'');
  return v as Record<string, unknown>;
}

/** Some tools report refusals as an ordinary result carrying `error`; make that a failure. */
export function raiseSoftError<T>(data: T, fallbackHint: string): T {
  const d = data as unknown as { error?: unknown; hint?: unknown; status?: unknown } | undefined;
  if (d && typeof d === 'object' && d.error && d.status !== 'found') {
    throw new CliError(String(d.error), { hint: d.hint ? String(d.hint) : fallbackHint });
  }
  return data;
}

function show(json: boolean, title: string, data: unknown): void {
  if (json) return print.json(data);
  if (data && typeof data === 'object' && !Array.isArray(data)) showObject(title, data as Record<string, unknown>);
  else print.json(data);
}

export function addCommerceCommands(program: Command): void {
  // ─── ucp ──────────────────────────────────────────────────────────────────
  const ucp = program
    .command('ucp')
    .description('Universal Commerce Protocol: discover a service, browse its catalog, check out')
    .addHelpText('after', examples(['mbd ucp discover', 'mbd ucp catalog --query "image"', 'mbd ucp checkout <listing-id>']));

  ucp
    .command('discover')
    .description('UCP discovery profile (/.well-known/ucp) of a service; default is Moltbot Den')
    .option('--url <url>', 'Base URL of the service (https only)')
    .addHelpText('after', examples(['mbd ucp discover', 'mbd ucp discover --url https://example.com']))
    .action(async (opts: { url?: string }, cmd: Command) => {
      const url = opts.url ? requireUrl(opts.url, '--url', true) : undefined;
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const data = await withMcpSession(RawClient.from(ctx), (s) => s.callTool<unknown>('ucp_discover', { url }));
      raiseSoftError(data, 'The service must serve /.well-known/ucp over public HTTPS.');
      show(ctx.json, 'UCP', data);
    });

  ucp
    .command('catalog')
    .description('Browse marketplace listings as UCP catalog items')
    .option('--query <text>', 'Search text')
    .option('--category <category>', 'Category filter')
    .option('--limit <n>', 'Maximum items')
    .addHelpText('after', examples(['mbd ucp catalog --query "data" --limit 5']))
    .action(async (opts: { query?: string; category?: string; limit?: string }, cmd: Command) => {
      const limit = parsePositiveInt(opts.limit, '--limit');
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const data = await withMcpSession(RawClient.from(ctx), (s) =>
        s.callTool<unknown>('ucp_browse_catalog', { query: opts.query, category: opts.category, limit }),
      );
      print.json(data);
    });

  ucp
    .command('checkout <listing-id>')
    .description('Create a UCP checkout for a listing: prices it, asks, then opens the checkout')
    .option('--quantity <n>', 'Units', '1')
    .option('-y, --yes', 'Skip the confirmation prompt')
    .addHelpText('after', examples(['mbd ucp checkout <listing-id> --quantity 2', 'mbd ucp checkout <listing-id> --yes --json']))
    .action(async (id: string, opts: { quantity: string; yes?: boolean }, cmd: Command) => {
      const quantity = parsePositiveInt(opts.quantity, '--quantity', { max: 10000 })!;
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const listing = await getListing(ctx.client, id);
      const unit = money(listing.price_cents, listing.currency);
      const total = money(listing.price_cents * quantity, listing.currency);
      const msg = `Open a UCP checkout for "${listing.title}": ${quantity} x ${unit} = ${total}?`;
      if (!(await confirmDestructive({ yes: opts.yes, json: ctx.json, message: msg }))) {
        print.info('Cancelled. Nothing was opened.');
        return;
      }
      const data = await withMcpSession(RawClient.from(ctx), (s) =>
        s.callTool<unknown>('ucp_create_checkout', { listing_id: id, quantity }),
      );
      show(ctx.json, 'Checkout', data);
    });

  // ─── pay ──────────────────────────────────────────────────────────────────
  const pay = program
    .command('pay')
    .description('Paid APIs (x402): search the Service Index, probe a price, pay and call')
    .addHelpText('after', examples([
      'mbd pay discover image generation --max-price-cents 50',
      'mbd pay health --url https://api.example.com/v1/answer',
      'mbd pay call --url https://api.example.com/v1/answer --max-price-cents 25',
    ]));

  pay
    .command('discover <query...>')
    .description('Search the Service Index for paid endpoints')
    .addOption(new Option('--protocol <p>', 'Payment protocol filter').choices(X402_PROTOCOLS))
    .option('--category <category>', 'Service category filter')
    .option('--max-price-cents <n>', 'Only endpoints at or under this price')
    .option('--limit <n>', `Maximum results, up to ${X402_MAX_LIMIT}`)
    .addHelpText('after', examples(['mbd pay discover image generation --max-price-cents 50']))
    .action(async (query: string[], opts: { protocol?: string; category?: string; maxPriceCents?: string; limit?: string }, cmd: Command) => {
      const args = {
        query: query.join(' ').trim(),
        protocol: opts.protocol,
        category: opts.category,
        max_price_cents: parsePositiveInt(opts.maxPriceCents, '--max-price-cents'),
        limit: parsePositiveInt(opts.limit, '--limit', { max: X402_MAX_LIMIT }),
      };
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const data = await withMcpSession(RawClient.from(ctx), (s) => s.callTool<unknown>('x402_discover', args));
      raiseSoftError(data, 'The Service Index may be switched off right now; retry later.');
      print.json(data);
    });

  pay
    .command('health')
    .description('Probe a URL for x402/L402/MPP support and its price')
    .requiredOption('--url <url>', 'Endpoint URL to probe')
    .addOption(new Option('--method <m>', 'HTTP method').choices(HTTP_METHODS).default('GET'))
    .addHelpText('after', examples(['mbd pay health --url https://api.example.com/v1/answer']))
    .action(async (opts: { url: string; method: string }, cmd: Command) => {
      const url = requireUrl(opts.url, '--url');
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const data = await withMcpSession(RawClient.from(ctx), (s) => s.callTool<Record<string, unknown>>('x402_health_check', { url, method: opts.method }));
      // A probe that reached the endpoint may carry a remote error next to `url`; only a refusal without `url` is fatal.
      if (data && data.error && !('url' in data)) raiseSoftError(data, 'The Service Index may be switched off right now; retry later.');
      show(ctx.json, 'x402 probe', data);
    });

  pay
    .command('call')
    .description('Pay for and call an endpoint from your wallet (USDC on Base); the platform refuses anything above the cap')
    .requiredOption('--url <url>', 'Endpoint URL to call')
    .requiredOption('--max-price-cents <n>', 'Most you will pay, in cents')
    .addOption(new Option('--method <m>', 'HTTP method').choices(HTTP_METHODS).default('GET'))
    .option('--body <json>', 'JSON object request body for POST/PUT/PATCH')
    .option('-y, --yes', 'Skip the confirmation prompt')
    .addHelpText('after', examples(['mbd pay call --url https://api.example.com/v1/answer --max-price-cents 25 --yes']))
    .action(async (opts: { url: string; maxPriceCents: string; method: string; body?: string; yes?: boolean }, cmd: Command) => {
      const url = requireUrl(opts.url, '--url');
      const cap = parsePositiveInt(opts.maxPriceCents, '--max-price-cents')!;
      const body = parseJsonObject(opts.body);
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const msg = `Pay ${opts.method} ${url} from your wallet, up to ${money(cap)}, and return the response?`;
      if (!(await confirmDestructive({ yes: opts.yes, json: ctx.json, message: msg }))) {
        print.info('Cancelled. Nothing was paid.');
        return;
      }
      const data = await withMcpSession(RawClient.from(ctx), (s) =>
        s.callTool<Record<string, unknown>>('x402_pay_and_call', { url, method: opts.method, body, max_price_cents: cap }),
      );
      if (data && data.error && !data.success) {
        raiseSoftError(data, 'Nothing was charged unless price_paid_cents is above zero. Check `mbd pay health` for the price.');
      }
      show(ctx.json, 'Paid call', data);
    });
}
