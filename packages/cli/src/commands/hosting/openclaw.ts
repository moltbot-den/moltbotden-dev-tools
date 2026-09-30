/**
 * mbd hosting openclaw: managed OpenClaw agent instances.
 * API: /v1/hosting/openclaw (routers/hosting/openclaw.py, models/hosting/openclaw.py).
 *
 * Each instance is an OpenClaw Gateway on its own VM, running on the
 * customer's own LLM key and bot tokens. Those credentials are write-only:
 * they are read from flags, environment variables or a masked prompt, sent
 * once, and never printed (not in --json output, not in errors).
 */

import { Command } from 'commander';
import * as clack from '@clack/prompts';
import chalk from 'chalk';
import { ApiError } from '../../lib/api-client.js';
import { print, statusBadge } from '../../lib/output.js';
import { UsageError } from '../../lib/errors.js';
import { confirmDestructive, isInteractive, requireInteractive } from '../../lib/prompts.js';
import {
  OPENCLAW_ALLOW_FROM_MAX, OPENCLAW_CHANNELS, OPENCLAW_LLM_API_KEY_LENGTH, OPENCLAW_LLM_PROVIDERS, OPENCLAW_MODEL_RE,
  OPENCLAW_PLAN_SPECS, OPENCLAW_TOKEN_RE, OPENCLAW_USE_CASE_LENGTH, OPENCLAW_USER_ID_RE,
  type OpenClawChannel, type OpenClawChannelSetup, type OpenClawInstance, type OpenClawPlan, type OpenClawUpdateRequest,
} from '../../types/hosting.js';
import {
  cancelled, examples, hostingAction, money, moreHint, parseIntOption, parseList, parseTimeout, relTime,
  shortId, validateChoice, waitWithSpinner, withSpinner, withWaitOptions,
} from './shared.js';

const PLANS = Object.keys(OPENCLAW_PLAN_SPECS) as OpenClawPlan[];
/** The logs endpoint's maximum `limit` (routers/hosting/openclaw.py). */
const LOGS_API_MAX = 500;
/** `failed` means the deploy never became healthy and was refunded; it never recovers. */
const WAIT_FAILED = ['failed', 'error', 'deleted'];

export const LLM_API_KEY_ENV = 'MBD_OPENCLAW_LLM_API_KEY';

/** `--flag [value]`: a string when a value is given, `true` when the flag is given bare. */
type SecretOption = string | boolean | undefined;

interface ConfigOptions {
  name?: string;
  llmProvider?: string;
  llmModel?: string;
  llmApiKey?: SecretOption;
  useCase?: string;
  personality?: string;
  instructions?: string;
  telegramAllow?: string;
  discordAllow?: string;
  slackAllow?: string;
  telegramToken?: SecretOption;
  discordToken?: SecretOption;
  slackBotToken?: SecretOption;
  slackAppToken?: SecretOption;
}

interface SecretSource {
  flag: string;
  env: string;
  label: string;
  /** Returns why the value is unusable, without echoing it. */
  problem: (value: string) => string | undefined;
}

interface TokenSpec extends SecretSource {
  option: 'telegramToken' | 'discordToken' | 'slackBotToken' | 'slackAppToken';
  field: 'bot_token' | 'app_token';
}

const tokenProblem = (re: RegExp, label: string) => (value: string): string | undefined =>
  re.test(value) ? undefined : `That does not look like a ${label}.`;

const CHANNEL_TOKENS: Record<OpenClawChannel, TokenSpec[]> = {
  telegram: [{
    option: 'telegramToken', field: 'bot_token', flag: '--telegram-token', env: 'TELEGRAM_BOT_TOKEN', label: 'Telegram bot token',
    problem: tokenProblem(OPENCLAW_TOKEN_RE.telegram_bot, 'Telegram bot token (123456789:AA...)'),
  }],
  discord: [{
    option: 'discordToken', field: 'bot_token', flag: '--discord-token', env: 'DISCORD_BOT_TOKEN', label: 'Discord bot token',
    problem: tokenProblem(OPENCLAW_TOKEN_RE.discord_bot, 'Discord bot token'),
  }],
  slack: [
    {
      option: 'slackBotToken', field: 'bot_token', flag: '--slack-bot-token', env: 'SLACK_BOT_TOKEN', label: 'Slack bot token (xoxb-)',
      problem: tokenProblem(OPENCLAW_TOKEN_RE.slack_bot, 'Slack bot token (xoxb-...)'),
    },
    {
      option: 'slackAppToken', field: 'app_token', flag: '--slack-app-token', env: 'SLACK_APP_TOKEN', label: 'Slack app token (xapp-)',
      problem: tokenProblem(OPENCLAW_TOKEN_RE.slack_app, 'Slack app-level token (xapp-...)'),
    },
  ],
};

