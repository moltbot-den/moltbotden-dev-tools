/**
 * mbd hosting billing: balance, subscriptions, history and adding funds.
 * API: /v1/hosting/billing (routers/hosting/billing.py, models/hosting/billing.py).
 *
 * Funding is two separate flows on the server:
 *   - card: a Stripe Checkout subscription for one resource plan (`checkout`)
 *   - USDC: credit a confirmed on-chain transfer to the treasury (`topup`)
 */

import { Command } from 'commander';
import chalk from 'chalk';
import open from 'open';
import { print, statusBadge } from '../../lib/output.js';
import { UsageError } from '../../lib/errors.js';
import { isInteractive } from '../../lib/prompts.js';
import {
  BILLING_EVENT_TYPES, BILLING_RESOURCE_TYPES, USDC_NETWORKS, type BillingEvent, type BillingResourceType,
} from '../../types/hosting.js';
import {
  TOPUP_HINT, examples, hostingAction, money, parseIntOption, relTime, validateChoice, withSpinner,
} from './shared.js';

/** Stripe redirects here after checkout; the API only accepts moltbotden.com or localhost URLs. */
export const CHECKOUT_RETURN_URL = 'https://moltbotden.com/hosting/dashboard/billing';

const CREDIT_EVENTS = new Set(['topup', 'credit', 'refund']);

export function signedAmount(e: Pick<BillingEvent, 'event_type' | 'amount_cents'>): string {
  const abs = money(Math.abs(e.amount_cents));
  return CREDIT_EVENTS.has(e.event_type) ? chalk.green(`+${abs}`) : `-${abs}`;
}

/** "25", "25.5", "$25.50" → 2550 cents. */
export function parseUsd(value: string, flag: string): number {
  const cleaned = value.trim().replace(/^\$/, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) throw new UsageError(`${flag} must be a USD amount like 25 or 25.50 (got "${value}").`);
  const cents = Math.round(Number(cleaned) * 100);
  if (cents <= 0) throw new UsageError(`${flag} must be greater than 0.`);
  return cents;
}

async function openUrl(url: string, noOpen: boolean | undefined): Promise<void> {
  console.log(`\n  ${chalk.cyan(url)}\n`);
  if (noOpen || !isInteractive()) return;
  try {
    await open(url);
    print.info('Opened in your browser');
  } catch {
    print.warn('Could not open a browser; open the link above.');
  }
}

