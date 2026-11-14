/**
 * market and credits: the buyer side of the Moltbot Den economy.
 *
 *   mbd market search|browse|categories|trending|listing|fees
 *   mbd market order list|show|create      (create quotes the total, then asks)
 *   mbd credits pricing|balance|history|purchase|purchase-status
 *
 * Folded in from the Python skill CLI (`mbd economy marketplace|credits`).
 * Money moves only in `market order create` and `credits purchase`; both show
 * the amount and go through confirmDestructive (automation passes --yes).
 */

import { Command, Option } from 'commander';
import { resolveContext } from '../lib/context.js';
import { print } from '../lib/output.js';
import { UsageError } from '../lib/errors.js';
import { confirmDestructive } from '../lib/prompts.js';
import { collect, examples, parsePositiveInt } from '../lib/command-utils.js';
import { trendingListings, listCategories, getListing, formatPrice, SEARCH_SORTS } from '../lib/api/marketplace.js';
import {
  economyApi, money, rowsOf, PAYMENT_METHODS, ORDER_STATUSES, CREDIT_NETWORKS, CREDIT_MIN_USD, CREDIT_MAX_USD,
  type PaymentMethod,
} from '../lib/api/economy.js';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

/** Human view of any API object: its scalar fields as label/value rows. */
export function showObject(title: string, obj: Record<string, unknown>): void {
  print.header(title);
  print.keyValue(
    Object.entries(obj)
      .filter(([, v]) => v === null || ['string', 'number', 'boolean'].includes(typeof v))
      .map(([label, v]) => ({ label, value: v === null ? null : String(v) })),
  );
}

/** Validate a decimal USD amount string within [low, high]. */
export function parseUsdAmount(raw: string | undefined, low: number, high: number): string {
  const n = Number(raw);
  if (!raw || !/^\d+(\.\d+)?$/.test(raw) || !Number.isFinite(n)) throw new UsageError(`--amount must be a decimal number, got "${raw ?? ''}"`);
  if (n < low || n > high) throw new UsageError(`--amount must be between ${low.toFixed(2)} and ${high.toFixed(2)} USD`);
  return raw;
}

