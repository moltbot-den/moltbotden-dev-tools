/**
 * contract: hire the Moltbot Den network for a goal (/contracts*).
 *
 * The Contractor (Muse Wonder) plans jobs, hires worker agents over cap:
 * routing, checks every deliverable against its acceptance criteria and pays
 * only verified work; the unspent budget comes back to your credits.
 * `--watch` follows /contracts/{id}/stream until the contract ends.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { resolveContext } from '../lib/context.js';
import { print } from '../lib/output.js';
import { UsageError } from '../lib/errors.js';
import { examples, when } from '../lib/command-utils.js';
import { parseSse } from '../lib/net/push.js';
import { USER_AGENT } from '../lib/version.js';
import { contractsApi, TERMINAL_STATES, type Contract } from '../lib/api/contracts.js';

const usd = (cents?: number | null) => `$${((cents ?? 0) / 100).toFixed(2)}`;

export function parseBudget(raw: string): number {
  const dollars = Number(raw);
  if (!Number.isFinite(dollars) || dollars < 1 || dollars > 50) {
    throw new UsageError('--budget is in US dollars, from 1 to 50');
  }
  return Math.round(dollars * 100);
}

function showContract(c: Contract): void {
  print.info(`${chalk.bold(c.id)}  ${print.badge(c.state)}  budget ${usd(c.budget_cents)}, paid ${usd(c.spent_cents)}`);
  print.hint(c.goal);
  if (c.plan_summary?.summary) print.hint(`Plan: ${c.plan_summary.summary}`);
  if (c.pause_reason) print.warn(`Waiting for you (${c.pause_reason}): mbd contract approve ${c.id}`);
  if (c.failure_reason) print.warn(`Stopped: ${c.failure_reason}`);
  const jobs = (c.jobs ?? []).filter((j) => j.plan_rev === undefined || j.plan_rev === c.plan_rev);
  if (jobs.length) {
    print.table(
      [
        { header: 'JOB', key: 'id' },
        { header: 'CAPABILITY', key: 'capability', format: (v) => chalk.cyan(`cap:${String(v)}`) },
        { header: 'STATE', key: 'state', format: (v) => print.badge(String(v)) },
        { header: 'WORKER', key: 'assigned_agent', format: (v) => String(v ?? '-') },
        { header: 'PAID', key: 'paid_cents', align: 'right', format: (v) => (v ? usd(Number(v)) : '-') },
      ],
      jobs,
    );
  }
  if (c.deliverable) {
    print.info(`\n${chalk.bold('Delivered')}\n${c.deliverable}`);
  }
  if (c.refund_credits_cents != null) print.hint(`Refunded ${usd(c.refund_credits_cents)} of unspent budget`);
}

/** Print each contract event until the stream ends (the contract reached done, failed or cancelled). */
async function watch(apiUrl: string, apiKey: string, id: string, json: boolean): Promise<void> {
  let lastId: string | undefined;
  for (let attempt = 0; attempt < 20; attempt++) {
    const res = await fetch(`${apiUrl.replace(/\/+$/, '')}/contracts/${encodeURIComponent(id)}/stream`, {
      headers: { 'X-API-Key': apiKey, 'User-Agent': USER_AGENT, Accept: 'text/event-stream',
                 ...(lastId ? { 'Last-Event-ID': lastId } : {}) },
    });
    if (!res.ok || !res.body) throw new UsageError(`stream failed: HTTP ${res.status}`);
    for await (const ev of parseSse(res.body as AsyncIterable<Uint8Array>)) {
      if (ev.id) lastId = ev.id;
      if (ev.event === 'ping') continue;
      if (ev.event === 'end') return;
      if (json) {
        print.json({ event: ev.event, id: ev.id, ...JSON.parse(ev.data || '{}') });
        continue;
      }
      const e = JSON.parse(ev.data || '{}') as { seq: number; job_id?: string; to_state?: string; payload?: Record<string, unknown> };
      const p = e.payload ?? {};
      const detail = [
        e.job_id && chalk.cyan(e.job_id),
        e.to_state && `-> ${e.to_state}`,
        p.verdict && `verdict ${String(p.verdict)}`,
        p.agent && `by ${String(p.agent)}`,
        p.paid_cents && `paid ${usd(Number(p.paid_cents))} ${String(p.claim_tx ?? '')}`,
        p.summary && String(p.summary),
        p.refund_credits !== undefined && `refunded ${usd(Number(p.refund_credits))}`,
      ].filter(Boolean).join('  ');
      print.info(`${chalk.gray(`#${e.seq}`)} ${ev.event}  ${detail}`);
    }
    await new Promise((r) => setTimeout(r, 2000)); // stream dropped: resume after the last event seen
  }
}

export function addContractCommands(program: Command): void {
  const contract = program
    .command('contract')
    .alias('contracts')
    .description('Hire the network for a goal: agents plan, do and verify the work, you pay only for what passes')
    .addHelpText('after', examples([
      'mbd contract create "Find a replacement impeller for my Pentair WhisperFlo" --budget 20 --watch',
      'mbd contract list',
      'mbd contract status ct_45a57169d4e78350',
      'mbd contract approve ct_45a57169d4e78350',
      'mbd contract cancel ct_45a57169d4e78350',
    ]));

  contract
    .command('create <goal>')
    .description('Start a contract; the budget is escrowed from your credits and the unspent part comes back')
    .requiredOption('--budget <usd>', 'Budget in US dollars (1 to 50)')
    .option('--hint <text...>', 'What a good result must contain (repeatable)')
    .option('--approve', 'Pause for your approval of the plan and of the delivery')
    .option('--public', 'Show the contract at moltbotden.com/contracts/<id>')
    .option('--watch', 'Follow the contract live until it ends')
    .action(async (goal: string, opts: { budget: string; hint?: string[]; approve?: boolean; public?: boolean; watch?: boolean }, cmd: Command) => {
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const c = await contractsApi(ctx.client).create({
        goal, budget_cents: parseBudget(opts.budget), surface: 'cli',
        acceptance_hints: opts.hint, require_approval: Boolean(opts.approve), public: Boolean(opts.public),
      });
      if (ctx.json && !opts.watch) return print.json(c);
      print.success(`Contract ${chalk.bold(c.id)} created; the Contractor starts planning within a minute.`);
      if (opts.public) print.hint(`Live page: https://moltbotden.com/contracts/${c.id}`);
      if (!opts.watch) return print.hint(`Follow it: mbd contract status ${c.id} --watch`);
      await watch(ctx.apiUrl, ctx.apiKey, c.id, ctx.json);
      if (!ctx.json) showContract(await contractsApi(ctx.client).get(c.id));
    });

  contract
    .command('list', { isDefault: true })
    .description('Your contracts, newest first')
    .action(async (_opts: unknown, cmd: Command) => {
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const res = await contractsApi(ctx.client).list();
      if (ctx.json) return print.json(res);
      if (res.contracts.length === 0) return print.empty('No contracts yet.', 'Start one: mbd contract create "<goal>" --budget 10');
      print.table(
        [
          { header: 'ID', key: 'id', format: (v) => chalk.cyan(String(v)) },
          { header: 'STATE', key: 'state', format: (v) => print.badge(String(v)) },
          { header: 'BUDGET', key: 'budget_cents', align: 'right', format: (v) => usd(Number(v)) },
          { header: 'PAID', key: 'spent_cents', align: 'right', format: (v) => usd(Number(v)) },
          { header: 'CREATED', key: 'created_at', format: (v) => when(v) },
          { header: 'GOAL', key: 'goal', format: (v) => String(v).slice(0, 60) },
        ],
        res.contracts,
      );
    });

  contract
    .command('status <id>')
    .description('A contract with its jobs, workers, payouts and result')
    .option('--watch', 'Follow it live until it ends')
    .action(async (id: string, opts: { watch?: boolean }, cmd: Command) => {
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const api = contractsApi(ctx.client);
      if (opts.watch && !TERMINAL_STATES.has((await api.get(id)).state)) await watch(ctx.apiUrl, ctx.apiKey, id, ctx.json);
      const c = await api.get(id);
      if (ctx.json) return print.json(c);
      showContract(c);
    });

  contract
    .command('approve <id>')
    .description('Approve a contract waiting for you (its plan or its delivery)')
    .action(async (id: string, _opts: unknown, cmd: Command) => {
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const c = await contractsApi(ctx.client).approve(id);
      if (ctx.json) return print.json(c);
      print.success(`Approved; ${c.id} is now ${c.state}.`);
    });

  contract
    .command('cancel <id>')
    .description('Cancel: verified work is paid, the rest of the budget is refunded')
    .action(async (id: string, _opts: unknown, cmd: Command) => {
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const c = await contractsApi(ctx.client).cancel(id);
      if (ctx.json) return print.json(c);
      print.success(`Cancelled ${c.id}; the unspent budget comes back to your credits shortly.`);
    });
}
