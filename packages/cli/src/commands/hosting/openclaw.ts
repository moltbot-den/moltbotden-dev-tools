/**
 * mbd hosting openclaw: managed OpenClaw agent instances.
 * API: /v1/hosting/openclaw (routers/hosting/openclaw.py, models/hosting/openclaw.py).
 */

import { Command } from 'commander';
import * as clack from '@clack/prompts';
import chalk from 'chalk';
import { print, statusBadge } from '../../lib/output.js';
import { UsageError } from '../../lib/errors.js';
import { confirmDestructive, isInteractive, requireInteractive } from '../../lib/prompts.js';
import {
  OPENCLAW_CHANNELS, OPENCLAW_LLM_PROVIDERS, OPENCLAW_MEMORY, OPENCLAW_PLAN_SPECS, OPENCLAW_PROACTIVITY,
  OPENCLAW_USE_CASE_LENGTH, type OpenClawInstance, type OpenClawPlan, type OpenClawUpdateRequest,
} from '../../types/hosting.js';
import {
  cancelled, examples, hostingAction, money, moreHint, parseIntOption, parseList, parseTimeout, relTime,
  shortId, validateChoice, waitWithSpinner, withSpinner, withWaitOptions,
} from './shared.js';

const PLANS = Object.keys(OPENCLAW_PLAN_SPECS) as OpenClawPlan[];
/** The logs endpoint's maximum `limit` (routers/hosting/openclaw.py). */
const LOGS_API_MAX = 500;

function maxLength(value: string | undefined, max: number, flag: string): string | undefined {
  if (value !== undefined && value.length > max) throw new UsageError(`${flag} must be at most ${max} characters.`);
  return value;
}

function checkChannels(channels: string[], plan?: OpenClawPlan): string[] {
  for (const c of channels) validateChoice(c, OPENCLAW_CHANNELS, '--channels');
  if (new Set(channels).size !== channels.length) throw new UsageError('--channels lists a channel twice.');
  // The API does not enforce the plan limits yet; the plan still promises them.
  if (plan && channels.length > OPENCLAW_PLAN_SPECS[plan].max_channels) {
    throw new UsageError(`The ${plan} plan allows at most ${OPENCLAW_PLAN_SPECS[plan].max_channels} channels.`);
  }
  return channels;
}

function checkSkills(skills: string[], plan?: OpenClawPlan): string[] {
  const max = plan ? OPENCLAW_PLAN_SPECS[plan].max_skills : 20;
  if (skills.length > max) throw new UsageError(`${plan ? `The ${plan} plan allows` : 'The API allows'} at most ${max} skills.`);
  return skills;
}

function displayName(i: Pick<OpenClawInstance, 'agent_name' | 'id'>): string {
  return i.agent_name || shortId(i.id);
}

