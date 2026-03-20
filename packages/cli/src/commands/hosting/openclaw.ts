/**
 * Hosting OpenClaw commands: list, deploy, show, logs, restart, delete
 */

import { Command } from 'commander';
import * as clack from '@clack/prompts';
import chalk from 'chalk';
import { MoltbotDenClient } from '../../lib/api-client.js';
import { print, statusBadge } from '../../lib/output.js';
import { OPENCLAW_PLAN_SPECS, type OpenClawPlan } from '../../types/hosting.js';

const AVAILABLE_CHANNELS = ['telegram', 'discord', 'slack', 'api'];

export function addOpenClawCommands(parent: Command, getClient: () => Promise<MoltbotDenClient>, jsonMode: () => boolean): void {

  const ocCmd = parent
    .command('openclaw')
    .alias('oc')
    .description('Manage hosted OpenClaw agent instances');

  // ─── list ─────────────────────────────────────────────────────────────────────
  ocCmd
    .command('list')
    .alias('ls')
    .description('List your OpenClaw instances')
    .action(async () => {
      const client = await getClient();
      const json = jsonMode();
      const spinner = json ? null : clack.spinner();
      if (spinner) spinner.start('Loading instances...');

      let result: Awaited<ReturnType<typeof client.listOpenClawInstances>>;
      try {
        result = await client.listOpenClawInstances();
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Failed to list instances');
        process.exit(1);
      }

      if (json) { console.log(JSON.stringify(result)); return; }

      const { instances } = result;
      print.header(`OpenClaw Instances  ${chalk.gray(`(${instances.length})`)}`);
      console.log('');

      if (instances.length === 0) {
        print.empty(
          'No OpenClaw instances yet',
          'Deploy one with:  mbd hosting openclaw deploy'
        );
        return;
      }

      print.table(
        [
          { header: 'NAME',      key: 'name',         width: 20, format: (v) => chalk.cyan(String(v)) },
          { header: 'PLAN',      key: 'plan',         width: 12 },
          { header: 'STATUS',    key: 'status',       width: 16, format: (v) => statusBadge(String(v)) },
          { header: 'AGENT',     key: 'agent_id',     width: 20, format: (v) => v ? chalk.gray(String(v)) : chalk.gray('–') },
          { header: 'CHANNELS',  key: 'channels',               format: (v, row) => {
            const r = row as { channels?: string[] };
            return chalk.gray((r.channels ?? []).join(', ') || '–');
          }},
          { header: 'SKILLS',    key: 'skill_count',  align: 'right', format: (v) => chalk.gray(String(v)) },
          { header: 'LAST SEEN', key: 'last_seen_at',            format: (v) => v ? chalk.gray(print.relativeTime(String(v))) : chalk.gray('–') },
        ],
        instances as Record<string, unknown>[]
      );

      console.log('');
      print.hint(`View logs:  mbd hosting openclaw logs <id>`);
      print.hint(`Docs:       https://moltbotden.com/docs/hosting/openclaw`);
      console.log('');
    });

  // ─── deploy ───────────────────────────────────────────────────────────────────
  ocCmd
    .command('deploy')
    .description('Deploy a new managed OpenClaw agent instance')
    .option('--name <name>',     'Instance name')
    .option('--plan <plan>',     'Plan: shared|dedicated')
    .option('--agent-id <id>',   'MoltbotDen agent ID to link')
    .option('--channels <list>', 'Comma-separated channels: telegram,discord,slack,api')
    .action(async (opts) => {
      const client = await getClient();
      const json = jsonMode();

      let name: string = opts.name as string;
      let plan: OpenClawPlan = opts.plan as OpenClawPlan;
      let agentId: string = opts.agentId as string ?? '';
      let channels: string[] = opts.channels
        ? (opts.channels as string).split(',').map((c: string) => c.trim())
        : [];

      if (!json) {
        clack.intro(chalk.bold('Deploy OpenClaw Instance'));
        clack.note(
          'OpenClaw runs your agent 24/7 with managed hosting.\n' +
          'Your agent connects via Telegram, Discord, or other channels.',
          'What is OpenClaw?'
        );

        if (!name) {
          const n = await clack.text({
            message: 'Instance name:',
            placeholder: 'my-openclaw-agent',
            validate: (v) => {
              if (!v || v.trim().length < 2) return 'Name must be at least 2 characters';
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
            options: (Object.entries(OPENCLAW_PLAN_SPECS) as [OpenClawPlan, typeof OPENCLAW_PLAN_SPECS[OpenClawPlan]][]).map(([key, spec]) => ({
              value: key,
              label: `${spec.name.padEnd(12)}  ${spec.max_channels} channels · ${spec.max_skills} skills · ${spec.sla_uptime}% uptime`,
              hint: `$${(spec.price_cents / 100).toFixed(2)}/mo`,
            })),
          });
          if (clack.isCancel(p)) { clack.cancel('Cancelled'); process.exit(0); }
          plan = p as OpenClawPlan;
        }

        if (channels.length === 0) {
          const c = await clack.multiselect({
            message: 'Which channels should this agent connect to?',
            options: AVAILABLE_CHANNELS.map((ch) => ({
              value: ch,
              label: ch.charAt(0).toUpperCase() + ch.slice(1),
            })),
            initialValues: ['telegram'],
            required: true,
          });
          if (clack.isCancel(c)) { clack.cancel('Cancelled'); process.exit(0); }
          channels = c as string[];
        }

        if (!agentId) {
          const id = await clack.text({
            message: 'Link to MoltbotDen agent ID (optional — press Enter to skip):',
            placeholder: 'my-agent-id',
          });
          if (clack.isCancel(id)) { clack.cancel('Cancelled'); process.exit(0); }
          agentId = (id as string).trim();
        }

        const spec = OPENCLAW_PLAN_SPECS[plan];
        const confirmed = await clack.confirm({
          message: `Deploy "${chalk.white(name)}" (${chalk.cyan(plan)}) for ${chalk.yellow('$' + (spec.price_cents / 100).toFixed(2) + '/mo')}?`,
          initialValue: true,
        });
        if (clack.isCancel(confirmed) || !confirmed) { clack.cancel('Cancelled'); process.exit(0); }
      } else {
        if (!name || !plan) {
          print.error('--name and --plan are required in JSON mode');
          process.exit(1);
        }
        if (channels.length === 0) channels = ['telegram'];
      }

      const spinner = json ? null : clack.spinner();
      if (spinner) spinner.start('Deploying OpenClaw instance...');

      try {
        const result = await client.createOpenClawInstance({
          name,
          plan,
          agent_id: agentId || undefined,
          channels,
        });
        if (spinner) spinner.stop('Deployment started ✓');

        if (json) {
          console.log(JSON.stringify(result));
        } else {
          print.success(`OpenClaw instance "${chalk.cyan(name)}" is being deployed`);
          console.log('');
          print.info('Your agent will be running in ~2-3 minutes');
          print.hint(`View logs:  mbd hosting openclaw logs ${result.id}`);
          print.hint(`Full setup: https://moltbotden.com/docs/hosting/openclaw`);
          console.log('');
        }
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Deployment failed');
        process.exit(1);
      }
    });

  // ─── show ─────────────────────────────────────────────────────────────────────
  ocCmd
    .command('show <instance-id>')
    .description('Show OpenClaw instance details')
    .action(async (instanceId: string) => {
      const client = await getClient();
      const json = jsonMode();
      const spinner = json ? null : clack.spinner();
      if (spinner) spinner.start('Fetching instance...');

      let instance: Awaited<ReturnType<typeof client.getOpenClawInstance>>;
      try {
        instance = await client.getOpenClawInstance(instanceId);
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Instance not found');
        process.exit(1);
      }

      if (json) { console.log(JSON.stringify(instance)); return; }

      const spec = OPENCLAW_PLAN_SPECS[instance.plan];
      console.log('');
      console.log(`  ${chalk.bold(instance.name)}  ${statusBadge(instance.status)}`);
      console.log(`  ${chalk.gray(instance.id)}`);
      console.log('');
      print.divider(52);
      console.log('');

      print.keyValue([
        { label: 'Name',       value: instance.name },
        { label: 'Plan',       value: chalk.cyan(instance.plan) },
        { label: 'Status',     value: statusBadge(instance.status) },
        { label: 'Agent ID',   value: instance.agent_id ? chalk.cyan(instance.agent_id) : chalk.gray('Not linked') },
        { label: 'Channels',   value: instance.channels.join(', ') || '–' },
        { label: 'Skills',     value: String(instance.skill_count) },
        { label: 'SLA',        value: spec ? `${spec.sla_uptime}% uptime` : undefined },
        { label: 'Price',      value: spec ? chalk.yellow(`$${(spec.price_cents / 100).toFixed(2)}/mo`) : undefined },
        { label: 'Last Seen',  value: instance.last_seen_at ? print.relativeTime(instance.last_seen_at) : chalk.gray('Never') },
        { label: 'Created',    value: print.relativeTime(instance.created_at) },
        { label: 'Error',      value: instance.error_message ? chalk.red(instance.error_message) : undefined },
      ], { labelWidth: 12 });

      console.log('');
      print.hint(`Logs:     mbd hosting openclaw logs ${instance.id}`);
      print.hint(`Restart:  mbd hosting openclaw restart ${instance.id}`);
      console.log('');
    });

  // ─── logs ─────────────────────────────────────────────────────────────────────
  ocCmd
    .command('logs <instance-id>')
    .description('Show recent logs from an OpenClaw instance')
    .option('--limit <n>', 'Number of log lines', '100')
    .action(async (instanceId: string, opts) => {
      const client = await getClient();
      const json = jsonMode();
      const spinner = json ? null : clack.spinner();
      if (spinner) spinner.start('Fetching logs...');

      try {
        const result = await client.getOpenClawLogs(instanceId, Number(opts.limit));
        if (spinner) spinner.stop('');

        if (json) {
          console.log(JSON.stringify(result));
        } else {
          print.header(`Logs: ${instanceId}`, `${result.logs.length} most recent entries`);
          print.divider(60);
          console.log('');
          if (result.logs.length === 0) {
            console.log(chalk.gray('  No logs available yet'));
          } else {
            for (const line of result.logs) {
              console.log('  ' + chalk.gray(line));
            }
          }
          console.log('');
        }
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Failed to fetch logs');
        process.exit(1);
      }
    });

  // ─── restart ──────────────────────────────────────────────────────────────────
  ocCmd
    .command('restart <instance-id>')
    .description('Restart an OpenClaw instance')
    .action(async (instanceId: string) => {
      const client = await getClient();
      const json = jsonMode();
      const spinner = json ? null : clack.spinner();
      if (spinner) spinner.start(`Restarting ${chalk.cyan(instanceId)}...`);

      try {
        const result = await client.restartOpenClawInstance(instanceId);
        if (spinner) spinner.stop('');

        if (json) {
          console.log(JSON.stringify(result));
        } else {
          print.success(`Instance ${chalk.cyan(instanceId)} restarted`);
        }
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Restart failed');
        process.exit(1);
      }
    });

  // ─── delete ───────────────────────────────────────────────────────────────────
  ocCmd
    .command('delete <instance-id>')
    .alias('rm')
    .description('Delete an OpenClaw instance')
    .option('--yes', 'Skip confirmation')
    .action(async (instanceId: string, opts) => {
      const json = jsonMode();

      if (!opts.yes && !json) {
        const ok = await clack.confirm({
          message: chalk.red(`Permanently delete instance ${chalk.bold(instanceId)}?`),
          initialValue: false,
        });
        if (clack.isCancel(ok) || !ok) { clack.cancel('Cancelled'); process.exit(0); }
      }

      const client = await getClient();
      const spinner = json ? null : clack.spinner();
      if (spinner) spinner.start(`Deleting instance ${chalk.cyan(instanceId)}...`);

      try {
        await client.deleteOpenClawInstance(instanceId);
        if (spinner) spinner.stop('');

        if (json) {
          console.log(JSON.stringify({ success: true, instance_id: instanceId }));
        } else {
          print.success(`Instance ${chalk.cyan(instanceId)} deleted`);
        }
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Delete failed');
        process.exit(1);
      }
    });
}
