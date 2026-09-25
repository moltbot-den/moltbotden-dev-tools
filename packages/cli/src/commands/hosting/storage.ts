/**
 * mbd hosting storage: object storage buckets.
 * API: /v1/hosting/storage/buckets (routers/hosting/storage.py).
 */

import { Command } from 'commander';
import * as clack from '@clack/prompts';
import chalk from 'chalk';
import { print, statusBadge } from '../../lib/output.js';
import { confirmDestructive, isInteractive, requireInteractive } from '../../lib/prompts.js';
import {
  SIGNED_URL_EXPIRES_S, SIGNED_URL_METHODS, STORAGE_PLAN_SPECS, type Bucket, type BucketUsage, type StoragePlan,
} from '../../types/hosting.js';
import { UsageError } from '../../lib/errors.js';
import {
  cancelled, examples, formatBytes, hostingAction, money, moreHint, nameProblem, parseIntOption, parseTimeout,
  relTime, validateChoice, validateName, waitWithSpinner, withSpinner, withWaitOptions,
} from './shared.js';

const PLANS = Object.keys(STORAGE_PLAN_SPECS) as StoragePlan[];

/** "used of max"; a 0 means the API has not metered anything yet. */
function usage(used: number | undefined, max: number | undefined): string {
  const limit = formatBytes(max);
  return used ? `${formatBytes(used)} of ${limit}` : `${chalk.gray('not reported yet')} (limit ${limit})`;
}

function printUsage(u: Pick<BucketUsage, 'storage_bytes' | 'max_storage_bytes' | 'egress_bytes_month' | 'max_egress_bytes_month'>): void {
  print.keyValue([
    { label: 'Stored', value: usage(u.storage_bytes, u.max_storage_bytes) },
    { label: 'Egress', value: `${usage(u.egress_bytes_month, u.max_egress_bytes_month)} this month` },
  ], { labelWidth: 8 });
}

