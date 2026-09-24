/**
 * wallet: your agent's CDP wallet (/wallet/me*).
 *
 * Only `send` moves money. It requires explicit --to, --amount and --asset,
 * shows a summary, and goes through confirmDestructive (so automation must
 * pass --yes). Trading and staking are deliberately not exposed here.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { resolveContext } from '../lib/context.js';
import { createSpinner, print } from '../lib/output.js';
import { CliError, UsageError } from '../lib/errors.js';
import { confirmDestructive } from '../lib/prompts.js';
import { walletApi, type WalletInfo } from '../lib/api/wallet.js';
import { examples, parsePositiveInt, when } from '../lib/command-utils.js';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const AMOUNT_RE = /^(\d+(\.\d*)?|\.\d+)$/;

/** Validate send arguments before anything touches the network. */
export function validateSend(opts: { to?: string; amount?: string; asset?: string }): { to: string; amount: string; asset: string } {
  if (!opts.to || !opts.amount || !opts.asset) {
    throw new UsageError('wallet send needs --to, --amount and --asset', {
      hint: 'Example: mbd wallet send --to 0xabc... --amount 1.5 --asset usdc',
    });
  }
  if (!ADDRESS_RE.test(opts.to)) throw new UsageError(`--to must be a 0x-prefixed 40-hex-character address, got "${opts.to}"`);
  if (!AMOUNT_RE.test(opts.amount) || Number(opts.amount) <= 0) {
    throw new UsageError(`--amount must be a positive decimal number, got "${opts.amount}"`);
  }
  return { to: opts.to, amount: opts.amount, asset: opts.asset.toLowerCase() };
}

function requireWallet(info: WalletInfo): asserts info is WalletInfo & { wallet_address: string } {
  if (!info.has_wallet || !info.wallet_address) {
    throw new CliError('You do not have a wallet yet', { hint: 'Create one: mbd wallet create' });
  }
}

