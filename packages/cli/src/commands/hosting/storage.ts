/**
 * Hosting storage commands: list, create, show, usage, delete
 */

import { Command } from 'commander';
import * as clack from '@clack/prompts';
import chalk from 'chalk';
import { MoltbotDenClient } from '../../lib/api-client.js';
import { print, statusBadge } from '../../lib/output.js';
import { STORAGE_PLAN_SPECS, type StoragePlan } from '../../types/hosting.js';

export function addStorageCommands(parent: Command, getClient: () => Promise<MoltbotDenClient>, jsonMode: () => boolean): void {

  const storageCmd = parent
    .command('storage')
    .description('Manage object storage buckets');

  // ─── list ─────────────────────────────────────────────────────────────────────
  storageCmd
    .command('list')
    .alias('ls')
    .description('List your storage buckets')
    .action(async () => {
      const client = await getClient();
      const json = jsonMode();
      const spinner = json ? null : clack.spinner();
      if (spinner) spinner.start('Loading buckets...');

      let result: Awaited<ReturnType<typeof client.listBuckets>>;
      try {
        result = await client.listBuckets();
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Failed to list buckets');
        process.exit(1);
      }

      if (json) { console.log(JSON.stringify(result)); return; }

      const { buckets } = result;
      print.header(`Storage Buckets  ${chalk.gray(`(${buckets.length})`)}`);
      console.log('');

      if (buckets.length === 0) {
        print.empty('No buckets yet', 'Create one with:  mbd hosting storage create');
        return;
      }

      print.table(
        [
          { header: 'NAME',    key: 'name',   width: 24, format: (v) => chalk.cyan(String(v)) },
          { header: 'PLAN',    key: 'plan',   width: 12, format: (v) => String(v) },
          { header: 'STATUS',  key: 'status', width: 16, format: (v) => statusBadge(String(v)) },
          { header: 'REGION',  key: 'region', width: 14, format: (v) => chalk.gray(String(v)) },
          { header: 'OBJECTS', key: 'object_count',       format: (v) => v !== null ? chalk.gray(String(v)) : chalk.gray('–') },
          { header: 'USED',    key: 'storage_used_bytes',
            format: (v) => v !== null ? chalk.gray(formatBytes(Number(v))) : chalk.gray('–') },
          { header: 'CREATED', key: 'created_at', format: (v) => chalk.gray(print.relativeTime(String(v))) },
        ],
        buckets as Record<string, unknown>[]
      );

      console.log('');
      print.hint(`Show details:  mbd hosting storage show <id>`);
      console.log('');
    });

  // ─── create ───────────────────────────────────────────────────────────────────
  storageCmd
    .command('create')
    .description('Create a new storage bucket')
    .option('--name <name>',     'Bucket name')
    .option('--plan <plan>',     'Plan: starter|standard|business')
    .option('--region <region>', 'GCP region', 'us-central1')
    .action(async (opts) => {
      const client = await getClient();
      const json = jsonMode();

      let name: string = opts.name as string;
      let plan: StoragePlan = opts.plan as StoragePlan;

      if (!json) {
        if (!name) {
          const n = await clack.text({
            message: 'Bucket name:',
            placeholder: 'my-agent-storage',
            validate: (v) => {
              if (!v || v.trim().length < 3) return 'Name must be at least 3 characters';
              if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]?$/.test(v)) return 'Use lowercase letters, numbers, and hyphens';
              if (v.length > 40) return 'Name must be at most 40 characters';
            },
          });
          if (clack.isCancel(n)) { clack.cancel('Cancelled'); process.exit(0); }
          name = (n as string).trim();
        }

        if (!plan) {
          const p = await clack.select({
            message: 'Select plan:',
            options: (Object.entries(STORAGE_PLAN_SPECS) as [StoragePlan, typeof STORAGE_PLAN_SPECS[StoragePlan]][]).map(([key, spec]) => ({
              value: key,
              label: `${spec.name.padEnd(10)}  ${spec.storage_gb} GB storage · ${spec.egress_gb} GB egress/mo`,
              hint: `$${(spec.price_cents / 100).toFixed(2)}/mo`,
            })),
          });
          if (clack.isCancel(p)) { clack.cancel('Cancelled'); process.exit(0); }
          plan = p as StoragePlan;
        }

        const spec = STORAGE_PLAN_SPECS[plan];
        const confirmed = await clack.confirm({
          message: `Create bucket "${chalk.white(name)}" (${chalk.cyan(plan)}) for ${chalk.yellow('$' + (spec.price_cents / 100).toFixed(2) + '/mo')}?`,
          initialValue: true,
        });
        if (clack.isCancel(confirmed) || !confirmed) { clack.cancel('Cancelled'); process.exit(0); }
      } else {
        if (!name || !plan) {
          print.error('--name and --plan are required in JSON mode');
          process.exit(1);
        }
      }

      const spinner = json ? null : clack.spinner();
      if (spinner) spinner.start('Creating bucket...');

      try {
        const result = await client.createBucket({ name, plan, region: opts.region as string });
        if (spinner) spinner.stop('Bucket created ✓');

        if (json) {
          console.log(JSON.stringify(result));
        } else {
          print.success(`Bucket "${chalk.cyan(name)}" created`);
          print.hint(`Show details:  mbd hosting storage show ${result.id}`);
          console.log('');
        }
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Bucket creation failed');
        process.exit(1);
      }
    });

  // ─── show ─────────────────────────────────────────────────────────────────────
  storageCmd
    .command('show <bucket-id>')
    .description('Show bucket details and usage')
    .action(async (bucketId: string) => {
      const client = await getClient();
      const json = jsonMode();
      const spinner = json ? null : clack.spinner();
      if (spinner) spinner.start('Fetching bucket...');

      let bucket: Awaited<ReturnType<typeof client.getBucket>>;
      let usage: Awaited<ReturnType<typeof client.getBucketUsage>> | null = null;

      try {
        [bucket, usage] = await Promise.allSettled([
          client.getBucket(bucketId),
          client.getBucketUsage(bucketId),
        ]).then(([b, u]) => [
          b.status === 'fulfilled' ? b.value : (() => { throw b.reason; })(),
          u.status === 'fulfilled' ? u.value : null,
        ]);
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Bucket not found');
        process.exit(1);
      }

      if (json) { console.log(JSON.stringify({ bucket, usage })); return; }

      const spec = STORAGE_PLAN_SPECS[bucket.plan];
      console.log('');
      console.log(`  ${chalk.bold(bucket.name)}  ${statusBadge(bucket.status)}`);
      console.log(`  ${chalk.gray(bucket.id)}`);
      console.log('');
      print.divider(52);
      console.log('');

      print.keyValue([
        { label: 'Name',      value: bucket.name },
        { label: 'Plan',      value: chalk.cyan(bucket.plan) },
        { label: 'Status',    value: statusBadge(bucket.status) },
        { label: 'Region',    value: chalk.gray(bucket.region) },
        { label: 'Capacity',  value: spec ? `${spec.storage_gb} GB` : undefined },
        { label: 'Egress',    value: spec ? `${spec.egress_gb} GB/mo` : undefined },
        { label: 'Price',     value: spec ? chalk.yellow(`$${(spec.price_cents / 100).toFixed(2)}/mo`) : undefined },
        { label: 'Objects',   value: usage ? String(usage.object_count) : (bucket.object_count !== null ? String(bucket.object_count) : undefined) },
        { label: 'Used',      value: usage ? formatBytes(usage.storage_used_bytes) : (bucket.storage_used_bytes !== null ? formatBytes(bucket.storage_used_bytes) : undefined) },
        { label: 'Created',   value: print.relativeTime(bucket.created_at) },
      ], { labelWidth: 12 });

      console.log('');
    });

  // ─── delete ───────────────────────────────────────────────────────────────────
  storageCmd
    .command('delete <bucket-id>')
    .alias('rm')
    .description('Delete a storage bucket')
    .option('--yes', 'Skip confirmation')
    .action(async (bucketId: string, opts) => {
      const json = jsonMode();

      if (!opts.yes && !json) {
        const ok = await clack.confirm({
          message: chalk.red(`Permanently delete bucket ${chalk.bold(bucketId)}? All stored data will be lost.`),
          initialValue: false,
        });
        if (clack.isCancel(ok) || !ok) { clack.cancel('Cancelled'); process.exit(0); }
      }

      const client = await getClient();
      const spinner = json ? null : clack.spinner();
      if (spinner) spinner.start(`Deleting bucket ${chalk.cyan(bucketId)}...`);

      try {
        await client.deleteBucket(bucketId);
        if (spinner) spinner.stop('');

        if (json) {
          console.log(JSON.stringify({ success: true, bucket_id: bucketId }));
        } else {
          print.success(`Bucket ${chalk.cyan(bucketId)} deleted`);
        }
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Delete failed');
        process.exit(1);
      }
    });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}