export function addStorageCommands(parent: Command, program: Command): void {
  const storageCmd = parent.command('storage').description('Manage object storage buckets');
  examples(storageCmd, ['mbd hosting storage list', 'mbd hosting storage create --name agent-files --plan starter --wait', 'mbd hosting storage url <bucket-id> path/to/file.txt']);

  // ─── list ──────────────────────────────────────────────────────────────────
  examples(
    storageCmd
      .command('list')
      .alias('ls')
      .description('List your storage buckets')
      .option('--limit <n>', 'Maximum buckets to return (1-100)', '50'),
    ['mbd hosting storage list'],
  ).action(hostingAction(program, 'storage', async (h, opts: { limit: string }) => {
    const limit = parseIntOption(opts.limit, '--limit', 1, 100);
    const result = await withSpinner('Loading buckets', () => h.api.listBuckets({ limit }));
    if (h.json) return print.json(result);
    print.header(`Storage Buckets  ${chalk.gray(`(${result.buckets.length})`)}`);
    console.log('');
    if (result.buckets.length === 0) {
      print.empty('No buckets yet', 'Create one:  mbd hosting storage create');
      return;
    }
    print.table(
      [
        { header: 'ID',      key: 'id',     format: (v) => chalk.gray(String(v)) },
        { header: 'NAME',    key: 'name',   format: (v) => chalk.cyan(String(v)) },
        { header: 'PLAN',    key: 'plan' },
        { header: 'STATUS',  key: 'status', format: (v) => statusBadge(String(v)) },
        { header: 'LIMIT',   key: 'max_storage_bytes', align: 'right', format: (v) => formatBytes(v) },
        { header: 'CREATED', key: 'created_at', format: (v) => chalk.gray(relTime(v)) },
      ],
      result.buckets,
    );
    console.log('');
    moreHint(result.count, limit, 'mbd hosting storage list');
    print.hint('Details:  mbd hosting storage show <id>');
  }));

  // ─── create ────────────────────────────────────────────────────────────────
  examples(
    withWaitOptions(
      storageCmd
        .command('create')
        .description('Create a bucket (charges the first month to your hosting balance)')
        .option('--name <name>', 'Bucket name: 3-50 lowercase letters, digits, hyphens; starts with a letter')
        .option('--plan <plan>', `Plan: ${PLANS.join('|')}`)
        .option('-y, --yes', 'Skip the confirmation prompt'),
    ),
    ['mbd hosting storage create', 'mbd hosting storage create --name agent-files --plan starter --wait'],
  ).action(hostingAction(program, 'storage', async (h, opts: { name?: string; plan?: string; yes?: boolean; wait?: boolean; timeout?: string }) => {
    let name = opts.name !== undefined ? validateName(opts.name, '--name', 3) : undefined;
    let plan = opts.plan !== undefined ? validateChoice(opts.plan, PLANS, '--plan') : undefined;
    const timeoutSec = opts.wait ? parseTimeout(opts.timeout) : undefined;

    if (!name) {
      requireInteractive('--name', 'bucket name');
      const n = await clack.text({ message: 'Bucket name', placeholder: 'my-agent-files', validate: (v) => nameProblem((v ?? '').trim(), 3) });
      if (clack.isCancel(n)) cancelled();
      name = n.trim();
    }
    if (!plan) {
      requireInteractive('--plan', PLANS.join(', '));
      const p = await clack.select({
        message: 'Plan',
        options: PLANS.map((key) => {
          const s = STORAGE_PLAN_SPECS[key];
          return { value: key, label: `${s.name.padEnd(9)} ${s.storage_gb} GB stored · ${s.egress_gb} GB egress/month` };
        }),
      });
      if (clack.isCancel(p)) cancelled();
      plan = p;
    }
    if (isInteractive() && !opts.yes) {
      const account = await h.api.getAccount().catch(() => null);
      const ok = await clack.confirm({
        message: `Create bucket "${name}" on the ${plan} plan? The first month is charged to your hosting balance now` +
          (account ? ` (balance ${money(account.usdc_balance_cents)}).` : '.'),
        initialValue: true,
      });
      if (clack.isCancel(ok) || !ok) cancelled();
    }

    const created = await withSpinner('Creating bucket', () => h.api.createBucket({ name: name!, plan: plan! }));
    if (timeoutSec !== undefined) {
      const bucket = await waitWithSpinner<Bucket>({
        fetch: () => h.api.getBucket(created.id),
        done: ['active'],
        label: `bucket ${created.name}`,
        timeoutSec: timeoutSec,
        showCommand: `mbd hosting storage show ${created.id}`,
      });
      if (h.json) return print.json(bucket);
      print.success(`Bucket "${chalk.cyan(bucket.name)}" is active`);
      print.hint(`Read or write objects with signed URLs:  mbd hosting storage url ${bucket.id} <object>`);
      return;
    }
    if (h.json) return print.json(created);
    print.success(`Bucket "${chalk.cyan(created.name)}" queued for provisioning (${created.id})`);
    print.hint(`Watch it:  mbd hosting storage show ${created.id}   (buckets are usable once active)`);
  }));

  // ─── show ──────────────────────────────────────────────────────────────────
  examples(
    storageCmd.command('show <bucket-id>').alias('get').description('Show bucket details and usage'),
    ['mbd hosting storage show <bucket-id>'],
  ).action(hostingAction(program, 'storage', async (h, bucketId: string) => {
    const bucket = await withSpinner('Fetching bucket', () => h.api.getBucket(bucketId));
    if (h.json) return print.json(bucket);
    console.log('');
    console.log(`  ${chalk.bold(bucket.name)}  ${statusBadge(bucket.status)}`);
    console.log(`  ${chalk.gray(bucket.id)}`);
    console.log('');
    print.keyValue([
      { label: 'Plan',       value: bucket.plan },
      { label: 'GCS bucket', value: bucket.gcs_bucket_name },
      { label: 'Created',    value: relTime(bucket.created_at) },
    ], { labelWidth: 10 });
    printUsage(bucket);
  }));

  // ─── usage ─────────────────────────────────────────────────────────────────
  examples(
    storageCmd.command('usage <bucket-id>').description('Show stored bytes and this month\'s egress for a bucket'),
    ['mbd hosting storage usage <bucket-id>', 'mbd --json hosting storage usage <bucket-id>'],
  ).action(hostingAction(program, 'storage', async (h, bucketId: string) => {
    const u = await withSpinner('Fetching usage', () => h.api.getBucketUsage(bucketId));
    if (h.json) return print.json(u);
    printUsage(u);
  }));

  // ─── url ───────────────────────────────────────────────────────────────────
  examples(
    storageCmd
      .command('url <bucket-id> <object>')
      .alias('signed-url')
      .description('Get a short-lived signed URL to read or write one object')
      .option('--method <method>', `HTTP method the URL allows: ${SIGNED_URL_METHODS.join('|')}`, 'GET')
      .option('--expires <seconds>', `Lifetime in seconds (${SIGNED_URL_EXPIRES_S.min}-${SIGNED_URL_EXPIRES_S.max})`, String(SIGNED_URL_EXPIRES_S.default))
      .option('--content-type <type>', 'Content-Type the upload must use (PUT only)'),
    [
      'curl -o report.pdf "$(mbd --json hosting storage url <bucket-id> reports/q3.pdf | jq -r .url)"',
      'curl -X PUT -T data.json -H "Content-Type: application/json" \\\n      "$(mbd --json hosting storage url <bucket-id> data.json --method PUT --content-type application/json | jq -r .url)"',
    ],
  ).action(hostingAction(program, 'storage', async (h, bucketId: string, object: string, opts: { method: string; expires: string; contentType?: string }) => {
    const method = validateChoice(opts.method.toUpperCase(), SIGNED_URL_METHODS, '--method');
    const expires = parseIntOption(opts.expires, '--expires', SIGNED_URL_EXPIRES_S.min, SIGNED_URL_EXPIRES_S.max);
    if (opts.contentType && method !== 'PUT') throw new UsageError('--content-type only applies to --method PUT.');
    const result = await withSpinner('Signing URL', () => h.api.createSignedUrl(bucketId, {
      object_name: object, method, expires_in_seconds: expires, content_type: opts.contentType,
    }));
    if (h.json) return print.json(result);
    console.log(`\n  ${chalk.cyan(result.url)}\n`);
    print.hint(`${result.method} ${result.object_name}; expires ${new Date(result.expires_at).toLocaleString()}. Anyone with this URL can use it until then.`);
  }));

  // ─── delete ────────────────────────────────────────────────────────────────
  examples(
    storageCmd
      .command('delete <bucket-id>')
      .alias('rm')
      .description('Delete a bucket and every object in it')
      .option('-y, --yes', 'Skip the confirmation prompt (required with --json or without a TTY)'),
    ['mbd hosting storage delete <bucket-id>', 'mbd --json hosting storage delete <bucket-id> --yes'],
  ).action(hostingAction(program, 'storage', async (h, bucketId: string, opts: { yes?: boolean }) => {
    const ok = await confirmDestructive({ yes: opts.yes, json: h.json, message: `Permanently delete bucket ${bucketId} and all its objects?` });
    if (!ok) cancelled();
    const result = await withSpinner('Deleting bucket', () => h.api.deleteBucket(bucketId));
    if (h.json) return print.json(result);
    print.success(`Deletion of bucket ${chalk.cyan(bucketId)} started`);
  }));
}