const ALLOW: Record<OpenClawChannel, { option: 'telegramAllow' | 'discordAllow' | 'slackAllow'; flag: string; ids: string }> = {
  telegram: { option: 'telegramAllow', flag: '--telegram-allow', ids: 'numeric Telegram user ids' },
  discord:  { option: 'discordAllow',  flag: '--discord-allow',  ids: 'Discord user ids (snowflakes)' },
  slack:    { option: 'slackAllow',    flag: '--slack-allow',    ids: 'Slack member ids (U0123ABCD)' },
};

function llmKeySource(provider: string): SecretSource {
  return {
    flag: '--llm-api-key', env: LLM_API_KEY_ENV, label: `${provider} API key`,
    problem: (v) => (v.length < OPENCLAW_LLM_API_KEY_LENGTH.min || v.length > OPENCLAW_LLM_API_KEY_LENGTH.max || /\s/.test(v)
      ? `That does not look like an API key (${OPENCLAW_LLM_API_KEY_LENGTH.min}-${OPENCLAW_LLM_API_KEY_LENGTH.max} characters, no spaces).`
      : undefined),
  };
}

// ─── Validation (pure; exported for tests) ───────────────────────────────────

function maxLength(value: string | undefined, max: number, flag: string): string | undefined {
  if (value !== undefined && value.length > max) throw new UsageError(`${flag} must be at most ${max} characters.`);
  return value;
}

function checkUseCase(value: string, flag = '--use-case'): string {
  if (value.length < OPENCLAW_USE_CASE_LENGTH.min || value.length > OPENCLAW_USE_CASE_LENGTH.max) {
    throw new UsageError(`${flag} must be ${OPENCLAW_USE_CASE_LENGTH.min}-${OPENCLAW_USE_CASE_LENGTH.max} characters.`);
  }
  return value;
}

/** Why a channel's allowlist is unusable, or undefined. Ids are not secrets, so bad ones are named. */
export function allowFromProblem(channel: OpenClawChannel, ids: string[]): string | undefined {
  if (ids.length === 0) return `Give at least one of the ${ALLOW[channel].ids} allowed to message the agent`;
  if (ids.length > OPENCLAW_ALLOW_FROM_MAX) return `At most ${OPENCLAW_ALLOW_FROM_MAX} user ids`;
  const bad = ids.filter((id) => !OPENCLAW_USER_ID_RE[channel].test(id));
  if (bad.length) return `Not ${ALLOW[channel].ids}: ${bad.slice(0, 3).join(', ')}`;
  return undefined;
}

export function parseAllowFrom(channel: OpenClawChannel, value: string): string[] {
  const ids = [...new Set(parseList(value))];
  const problem = allowFromProblem(channel, ids);
  if (problem) throw new UsageError(`${ALLOW[channel].flag}: ${problem}.`);
  return ids;
}

/** The API wants `provider/model` with the instance's provider as the prefix. */
export function checkModel(model: string, provider: string): string {
  if (!OPENCLAW_MODEL_RE.test(model)) {
    throw new UsageError(`--llm-model must look like provider/model, e.g. ${provider}/<model-id>.`);
  }
  if (model.split('/', 1)[0] !== provider) throw new UsageError(`--llm-model must start with "${provider}/" (the LLM provider).`);
  return model;
}

/** Enabled channels from the --<channel>-allow flags, in catalog order. */
function allowFlags(opts: ConfigOptions): Map<OpenClawChannel, string[]> {
  const out = new Map<OpenClawChannel, string[]>();
  for (const channel of OPENCLAW_CHANNELS) {
    const value = opts[ALLOW[channel].option];
    if (value !== undefined) out.set(channel, parseAllowFrom(channel, value));
    else {
      const stray = CHANNEL_TOKENS[channel].find((t) => opts[t.option] !== undefined);
      if (stray) throw new UsageError(`${stray.flag} needs ${ALLOW[channel].flag} (the user ids allowed to message the agent).`);
    }
  }
  return out;
}

