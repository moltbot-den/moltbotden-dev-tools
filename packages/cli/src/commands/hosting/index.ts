/**
 * Hosting command group — orchestrates all hosting subcommands.
 *
 * Usage:
 *   mbd hosting vm list
 *   mbd hosting db create
 *   mbd hosting storage list
 *   mbd hosting openclaw deploy
 *   mbd hosting domains list
 *   mbd hosting billing balance
 *   mbd hosting status
 */

import { Command } from 'commander';
import * as clack from '@clack/prompts';
import chalk from 'chalk';
import { AuthManager } from '../../lib/auth-manager.js';
import { MoltbotDenClient } from '../../lib/api-client.js';
import { print, statusBadge } from '../../lib/output.js';
import { addVMCommands } from './vm.js';
import { addDatabaseCommands } from './db.js';
import { addStorageCommands } from './storage.js';
import { addOpenClawCommands } from './openclaw.js';
import { addDomainCommands } from './domains.js';
import { addBillingCommands } from './billing.js';

export function addHostingCommands(program: Command): void {

  const hostingCmd = program
    .command('hosting')
    .alias('h')
    .description('Manage hosted infrastructure (VMs, databases, storage, and more)');

  // ─── Client factory ───────────────────────────────────────────────────────────
  // Each hosting subcommand calls this to get an authenticated client

  const getClient = async (): Promise<MoltbotDenClient> => {
    const globalOpts = program.opts();
    const auth = await AuthManager.requireAuth(
      globalOpts.apiKey as string,
      globalOpts.apiUrl as string
    );
    return new MoltbotDenClient(auth.apiUrl, auth.apiKey);
  };

  const jsonMode = (): boolean => {
    const globalOpts = program.opts();
    return Boolean(globalOpts.json);
  };

  // ─── Subcommand groups ────────────────────────────────────────────────────────
  addVMCommands(hostingCmd, getClient, jsonMode);
  addDatabaseCommands(hostingCmd, getClient, jsonMode);
  addStorageCommands(hostingCmd, getClient, jsonMode);
  addOpenClawCommands(hostingCmd, getClient, jsonMode);
  addDomainCommands(hostingCmd, getClient, jsonMode);
  addBillingCommands(hostingCmd, getClient, jsonMode);

  // ─── hosting status (overview) ────────────────────────────────────────────────
  hostingCmd
    .command('status')
    .description('Show an overview of all your hosted resources')
    .action(async () => {
      const client = await getClient();
      const json = jsonMode();
      const spinner = json ? null : clack.spinner();
      if (spinner) spinner.start('Loading hosting status...');

      type SettledResult<T> = { status: 'fulfilled'; value: T } | { status: 'rejected'; reason: unknown };

      let vmsResult: Awaited<ReturnType<typeof client.listVMs>> | null = null;
      let dbsResult: Awaited<ReturnType<typeof client.listDatabases>> | null = null;
      let bucketsResult: Awaited<ReturnType<typeof client.listBuckets>> | null = null;
      let ocResult: Awaited<ReturnType<typeof client.listOpenClawInstances>> | null = null;
      let balanceResult: Awaited<ReturnType<typeof client.getBillingBalance>> | null = null;

      const [vms, dbs, buckets, oc, balance] = await Promise.allSettled([
        client.listVMs(),
        client.listDatabases(),
        client.listBuckets(),
        client.listOpenClawInstances(),
        client.getBillingBalance(),
      ]) as [
        SettledResult<Awaited<ReturnType<typeof client.listVMs>>>,
        SettledResult<Awaited<ReturnType<typeof client.listDatabases>>>,
        SettledResult<Awaited<ReturnType<typeof client.listBuckets>>>,
        SettledResult<Awaited<ReturnType<typeof client.listOpenClawInstances>>>,
        SettledResult<Awaited<ReturnType<typeof client.getBillingBalance>>>,
      ];

      if (vms.status === 'fulfilled') vmsResult = vms.value;
      if (dbs.status === 'fulfilled') dbsResult = dbs.value;
      if (buckets.status === 'fulfilled') bucketsResult = buckets.value;
      if (oc.status === 'fulfilled') ocResult = oc.value;
      if (balance.status === 'fulfilled') balanceResult = balance.value;

      if (spinner) spinner.stop('');

      if (json) {
        console.log(JSON.stringify({ vms: vmsResult, databases: dbsResult, storage: bucketsResult, openclaw: ocResult, balance: balanceResult }));
        return;
      }

      console.log('');
      console.log(chalk.bold('  Hosting Overview'));
      console.log('');
      print.divider(52);
      console.log('');

      // Balance
      if (balanceResult) {
        const dollars = balanceResult.balance_cents / 100;
        const isLow = dollars < 10;
        console.log(
          `  ${chalk.gray('Balance')}  ` +
          (isLow ? chalk.red.bold(`$${dollars.toFixed(2)}`) : chalk.white.bold(`$${dollars.toFixed(2)}`)) +
          (isLow ? chalk.red('  ⚠ Low') : '')
        );
        console.log('');
      }

      // Resource summary table
      const resources: Array<{ type: string; count: number; running: number; hint: string }> = [];

      if (vmsResult) {
        const running = vmsResult.vms.filter((v) => v.status === 'running').length;
        resources.push({ type: 'Virtual Machines', count: vmsResult.count, running, hint: 'mbd hosting vm list' });
      }
      if (dbsResult) {
        const ready = dbsResult.databases.filter((d) => d.status === 'ready').length;
        resources.push({ type: 'Databases', count: dbsResult.count, running: ready, hint: 'mbd hosting db list' });
      }
      if (bucketsResult) {
        const active = bucketsResult.buckets.filter((b) => b.status === 'active').length;
        resources.push({ type: 'Storage Buckets', count: bucketsResult.count, running: active, hint: 'mbd hosting storage list' });
      }
      if (ocResult) {
        const running = ocResult.instances.filter((i) => i.status === 'running').length;
        resources.push({ type: 'OpenClaw Instances', count: ocResult.count, running, hint: 'mbd hosting openclaw list' });
      }

      if (resources.length === 0) {
        print.empty(
          'No hosting resources yet',
          "Get started:  mbd hosting vm create  or  mbd hosting openclaw deploy"
        );
      } else {
        for (const r of resources) {
          const statusStr = r.count === 0
            ? chalk.gray('none')
            : r.running === r.count
              ? chalk.green(`${r.count} running`)
              : r.running > 0
                ? chalk.yellow(`${r.running}/${r.count} running`)
                : chalk.yellow(`${r.count} stopped`);

          console.log(`  ${chalk.white(r.type.padEnd(22))}  ${statusStr}`);
          if (r.count > 0) {
            console.log(`  ${chalk.gray(' '.repeat(22))}  ${chalk.gray(r.hint)}`);
          }
          console.log('');
        }
      }

      print.divider(52);
      console.log('');
      print.hint('Full usage breakdown:  mbd hosting billing usage');
      console.log('');
    });

  // ─── hosting account ──────────────────────────────────────────────────────────
  hostingCmd
    .command('account')
    .description('Show your hosting account details')
    .action(async () => {
      const client = await getClient();
      const json = jsonMode();
      const spinner = json ? null : clack.spinner();
      if (spinner) spinner.start('Fetching account...');

      let account: Awaited<ReturnType<typeof client.getHostingAccount>>;
      try {
        account = await client.getHostingAccount();
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Failed to fetch account');
        process.exit(1);
      }

      if (json) { console.log(JSON.stringify(account)); return; }

      console.log('');
      console.log(`  ${chalk.bold('Hosting Account')}`);
      console.log('');

      print.keyValue([
        { label: 'Account ID',  value: chalk.gray(account.id) },
        { label: 'Email',       value: account.email },
        { label: 'Status',      value: statusBadge(account.status) },
        { label: 'Balance',     value: chalk.white(`$${(account.usdc_balance_cents / 100).toFixed(2)}`) },
        { label: 'NFT Holder',  value: account.nft_holder ? chalk.green('Yes (10% discount)') : chalk.gray('No') },
        { label: 'Wallet',      value: account.wallet_address ? chalk.gray(account.wallet_address) : undefined },
        { label: 'Referral',    value: account.referral_code ? chalk.cyan(account.referral_code) : undefined },
        { label: 'Member Since', value: print.relativeTime(account.created_at) },
      ], { labelWidth: 14 });

      console.log('');
      print.hint('Top up balance:  mbd hosting billing topup');
      console.log('');
    });
}
