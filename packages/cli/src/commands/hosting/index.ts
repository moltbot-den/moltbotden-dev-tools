/**
 * mbd hosting: VMs, databases, storage, OpenClaw, domains and billing on
 * Moltbot Den. Every subcommand talks to /v1/hosting (see lib/api/hosting.ts).
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { print, statusBadge } from '../../lib/output.js';
import { UsageError } from '../../lib/errors.js';
import type { PlatformStatus } from '../../types/hosting.js';
import { addVMCommands } from './vm.js';
import { addDatabaseCommands } from './db.js';
import { addStorageCommands } from './storage.js';
import { addOpenClawCommands } from './openclaw.js';
import { addDomainCommands } from './domains.js';
import { addBillingCommands } from './billing.js';
import {
  TOPUP_HINT, examples, explainHostingError, getHosting, hostingAction, money, relTime, withSpinner,
  type HostingService,
} from './shared.js';

/** One row of the `hosting status` resource overview. */
export interface ResourceSummary {
  count?: number;
  running?: number;
  error?: string;
}

async function summarize<T extends { status: string }>(
  service: HostingService,
  load: () => Promise<{ count: number; items: T[] }>,
  up: string,
): Promise<ResourceSummary> {
  try {
    const { count, items } = await load();
    return { count, running: items.filter((i) => i.status === up).length };
  } catch (err) {
    const explained = await explainHostingError(err, service);
    return { error: explained instanceof Error ? explained.message : String(explained) };
  }
}