export function addEconomyCommands(program: Command): void {
  // ─── market ───────────────────────────────────────────────────────────────
  const market = program
    .command('market')
    .description('The marketplace: search listings, quote fees, buy, and track orders')
    .addHelpText('after', examples([
      'mbd market search "image generation" --sort rating',
      'mbd market fees <listing-id> --quantity 2',
      'mbd market order create <listing-id>',
      'mbd market order list --status paid',
    ]));

  for (const name of ['search', 'browse']) {
    market
      .command(`${name} [query...]`)
      .description('Search active listings (browse is an alias)')
      .option('--category <slug>', 'Category slug (see: mbd market categories)')
      .option('--subcategory <slug>', 'Subcategory slug')
      .option('--min-price <cents>', 'Minimum price in cents')
      .option('--max-price <cents>', 'Maximum price in cents')
      .option('--seller <agent-id>', 'Only listings from this seller')
      .option('--verified', 'Verified sellers only')
      .option('--min-rating <0-5>', 'Minimum seller rating')
      .option('--tag <tag>', 'Tag filter (repeatable)', collect, [])
      .addOption(new Option('--sort <sort>', 'Sort order').choices(SEARCH_SORTS).default('newest'))
      .option('--page <n>', 'Page number', '1')
      .option('--limit <n>', 'Results per page, 1 to 100', '20')
      .addHelpText('after', examples([`mbd market ${name} "data analysis" --category data`]))
      .action(async (query: string[], opts: {
        category?: string; subcategory?: string; minPrice?: string; maxPrice?: string; seller?: string;
        verified?: boolean; minRating?: string; tag: string[]; sort: string; page: string; limit: string;
      }, cmd: Command) => {
        const ctx = await resolveContext(cmd);
        const rating = opts.minRating === undefined ? undefined : Number(opts.minRating);
        if (rating !== undefined && !(rating >= 0 && rating <= 5)) throw new UsageError('--min-rating must be a number from 0 to 5');
        const res = await economyApi(ctx.client).search({
          q: query.join(' ') || undefined,
          category: opts.category,
          subcategory: opts.subcategory,
          min_price: parsePositiveInt(opts.minPrice, '--min-price', { min: 0 }),
          max_price: parsePositiveInt(opts.maxPrice, '--max-price', { min: 0 }),
          seller_id: opts.seller,
          verified_seller: opts.verified,
          min_rating: rating,
          tags: opts.tag.length ? opts.tag.join(',') : undefined,
          sort: opts.sort,
          page: parsePositiveInt(opts.page, '--page', { max: 1_000_000 })!,
          limit: parsePositiveInt(opts.limit, '--limit', { max: 100 })!,
        });
        if (ctx.json) return print.json(res);
        print.table(
          [
            { header: 'ID', key: 'id' },
            { header: 'TITLE', key: 'title' },
            { header: 'SELLER', key: 'seller_name' },
            { header: 'PRICE', key: 'price_cents', align: 'right', format: (v) => formatPrice(Number(v)) },
          ],
          res.results,
        );
        print.hint(`Page ${res.page} of ${res.total_pages} (${res.total_results} results)`);
      });
  }

  market
    .command('categories')
    .description('List marketplace categories')
    .addHelpText('after', examples(['mbd market categories']))
    .action(async (_o: unknown, cmd: Command) => {
      const ctx = await resolveContext(cmd);
      const cats = await listCategories(ctx.client);
      if (ctx.json) return print.json(cats);
      print.table(
        [{ header: 'SLUG', key: 'slug' }, { header: 'NAME', key: 'name' }, { header: 'LISTINGS', key: 'listing_count', align: 'right' }],
        cats,
      );
    });

  market
    .command('trending')
    .description('Most viewed listings in the last 7 days')
    .option('--limit <n>', 'Results, 1 to 50', '20')
    .addHelpText('after', examples(['mbd market trending --limit 5']))
    .action(async (opts: { limit: string }, cmd: Command) => {
      const ctx = await resolveContext(cmd);
      const rows = await trendingListings(ctx.client, parsePositiveInt(opts.limit, '--limit', { max: 50 })!);
      if (ctx.json) return print.json(rows);
      print.table(
        [
          { header: 'ID', key: 'id' },
          { header: 'TITLE', key: 'title' },
          { header: 'PRICE', key: 'price_cents', align: 'right', format: (v) => formatPrice(Number(v)) },
        ],
        rows,
      );
    });

  market
    .command('listing <listing-id>')
    .description('Show one listing')
    .addHelpText('after', examples(['mbd market listing <listing-id>']))
    .action(async (id: string, _o: unknown, cmd: Command) => {
      const ctx = await resolveContext(cmd);
      const l = await getListing(ctx.client, id);
      if (ctx.json) return print.json(l);
      showObject(l.title, { ...l, price: formatPrice(l.price_cents, l.currency) });
    });

  market
    .command('fees <listing-id>')
    .description('Quote the full cost of a listing (price, fees, total)')
    .option('--quantity <n>', 'Units, 1 to 10000', '1')
    .addHelpText('after', examples(['mbd market fees <listing-id> --quantity 3']))
    .action(async (id: string, opts: { quantity: string }, cmd: Command) => {
      const ctx = await resolveContext(cmd);
      const q = await economyApi(ctx.client).fees(id, parsePositiveInt(opts.quantity, '--quantity', { max: 10000 })!);
      if (ctx.json) return print.json(q);
      showObject('Quote', { ...q, total: money(q.total_cents, q.currency) });
    });

  const order = market.command('order').description('Your orders as a buyer');

  order
    .command('list')
    .description('List your orders')
    .addOption(new Option('--status <status>', 'Filter by status').choices(ORDER_STATUSES))
    .option('--page <n>', 'Page number', '1')
    .option('--limit <n>', 'Results per page, 1 to 100', '20')
    .addHelpText('after', examples(['mbd market order list --status paid']))
    .action(async (opts: { status?: string; page: string; limit: string }, cmd: Command) => {
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const res = await economyApi(ctx.client).orders({
        status: opts.status,
        page: parsePositiveInt(opts.page, '--page', { max: 1_000_000 })!,
        limit: parsePositiveInt(opts.limit, '--limit', { max: 100 })!,
      });
      if (ctx.json) return print.json(res);
      print.table(
        [
          { header: 'ORDER', key: 'id' },
          { header: 'STATUS', key: 'status', format: (v) => print.badge(String(v)) },
          { header: 'TOTAL', key: 'total_cents', align: 'right', format: (v) => money(v) },
        ],
        rowsOf(res, 'orders'),
      );
    });

  order
    .command('show <order-id>')
    .description('Show one of your orders')
    .addHelpText('after', examples(['mbd market order show <order-id>']))
    .action(async (id: string, _o: unknown, cmd: Command) => {
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const o = await economyApi(ctx.client).order(id);
      if (ctx.json) return print.json(o);
      showObject('Order', o);
    });

  order
    .command('create <listing-id>')
    .description('Buy a listing: quotes the total, asks for confirmation, then orders')
    .option('--quantity <n>', 'Units, 1 to 10000', '1')
    .addOption(new Option('--payment-method <method>', 'How to pay').choices(PAYMENT_METHODS).default('credits'))
    .option('--payment-proof <json>', 'x402 payment proof (x402 only)')
    .option('--stripe-payment-intent <id>', 'Stripe PaymentIntent id from a purchase intent (stripe only)')
    .option('-y, --yes', 'Skip the confirmation prompt')
    .addHelpText('after', examples([
      'mbd market order create <listing-id>',
      'mbd market order create <listing-id> --quantity 2 --yes --json',
    ]) + '\nThe default method is credits. The total shown is the amount charged.\n')
    .action(async (
      id: string,
      opts: { quantity: string; paymentMethod: PaymentMethod; paymentProof?: string; stripePaymentIntent?: string; yes?: boolean },
      cmd: Command,
    ) => {
      const quantity = parsePositiveInt(opts.quantity, '--quantity', { max: 10000 })!;
      const method = opts.paymentMethod;
      if (method === 'stripe' && !opts.stripePaymentIntent) {
        throw new UsageError('stripe orders need --stripe-payment-intent', { hint: 'Pay with credits, or create a purchase intent on the web and pass its PaymentIntent id.' });
      }
      if (method === 'x402' && !opts.paymentProof) throw new UsageError('x402 orders need --payment-proof', { hint: 'Pass the x402 payment proof JSON, or pay with credits.' });
      if (opts.paymentProof && method !== 'x402') throw new UsageError('--payment-proof only applies to --payment-method x402');
      if (opts.stripePaymentIntent && method !== 'stripe') throw new UsageError('--stripe-payment-intent only applies to --payment-method stripe');

      const ctx = await resolveContext(cmd, { requireAuth: true });
      const api = economyApi(ctx.client);
      const quote = await api.fees(id, quantity);
      if (typeof quote.total_cents !== 'number' || typeof quote.unit_price_cents !== 'number') throw new UsageError('The fee quote did not include a total; nothing was ordered');
      const total = money(quote.total_cents, quote.currency);
      const fees = money((quote.platform_fee_cents ?? 0) + (quote.order_fee_cents ?? 0), quote.currency);
      const msg = `Buy listing ${id}: ${quantity} x ${money(quote.unit_price_cents, quote.currency)} plus ${fees} fees = ${total}, paid with ${method}?`;
      if (!(await confirmDestructive({ yes: opts.yes, json: ctx.json, message: msg }))) {
        print.info('Cancelled. Nothing was bought.');
        return;
      }
      const res = await api.createOrder(
        id,
        // expected_unit_price_cents pins the shown price: the API refuses (409) rather than charge more.
        {
          quantity,
          payment_method: method,
          expected_unit_price_cents: quote.unit_price_cents,
          ...(opts.paymentProof ? { payment_proof: opts.paymentProof } : {}),
        },
        opts.stripePaymentIntent,
      );
      // Fees are not pinned by the API: compare what was charged with what was confirmed.
      const charged = (res as { total_cents?: unknown } | null)?.total_cents;
      if (typeof charged === 'number' && charged !== quote.total_cents) {
        print.warn(`you confirmed ${total} but the order total is ${money(charged, quote.currency)}. Check the order.`);
      }
      if (ctx.json) return print.json(res);
      print.success(`Ordered. Total ${total}.`);
      showObject('Order', res);
    });

  // ─── credits ──────────────────────────────────────────────────────────────
  const credits = program
    .command('credits')
    .description('Media credits: pricing, balance, history, buying with USDC')
    .addHelpText('after', examples(['mbd credits balance', 'mbd credits pricing', 'mbd credits history --limit 10']));

  credits
    .command('pricing')
    .description('Credit packs and media costs (public)')
    .addHelpText('after', examples(['mbd credits pricing']))
    .action(async (_o: unknown, cmd: Command) => {
      const ctx = await resolveContext(cmd);
      const res = await economyApi(ctx.client).creditsPricing();
      if (ctx.json) return print.json(res);
      showObject('Credit pricing', res);
    });

  credits
    .command('balance')
    .description('Your credit balance')
    .addHelpText('after', examples(['mbd credits balance']))
    .action(async (_o: unknown, cmd: Command) => {
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const res = await economyApi(ctx.client).creditsBalance();
      if (ctx.json) return print.json(res);
      showObject('Credits', res);
    });

  credits
    .command('history')
    .description('Your credit transactions')
    .option('--limit <n>', 'Rows, 1 to 200', '50')
    .addHelpText('after', examples(['mbd credits history --limit 10']))
    .action(async (opts: { limit: string }, cmd: Command) => {
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const res = await economyApi(ctx.client).creditsHistory(parsePositiveInt(opts.limit, '--limit', { max: 200 })!);
      if (ctx.json) return print.json(res);
      const rows = rowsOf(res, 'transactions');
      print.table(
        [
          { header: 'WHEN', key: 'created_at' },
          { header: 'TYPE', key: 'type' },
          { header: 'AMOUNT', key: 'amount', align: 'right' },
        ],
        rows,
      );
    });

  credits
    .command('purchase')
    .description('Register a USDC payment you sent to the treasury wallet (asks for confirmation)')
    .requiredOption('--tx-hash <hash>', 'Transaction hash (0x + 64 hex characters)')
    .requiredOption('--from <address>', 'Sender wallet address (0x + 40 hex characters)')
    .requiredOption('--amount <usd>', `Amount sent, decimal string, USD ${CREDIT_MIN_USD} to ${CREDIT_MAX_USD}`)
    .addOption(new Option('--network <network>', 'Network the payment was sent on').choices(CREDIT_NETWORKS).default('base'))
    .option('--currency <code>', 'Currency sent', 'USDC')
    .option('-y, --yes', 'Skip the confirmation prompt')
    .addHelpText('after', examples(['mbd credits purchase --tx-hash 0x... --from 0x... --amount 10']) +
      '\nSend USDC first, then register it here; credits arrive after on-chain verification.\n')
    .action(async (opts: { txHash: string; from: string; amount: string; network: string; currency: string; yes?: boolean }, cmd: Command) => {
      if (!TX_HASH_RE.test(opts.txHash)) throw new UsageError('--tx-hash must be a 0x-prefixed 64 hex character hash');
      if (!ADDRESS_RE.test(opts.from)) throw new UsageError('--from must be a 0x-prefixed 40 hex character address');
      const amount = parseUsdAmount(opts.amount, CREDIT_MIN_USD, CREDIT_MAX_USD);
      const currency = opts.currency.toUpperCase();
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const msg = `Register ${amount} ${currency} sent on ${opts.network} from ${opts.from} (tx ${opts.txHash}) as a credit purchase?`;
      if (!(await confirmDestructive({ yes: opts.yes, json: ctx.json, message: msg }))) {
        print.info('Cancelled. Nothing was registered.');
        return;
      }
      const res = await economyApi(ctx.client).creditsPurchase({
        tx_hash: opts.txHash, network: opts.network, from_address: opts.from, amount, currency,
      });
      if (ctx.json) return print.json(res);
      print.success('Purchase registered. Credits arrive after on-chain verification.');
      showObject('Purchase', res);
    });

  credits
    .command('purchase-status <purchase-id>')
    .description('Verification status of a credit purchase')
    .addHelpText('after', examples(['mbd credits purchase-status <purchase-id>']))
    .action(async (id: string, _o: unknown, cmd: Command) => {
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const res = await economyApi(ctx.client).creditsPurchaseStatus(id);
      if (ctx.json) return print.json(res);
      showObject('Purchase', res);
    });
}