// ─── Secrets ─────────────────────────────────────────────────────────────────

/**
 * Resolve a credential: the flag's value, else its environment variable, else
 * a masked prompt. Never echoes the value, including in errors.
 */
async function resolveSecret(given: SecretOption, source: SecretSource): Promise<string> {
  let value: string | undefined;
  let from: string;
  if (typeof given === 'string' && given.trim()) {
    value = given.trim();
    from = source.flag;
  } else if (process.env[source.env]?.trim()) {
    value = process.env[source.env]!.trim();
    from = `$${source.env}`;
  } else {
    if (!isInteractive()) {
      throw new UsageError(`Missing the ${source.label}: pass ${source.flag} or set ${source.env}.`, {
        hint: `Prefer the environment variable so the secret stays out of your shell history: export ${source.env}=...`,
      });
    }
    const answer = await clack.password({ message: source.label, validate: (v) => source.problem((v ?? '').trim()) });
    if (clack.isCancel(answer)) cancelled();
    return answer.trim();
  }
  const problem = source.problem(value);
  if (problem) throw new UsageError(`The ${source.label} from ${from} was rejected: ${problem} (the value is not shown)`);
  return value;
}

/**
 * Channel setups for the enabled channels. A channel in `keepTokensFor` (the
 * instance already has it) sends only the tokens whose flags were given; the
 * server keeps the stored ones.
 */
async function channelSetups(
  enabled: Map<OpenClawChannel, string[]>, opts: ConfigOptions, keepTokensFor: ReadonlySet<string> = new Set(),
): Promise<{ channels: OpenClawChannelSetup[]; secrets: string[] }> {
  const channels: OpenClawChannelSetup[] = [];
  const secrets: string[] = [];
  for (const [type, allow_from] of enabled) {
    const setup: OpenClawChannelSetup = { type, allow_from };
    for (const spec of CHANNEL_TOKENS[type]) {
      if (keepTokensFor.has(type) && opts[spec.option] === undefined) continue;
      const token = await resolveSecret(opts[spec.option], spec);
      setup[spec.field] = token;
      secrets.push(token);
    }
    channels.push(setup);
  }
  return { channels, secrets };
}

/**
 * Run a request that carries credentials. FastAPI validation errors echo the
 * submitted input, so strip every credential from the error before it can be
 * printed or put into a --json error envelope.
 */
export async function withoutSecrets<T>(secrets: readonly string[], fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    const needles = secrets.filter(Boolean).flatMap((s) => [s, JSON.stringify(s).slice(1, -1)]);
    const scrub = (text: string) => needles.reduce((t, s) => t.split(s).join('[redacted]'), text);
    const details = err.details === undefined ? undefined : JSON.parse(scrub(JSON.stringify(err.details))) as unknown;
    throw new ApiError(err.status, scrub(err.message), details, err.retryAfterMs);
  }
}

// ─── Display ─────────────────────────────────────────────────────────────────

function displayName(i: Pick<OpenClawInstance, 'agent_name' | 'id'>): string {
  return i.agent_name || shortId(i.id);
}

function uptime(i: Pick<OpenClawInstance, 'health'>): string | undefined {
  const pct = i.health?.uptime_percent;
  return typeof pct === 'number' ? `${pct}%` : undefined;
}

function healthLine(i: OpenClawInstance): string {
  const h = i.health;
  if (!h || h.checks_total === 0) return chalk.gray('no health checks yet');
  const state = h.healthy === true ? chalk.green('healthy') : h.healthy === false ? chalk.red('unhealthy') : chalk.gray('unknown');
  return `${state} · ${uptime(i) ?? '–'} uptime (${h.checks_ok}/${h.checks_total} checks) · last check ${relTime(h.last_check_at)}`;
}