export function addHostingCommands(program: Command): void {
  const hostingCmd = program
    .command('hosting')
    .alias('h')
    .description('Manage hosted infrastructure (VMs, databases, storage, OpenClaw, domains, billing)');
  examples(hostingCmd, ['mbd hosting status', 'mbd hosting vm create', 'mbd hosting openclaw deploy', 'mbd hosting billing status']);

  addVMCommands(hostingCmd, program);
  addDatabaseCommands(hostingCmd, program);
  addStorageCommands(hostingCmd, program);
  addOpenClawCommands(hostingCmd, program);
  addDomainCommands(hostingCmd, program);
  addBillingCommands(hostingCmd, program);

  // ─── status ────────────────────────────────────────────────────────────────
  examples(
    hostingCmd
      .command('status')
      .description('Platform health, plus your balance and resources when logged in'),
    ['mbd hosting status', 'mbd --json hosting status'],
  ).addHelpText('after', `
--json prints {"platform": <GET /v1/hosting/status>, "balance_cents": number|null,
"resources": {"vms"|"databases"|"storage"|"openclaw": {"count","running"} | {"error"}} | null}.
`).action(async () => {
    const h = await getHosting(program, false);
    const platform: PlatformStatus = await withSpinner('Checking hosting status', () => h.api.platformStatus());

    let balanceCents: number | null = null;
    let resources: Record<string, ResourceSummary> | null = null;
    if (h.authed) {
      const [account, vms, dbs, buckets, oc] = await Promise.all([
        h.api.getAccount().catch(() => null),
        summarize('compute', async () => { const r = await h.api.listVMs({ limit: 100 }); return { count: r.count, items: r.vms }; }, 'running'),
        summarize('databases', async () => { const r = await h.api.listDatabases({ limit: 100 }); return { count: r.count, items: r.databases }; }, 'running'),
        summarize('storage', async () => { const r = await h.api.listBuckets({ limit: 100 }); return { count: r.count, items: r.buckets }; }, 'active'),
        summarize('OpenClaw', async () => { const r = await h.api.listOpenClaw({ limit: 100 }); return { count: r.count, items: r.instances }; }, 'running'),
      ]);
      balanceCents = account?.usdc_balance_cents ?? null;
      resources = { vms, databases: dbs, storage: buckets, openclaw: oc };
    }

    if (h.json) return print.json({ platform, balance_cents: balanceCents, resources });

    console.log('');
    console.log(`  ${chalk.bold('Hosting platform')}  ${statusBadge(platform.status)}  ${chalk.gray(relTime(platform.timestamp))}`);
    for (const [name, s] of Object.entries(platform.services ?? {})) {
      console.log(`    ${chalk.gray(name.padEnd(12))} ${s.status.replace(/_/g, ' ')}${s.error ? chalk.red(`  ${s.error}`) : ''}`);
    }
    console.log('');
    if (!resources) {
      print.hint('Log in to see your balance and resources:  mbd login');
      return;
    }
    if (balanceCents !== null) console.log(`  ${chalk.gray('Balance'.padEnd(20))} ${chalk.bold(money(balanceCents))}`);
    const rows: Array<[string, ResourceSummary, string]> = [
      ['Virtual machines', resources.vms, 'mbd hosting vm list'],
      ['Databases', resources.databases, 'mbd hosting db list'],
      ['Storage buckets', resources.storage, 'mbd hosting storage list'],
      ['OpenClaw instances', resources.openclaw, 'mbd hosting openclaw list'],
    ];
    for (const [label, r, cmd] of rows) {
      let text: string;
      if (r.error) text = chalk.yellow(r.error);
      else if (!r.count) text = chalk.gray('none');
      else text = `${r.count} (${r.running} ${label === 'Storage buckets' ? 'active' : 'running'})  ${chalk.gray(cmd)}`;
      console.log(`  ${chalk.gray(label.padEnd(20))} ${text}`);
    }
    console.log('');
    if (balanceCents === 0) print.hint(TOPUP_HINT);
  });

  // ─── account ───────────────────────────────────────────────────────────────
  const accountCmd = hostingCmd.command('account').description('Show or update your hosting account');
  examples(accountCmd, ['mbd hosting account', 'mbd hosting account update --wallet 0x...']);

  examples(
    accountCmd.command('show', { isDefault: true }).description('Show your hosting account'),
    ['mbd hosting account', 'mbd --json hosting account show'],
  ).action(hostingAction(program, 'accounts', async (h) => {
    const a = await withSpinner('Fetching account', () => h.api.getAccount());
    if (h.json) return print.json(a);
    console.log('');
    print.keyValue([
      { label: 'Account ID',   value: chalk.gray(a.id) },
      { label: 'Email',        value: a.email },
      { label: 'Name',         value: a.display_name ?? undefined },
      { label: 'Status',       value: statusBadge(a.status) },
      { label: 'Balance',      value: chalk.bold(money(a.usdc_balance_cents)) },
      { label: 'Wallet',       value: a.wallet_address ? `${a.wallet_address}${a.wallet_verified === false ? chalk.yellow('  (unverified)') : ''}` : chalk.gray('not set') },
      { label: 'Referral',     value: a.referral_code ?? undefined },
      { label: 'Member since', value: relTime(a.created_at) },
    ], { labelWidth: 12 });
    console.log('');
    print.hint(TOPUP_HINT);
  }));

  examples(
    accountCmd
      .command('update')
      .description('Update your display name or the wallet you send USDC top-ups from')
      .option('--display-name <name>', 'Display name (max 100 characters)')
      .option('--wallet <address>', 'EVM wallet address (0x + 40 hex characters)')
      .option('--wallet-signature <signature>', 'Signature proving you own --wallet, if the server asks for one'),
    ['mbd hosting account update --wallet 0x1234...abcd', 'mbd hosting account update --display-name "Research Bot"'],
  ).action(hostingAction(program, 'accounts', async (h, opts: { displayName?: string; wallet?: string; walletSignature?: string }) => {
    if (opts.displayName === undefined && opts.wallet === undefined) {
      throw new UsageError('Nothing to update. Pass --display-name and/or --wallet.');
    }
    if (opts.displayName !== undefined && opts.displayName.length > 100) throw new UsageError('--display-name must be at most 100 characters.');
    if (opts.wallet !== undefined && !/^0x[0-9a-fA-F]{40}$/.test(opts.wallet)) {
      throw new UsageError('--wallet must be 0x followed by 40 hex characters.');
    }
    if (opts.walletSignature !== undefined && opts.wallet === undefined) throw new UsageError('--wallet-signature needs --wallet.');
    const result = await withSpinner('Updating account', () => h.api.updateAccount({
      display_name: opts.displayName,
      wallet_address: opts.wallet,
      wallet_signature: opts.walletSignature,
    }));
    if (h.json) return print.json(result);
    print.success('Account updated');
    if (opts.wallet) print.hint('USDC top-ups are matched to this wallet:  mbd hosting billing topup --help');
  }));
}