export function addWalletCommands(program: Command): void {
  const wallet = program
    .command('wallet')
    .description('Your agent wallet: address, balances, networks, sending')
    .addHelpText('after', examples([
      'mbd wallet',
      'mbd wallet balance',
      'mbd wallet create --network base-mainnet',
      'mbd wallet send --to 0xabc... --amount 5 --asset usdc',
    ]));

  wallet
    .command('show', { isDefault: true })
    .description('Show your wallet address and network')
    .addHelpText('after', examples(['mbd wallet show', 'mbd wallet show --json']))
    .action(async (_opts: unknown, cmd: Command) => {
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const info = await walletApi(ctx.client).get();
      if (ctx.json) return print.json(info);
      if (!info.has_wallet) {
        print.empty('No wallet yet.', 'Create one: mbd wallet create');
        return;
      }
      print.header('Wallet');
      print.keyValue([
        { label: 'Address', value: chalk.cyan(info.wallet_address ?? '') },
        { label: 'Network', value: info.network ?? null },
        { label: 'Wallet ID', value: chalk.gray(info.wallet_id ?? '') },
      ]);
      const others = Object.entries(info.cdp_wallets ?? {}).filter(([, w]) => w.address !== info.wallet_address);
      if (others.length > 0) {
        print.spacer();
        print.table(
          [
            { header: 'NETWORK', key: 'network' },
            { header: 'ADDRESS', key: 'address', format: (v) => chalk.cyan(String(v)) },
          ],
          others.map(([network, w]) => ({ network, address: w.address })),
        );
      }
      print.hint('\nBalances: mbd wallet balance');
    });

  wallet
    .command('balance')
    .description('Show token balances of your primary wallet')
    .addHelpText('after', examples(['mbd wallet balance', 'mbd wallet balance --json']))
    .action(async (_opts: unknown, cmd: Command) => {
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const spinner = createSpinner();
      spinner.start('Fetching balances...');
      let res;
      try {
        res = await walletApi(ctx.client).balance();
      } finally {
        spinner.stop('');
      }
      if (ctx.json) return print.json(res);
      print.table(
        [
          { header: 'ASSET', key: 'asset', format: (v) => String(v).toUpperCase() },
          { header: 'BALANCE', key: 'amount', align: 'right' },
        ],
        Object.entries(res.balances).map(([asset, amount]) => ({ asset, amount })),
      );
    });

  wallet
    .command('networks')
    .description('List networks available for wallets')
    .addHelpText('after', examples(['mbd wallet networks']))
    .action(async (_opts: unknown, cmd: Command) => {
      const ctx = await resolveContext(cmd);
      const res = await walletApi(ctx.client).networks();
      if (ctx.json) return print.json(res);
      print.table(
        [
          { header: 'NETWORK', key: 'network_id', format: (v) => (v === res.default_network ? `${chalk.cyan(String(v))} ${chalk.gray('(default)')}` : String(v)) },
          { header: 'NAME', key: 'display_name' },
          { header: 'TESTNET', key: 'is_testnet', format: (v) => (v ? 'yes' : 'no') },
          { header: 'ASSETS', key: 'supported_assets', format: (v) => (Array.isArray(v) ? v.join(', ') : '') },
        ],
        res.networks,
      );
    });

  wallet
    .command('create')
    .description('Create a wallet (returns the existing one if you already have it)')
    .option('--network <network>', 'Network id (see: mbd wallet networks); default is the platform default')
    .addHelpText('after', examples(['mbd wallet create', 'mbd wallet create --network base-mainnet']))
    .action(async (opts: { network?: string }, cmd: Command) => {
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const spinner = createSpinner();
      spinner.start('Creating wallet...');
      let res;
      try {
        res = await walletApi(ctx.client).create(opts.network);
      } finally {
        spinner.stop('');
      }
      if (ctx.json) return print.json(res);
      print.success(`${res.message} ${chalk.cyan(res.wallet_address)} on ${res.network}`);
      print.hint('Balances: mbd wallet balance');
    });

  wallet
    .command('send')
    .description('Send crypto from your wallet (irreversible; asks for confirmation)')
    .option('--to <address>', 'Recipient address (0x + 40 hex characters)')
    .option('--amount <amount>', 'Amount as a decimal string, e.g. 1.5')
    .option('--asset <asset>', 'Asset symbol, e.g. usdc or eth')
    .option('--no-gasless', 'Pay gas yourself instead of using the platform paymaster')
    .option('-y, --yes', 'Skip the confirmation prompt')
    .addHelpText('after', examples([
      'mbd wallet send --to 0x1234...abcd --amount 2.5 --asset usdc',
      'mbd wallet send --to 0x1234...abcd --amount 0.01 --asset eth --yes --json',
    ]) + `
On-chain transfers cannot be undone. Double-check the address and network.
`)
    .action(async (opts: { to?: string; amount?: string; asset?: string; gasless: boolean; yes?: boolean }, cmd: Command) => {
      const send = validateSend(opts);
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const api = walletApi(ctx.client);
      const info = await api.get();
      requireWallet(info);

      const summary =
        `Send ${send.amount} ${send.asset.toUpperCase()} to ${send.to} on ${info.network ?? 'the default network'}` +
        ` from ${info.wallet_address}${opts.gasless ? '' : ' (you pay gas)'}? This cannot be undone.`;
      if (!ctx.json) {
        print.header('Transfer');
        print.keyValue([
          { label: 'Amount', value: `${send.amount} ${send.asset.toUpperCase()}` },
          { label: 'To', value: send.to },
          { label: 'From', value: info.wallet_address },
          { label: 'Network', value: info.network ?? 'default' },
          { label: 'Gas', value: opts.gasless ? 'sponsored when eligible' : 'paid by you' },
        ]);
        print.spacer();
      }
      if (!(await confirmDestructive({ yes: opts.yes, json: ctx.json, message: summary }))) {
        print.info('Cancelled. Nothing was sent.');
        return;
      }
      const res = await api.send({ to_address: send.to, amount: send.amount, asset: send.asset }, opts.gasless);
      if (ctx.json) return print.json({ ...res, network: info.network ?? null });
      print.success(`Sent ${res.amount} ${res.asset.toUpperCase()} to ${res.to}`);
      print.hint(`Status: ${res.status}  Tx: ${res.tx_hash}`);
    });

  wallet
    .command('history')
    .description('Recent on-chain transactions for your wallet address')
    .option('--chain <chain>', 'Chain to query (e.g. base, ethereum)', 'base')
    .option('--limit <n>', 'Number of transactions (1-100)', '20')
    .addHelpText('after', examples(['mbd wallet history', 'mbd wallet history --chain ethereum --limit 50']))
    .action(async (opts: { chain: string; limit: string }, cmd: Command) => {
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const api = walletApi(ctx.client);
      const info = await api.get();
      requireWallet(info);
      const res = await api.transactions(info.wallet_address, {
        chain: opts.chain,
        limit: parsePositiveInt(opts.limit, '--limit', { max: 100 }),
      });
      if (ctx.json) return print.json(res);
      if (res.transactions.length === 0) {
        print.empty(`No transactions on ${opts.chain} yet.`);
        return;
      }
      print.table(
        [
          { header: 'WHEN', key: 'timestamp', format: (v) => when(v) },
          { header: 'TRANSFERS', key: 'asset_transfers', format: (v) =>
            (Array.isArray(v) ? v : [])
              .map((t: { direction: string; amount: string; token_symbol: string }) =>
                `${t.direction === 'in' ? chalk.green('+') : chalk.red('-')}${t.amount} ${t.token_symbol}`)
              .join(', ') || chalk.gray('–') },
          { header: 'HASH', key: 'hash', format: (v) => chalk.gray(String(v)) },
        ],
        res.transactions,
      );
    });
}
