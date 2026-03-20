/**
 * Hosting database commands: list, create, show, connection-string, delete
 */

import { Command } from 'commander';
import * as clack from '@clack/prompts';
import chalk from 'chalk';
import { MoltbotDenClient } from '../../lib/api-client.js';
import { print, statusBadge } from '../../lib/output.js';
import { DB_PLAN_SPECS, type DatabasePlan, type DatabaseEngine } from '../../types/hosting.js';

export function addDatabaseCommands(parent: Command, getClient: () => Promise<MoltbotDenClient>, jsonMode: () => boolean): void {

  const dbCmd = parent
    .command('db')
    .description('Manage managed databases');

  // ─── list ─────────────────────────────────────────────────────────────────────
  dbCmd
    .command('list')
    .alias('ls')
    .description('List your databases')
    .action(async () => {
      const client = await getClient();
      const json = jsonMode();
      const spinner = json ? null : clack.spinner();
      if (spinner) spinner.start('Loading databases...');

      let result: Awaited<ReturnType<typeof client.listDatabases>>;
      try {
        result = await client.listDatabases();
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Failed to list databases');
        process.exit(1);
      }

      if (json) { console.log(JSON.stringify(result)); return; }

      const { databases } = result;
      print.header(`Databases  ${chalk.gray(`(${databases.length})`)}`);
      console.log('');

      if (databases.length === 0) {
        print.empty('No databases yet', 'Create one with:  mbd hosting db create');
        return;
      }

      print.table(
        [
          { header: 'NAME',    key: 'name',       width: 24, format: (v) => chalk.cyan(String(v)) },
          { header: 'ENGINE',  key: 'engine',     width: 10 },
          { header: 'PLAN',    key: 'plan',       width: 10, format: (v) => planLabel(String(v) as DatabasePlan) },
          { header: 'STATUS',  key: 'status',     width: 18, format: (v) => statusBadge(String(v)) },
          { header: 'HOST',    key: 'host',       width: 24, format: (v) => v ? chalk.gray(String(v)) : chalk.gray('–') },
          { header: 'CREATED', key: 'created_at',            format: (v) => chalk.gray(print.relativeTime(String(v))) },
        ],
        databases as Record<string, unknown>[]
      );

      console.log('');
      print.hint(`Get connection string:  mbd hosting db connection-string <id>`);
      console.log('');
    });

  // ─── create ───────────────────────────────────────────────────────────────────
  dbCmd
    .command('create')
    .description('Provision a new managed database')
    .option('--name <name>',     'Database name')
    .option('--engine <engine>', 'Engine: postgres|redis')
    .option('--plan <plan>',     'Plan: starter|standard|pro|business')
    .action(async (opts) => {
      const client = await getClient();
      const json = jsonMode();

      let name: string = opts.name as string;
      let engine: DatabaseEngine = opts.engine as DatabaseEngine;
      let plan: DatabasePlan = opts.plan as DatabasePlan;

      if (!json) {
        if (!name) {
          const n = await clack.text({
            message: 'Database name:',
            placeholder: 'my-agent-db',
            validate: (v) => {
              if (!v || v.trim().length < 2) return 'Name must be at least 2 characters';
              if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]?$/.test(v)) return 'Use lowercase letters, numbers, and hyphens';
              if (v.length > 40) return 'Name must be at most 40 characters';
            },
          });
          if (clack.isCancel(n)) { clack.cancel('Cancelled'); process.exit(0); }
          name = (n as string).trim();
        }

        if (!engine) {
          const e = await clack.select({
            message: 'Database engine:',
            options: [
              { value: 'postgres', label: 'PostgreSQL', hint: 'Full-featured relational DB' },
              { value: 'redis',    label: 'Redis',      hint: 'In-memory cache and key-value store' },
            ],
          });
          if (clack.isCancel(e)) { clack.cancel('Cancelled'); process.exit(0); }
          engine = e as DatabaseEngine;
        }

        if (!plan) {
          const availablePlans = (Object.entries(DB_PLAN_SPECS) as [DatabasePlan, typeof DB_PLAN_SPECS[DatabasePlan]][])
            .filter(([, spec]) => spec.engines.includes(engine));

          const p = await clack.select({
            message: 'Select plan:',
            options: availablePlans.map(([key, spec]) => ({
              value: key,
              label: `${spec.name.padEnd(10)}  ${spec.vcpus} vCPU · ${spec.ram_gb} GB RAM · ${spec.storage_gb} GB · ${spec.max_connections} conns`,
              hint: `$${(spec.price_cents / 100).toFixed(2)}/mo`,
            })),
          });
          if (clack.isCancel(p)) { clack.cancel('Cancelled'); process.exit(0); }
          plan = p as DatabasePlan;
        }

        const spec = DB_PLAN_SPECS[plan];
        const confirmed = await clack.confirm({
          message: `Create ${chalk.cyan(engine)} database "${chalk.white(name)}" (${chalk.cyan(plan)}) for ${chalk.yellow('$' + (spec.price_cents / 100).toFixed(2) + '/mo')}?`,
          initialValue: true,
        });
        if (clack.isCancel(confirmed) || !confirmed) { clack.cancel('Cancelled'); process.exit(0); }
      } else {
        if (!name || !engine || !plan) {
          print.error('--name, --engine, and --plan are required in JSON mode');
          process.exit(1);
        }
      }

      const spinner = json ? null : clack.spinner();
      if (spinner) spinner.start('Provisioning database...');

      try {
        const result = await client.createDatabase({ name, engine, plan });
        if (spinner) spinner.stop('Database provisioning started ✓');

        if (json) {
          console.log(JSON.stringify(result));
        } else {
          print.success(`Database "${chalk.cyan(name)}" is being provisioned`);
          print.info('Will be ready in ~2-5 minutes');
          print.hint(`Show status:  mbd hosting db show ${result.id}`);
          console.log('');
        }
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Database creation failed');
        process.exit(1);
      }
    });

  // ─── show ─────────────────────────────────────────────────────────────────────
  dbCmd
    .command('show <db-id>')
    .description('Show database details')
    .action(async (dbId: string) => {
      const client = await getClient();
      const json = jsonMode();
      const spinner = json ? null : clack.spinner();
      if (spinner) spinner.start('Fetching database...');

      let db: Awaited<ReturnType<typeof client.getDatabase>>;
      try {
        db = await client.getDatabase(dbId);
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Database not found');
        process.exit(1);
      }

      if (json) { console.log(JSON.stringify(db)); return; }

      const spec = DB_PLAN_SPECS[db.plan];
      console.log('');
      console.log(`  ${chalk.bold(db.name)}  ${statusBadge(db.status)}`);
      console.log(`  ${chalk.gray(db.id)}`);
      console.log('');
      print.divider(52);
      console.log('');

      print.keyValue([
        { label: 'Name',         value: db.name },
        { label: 'Engine',       value: chalk.cyan(db.engine) },
        { label: 'Plan',         value: planLabel(db.plan) },
        { label: 'Status',       value: statusBadge(db.status) },
        { label: 'Host',         value: db.host ? chalk.gray(db.host) : chalk.gray('Not ready yet') },
        { label: 'Port',         value: db.port ? String(db.port) : undefined },
        { label: 'Database',     value: db.database_name ?? undefined },
        { label: 'vCPUs',        value: spec ? `${spec.vcpus} vCPU` : undefined },
        { label: 'Memory',       value: spec ? `${spec.ram_gb} GB` : undefined },
        { label: 'Storage',      value: spec ? `${spec.storage_gb} GB` : undefined },
        { label: 'Connections',  value: spec ? `max ${spec.max_connections}` : undefined },
        { label: 'Price',        value: spec ? chalk.yellow(`$${(spec.price_cents / 100).toFixed(2)}/mo`) : undefined },
        { label: 'Created',      value: print.relativeTime(db.created_at) },
        { label: 'Error',        value: db.error_message ? chalk.red(db.error_message) : undefined },
      ], { labelWidth: 14 });

      console.log('');
      if (db.status === 'ready') {
        print.hint(`Connection string:  mbd hosting db connection-string ${db.id}`);
      }
      console.log('');
    });

  // ─── connection-string ────────────────────────────────────────────────────────
  dbCmd
    .command('connection-string <db-id>')
    .alias('conn')
    .description('Show the database connection string')
    .action(async (dbId: string) => {
      const client = await getClient();
      const json = jsonMode();
      const spinner = json ? null : clack.spinner();
      if (spinner) spinner.start('Fetching connection string...');

      let result: Awaited<ReturnType<typeof client.getDatabaseConnectionString>>;
      try {
        result = await client.getDatabaseConnectionString(dbId);
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Failed to get connection string');
        process.exit(1);
      }

      if (json) {
        console.log(JSON.stringify(result));
        return;
      }

      console.log('');
      console.log('  ' + chalk.bold('Connection String'));
      console.log('');
      console.log('  ' + chalk.cyan(result.connection_string));

      if (result.read_only_connection_string) {
        console.log('');
        console.log('  ' + chalk.bold('Read-Only Connection String'));
        console.log('  ' + chalk.gray(result.read_only_connection_string));
      }

      console.log('');
      print.warn('Keep this secret — do not commit to version control!');
      console.log('');
    });

  // ─── delete ───────────────────────────────────────────────────────────────────
  dbCmd
    .command('delete <db-id>')
    .alias('rm')
    .description('Delete a database permanently')
    .option('--yes', 'Skip confirmation')
    .action(async (dbId: string, opts) => {
      const json = jsonMode();

      if (!opts.yes && !json) {
        const ok = await clack.confirm({
          message: chalk.red(`Permanently delete database ${chalk.bold(dbId)}? All data will be lost.`),
          initialValue: false,
        });
        if (clack.isCancel(ok) || !ok) { clack.cancel('Cancelled'); process.exit(0); }
      }

      const client = await getClient();
      const spinner = json ? null : clack.spinner();
      if (spinner) spinner.start(`Deleting database ${chalk.cyan(dbId)}...`);

      try {
        await client.deleteDatabase(dbId);
        if (spinner) spinner.stop('');

        if (json) {
          console.log(JSON.stringify({ success: true, db_id: dbId }));
        } else {
          print.success(`Database ${chalk.cyan(dbId)} deleted`);
        }
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Delete failed');
        process.exit(1);
      }
    });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function planLabel(plan: DatabasePlan): string {
  const spec = DB_PLAN_SPECS[plan];
  if (!spec) return plan;
  return `${chalk.white(spec.name)} ${chalk.gray(`(${spec.ram_gb}GB RAM)`)}`;
}
