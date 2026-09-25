/**
 * mbd hosting db: managed PostgreSQL and Redis.
 * API: /v1/hosting/databases (routers/hosting/databases.py).
 */

import { Command } from 'commander';
import * as clack from '@clack/prompts';
import chalk from 'chalk';
import { print, statusBadge } from '../../lib/output.js';
import { ApiError } from '../../lib/api-client.js';
import { CliError, UsageError } from '../../lib/errors.js';
import { confirmDestructive, isInteractive, requireInteractive } from '../../lib/prompts.js';
import {
  DATABASE_TYPES, DB_PLAN_SPECS, type Database, type DatabasePlan, type DatabaseType,
} from '../../types/hosting.js';
import {
  cancelled, examples, formatBytes, hostingAction, money, moreHint, nameProblem, parseIntOption, parseTimeout,
  relTime, validateChoice, validateName, waitWithSpinner, withSpinner, withWaitOptions,
} from './shared.js';

const PLANS = Object.keys(DB_PLAN_SPECS) as DatabasePlan[];

function plansFor(type: DatabaseType): DatabasePlan[] {
  return PLANS.filter((p) => DB_PLAN_SPECS[p].engines.includes(type));
}

function planLabel(plan: string): string {
  const spec = DB_PLAN_SPECS[plan as DatabasePlan];
  return spec ? `${spec.name} ${chalk.gray(`(${spec.ram_gb} GB RAM)`)}` : plan;
}

/** Redis has no credential: Memorystore is reached by private IP from inside the hosting network. */
function redisUrl(db: Database): string | undefined {
  return db.db_type === 'redis' && db.host ? `redis://${db.host}:${db.port ?? 6379}` : undefined;
}