function channelLines(i: OpenClawInstance): string | undefined {
  if (!i.channels?.length) return undefined;
  return i.channels
    .map((c) => {
      const ids = i.channel_allow_from?.[c] ?? [];
      return `${c}${ids.length ? chalk.gray(` (allows ${ids.join(', ')})`) : ''}`;
    })
    .join('\n');
}

// ─── Commands ────────────────────────────────────────────────────────────────

/** Flags shared by deploy and update. */
function withConfigOptions(cmd: Command, update: boolean): Command {
  const keep = update ? '; a channel the instance already has keeps its stored tokens unless you pass a token flag' : '';
  return cmd
    .option('--name <name>', 'Agent name (max 50 characters)')
    .option('--llm-provider <provider>', `LLM provider: ${OPENCLAW_LLM_PROVIDERS.join('|')}${update ? ' (needs the new provider\'s API key)' : ''}`)
    .option('--llm-model <model>', 'Model as provider/model, e.g. anthropic/<model-id> (default: the provider\'s OpenClaw default)')
    .option('--llm-api-key [key]', update
      ? `New LLM provider API key; pass it bare to read $${LLM_API_KEY_ENV} or get a masked prompt (needed with --llm-provider)`
      : `Your LLM provider API key (default: $${LLM_API_KEY_ENV}, else a masked prompt)`)
    .option('--use-case <text>', `What the agent should do (${OPENCLAW_USE_CASE_LENGTH.min}-${OPENCLAW_USE_CASE_LENGTH.max} characters)`)
    .option('--personality <text>', 'Agent personality (max 500 characters)')
    .option('--instructions <text>', 'Special instructions (max 2000 characters)')
    .option('--telegram-allow <ids>', `Enable Telegram: comma-separated Telegram user ids allowed to DM the agent${update ? ' (any channel flag replaces the channel list)' : ''}`)
    .option('--telegram-token [token]', `Telegram bot token from @BotFather (default: $TELEGRAM_BOT_TOKEN, else a prompt${keep})`)
    .option('--discord-allow <ids>', 'Enable Discord: comma-separated Discord user ids allowed to DM the agent')
    .option('--discord-token [token]', 'Discord bot token (default: $DISCORD_BOT_TOKEN, else a prompt)')
    .option('--slack-allow <ids>', 'Enable Slack: comma-separated Slack member ids allowed to DM the agent')
    .option('--slack-bot-token [token]', 'Slack xoxb- bot token (default: $SLACK_BOT_TOKEN, else a prompt)')
    .option('--slack-app-token [token]', 'Slack xapp- app-level token for Socket Mode (default: $SLACK_APP_TOKEN, else a prompt)');
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
        { header: 'UPTIME',   align: 'right', format: (_v, row) => uptime(row as OpenClawInstance) ?? chalk.gray('–') },
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
      withConfigOptions(
        ocCmd
          .command('deploy')
          .alias('create')
          .description('Deploy an OpenClaw agent on its own VM with your LLM key and bot tokens (charges the first month to your hosting balance)')
          .option('--plan <plan>', `Plan: ${PLANS.join('|')}`),
        false,
      ).option('-y, --yes', 'Skip the confirmation prompt'),
    ),
    [
      'mbd hosting openclaw deploy',
      `export ${LLM_API_KEY_ENV}=sk-ant-...  TELEGRAM_BOT_TOKEN=123456789:AA...\n` +
      '  mbd hosting openclaw deploy --plan shared --llm-provider anthropic --telegram-allow 123456789 \\\n' +
      '      --use-case "Answer questions about our docs" --name docs-bot --yes --wait',
    ],
  ).action(hostingAction(program, 'OpenClaw', async (h, opts: ConfigOptions & { plan?: string; yes?: boolean; wait?: boolean; timeout?: string }) => {
    let plan = opts.plan !== undefined ? validateChoice(opts.plan, PLANS, '--plan') : undefined;
    let provider = opts.llmProvider !== undefined ? validateChoice(opts.llmProvider, OPENCLAW_LLM_PROVIDERS, '--llm-provider') : undefined;
    let useCase = opts.useCase !== undefined ? checkUseCase(opts.useCase.trim()) : undefined;
    let name = maxLength(opts.name?.trim(), 50, '--name');
    const personality = maxLength(opts.personality, 500, '--personality');
    const instructions = maxLength(opts.instructions, 2000, '--instructions');
    const enabled = allowFlags(opts);
    const timeoutSec = opts.wait ? parseTimeout(opts.timeout) : undefined;
    if (provider && opts.llmModel !== undefined) checkModel(opts.llmModel, provider);

    if (!plan) {
      requireInteractive('--plan', PLANS.join(' or '));
      const p = await clack.select({
        message: 'Plan (each instance gets its own VM)',
        options: PLANS.map((key) => {
          const s = OPENCLAW_PLAN_SPECS[key];
          return {
            value: key,
            label: `${s.name.padEnd(10)} ${s.machine_type} · ${s.ram_gb} GB RAM · ${s.disk_gb} GB disk · up to ${s.max_channels} channels · ${s.sla_uptime}% uptime target`,
          };
        }),
      });
      if (clack.isCancel(p)) cancelled();
      plan = p;
    }
    const maxChannels = OPENCLAW_PLAN_SPECS[plan].max_channels;
    if (enabled.size > maxChannels) throw new UsageError(`The ${plan} plan allows at most ${maxChannels} channels.`);
    if (!provider) {
      requireInteractive('--llm-provider', OPENCLAW_LLM_PROVIDERS.join(', '));
      const p = await clack.select({ message: 'LLM provider (you pay it directly with your own key)', options: OPENCLAW_LLM_PROVIDERS.map((v) => ({ value: v, label: v })) });
      if (clack.isCancel(p)) cancelled();
      provider = p;
      if (opts.llmModel !== undefined) checkModel(opts.llmModel, provider);
    }
    const llmApiKey = await resolveSecret(opts.llmApiKey, llmKeySource(provider));

    if (enabled.size === 0 && isInteractive()) {
      const picked = await clack.multiselect({
        message: `Channels (up to ${maxChannels}; space to select, enter to continue)`,
        options: OPENCLAW_CHANNELS.map((v) => ({ value: v, label: v })),
        required: false,
      });
      if (clack.isCancel(picked)) cancelled();
      if (picked.length > maxChannels) throw new UsageError(`The ${plan} plan allows at most ${maxChannels} channels.`);
      for (const channel of picked) {
        const ids = await clack.text({
          message: `${channel}: user ids allowed to message the agent (comma-separated ${ALLOW[channel].ids})`,
          validate: (v) => allowFromProblem(channel, [...new Set(parseList(v))]),
        });
        if (clack.isCancel(ids)) cancelled();
        enabled.set(channel, [...new Set(parseList(ids))]);
      }
    }
    const { channels, secrets } = await channelSetups(enabled, opts);

    if (!useCase) {
      requireInteractive('--use-case', 'what the agent should do');
      const u = await clack.text({
        message: 'What should the agent do?',
        placeholder: 'Answer customer questions about our product in Telegram',
        validate: (v) => ((v ?? '').trim().length < OPENCLAW_USE_CASE_LENGTH.min ? `At least ${OPENCLAW_USE_CASE_LENGTH.min} characters` : undefined),
      });
      if (clack.isCancel(u)) cancelled();
      useCase = checkUseCase(u.trim());
    }
    if (name === undefined && isInteractive()) {
      const n = await clack.text({ message: 'Agent name (optional)', placeholder: 'docs-bot', validate: (v) => ((v ?? '').length > 50 ? 'At most 50 characters' : undefined) });
      if (clack.isCancel(n)) cancelled();
      name = n.trim() || undefined;
    }

    if (isInteractive() && !opts.yes) {
      const account = await h.api.getAccount().catch(() => null);
      const ok = await clack.confirm({
        message: `Deploy a ${OPENCLAW_PLAN_SPECS[plan].name} OpenClaw instance? Your LLM key and bot tokens are checked first, ` +
          'then the first month is charged to your hosting balance' + (account ? ` (balance ${money(account.usdc_balance_cents)}).` : '.'),
        initialValue: true,
      });
      if (clack.isCancel(ok) || !ok) cancelled();
    }

    const created = await withoutSecrets([llmApiKey, ...secrets], () => withSpinner('Checking credentials and deploying', () => h.api.createOpenClaw({
      plan: plan!,
      agent_name: name,
      llm_provider: provider!,
      llm_api_key: llmApiKey,
      llm_model: opts.llmModel,
      channels,
      use_case: useCase!,
      agent_personality: personality,
      special_instructions: instructions,
    })));
    const noChannelsHint = `Add a channel later:  mbd hosting openclaw update ${created.id} --telegram-allow <your-telegram-user-id>`;
    if (timeoutSec !== undefined) {
      const instance = await waitWithSpinner({
        fetch: () => h.api.getOpenClaw(created.id),
        done: ['running'],
        failed: WAIT_FAILED,
        label: `OpenClaw ${name ?? shortId(created.id)}`,
        timeoutSec: timeoutSec,
        showCommand: `mbd hosting openclaw show ${created.id}`,
      });
      if (h.json) return print.json(instance);
      print.success(`OpenClaw instance ${chalk.cyan(displayName(instance))} is running`);
      if (channels.length === 0) print.hint(noChannelsHint);
      else print.hint(`Message your bot from an allowed account to talk to the agent. Logs:  mbd hosting openclaw logs ${created.id}`);
      return;
    }
    if (h.json) return print.json(created);
    print.success(`OpenClaw instance ${chalk.cyan(created.id)} queued for setup (${created.status})`);
    if (channels.length === 0) print.hint(noChannelsHint);
    print.hint(`Watch it:  mbd hosting openclaw show ${created.id}`);
  }));

  // ─── show ──────────────────────────────────────────────────────────────────
  examples(
    ocCmd.command('show <instance-id>').alias('get').description('Show instance details, channels and health'),
    ['mbd hosting openclaw show <instance-id>'],
  ).action(hostingAction(program, 'OpenClaw', async (h, id: string) => {
    const i = await withSpinner('Fetching instance', () => h.api.getOpenClaw(id));
    if (h.json) return print.json(i);
    console.log('');
    console.log(`  ${chalk.bold(displayName(i))}  ${statusBadge(i.status)}`);
    console.log(`  ${chalk.gray(i.id)}`);
    console.log('');
    const spec = OPENCLAW_PLAN_SPECS[i.plan];
    print.keyValue([
      { label: 'Plan',        value: spec ? `${spec.name} (${i.plan})` : i.plan },
      { label: 'Model',       value: i.llm_model ?? (i.llm_provider ? `${i.llm_provider} (OpenClaw default model)` : undefined) },
      { label: 'Channels',    value: channelLines(i) ?? chalk.gray('none') },
      { label: 'Health',      value: healthLine(i) },
      { label: 'OpenClaw',    value: i.openclaw_version ?? undefined },
      { label: 'Use case',    value: i.use_case || undefined },
      { label: 'Personality', value: i.agent_personality ?? undefined },
      { label: 'VM',          value: i.vm_id ?? chalk.gray('not assigned yet') },
      { label: 'Created',     value: relTime(i.created_at) },
      { label: 'Last active', value: i.last_active_at ? relTime(i.last_active_at) : undefined },
      { label: 'Next bill',   value: i.next_billing_at ? `${money(i.monthly_price_cents)} ${relTime(i.next_billing_at)}` : undefined },
      { label: 'Error',       value: i.error_message ? chalk.red(i.error_message) : undefined },
    ], { labelWidth: 11 });
    console.log('');
    print.hint(`Logs:  mbd hosting openclaw logs ${i.id}    Change it:  mbd hosting openclaw update ${i.id}`);
  }));

  // ─── update ────────────────────────────────────────────────────────────────
  examples(
    withConfigOptions(
      ocCmd
        .command('update <instance-id>')
        .alias('config')
        .description('Change an instance\'s profile, model, LLM key or channels (the agent restarts to apply it)'),
      true,
    ),
    [
      'mbd hosting openclaw update <instance-id> --llm-model anthropic/<model-id>',
      'mbd hosting openclaw update <instance-id> --llm-api-key            # rotate the key from $' + LLM_API_KEY_ENV + ' or a prompt',
      'mbd hosting openclaw update <instance-id> --telegram-allow 123456789,987654321 --slack-allow U0123ABCD',
    ],
  ).action(hostingAction(program, 'OpenClaw', async (h, id: string, opts: ConfigOptions) => {
    const provider = opts.llmProvider !== undefined ? validateChoice(opts.llmProvider, OPENCLAW_LLM_PROVIDERS, '--llm-provider') : undefined;
    const useCase = opts.useCase !== undefined ? checkUseCase(opts.useCase.trim()) : undefined;
    const enabled = allowFlags(opts);
    const body: OpenClawUpdateRequest = {};
    if (opts.name !== undefined) body.agent_name = maxLength(opts.name.trim(), 50, '--name');
    if (useCase !== undefined) body.use_case = useCase;
    if (opts.personality !== undefined) body.agent_personality = maxLength(opts.personality, 500, '--personality');
    if (opts.instructions !== undefined) body.special_instructions = maxLength(opts.instructions, 2000, '--instructions');
    if (Object.keys(body).length === 0 && provider === undefined && opts.llmModel === undefined && opts.llmApiKey === undefined && enabled.size === 0) {
      throw new UsageError(
        'Nothing to update. Pass at least one of --name, --llm-provider, --llm-model, --llm-api-key, --use-case, --personality, --instructions, --telegram-allow, --discord-allow, --slack-allow.',
      );
    }

    // The provider prefix of --llm-model, the plan's channel cap and which channels
    // already have stored tokens all come from the instance.
    const instance = await withSpinner('Fetching instance', () => h.api.getOpenClaw(id));
    if (opts.llmModel !== undefined) body.llm_model = checkModel(opts.llmModel, provider ?? instance.llm_provider);
    const secrets: string[] = [];
    if (provider !== undefined || opts.llmApiKey !== undefined) {
      if (provider !== undefined) body.llm_provider = provider;
      body.llm_api_key = await resolveSecret(opts.llmApiKey, llmKeySource(provider ?? instance.llm_provider));
      secrets.push(body.llm_api_key);
    }
    let removed: string[] = [];
    if (enabled.size > 0) {
      const maxChannels = OPENCLAW_PLAN_SPECS[instance.plan]?.max_channels ?? OPENCLAW_CHANNELS.length;
      if (enabled.size > maxChannels) throw new UsageError(`The ${instance.plan} plan allows at most ${maxChannels} channels.`);
      const setup = await channelSetups(enabled, opts, new Set(instance.channels ?? []));
      body.channels = setup.channels;
      secrets.push(...setup.secrets);
      removed = (instance.channels ?? []).filter((c) => !enabled.has(c as OpenClawChannel));
    }

    const result = await withoutSecrets(secrets, () => withSpinner('Saving configuration', () => h.api.updateOpenClaw(id, body)));
    if (h.json) return print.json(result);
    print.success(`Updated ${Object.keys(body).join(', ')} for instance ${chalk.cyan(id)}`);
    if (removed.length) print.info(`Removed channel${removed.length === 1 ? '' : 's'}: ${removed.join(', ')}`);
    if (result.restarting) print.info('The agent is restarting to apply the change.');
    else print.info('The change applies the next time the agent starts.');
    print.hint(`Check it:  mbd hosting openclaw show ${id}`);
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
    const result = await withSpinner('Fetching logs', () => h.api.getOpenClawLogs(id, limit));
    const logs = result.logs ?? [];
    if (h.json) return print.json(result);
    if (logs.length === 0) return print.empty(result.message ?? 'No log lines yet');
    for (const line of logs) console.log('  ' + chalk.gray(line));
  }));

  // ─── restart ───────────────────────────────────────────────────────────────
  examples(
    withWaitOptions(ocCmd.command('restart <instance-id>').description('Restart an instance (power-cycles its VM)')),
    ['mbd hosting openclaw restart <instance-id> --wait'],
  ).action(hostingAction(program, 'OpenClaw', async (h, id: string, opts: { wait?: boolean; timeout?: string }) => {
    const timeoutSec = opts.wait ? parseTimeout(opts.timeout) : undefined;
    const result = await withSpinner('Restarting instance', () => h.api.restartOpenClaw(id));
    if (timeoutSec !== undefined) {
      const instance = await waitWithSpinner({
        fetch: () => h.api.getOpenClaw(id),
        done: ['running'],
        failed: WAIT_FAILED,
        label: `OpenClaw ${shortId(id)}`,
        timeoutSec: timeoutSec,
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
      .description('Delete an OpenClaw instance permanently (its VM and stored credentials)')
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