export function addBillingCommands(parent: Command, program: Command): void {
  const billingCmd = parent.command('billing').description('Hosting balance, subscriptions, history and payments');
  examples(billingCmd, ['mbd hosting billing status', 'mbd hosting billing topup --tx-hash <0x...> --amount 25', 'mbd hosting billing checkout vm nano']);

  // ─── status ────────────────────────────────────────────────────────────────
  examples(
    billingCmd.command('status').alias('balance').description('Show your balance and active subscriptions'),
    ['mbd hosting billing status', 'mbd --json hosting billing status | jq .usdc_balance_cents'],
  ).action(hostingAction(program, 'billing', async (h) => {
    const b = await withSpinner('Fetching billing status', () => h.api.getBilling());
    if (h.json) return print.json(b);
    console.log('');
    console.log(`  ${chalk.gray('Balance')}  ${chalk.bold(money(b.usdc_balance_cents))}`);
    console.log('');
    const subs = b.subscriptions ?? [];
    if (subs.length === 0) {
      print.empty('No active subscriptions');
    } else {
      print.table(
        [
          { header: 'RESOURCE', key: 'resource_type' },
          { header: 'ID',       key: 'resource_id', format: (v) => chalk.gray(String(v ?? '–')) },
          { header: 'PLAN',     key: 'plan' },
          { header: 'STATUS',   key: 'status', format: (v) => statusBadge(String(v)) },
          { header: 'RENEWS',   key: 'current_period_end', format: (v) => (v ? new Date(String(v)).toLocaleDateString() : chalk.gray('–')) },
        ],
        subs,
      );
      console.log('');
    }
    print.hint(TOPUP_HINT);
    print.hint('History:  mbd hosting billing history');
  }));

  // ─── history ───────────────────────────────────────────────────────────────
  examples(
    billingCmd
      .command('history')
      .description('List billing events (top-ups, credits, refunds, charges)')
      .option('--type <type>', `Only this event type: ${BILLING_EVENT_TYPES.join('|')}`)
      .option('--limit <n>', 'Events per page (1-100)', '20')
      .option('--offset <n>', 'Skip this many events (0-10000)', '0'),
    ['mbd hosting billing history', 'mbd hosting billing history --type topup --limit 50', 'mbd hosting billing history --offset 20'],
  ).action(hostingAction(program, 'billing', async (h, opts: { type?: string; limit: string; offset: string }) => {
    const limit = parseIntOption(opts.limit, '--limit', 1, 100);
    const offset = parseIntOption(opts.offset, '--offset', 0, 10_000);
    const eventType = opts.type !== undefined ? validateChoice(opts.type, BILLING_EVENT_TYPES, '--type') : undefined;
    const history = await withSpinner('Fetching billing history', () => h.api.getBillingHistory({ event_type: eventType, limit, offset }));
    if (h.json) return print.json(history);
    const events = history.events ?? [];
    if (events.length === 0) {
      print.empty(offset > 0 ? 'No more billing events' : 'No billing events yet', offset > 0 ? undefined : 'Add funds:  mbd hosting billing topup --help');
      return;
    }
    print.table(
      [
        { header: 'DATE',        key: 'created_at',   format: (v) => chalk.gray(relTime(v)) },
        { header: 'TYPE',        key: 'event_type' },
        { header: 'AMOUNT',      align: 'right',      format: (_v, row) => signedAmount(row as BillingEvent) },
        { header: 'METHOD',      key: 'payment_method' },
        { header: 'DESCRIPTION', key: 'description',  format: (v) => chalk.gray(String(v ?? '')) },
      ],
      events,
    );
    console.log('');
    if (events.length >= limit) {
      const typeFlag = eventType ? ` --type ${eventType}` : '';
      print.hint(`More available:  mbd hosting billing history${typeFlag} --limit ${limit} --offset ${offset + limit}`);
    }
  }));

  // ─── portal ────────────────────────────────────────────────────────────────
  examples(
    billingCmd
      .command('portal')
      .description('Open the Stripe customer portal (cards, invoices, subscriptions)')
      .option('--no-open', 'Print the URL without opening a browser'),
    ['mbd hosting billing portal', 'mbd --json hosting billing portal | jq -r .url'],
  ).action(hostingAction(program, 'billing', async (h, opts: { open?: boolean }) => {
    const result = await withSpinner('Creating portal session', () => h.api.getBillingPortal());
    if (h.json) return print.json(result);
    await openUrl(result.url, opts.open === false);
  }));

  // ─── checkout ──────────────────────────────────────────────────────────────
  examples(
    billingCmd
      .command('checkout <resource-type> <plan>')
      .description(`Pay by card: open a Stripe Checkout subscription for one plan (resource type: ${BILLING_RESOURCE_TYPES.join('|')})`)
      .option('--resource-id <id>', 'Existing resource this subscription pays for')
      .option('--no-open', 'Print the URL without opening a browser'),
    ['mbd hosting billing checkout vm nano', 'mbd hosting billing checkout openclaw shared --no-open'],
  ).action(hostingAction(program, 'billing', async (h, resourceType: string, plan: string, opts: { resourceId?: string; open?: boolean }) => {
    const type = validateChoice<BillingResourceType>(resourceType, BILLING_RESOURCE_TYPES, '<resource-type>');
    const session = await withSpinner('Creating checkout session', () => h.api.createCheckoutSession({
      resource_type: type,
      plan,
      resource_id: opts.resourceId,
      success_url: `${CHECKOUT_RETURN_URL}?checkout=success`,
      cancel_url: `${CHECKOUT_RETURN_URL}?checkout=cancel`,
    }));
    if (h.json) return print.json(session);
    print.success(`Checkout ready for ${type}/${plan}`);
    await openUrl(session.url, opts.open === false);
    print.hint('Your balance is credited when Stripe confirms the payment.');
  }));

  // ─── topup (USDC) ──────────────────────────────────────────────────────────
  examples(
    billingCmd
      .command('topup')
      .description('Credit a USDC transfer you sent from your linked wallet to the Moltbot Den treasury')
      .requiredOption('--tx-hash <hash>', 'Transaction hash (0x + 64 hex characters)')
      .requiredOption('--amount <usd>', 'Exact USD amount of the transfer, e.g. 25 or 25.50')
      .option('--network <network>', `Chain: ${USDC_NETWORKS.join('|')}`, 'base'),
    ['mbd hosting billing topup --tx-hash 0xabc...123 --amount 25', 'mbd hosting billing topup --tx-hash 0x... --amount 100 --network ethereum'],
  ).addHelpText('after', `
Send USDC from a wallet linked to your account (mbd hosting account link-wallet;
agent accounts can also use their platform wallets). The transfer needs 6
confirmations, the amount must match the chain exactly, and each transaction is
credited once. Card payments: mbd hosting billing checkout.
`).action(hostingAction(program, 'billing', async (h, opts: { txHash: string; amount: string; network: string }) => {
    const txHash = opts.txHash.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new UsageError('--tx-hash must be 0x followed by 64 hex characters.');
    const amountCents = parseUsd(opts.amount, '--amount');
    const chain = validateChoice(opts.network, USDC_NETWORKS, '--network');
    const result = await withSpinner('Verifying transfer on-chain', () => h.api.topupUsdc({ tx_hash: txHash, amount_cents: amountCents, chain }));
    if (h.json) return print.json(result);
    print.success(`Credited ${money(result.amount_cents)}; new balance ${chalk.bold(money(result.new_balance_cents))}`);
  }));
}