export function addDatabaseCommands(parent: Command, program: Command): void {
  const dbCmd = parent.command('db').alias('database').description('Manage PostgreSQL and Redis databases');
  examples(dbCmd, ['mbd hosting db list', 'mbd hosting db create --name app-db --type postgres --plan starter --wait', 'mbd hosting db credentials <db-id>']);

  // ─── list ──────────────────────────────────────────────────────────────────
  examples(
    dbCmd
      .command('list')
      .alias('ls')
      .description('List your databases')
      .option('--limit <n>', 'Maximum databases to return (1-100)', '50'),
    ['mbd hosting db list', 'mbd --json hosting db list'],
  ).action(hostingAction(program, 'databases', async (h, opts: { limit: string }) => {
    const limit = parseIntOption(opts.limit, '--limit', 1, 100);
    const result = await withSpinner('Loading databases', () => h.api.listDatabases({ limit }));
    if (h.json) return print.json(result);
    print.header(`Databases  ${chalk.gray(`(${result.databases.length})`)}`);
    console.log('');
    if (result.databases.length === 0) {
      print.empty('No databases yet', 'Create one:  mbd hosting db create');
      return;
    }
    print.table(
      [
        { header: 'ID',      key: 'id',      format: (v) => chalk.gray(String(v)) },
        { header: 'NAME',    key: 'name',    format: (v) => chalk.cyan(String(v)) },
        { header: 'TYPE',    key: 'db_type' },
        { header: 'PLAN',    key: 'plan',    format: (v) => planLabel(String(v)) },
        { header: 'STATUS',  key: 'status',  format: (v) => statusBadge(String(v)) },
        { header: 'CREATED', key: 'created_at', format: (v) => chalk.gray(relTime(v)) },
      ],
      result.databases,
    );
    console.log('');
    moreHint(result.count, limit, 'mbd hosting db list');
    print.hint('Details:  mbd hosting db show <id>');
  }));

  // ─── create ────────────────────────────────────────────────────────────────
  examples(
    withWaitOptions(
      dbCmd
        .command('create')
        .description('Provision a database (charges the first month to your hosting balance)')
        .option('--name <name>', 'Database name: lowercase letters, digits, hyphens; starts with a letter; max 50')
        .option('--type <type>', `Engine: ${DATABASE_TYPES.join('|')}`)
        .option('--engine <type>', 'Alias for --type')
        .option('--plan <plan>', `Plan: ${PLANS.join('|')} (starter is postgres-only)`)
        .option('-y, --yes', 'Skip the confirmation prompt'),
    ),
    [
      'mbd hosting db create',
      'mbd hosting db create --name app-db --type postgres --plan starter --wait',
      'mbd --json hosting db create --name cache --type redis --plan standard',
    ],
  ).action(hostingAction(program, 'databases', async (h, opts: {
    name?: string; type?: string; engine?: string; plan?: string; yes?: boolean; wait?: boolean; timeout?: string;
  }) => {
    let name = opts.name !== undefined ? validateName(opts.name) : undefined;
    const rawType = opts.type ?? opts.engine;
    let type = rawType !== undefined ? validateChoice(rawType, DATABASE_TYPES, '--type') : undefined;
    let plan = opts.plan !== undefined ? validateChoice(opts.plan, PLANS, '--plan') : undefined;
    if (opts.wait) parseTimeout(opts.timeout);

    if (!name) {
      requireInteractive('--name', 'database name');
      const n = await clack.text({ message: 'Database name', placeholder: 'my-agent-db', validate: (v) => nameProblem((v ?? '').trim()) });
      if (clack.isCancel(n)) cancelled();
      name = n.trim();
    }
    if (!type) {
      requireInteractive('--type', DATABASE_TYPES.join(' or '));
      const t = await clack.select({
        message: 'Engine',
        options: [
          { value: 'postgres' as const, label: 'PostgreSQL', hint: 'relational database' },
          { value: 'redis' as const, label: 'Redis', hint: 'in-memory cache / key-value store' },
        ],
      });
      if (clack.isCancel(t)) cancelled();
      type = t;
    }
    if (!plan) {
      requireInteractive('--plan', plansFor(type).join(', '));
      const p = await clack.select({
        message: 'Plan',
        options: plansFor(type).map((key) => {
          const s = DB_PLAN_SPECS[key];
          return { value: key, label: `${s.name.padEnd(9)} ${s.vcpus} vCPU · ${s.ram_gb} GB RAM · ${s.storage_gb} GB · ${s.max_connections} connections` };
        }),
      });
      if (clack.isCancel(p)) cancelled();
      plan = p;
    }
    if (!DB_PLAN_SPECS[plan].engines.includes(type)) {
      throw new UsageError(`The ${plan} plan does not offer ${type}. Plans with ${type}: ${plansFor(type).join(', ')}.`);
    }

    if (isInteractive() && !opts.yes) {
      const account = await h.api.getAccount().catch(() => null);
      const ok = await clack.confirm({
        message: `Create ${type} database "${name}" on the ${plan} plan? The first month is charged to your hosting balance now` +
          (account ? ` (balance ${money(account.usdc_balance_cents)}).` : '.'),
        initialValue: true,
      });
      if (clack.isCancel(ok) || !ok) cancelled();
    }

    const created = await withSpinner('Creating database', () => h.api.createDatabase({ name: name!, db_type: type!, plan: plan! }));
    if (opts.wait) {
      const db = await waitWithSpinner({
        fetch: () => h.api.getDatabase(created.id),
        done: ['running'],
        label: `database ${created.name}`,
        timeoutSec: parseTimeout(opts.timeout),
        showCommand: `mbd hosting db show ${created.id}`,
      });
      if (h.json) return print.json(db);
      print.success(`Database "${chalk.cyan(db.name)}" is running`);
      print.hint(db.db_type === 'postgres' ? `Get the connection string (shown once):  mbd hosting db credentials ${db.id}` : `Connect:  ${redisUrl(db) ?? `mbd hosting db show ${db.id}`}`);
      return;
    }
    if (h.json) return print.json(created);
    print.success(`Database "${chalk.cyan(created.name)}" queued for provisioning (${created.id})`);
    print.hint(`Watch it:  mbd hosting db show ${created.id}   (pass --wait next time to block until it is running)`);
  }));

  // ─── show ──────────────────────────────────────────────────────────────────
  examples(
    dbCmd.command('show <db-id>').alias('get').description('Show database details'),
    ['mbd hosting db show <db-id>'],
  ).action(hostingAction(program, 'databases', async (h, dbId: string) => {
    const db = await withSpinner('Fetching database', () => h.api.getDatabase(dbId));
    if (h.json) return print.json(db);
    const spec = DB_PLAN_SPECS[db.plan];
    console.log('');
    console.log(`  ${chalk.bold(db.name)}  ${statusBadge(db.status)}`);
    console.log(`  ${chalk.gray(db.id)}`);
    console.log('');
    print.keyValue([
      { label: 'Type',        value: db.db_type },
      { label: 'Plan',        value: planLabel(db.plan) },
      { label: 'Resources',   value: spec ? `${spec.vcpus} vCPU · ${spec.ram_gb} GB RAM · ${spec.max_connections} max connections` : undefined },
      { label: 'Storage',     value: spec ? `${spec.storage_gb} GB plan limit` : undefined },
      { label: 'Host',        value: db.host ?? chalk.gray('not ready yet') },
      { label: 'Port',        value: db.port ? String(db.port) : undefined },
      { label: 'Database',    value: db.db_type === 'postgres' ? db.database_name ?? undefined : undefined },
      { label: 'User',        value: db.username ?? undefined },
      { label: 'Redis URL',   value: redisUrl(db) },
      { label: 'Created',     value: relTime(db.created_at) },
      { label: 'Error',       value: db.error_message ? chalk.red(db.error_message) : undefined },
    ], { labelWidth: 11 });
    console.log('');
    if (db.status === 'running' && db.db_type === 'postgres') {
      print.hint(db.credentials_available
        ? `Get the connection string (shown once):  mbd hosting db credentials ${db.id}`
        : `The initial credentials were already shown. New password:  mbd hosting db reset-password ${db.id}`);
    }
    if (db.restored_from) print.hint(`Restored from database ${db.restored_from.db_id}, backup ${db.restored_from.backup_id}`);
    if (db.db_type === 'redis' && db.host) print.hint('Redis is reachable only from inside the hosting network (for example from your hosting VMs).');
  }));

  // ─── credentials ───────────────────────────────────────────────────────────
  examples(
    dbCmd
      .command('credentials <db-id>')
      .description('Print the PostgreSQL connection string created at provisioning (works once)'),
    ['mbd hosting db credentials <db-id>', 'mbd --json hosting db credentials <db-id> | jq -r .connection_string'],
  ).action(hostingAction(program, 'databases', async (h, dbId: string) => {
    let result: { connection_string: string };
    try {
      result = await withSpinner('Fetching credentials', () => h.api.revealDatabaseCredentials(dbId));
    } catch (err) {
      if (err instanceof ApiError && err.status === 410) {
        throw new CliError('The initial credentials for this database were already shown once.', {
          status: 410,
          hint: `Rotate the password to get a new connection string:  mbd hosting db reset-password ${dbId}`,
        });
      }
      throw err;
    }
    if (h.json) return print.json(result);
    console.log('');
    console.log(`  ${chalk.bold('Connection string')}`);
    console.log(`  ${chalk.cyan(result.connection_string)}`);
    console.log('');
    print.warn('Shown once: the server deleted its copy. Store it in a secret manager now.');
    print.hint(`Lost it? Rotate the password:  mbd hosting db reset-password ${dbId}`);
  }));

  // ─── reset-password ────────────────────────────────────────────────────────
  examples(
    dbCmd
      .command('reset-password <db-id>')
      .description('Rotate the PostgreSQL password and print the new connection string (shown once)')
      .option('-y, --yes', 'Skip the confirmation prompt (required with --json or without a TTY)'),
    ['mbd hosting db reset-password <db-id>', 'mbd --json hosting db reset-password <db-id> --yes | jq -r .connection_string'],
  ).action(hostingAction(program, 'databases', async (h, dbId: string, opts: { yes?: boolean }) => {
    const ok = await confirmDestructive({
      yes: opts.yes, json: h.json,
      message: `Rotate the password for database ${dbId}? Apps using the current password stop connecting. The new password is shown once and cannot be retrieved later.`,
    });
    if (!ok) cancelled();
    const result = await withSpinner('Rotating password', () => h.api.resetDatabasePassword(dbId));
    if (h.json) return print.json(result);
    console.log('');
    console.log(`  ${chalk.bold('Connection string')}`);
    console.log(`  ${chalk.cyan(result.connection_string)}`);
    console.log('');
    print.warn('Shown once and not stored anywhere. Store it in a secret manager now; running this command again rotates the password.');
  }));

  // ─── connection-string ─────────────────────────────────────────────────────
  examples(
    dbCmd
      .command('connection-string <db-id>')
      .alias('conn')
      .description('Show how to connect: redis:// URL for Redis; PostgreSQL points to credentials/reset-password'),
    ['mbd hosting db connection-string <db-id>'],
  ).action(hostingAction(program, 'databases', async (h, dbId: string) => {
    const db = await withSpinner('Fetching database', () => h.api.getDatabase(dbId));
    if (db.db_type === 'postgres') {
      throw new CliError('PostgreSQL connection strings are only shown once, so this command cannot print one.', {
        hint: db.credentials_available
          ? `Get it (once):  mbd hosting db credentials ${dbId}`
          : `Rotate the password to get a new one:  mbd hosting db reset-password ${dbId}`,
      });
    }
    const url = redisUrl(db);
    if (!url) throw new CliError(`Database ${dbId} has no host yet (status: ${db.status}).`, { hint: `mbd hosting db show ${dbId}` });
    if (h.json) return print.json({ db_id: db.id, db_type: db.db_type, connection_string: url });
    console.log(`\n  ${chalk.cyan(url)}\n`);
    print.hint('Reachable only from inside the hosting network (for example from your hosting VMs).');
  }));

  // ─── metrics ───────────────────────────────────────────────────────────────
  examples(
    dbCmd.command('metrics <db-id>').description('Show storage, connection and CPU metrics'),
    ['mbd hosting db metrics <db-id>'],
  ).action(hostingAction(program, 'databases', async (h, dbId: string) => {
    const m = await withSpinner('Fetching metrics', () => h.api.getDatabaseMetrics(dbId));
    if (h.json) return print.json(m);
    // Cloud Monitoring reports CPU as a 0-1 fraction. Storage and connection
    // counts come back as 0 until the API collects them, so 0 reads "not reported".
    const notReported = chalk.gray('not reported yet');
    print.keyValue([
      { label: 'CPU',          value: `${(m.cpu_utilization * 100).toFixed(1)}%` },
      { label: 'Storage used', value: m.storage_used_gb ? `${m.storage_used_gb} GB of ${m.max_size_gb} GB` : notReported },
      { label: 'Connections',  value: m.connections_active ? String(m.connections_active) : notReported },
    ], { labelWidth: 12 });
  }));

  // ─── backups ───────────────────────────────────────────────────────────────
  examples(
    dbCmd.command('backups <db-id>').description('List automatic and on-demand backups (PostgreSQL only)'),
    ['mbd hosting db backups <db-id>'],
  ).action(hostingAction(program, 'databases', async (h, dbId: string) => {
    const result = await withSpinner('Loading backups', () => h.api.listDatabaseBackups(dbId));
    if (h.json) return print.json(result);
    if (result.backups.length === 0) return print.empty('No backups yet', 'Backups run automatically once the database is running.');
    print.table(
      [
        { header: 'ID',      key: 'id' },
        { header: 'CREATED', key: 'created_at', format: (v) => chalk.gray(relTime(v)) },
        { header: 'TYPE',    key: 'backup_type' },
        { header: 'STATUS',  key: 'status', format: (v) => statusBadge(String(v).toLowerCase() === 'successful' ? 'ready' : String(v).toLowerCase()) },
        { header: 'SIZE',    key: 'size_bytes', align: 'right', format: (v) => formatBytes(v) },
      ],
      result.backups,
    );
  }));

  // ─── restore ───────────────────────────────────────────────────────────────
  examples(
    withWaitOptions(
      dbCmd
        .command('restore <db-id>')
        .description('Restore a backup into a NEW database on the same plan (charged like a create)')
        .requiredOption('--backup <backup-id>', 'Backup id from `mbd hosting db backups <db-id>`')
        .requiredOption('--name <name>', 'Name for the new database')
        .option('-y, --yes', 'Skip the confirmation prompt'),
    ),
    ['mbd hosting db restore <db-id> --backup 1727000000000 --name app-db-restored --wait'],
  ).action(hostingAction(program, 'databases', async (h, dbId: string, opts: { backup: string; name: string; yes?: boolean; wait?: boolean; timeout?: string }) => {
    if (!/^[0-9]{1,20}$/.test(opts.backup)) throw new UsageError('--backup must be a numeric backup id (see `mbd hosting db backups <db-id>`).');
    const name = validateName(opts.name);
    if (opts.wait) parseTimeout(opts.timeout);
    if (isInteractive() && !opts.yes) {
      const account = await h.api.getAccount().catch(() => null);
      const ok = await clack.confirm({
        message: `Restore backup ${opts.backup} into a new database "${name}"? A month of the source database's plan is charged now` +
          (account ? ` (balance ${money(account.usdc_balance_cents)}).` : '.'),
        initialValue: true,
      });
      if (clack.isCancel(ok) || !ok) cancelled();
    }
    const result = await withSpinner('Starting restore', () => h.api.restoreDatabase(dbId, { backup_id: opts.backup, target_name: name }));
    if (opts.wait) {
      const db = await waitWithSpinner({
        fetch: () => h.api.getDatabase(result.target_db_id),
        done: ['running'],
        label: `database ${name}`,
        timeoutSec: parseTimeout(opts.timeout),
        showCommand: `mbd hosting db show ${result.target_db_id}`,
      });
      if (h.json) return print.json(db);
      print.success(`Database "${chalk.cyan(db.name)}" restored and running (${db.id})`);
      print.hint(`Get the connection string (shown once):  mbd hosting db credentials ${db.id}`);
      return;
    }
    if (h.json) return print.json(result);
    print.success(`Restore into new database ${chalk.cyan(result.target_db_id)} started`);
    print.hint(`Watch it:  mbd hosting db show ${result.target_db_id}`);
  }));

  // ─── delete ────────────────────────────────────────────────────────────────
  examples(
    dbCmd
      .command('delete <db-id>')
      .alias('rm')
      .description('Delete a database and all its data permanently')
      .option('-y, --yes', 'Skip the confirmation prompt (required with --json or without a TTY)'),
    ['mbd hosting db delete <db-id>', 'mbd --json hosting db delete <db-id> --yes'],
  ).action(hostingAction(program, 'databases', async (h, dbId: string, opts: { yes?: boolean }) => {
    const ok = await confirmDestructive({ yes: opts.yes, json: h.json, message: `Permanently delete database ${dbId}? All data is lost.` });
    if (!ok) cancelled();
    const result = await withSpinner('Deleting database', () => h.api.deleteDatabase(dbId));
    if (h.json) return print.json(result);
    print.success(`Deletion of database ${chalk.cyan(dbId)} started`);
  }));
}