export function addOpenClawCommands(parent: Command, program: Command): void {
  const ocCmd = parent.command('openclaw').alias('oc').description('Manage hosted OpenClaw agent instances');
  examples(ocCmd, ['mbd hosting openclaw deploy', 'mbd hosting openclaw show <instance-id>', 'mbd hosting openclaw logs <instance-id>']);

  // ─── list ──────────────────────────────────────────────────────────────────
  examples(
    ocCmd
      .command('list')
      .alias('ls')
      .description('List your OpenClaw instances')
      .option('--limit <n>', 'Maximum instances to return (1-100)', '50'),
    ['mbd hosting openclaw list'],
  ).action(hostingAction(program, 'OpenClaw', async (h, opts: { limit: string }) => {
    const limit = parseIntOption(opts.limit, '--limit', 1, 100);
    const result = await withSpinner('Loading instances', () => h.api.listOpenClaw({ limit }));
    if (h.json) return print.json(result);
    print.header(`OpenClaw Instances  ${chalk.gray(`(${result.instances.length})`)}`);
    console.log('');
    if (result.instances.length === 0) {
      print.empty('No OpenClaw instances yet', 'Deploy one:  mbd hosting openclaw deploy');
      return;
    }
    print.table(
      [
        { header: 'ID',       key: 'id',       format: (v) => chalk.gray(String(v)) },
        { header: 'NAME',     format: (_v, row) => chalk.cyan(displayName(row as OpenClawInstance)) },
        { header: 'PLAN',     key: 'plan' },
        { header: 'STATUS',   key: 'status',   format: (v) => statusBadge(String(v)) },
        { header: 'LLM',      key: 'llm_provider', format: (v) => (v ? String(v) : chalk.gray('–')) },
        { header: 'CHANNELS', key: 'channels', format: (v) => (Array.isArray(v) && v.length ? v.join(', ') : chalk.gray('–')) },
        { header: 'SKILLS',   key: 'skills',   align: 'right', format: (v) => String(Array.isArray(v) ? v.length : 0) },
        { header: 'ACTIVE',   key: 'last_active_at', format: (v) => chalk.gray(relTime(v)) },
      ],
      result.instances,
    );
    console.log('');
    moreHint(result.count, limit, 'mbd hosting openclaw list');
    print.hint('Details:  mbd hosting openclaw show <id>');
  }));

  // ─── deploy ────────────────────────────────────────────────────────────────
  examples(
    withWaitOptions(
      ocCmd
        .command('deploy')
        .alias('create')
        .description('Deploy a managed OpenClaw agent (charges the first month to your hosting balance)')
        .option('--plan <plan>', `Plan: ${PLANS.join('|')}`)
        .option('--llm-provider <provider>', `LLM provider: ${OPENCLAW_LLM_PROVIDERS.join('|')}`)
        .option('--channels <list>', `Comma-separated: ${OPENCLAW_CHANNELS.join(',')}`)
        .option('--use-case <text>', `What the agent should do (${OPENCLAW_USE_CASE_LENGTH.min}-${OPENCLAW_USE_CASE_LENGTH.max} characters)`)
        .option('--name <name>', 'Agent name (max 50 characters)')
        .option('--skills <list>', 'Comma-separated skill names')
        .option('--proactivity <level>', `${OPENCLAW_PROACTIVITY.join('|')} (default reactive)`)
        .option('--personality <text>', 'Agent personality (max 500 characters)')
        .option('--instructions <text>', 'Special instructions (max 2000 characters)')
        .option('--memory <mode>', `${OPENCLAW_MEMORY.join('|')} (default standard)`)
        .option('-y, --yes', 'Skip the confirmation prompt'),
    ),
    [
      'mbd hosting openclaw deploy',
      'mbd hosting openclaw deploy --plan shared --llm-provider anthropic --channels telegram,discord \\\n      --use-case "Answer questions about our docs" --name docs-bot --wait',
    ],
  ).action(hostingAction(program, 'OpenClaw', async (h, opts: {
    plan?: string; llmProvider?: string; channels?: string; useCase?: string; name?: string; skills?: string;
    proactivity?: string; personality?: string; instructions?: string; memory?: string; yes?: boolean; wait?: boolean; timeout?: string;
  }) => {
    let plan = opts.plan !== undefined ? validateChoice(opts.plan, PLANS, '--plan') : undefined;
    let provider = opts.llmProvider !== undefined ? validateChoice(opts.llmProvider, OPENCLAW_LLM_PROVIDERS, '--llm-provider') : undefined;
    let channels = opts.channels !== undefined ? checkChannels(parseList(opts.channels), plan) : undefined;
    let useCase = opts.useCase?.trim();
    let name = maxLength(opts.name?.trim(), 50, '--name');
    const proactivity = opts.proactivity !== undefined ? validateChoice(opts.proactivity, OPENCLAW_PROACTIVITY, '--proactivity') : undefined;
    const memory = opts.memory !== undefined ? validateChoice(opts.memory, OPENCLAW_MEMORY, '--memory') : undefined;
    const personality = maxLength(opts.personality, 500, '--personality');
    const instructions = maxLength(opts.instructions, 2000, '--instructions');
    if (opts.wait) parseTimeout(opts.timeout);

    if (!plan) {
      requireInteractive('--plan', PLANS.join(' or '));
      const p = await clack.select({
        message: 'Plan',
        options: PLANS.map((key) => {
          const s = OPENCLAW_PLAN_SPECS[key];
          return { value: key, label: `${s.name.padEnd(10)} up to ${s.max_channels} channels · ${s.max_skills} skills · ${s.sla_uptime}% uptime target` };
        }),
      });
      if (clack.isCancel(p)) cancelled();
      plan = p;
    }
    if (!provider) {
      requireInteractive('--llm-provider', OPENCLAW_LLM_PROVIDERS.join(', '));
      const p = await clack.select({ message: 'LLM provider', options: OPENCLAW_LLM_PROVIDERS.map((v) => ({ value: v, label: v })) });
      if (clack.isCancel(p)) cancelled();
      provider = p;
    }
    if (!channels) {
      requireInteractive('--channels', OPENCLAW_CHANNELS.join(','));
      const c = await clack.multiselect({
        message: `Channels (up to ${OPENCLAW_PLAN_SPECS[plan].max_channels})`,
        options: OPENCLAW_CHANNELS.map((v) => ({ value: v, label: v })),
        required: true,
      });
      if (clack.isCancel(c)) cancelled();
      channels = c;
    }
    checkChannels(channels, plan);
    if (channels.length === 0) throw new UsageError('Pick at least one channel.');
    if (!useCase) {
      requireInteractive('--use-case', 'what the agent should do');
      const u = await clack.text({
        message: 'What should the agent do?',
        placeholder: 'Answer customer questions about our product in Telegram',
        validate: (v) => ((v ?? '').trim().length < OPENCLAW_USE_CASE_LENGTH.min ? `At least ${OPENCLAW_USE_CASE_LENGTH.min} characters` : undefined),
      });
      if (clack.isCancel(u)) cancelled();
      useCase = u.trim();
    }
    if (useCase.length < OPENCLAW_USE_CASE_LENGTH.min || useCase.length > OPENCLAW_USE_CASE_LENGTH.max) {
      throw new UsageError(`--use-case must be ${OPENCLAW_USE_CASE_LENGTH.min}-${OPENCLAW_USE_CASE_LENGTH.max} characters.`);
    }
    if (name === undefined && isInteractive()) {
      const n = await clack.text({ message: 'Agent name (optional)', placeholder: 'docs-bot', validate: (v) => ((v ?? '').length > 50 ? 'At most 50 characters' : undefined) });
      if (clack.isCancel(n)) cancelled();
      name = n.trim() || undefined;
    }
    const skills = checkSkills(parseList(opts.skills), plan);

    if (isInteractive() && !opts.yes) {
      const account = await h.api.getAccount().catch(() => null);
      const ok = await clack.confirm({
        message: `Deploy a ${plan} OpenClaw instance? The first month is charged to your hosting balance now` +
          (account ? ` (balance ${money(account.usdc_balance_cents)}).` : '.'),
        initialValue: true,
      });
      if (clack.isCancel(ok) || !ok) cancelled();
    }

    const created = await withSpinner('Deploying OpenClaw instance', () => h.api.createOpenClaw({
      plan: plan!,
      llm_provider: provider!,
      channels: channels!,
      use_case: useCase!,
      skills,
      proactivity_level: proactivity,
      agent_name: name,
      agent_personality: personality,
      special_instructions: instructions,
      memory_preference: memory,
    }));
    if (opts.wait) {
      const instance = await waitWithSpinner({
        fetch: () => h.api.getOpenClaw(created.id),
        done: ['running'],
        failed: ['error', 'stopped', 'deleted'],
        label: `OpenClaw ${name ?? shortId(created.id)}`,
        timeoutSec: parseTimeout(opts.timeout),
        showCommand: `mbd hosting openclaw show ${created.id}`,
      });
      if (h.json) return print.json(instance);
      print.success(`OpenClaw instance ${chalk.cyan(displayName(instance))} is running`);
      if (instance.connection_instructions) console.log(`\n${instance.connection_instructions}\n`);
      return;
    }
    if (h.json) return print.json(created);
    print.success(`OpenClaw instance ${chalk.cyan(created.id)} queued for setup (${created.status})`);
    print.hint(`Watch it and get channel setup steps:  mbd hosting openclaw show ${created.id}`);
  }));

  // ─── show ──────────────────────────────────────────────────────────────────
  examples(
    ocCmd.command('show <instance-id>').alias('get').description('Show instance details and channel setup instructions'),
    ['mbd hosting openclaw show <instance-id>'],
  ).action(hostingAction(program, 'OpenClaw', async (h, id: string) => {
    const i = await withSpinner('Fetching instance', () => h.api.getOpenClaw(id));
    if (h.json) return print.json(i);
    console.log('');
    console.log(`  ${chalk.bold(displayName(i))}  ${statusBadge(i.status)}`);
    console.log(`  ${chalk.gray(i.id)}`);
    console.log('');
    print.keyValue([
      { label: 'Plan',        value: i.plan },
      { label: 'LLM',         value: [i.llm_provider, i.llm_model].filter(Boolean).join(' / ') || undefined },
      { label: 'Channels',    value: i.channels?.length ? i.channels.join(', ') : undefined },
      { label: 'Skills',      value: i.skills?.length ? i.skills.join(', ') : chalk.gray('none') },
      { label: 'Proactivity', value: i.proactivity_level },
      { label: 'Use case',    value: i.use_case || undefined },
      { label: 'VM',          value: i.vm_id ?? chalk.gray('not assigned yet') },
      { label: 'Created',     value: relTime(i.created_at) },
      { label: 'Last active', value: i.last_active_at ? relTime(i.last_active_at) : undefined },
      { label: 'Error',       value: i.error_message ? chalk.red(i.error_message) : undefined },
    ], { labelWidth: 11 });
    if (i.connection_instructions) {
      console.log('');
      console.log(`  ${chalk.bold('Connect your channels')}`);
      console.log(i.connection_instructions.split('\n').map((l) => `  ${l}`).join('\n'));
    }
    console.log('');
    print.hint(`Logs:  mbd hosting openclaw logs ${i.id}`);
  }));

  // ─── config ────────────────────────────────────────────────────────────────
  examples(
    ocCmd
      .command('config <instance-id>')
      .description('Update an instance\'s configuration (channels, skills, persona, model)')
      .option('--channels <list>', `Comma-separated: ${OPENCLAW_CHANNELS.join(',')} (replaces the list)`)
      .option('--skills <list>', 'Comma-separated skill names (replaces the list; pass "" to clear)')
      .option('--proactivity <level>', OPENCLAW_PROACTIVITY.join('|'))
      .option('--name <name>', 'Agent name (max 50 characters)')
      .option('--personality <text>', 'Agent personality (max 500 characters)')
      .option('--instructions <text>', 'Special instructions (max 2000 characters)')
      .option('--model <model>', 'LLM model id for the configured provider (max 100 characters)'),
    ['mbd hosting openclaw config <instance-id> --channels telegram,slack', 'mbd hosting openclaw config <instance-id> --proactivity scheduled'],
  ).action(hostingAction(program, 'OpenClaw', async (h, id: string, opts: {
    channels?: string; skills?: string; proactivity?: string; name?: string; personality?: string; instructions?: string; model?: string;
  }) => {
    const body: OpenClawUpdateRequest = {};
    if (opts.channels !== undefined) {
      body.channels = checkChannels(parseList(opts.channels));
      if (body.channels.length === 0) throw new UsageError('--channels needs at least one channel.');
      if (body.channels.length > 6) throw new UsageError('At most 6 channels are allowed.');
    }
    if (opts.skills !== undefined) body.skills = checkSkills(parseList(opts.skills));
    if (opts.proactivity !== undefined) body.proactivity_level = validateChoice(opts.proactivity, OPENCLAW_PROACTIVITY, '--proactivity');
    if (opts.name !== undefined) body.agent_name = maxLength(opts.name, 50, '--name');
    if (opts.personality !== undefined) body.agent_personality = maxLength(opts.personality, 500, '--personality');
    if (opts.instructions !== undefined) body.special_instructions = maxLength(opts.instructions, 2000, '--instructions');
    if (opts.model !== undefined) body.llm_model = maxLength(opts.model, 100, '--model');
    if (Object.keys(body).length === 0) {
      throw new UsageError('Nothing to update. Pass at least one of --channels, --skills, --proactivity, --name, --personality, --instructions, --model.');
    }
    const result = await withSpinner('Saving configuration', () => h.api.updateOpenClaw(id, body));
    if (h.json) return print.json(result);
    print.success(`Saved ${Object.keys(body).join(', ')} for instance ${chalk.cyan(id)}`);
    print.warn('The server stores the new settings but does not push them to the running agent yet.');
  }));

  // ─── logs ──────────────────────────────────────────────────────────────────
  examples(
    ocCmd
      .command('logs <instance-id>')
      .description('Show recent OpenClaw log lines from the instance VM')
      .option('--limit <n>', 'Lines to show (1-500)', '100'),
    ['mbd hosting openclaw logs <instance-id>', 'mbd hosting openclaw logs <instance-id> --limit 500'],
  ).action(hostingAction(program, 'OpenClaw', async (h, id: string, opts: { limit: string }) => {
    const limit = parseIntOption(opts.limit, '--limit', 1, LOGS_API_MAX);
    // Ask for the maximum and keep the newest lines ourselves, so the result is
    // the most recent `limit` lines whichever end of the buffer the API returns.
    const result = await withSpinner('Fetching logs', () => h.api.getOpenClawLogs(id, LOGS_API_MAX));
    const logs = (result.logs ?? []).slice(-limit);
    if (h.json) return print.json({ ...result, logs });
    if (logs.length === 0) return print.empty(result.message ?? 'No log lines yet');
    for (const line of logs) console.log('  ' + chalk.gray(line));
  }));

  // ─── restart ───────────────────────────────────────────────────────────────
  examples(
    withWaitOptions(ocCmd.command('restart <instance-id>').description('Restart an instance (stops and starts its VM)')),
    ['mbd hosting openclaw restart <instance-id> --wait'],
  ).action(hostingAction(program, 'OpenClaw', async (h, id: string, opts: { wait?: boolean; timeout?: string }) => {
    if (opts.wait) parseTimeout(opts.timeout);
    const result = await withSpinner('Restarting instance', () => h.api.restartOpenClaw(id));
    if (opts.wait) {
      const instance = await waitWithSpinner({
        fetch: () => h.api.getOpenClaw(id),
        done: ['running'],
        label: `OpenClaw ${shortId(id)}`,
        timeoutSec: parseTimeout(opts.timeout),
        showCommand: `mbd hosting openclaw show ${id}`,
      });
      if (h.json) return print.json(instance);
      print.success(`Instance ${chalk.cyan(id)} is running`);
      return;
    }
    if (h.json) return print.json(result);
    print.success(`Restart of instance ${chalk.cyan(id)} started`);
    print.hint(`Check progress:  mbd hosting openclaw show ${id}`);
  }));

  // ─── delete ────────────────────────────────────────────────────────────────
  examples(
    ocCmd
      .command('delete <instance-id>')
      .alias('rm')
      .description('Delete an OpenClaw instance permanently')
      .option('-y, --yes', 'Skip the confirmation prompt (required with --json or without a TTY)'),
    ['mbd hosting openclaw delete <instance-id>', 'mbd --json hosting openclaw delete <instance-id> --yes'],
  ).action(hostingAction(program, 'OpenClaw', async (h, id: string, opts: { yes?: boolean }) => {
    const ok = await confirmDestructive({ yes: opts.yes, json: h.json, message: `Permanently delete OpenClaw instance ${id}? The agent stops answering on every channel.` });
    if (!ok) cancelled();
    const result = await withSpinner('Deleting instance', () => h.api.deleteOpenClaw(id));
    if (h.json) return print.json(result);
    print.success(`Deletion of instance ${chalk.cyan(id)} started`);
  }));
}
