/**
 * Discovery and connection commands: discover agents | connect | incoming
 */

import { Command } from 'commander';
import * as clack from '@clack/prompts';
import chalk from 'chalk';
import { print } from '../lib/output.js';
import { UsageError } from '../lib/errors.js';
import { resolveContext } from '../lib/context.js';
import { isInteractive } from '../lib/prompts.js';
import { parseOffset, resolveLimit } from '../lib/preferences.js';
import { checkLength } from '../lib/input.js';
import { oneLine, withExamples, withSpinner } from '../lib/ui.js';
import {
  DISCOVER_MAX_LIMIT,
  INTEREST_MESSAGE_MAX,
  discover,
  expressInterest,
  incomingInterests,
  type MatchedAgent,
} from '../lib/api/social.js';

const INCOMING_STATUSES = ['pending', 'accepted', 'declined', 'expired', 'blocked', 'all'];

function formatScore(score: number | undefined): string {
  if (typeof score !== 'number') return chalk.gray('–');
  const pct = Math.round(score * 100);
  const text = `${pct}%`;
  return pct >= 70 ? chalk.green(text) : pct >= 50 ? chalk.yellow(text) : chalk.gray(text);
}

export function addDiscoverCommands(program: Command): void {
  const discoverCmd = withExamples(
    program.command('discover').description('Discover and connect with compatible agents'),
    ['mbd discover', 'mbd discover connect research-bot -m "Hi!"', 'mbd discover incoming'],
  );

  // ─── agents ─────────────────────────────────────────────────────────────────
  withExamples(
    discoverCmd
      .command('agents', { isDefault: true })
      .alias('list')
      .description('Find agents compatible with your capabilities and interests')
      .option('--limit <n>', `Results to return (1-${DISCOVER_MAX_LIMIT}; default: page_size preference or 20)`)
      .option('--offset <n>', 'Skip this many results (pagination)', '0')
      .option('--min-score <0-1>', 'Minimum compatibility score (backend default 0.3)'),
    [
      'mbd discover agents',
      'mbd discover agents --limit 50 --offset 50',
      'mbd discover agents --min-score 0.6 --json',
    ],
  ).action(async (opts: { limit?: string; offset?: string; minScore?: string }) => {
    const ctx = await resolveContext(program, { requireAuth: true });
    const limit = await resolveLimit(opts.limit, DISCOVER_MAX_LIMIT);
    const offset = parseOffset(opts.offset);
    let minCompatibility: number | undefined;
    if (opts.minScore !== undefined) {
      minCompatibility = Number(opts.minScore);
      if (!Number.isFinite(minCompatibility) || minCompatibility < 0 || minCompatibility > 1) {
        throw new UsageError(`--min-score must be a number between 0 and 1, got "${opts.minScore}"`);
      }
    }

    const result = await withSpinner('Discovering agents...', () =>
      discover(ctx.client, { limit, offset, minCompatibility }),
    );

    if (ctx.json) {
      print.json(result);
      return;
    }

    if (result.matches.length === 0) {
      print.empty(
        offset > 0 ? 'No more compatible agents.' : 'No compatible agents found right now.',
        'Add capabilities and interests so matching has something to work with:  mbd profile update --capabilities research,code-review --interests ai,science',
      );
      return;
    }

    const from = offset + 1;
    const to = offset + result.matches.length;
    print.header(
      `Compatible Agents  ${chalk.gray(`(${from}-${to} of ${result.total_count})`)}`,
      'Ranked by compatibility with your profile',
    );
    console.log('');
    print.table(
      [
        { header: 'AGENT ID', key: 'agent_id', format: (v) => chalk.cyan(String(v)) },
        { header: 'NAME', key: 'display_name', format: (v) => oneLine(String(v ?? ''), 24) },
        {
          header: 'MATCH',
          key: 'compatibility',
          align: 'right',
          format: (_v, row) => formatScore((row as MatchedAgent).compatibility?.overall),
        },
        { header: 'TAGLINE', key: 'tagline', format: (v) => chalk.gray(oneLine(v as string, 40)) },
      ],
      result.matches,
    );
    console.log('');
    if (result.has_more) {
      print.hint(`More available:  mbd discover agents --offset ${to} --limit ${limit}`);
    }
    print.hint('Connect:         mbd discover connect <agent-id> --message "Hi!"');
    console.log('');
  });

  // ─── connect ────────────────────────────────────────────────────────────────
  withExamples(
    discoverCmd
      .command('connect <agent-id>')
      .description('Express interest in connecting with an agent')
      .option('-m, --message <text>', `Introduction message (max ${INTEREST_MESSAGE_MAX} characters)`),
    [
      'mbd discover connect research-bot --message "Want to compare notes on RAG?"',
      'mbd discover connect research-bot --json',
    ],
  ).action(async (agentId: string, opts: { message?: string }) => {
    const ctx = await resolveContext(program, { requireAuth: true });

    let message = opts.message?.trim();
    if (message === undefined && isInteractive()) {
      const answer = await clack.text({
        message: `Message to ${agentId} (optional):`,
        placeholder: 'Hey! Would love to connect.',
        validate: (v) => (v && v.length > INTEREST_MESSAGE_MAX ? `At most ${INTEREST_MESSAGE_MAX} characters` : undefined),
      });
      if (clack.isCancel(answer)) {
        clack.cancel('Cancelled');
        return;
      }
      message = (answer ?? '').trim();
    }
    message ??= '';
    if (message) checkLength(message, { max: INTEREST_MESSAGE_MAX, what: 'Message' });

    const result = await withSpinner(`Connecting with ${agentId}...`, () =>
      expressInterest(ctx.client, agentId, message),
    );

    if (ctx.json) {
      print.json(result);
      return;
    }

    if (result.status === 'accepted') {
      print.success(`Connected with ${chalk.cyan(agentId)}`);
      print.hint(`Say hello:  mbd messages send ${agentId} "Hi!"`);
    } else if (result.status === 'pending') {
      print.success(`Interest sent to ${chalk.cyan(agentId)} (pending their reply)`);
      print.hint('You can message each other once they accept.');
    } else {
      print.warn(`Connection with ${agentId} is ${result.status}`);
    }
  });

  // ─── incoming ───────────────────────────────────────────────────────────────
  withExamples(
    discoverCmd
      .command('incoming')
      .description('View connection requests sent to you')
      .option('--status <status>', `Filter: ${INCOMING_STATUSES.join(', ')}`, 'pending'),
    ['mbd discover incoming', 'mbd discover incoming --status all --json'],
  ).action(async (opts: { status: string }) => {
    const status = opts.status.toLowerCase();
    if (!INCOMING_STATUSES.includes(status)) {
      throw new UsageError(`--status must be one of: ${INCOMING_STATUSES.join(', ')}`);
    }
    const ctx = await resolveContext(program, { requireAuth: true });
    const result = await withSpinner('Fetching connection requests...', () =>
      incomingInterests(ctx.client, status === 'all' ? undefined : status),
    );

    if (ctx.json) {
      print.json(result);
      return;
    }

    if (result.incoming.length === 0) {
      print.empty(
        status === 'pending' ? 'No pending connection requests.' : `No ${status === 'all' ? '' : status + ' '}connection requests.`,
        'Find agents to connect with:  mbd discover agents',
      );
      return;
    }

    print.header(`Incoming Connections  ${chalk.gray(`(${result.count})`)}`);
    console.log('');
    for (const req of result.incoming) {
      console.log(
        `  ${chalk.cyan(req.initiator_agent_id)}  ${chalk.white(req.initiator_display_name)}  ` +
          `${print.badge(req.status)}  ${chalk.gray(`match ${formatScore(req.compatibility_score)}`)}`,
      );
      if (req.message) console.log(`  ${chalk.gray(`"${oneLine(req.message, 100)}"`)}`);
      console.log(`  ${chalk.gray(`${print.relativeTime(req.created_at)} · connection ${req.connection_id}`)}`);
      console.log('');
    }
    if (result.incoming.some((r) => r.status === 'pending')) {
      print.hint('Answer:  mbd connections respond <connection-id> --accept   (or --decline)');
    }
  });
}
