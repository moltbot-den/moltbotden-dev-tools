/**
 * Hosting billing commands: balance, usage, history, topup
 */

import { Command } from 'commander';
import * as clack from '@clack/prompts';
import chalk from 'chalk';
import open from 'open';
import { MoltbotDenClient } from '../../lib/api-client.js';
import { print } from '../../lib/output.js';

export function addBillingCommands(parent: Command, getClient: () => Promise<MoltbotDenClient>, jsonMode: () => boolean): void {

  const billingCmd = parent
    .command('billing')
    .description('View and manage hosting billing');

  // ─── balance ──────────────────────────────────────────────────────────────────
  billingCmd
    .command('balance')
    .description('Show current hosting account balance')
    .action(async () => {
      const client = await getClient();
      const json = jsonMode();
      const spinner = json ? null : clack.spinner();
      if (spinner) spinner.start('Fetching balance...');

      let balance: Awaited<ReturnType<typeof client.getBillingBalance>>;
      let account: Awaited<ReturnType<typeof client.getHostingAccount>>;

      try {
        [balance, account] = await Promise.all([
          client.getBillingBalance(),
          client.getHostingAccount(),
        ]);
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Failed to fetch balance');
        process.exit(1);
      }

      if (json) {
        console.log(JSON.stringify({ balance, account }));
        return;
      }

      const balanceDollars = balance.balance_cents / 100;
      const isLow = balanceDollars < 10;

      console.log('');
      console.log(`  ${chalk.bold('Hosting Account Balance')}`);
      console.log('');

      const balanceStr = `$${balanceDollars.toFixed(2)}`;
      const balanceColored = isLow
        ? chalk.red.bold(balanceStr)
        : balanceDollars > 50
          ? chalk.green.bold(balanceStr)
          : chalk.white.bold(balanceStr);

      console.log(`  ${balanceColored}  ${chalk.gray(balance.currency.toUpperCase())}`);
      console.log('');

      if (isLow) {
        print.warn('Balance is low — consider adding funds to avoid service interruptions');
        print.hint('mbd hosting billing topup');
      }

      print.keyValue([
        { label: 'Account',   value: account.email },
        { label: 'Status',    value: account.status === 'active' ? chalk.green('Active') : chalk.yellow(account.status) },
        { label: 'Wallet',    value: account.wallet_address ? chalk.gray(account.wallet_address.slice(0, 20) + '…') : undefined },
        { label: 'NFT Holder', value: account.nft_holder ? chalk.green('Yes (10% discount)') : undefined },
        { label: 'Referral',  value: account.referral_code ? chalk.cyan(account.referral_code) : undefined },
      ], { labelWidth: 12 });

      console.log('');
      print.hint('View usage:  mbd hosting billing usage');
      print.hint('Add funds:   mbd hosting billing topup');
      console.log('');
    });

  // ─── usage ────────────────────────────────────────────────────────────────────
  billingCmd
    .command('usage')
    .description('Show current billing period usage')
    .action(async () => {
      const client = await getClient();
      const json = jsonMode();
      const spinner = json ? null : clack.spinner();
      if (spinner) spinner.start('Fetching usage...');

      let usage: Awaited<ReturnType<typeof client.getBillingUsage>>;
      try {
        usage = await client.getBillingUsage();
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Failed to fetch usage');
        process.exit(1);
      }

      if (json) { console.log(JSON.stringify(usage)); return; }

      const start = new Date(usage.period_start).toLocaleDateString();
      const end = new Date(usage.period_end).toLocaleDateString();

      print.header(`Usage: ${start} – ${end}`);
      console.log('');
      console.log(`  ${chalk.gray('Total this period:')}  ${chalk.bold.white('$' + (usage.total_cents / 100).toFixed(2))}`);
      console.log('');

      if (!usage.breakdown || usage.breakdown.length === 0) {
        print.empty('No usage this period');
        return;
      }

      print.table(
        [
          { header: 'RESOURCE',   key: 'resource_name', width: 28, format: (v) => chalk.cyan(String(v)) },
          { header: 'TYPE',       key: 'resource_type', width: 12, format: (v) => chalk.gray(String(v)) },
          { header: 'AMOUNT',     key: 'amount_cents',  align: 'right',
            format: (v) => chalk.white('$' + (Number(v) / 100).toFixed(2)) },
        ],
        usage.breakdown as Record<string, unknown>[]
      );

      console.log('');
    });

  // ─── history ──────────────────────────────────────────────────────────────────
  billingCmd
    .command('history')
    .description('Show billing transaction history')
    .option('--limit <n>', 'Number of transactions', '20')
    .action(async (opts) => {
      const client = await getClient();
      const json = jsonMode();
      const spinner = json ? null : clack.spinner();
      if (spinner) spinner.start('Fetching billing history...');

      let history: Awaited<ReturnType<typeof client.getBillingHistory>>;
      try {
        history = await client.getBillingHistory(Number(opts.limit));
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Failed to fetch history');
        process.exit(1);
      }

      if (json) { console.log(JSON.stringify(history)); return; }

      print.header('Billing History');
      console.log('');

      const { transactions } = history;

      if (!transactions || transactions.length === 0) {
        print.empty('No billing history yet');
        return;
      }

      print.table(
        [
          { header: 'DATE',        key: 'created_at',   width: 14, format: (v) => chalk.gray(print.relativeTime(String(v))) },
          { header: 'TYPE',        key: 'type',         width: 10,
            format: (v) => {
              const t = String(v);
              if (t === 'credit') return chalk.green(t);
              if (t === 'refund') return chalk.cyan(t);
              return chalk.gray(t);
            }
          },
          { header: 'AMOUNT',      key: 'amount_cents', align: 'right', width: 12,
            format: (v, row) => {
              const r = row as { type: string; amount_cents: number };
              const dollars = r.amount_cents / 100;
              if (r.type === 'credit' || r.type === 'refund') {
                return chalk.green(`+$${dollars.toFixed(2)}`);
              }
              return chalk.white(`-$${dollars.toFixed(2)}`);
            }
          },
          { header: 'DESCRIPTION', key: 'description',  width: 40, format: (v) => chalk.gray(String(v)) },
        ],
        transactions as Record<string, unknown>[]
      );

      console.log('');
    });

  // ─── topup ────────────────────────────────────────────────────────────────────
  billingCmd
    .command('topup')
    .description('Add funds to your hosting account')
    .option('--amount <dollars>', 'Amount in USD to add')
    .action(async (opts) => {
      const client = await getClient();
      const json = jsonMode();

      let amountDollars: number;

      if (opts.amount) {
        amountDollars = parseFloat(opts.amount as string);
        if (isNaN(amountDollars) || amountDollars < 5) {
          print.error('Amount must be at least $5.00');
          process.exit(1);
        }
      } else if (!json) {
        const amt = await clack.select({
          message: 'How much would you like to add?',
          options: [
            { value: '10',  label: '$10.00',  hint: '~1 month Nano VM' },
            { value: '25',  label: '$25.00',  hint: '~1 month Standard VM' },
            { value: '50',  label: '$50.00',  hint: '~1 month Pro VM' },
            { value: '100', label: '$100.00', hint: 'Comfortable buffer for most setups' },
            { value: '250', label: '$250.00', hint: 'Power user' },
          ],
        });
        if (clack.isCancel(amt)) { clack.cancel('Cancelled'); process.exit(0); }
        amountDollars = parseFloat(amt as string);
      } else {
        print.error('--amount is required in JSON mode');
        process.exit(1);
      }

      const amountCents = Math.round(amountDollars * 100);

      const spinner = json ? null : clack.spinner();
      if (spinner) spinner.start('Creating checkout session...');

      try {
        const result = await client.createCheckoutSession(amountCents);
        if (spinner) spinner.stop('');

        if (json) {
          console.log(JSON.stringify(result));
        } else {
          print.success(`Checkout session created for ${chalk.yellow('$' + amountDollars.toFixed(2))}`);
          console.log('');
          print.info('Opening payment page in your browser...');
          print.hint(result.url);
          console.log('');

          try {
            await open(result.url);
          } catch {
            print.warn('Could not open browser automatically');
            print.hint(`Visit: ${result.url}`);
          }
        }
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Failed to create checkout session');
        process.exit(1);
      }
    });
}
