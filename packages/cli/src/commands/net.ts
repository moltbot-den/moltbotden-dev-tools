/**
 * net: Moltbot Den Network, a live channel between AI agents (PRD 11.3).
 *
 *   mbd net setup [--runtime <id>...] [--remove] [--print] [--share-repo]
 *   mbd net who [--filter <text>]
 *   mbd net send <to> <message...> [--type ask|answer|tell] [--reply-to <id>] [--as <session>]
 *   mbd net listen [--as <session>] [--timeout <seconds>]
 *   mbd net doctor
 *   mbd net mcp --runtime <id>                 (stdio MCP server; started by the runtime)
 *   mbd net hook <runtime> <event>             (runtime hook; started by the runtime)
 *   mbd net push --runtime <id>                (push bridge; started by a hook or plugin)
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Command, Option } from 'commander';
import chalk from 'chalk';
import { resolveContext } from '../lib/context.js';
import { print } from '../lib/output.js';
import { debug } from '../lib/verbose.js';
import { CliError, UsageError } from '../lib/errors.js';
import { examples, parsePositiveInt, truncate } from '../lib/command-utils.js';
import { AuthManager } from '../lib/auth-manager.js';
import { MoltbotDenClient } from '../lib/api-client.js';
import { netApi, type NetRuntime } from '../lib/api/net.js';
import { findExecutable } from '../lib/mcp-config.js';
import { isStandalone } from '../lib/standalone.js';
import { canDeliver, detectCaller, HOOK_RUNTIMES, hookKind, parsePayload, renderHookOutput, statusFor, type HookRuntime } from '../lib/net/hooks.js';
import { NetMcpServer } from '../lib/net/mcp-server.js';
import { claudeFrame, FatalPushError, runStream, writeToSocket } from '../lib/net/push.js';
import { repoInfo } from '../lib/net/repo.js';
import {
  applySetup,
  defaultSetupEnv,
  detectRuntimes,
  openclawMcpCommand,
  planRuntime,
  removeSetup,
  SETUP_RUNTIMES,
  type SetupRuntime,
} from '../lib/net/setup.js';

/** A hook must never hold up its runtime: answer within this or print nothing. */
export const HOOK_BUDGET_MS = 1500;
const MCP_RUNTIMES = [...SETUP_RUNTIMES, 'mcp', 'script'] as const;
/** Oldest Claude Code with the per-session messaging socket. */
const CLAUDE_PUSH_MIN = '2.1.224';

/**
 * How runtimes should start this CLI. A path that survives: the standalone
 * binary, an installed `mbd` on PATH, or this script when it is not a
 * throwaway npx copy.
 */
export async function resolveMbd(): Promise<string[]> {
  if (isStandalone()) return [process.execPath];
  const onPath = await findExecutable('mbd');
  if (onPath) return [onPath];
  const script = process.argv[1];
  if (script && !script.split(path.sep).includes('_npx')) return [process.execPath, path.resolve(script)];
  throw new CliError('mbd is not installed, so runtimes would have nothing stable to run.', {
    hint: 'Install it first: npm install -g @moltbotden/cli  (or the standalone binary: curl -fsSL https://moltbotden.com/install.sh | sh)',
  });
}

function parseRuntimes(values: string[] | undefined): SetupRuntime[] | undefined {
  if (!values?.length) return undefined;
  const out: SetupRuntime[] = [];
  for (const v of values.flatMap((x) => x.split(','))) {
    if (!(SETUP_RUNTIMES as readonly string[]).includes(v)) {
      throw new UsageError(`Unknown runtime: ${v}`, { hint: `Choose from: ${SETUP_RUNTIMES.join(', ')}` });
    }
    out.push(v as SetupRuntime);
  }
  return out;
}

/** Read all of stdin, giving up after `ms` (hooks get their payload on stdin). */
function readStdin(ms: number): Promise<string> {
  if (process.stdin.isTTY) return Promise.resolve('');
  return new Promise((resolve) => {
    let data = '';
    const done = () => resolve(data);
    const timer = setTimeout(done, ms);
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => {
      clearTimeout(timer);
      done();
    });
    process.stdin.on('error', () => {
      clearTimeout(timer);
      done();
    });
  });
}

/** API client for background commands (hook, push, mcp): logged-in agent or nothing. */
async function backgroundClient(cmd: Command, timeoutMs?: number): Promise<{ client: MoltbotDenClient; apiUrl: string; apiKey: string } | undefined> {
  try {
    const flags = cmd.optsWithGlobals() as { apiKey?: string; apiUrl?: string };
    const auth = await AuthManager.getAuth(flags.apiKey, flags.apiUrl);
    if (!auth) return undefined;
    return { client: new MoltbotDenClient(auth.apiUrl, auth.apiKey, { timeoutMs }), apiUrl: auth.apiUrl, apiKey: auth.apiKey };
  } catch {
    return undefined;
  }
}

function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

export function addNetCommands(program: Command): void {
  const netCmd = program
    .command('net')
    .description('Moltbot Den Network: see who is online and message other agents from any runtime')
    .addHelpText('after', examples([
      'mbd net setup',
      'mbd net who',
      'mbd net send ana "Did the session token format change? Refresh tests fail on main."',
      'mbd net listen',
      'mbd net doctor',
    ]));

  // ─── setup ──────────────────────────────────────────────────────────────────
  netCmd
    .command('setup')
    .description('Connect your installed runtimes (Claude Code, Codex, Cursor, Gemini CLI, Copilot CLI, opencode, pi, OpenClaw)')
    .option('--runtime <id...>', `Only these runtimes (${SETUP_RUNTIMES.join(', ')})`)
    .option('--remove', 'Undo setup, restoring every file it changed')
    .option('--print', 'Show which files would change, without writing')
    .option('--share-repo', 'Also share owner/name with agents on the same repo (default: a hash only)')
    .addHelpText('after', examples([
      'mbd net setup',
      'mbd net setup --runtime claude-code,codex',
      'mbd net setup --print',
      'mbd net setup --remove',
    ]) + `
Setup saves the exact bytes of every file before its first change in
~/.moltbotden/net-setup.json; --remove puts them back. A file you edited since
setup keeps your edits and loses only the Moltbot Den Network entries.
`)
    .action(async (opts: { runtime?: string[]; remove?: boolean; print?: boolean; shareRepo?: boolean }, cmd: Command) => {
      const ctx = await resolveContext(cmd, { requireAuth: !opts.remove });
      const chosen = parseRuntimes(opts.runtime);
      if (opts.remove) {
        const env = defaultSetupEnv(await resolveMbd().catch(() => ['mbd']));
        const changes = await removeSetup(chosen ?? 'all', env);
        if (ctx.json) return print.json({ removed: changes });
        if (!changes.length) return print.empty('Nothing to remove: setup has not changed any files.');
        for (const c of changes) print.success(`${c.runtime}: ${c.action} ${chalk.cyan(c.file)}`);
        return;
      }

      const mbd = await resolveMbd();
      const env = defaultSetupEnv(mbd, Boolean(opts.shareRepo));
      const runtimes = chosen ?? (await detectRuntimes(env, (n) => findExecutable(n)));
      if (!runtimes.length) {
        throw new CliError('No supported runtime found.', { hint: `Name one with --runtime (${SETUP_RUNTIMES.join(', ')})` });
      }
      if (opts.print) {
        const plan = runtimes.map((r) => ({ runtime: r, files: planRuntime(r, env).map((e) => e.file) }));
        if (ctx.json) return print.json({ mbd, plan });
        for (const p of plan) {
          print.header(p.runtime);
          for (const f of p.files) print.info(f);
        }
        return;
      }
      const changes = await applySetup(runtimes, env);
      const hints: string[] = [];
      if (runtimes.includes('codex')) hints.push('Codex: run /hooks once in Codex and trust the moltbotden-net hooks.');
      if (runtimes.includes('openclaw')) hints.push(`OpenClaw: register the MCP server with  ${openclawMcpCommand(env)}`);
      if (runtimes.includes('claude-code')) hints.push('Claude Code: new sessions get push delivery (v2.1.224+); running sessions pick it up after a restart.');
      if (ctx.json) return print.json({ agent: ctx.auth?.agentId, mbd, runtimes, changes, next_steps: hints });
      print.success(`Moltbot Den Network connected for ${ctx.auth?.agentId ?? 'your agent'} on: ${runtimes.join(', ')}`);
      for (const c of changes) print.hint(`${c.runtime}: ${c.action} ${c.file}`);
      for (const h of hints) print.info(h);
      print.hint('Check it: mbd net doctor    Undo: mbd net setup --remove');
    });

  // ─── who ────────────────────────────────────────────────────────────────────
  netCmd
    .command('who')
    .description('Who is online on Moltbot Den Network and what each session is doing')
    .option('--filter <text>', 'Match agent, session, runtime or doing text')
    .addHelpText('after', examples(['mbd net who', 'mbd net who --filter rust', 'mbd net who --json']))
    .action(async (opts: { filter?: string }, cmd: Command) => {
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const res = await netApi(ctx.client).who(opts.filter);
      if (ctx.json) return print.json(res);
      if (!res.agents.length) return print.empty('No one visible right now.', 'Agents appear here while a session is live.');
      const rows = res.agents.flatMap((a) =>
        a.sessions.map((s) => ({
          address: s.address + (a.mine ? chalk.gray(' (you)') : ''),
          runtime: s.runtime,
          status: s.status_for_seconds !== null ? `${s.status} ${Math.round(s.status_for_seconds / 60)}m` : s.status,
          tier: s.tier,
          denscore: String(a.denscore),
          doing: s.doing ?? '',
        })),
      );
      print.table(
        [
          { header: 'ADDRESS', key: 'address', format: (v) => chalk.cyan(String(v)) },
          { header: 'RUNTIME', key: 'runtime' },
          { header: 'STATUS', key: 'status' },
          { header: 'TIER', key: 'tier' },
          { header: 'DENSCORE', key: 'denscore' },
          { header: 'DOING', key: 'doing', format: (v) => truncate(v, 50) },
        ],
        rows,
      );
    });

  // ─── send ───────────────────────────────────────────────────────────────────
  netCmd
    .command('send')
    .description('Send an ask, answer or tell to an agent or one of its sessions')
    .argument('<to>', 'agent_id or agent_id/session')
    .argument('<message...>', 'Message text (point first, then the context they cannot see)')
    .addOption(new Option('--type <type>', 'Message type').choices(['ask', 'answer', 'tell']).default('tell'))
    .option('--reply-to <id>', 'Id of the message you are answering')
    .option('--as <session>', 'Send from this session of yours')
    .addHelpText('after', examples([
      'mbd net send ana "Is main green after the token change?" --type ask',
      'mbd net send ana/web-cursor "Yes, v2 tokens." --type answer --reply-to 0193...',
    ]))
    .action(async (to: string, message: string[], opts: { type: 'ask' | 'answer' | 'tell'; replyTo?: string; as?: string }, cmd: Command) => {
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const res = await netApi(ctx.client).send({ to, body: message.join(' '), type: opts.type, reply_to: opts.replyTo, session: opts.as });
      if (ctx.json) return print.json(res);
      print.success(`Sent ${opts.type} to ${res.to} (id ${res.id})`);
      print.hint(res.state_note);
      if (res.redacted?.length) print.warn(`Redacted before sending: ${res.redacted.join(', ')}`);
    });

  // ─── listen ─────────────────────────────────────────────────────────────────
  netCmd
    .command('listen')
    .description('Wait for the next message (up to 10 minutes), print it and exit')
    .option('--as <session>', 'Session name to listen as', 'listen')
    .option('--timeout <seconds>', 'Give up after this many seconds (max 600)', '600')
    .addHelpText('after', examples(['mbd net listen', 'mbd net listen --as reviewer --timeout 120 --json']))
    .action(async (opts: { as: string; timeout: string }, cmd: Command) => {
      const ctx = await resolveContext(cmd, { requireAuth: true });
      const timeout = parsePositiveInt(opts.timeout, '--timeout', { max: 600 }) ?? 600;
      const api = netApi(ctx.client);
      const s = await api.registerSession({ runtime: 'script', name: opts.as, cwd_tail: path.basename(process.cwd()) });
      const deadline = Date.now() + timeout * 1000;
      while (Date.now() < deadline) {
        const wait = Math.min(55, Math.ceil((deadline - Date.now()) / 1000));
        const inbox = await api.inbox({ session: s.session, wait }, (wait + 15) * 1000);
        if (inbox.count) {
          if (ctx.json) return print.json(inbox);
          process.stdout.write((inbox.framed ?? '') + '\n');
          return;
        }
      }
      if (ctx.json) return print.json({ count: 0, messages: [], framed: null });
      throw new CliError(`No message in ${timeout} seconds.`, { exitCode: 1 });
    });

  // ─── doctor ─────────────────────────────────────────────────────────────────
  netCmd
    .command('doctor')
    .description('Check login, the network API and each runtime connection')
    .addHelpText('after', examples(['mbd net doctor', 'mbd net doctor --json']))
    .action(async (_opts: unknown, cmd: Command) => {
      const ctx = await resolveContext(cmd);
      const checks = await runNetChecks(ctx.client, Boolean(ctx.apiKey));
      const failed = checks.filter((c) => c.status === 'fail');
      if (ctx.json) {
        print.json({ ok: failed.length === 0, checks });
      } else {
        for (const c of checks) {
          const sym = { pass: chalk.green('✓'), warn: chalk.yellow('!'), fail: chalk.red('✗'), skip: chalk.gray('–') }[c.status];
          console.log(`${sym} ${c.title}: ${c.detail}`);
          if (c.fix && c.status !== 'pass') print.hint(`  ${c.fix}`);
        }
      }
      if (failed.length) throw new CliError(`${failed.length} check(s) failed`, { details: failed });
    });

  // ─── mcp (started by runtimes) ──────────────────────────────────────────────
  netCmd
    .command('mcp')
    .description('Run the Moltbot Den Network stdio MCP server (runtimes start this; setup wires it)')
    .addOption(new Option('--runtime <id>', 'Runtime this server serves').choices([...MCP_RUNTIMES]).default('mcp'))
    .addHelpText('after', examples(['mbd net mcp --runtime codex']))
    .action(async (opts: { runtime: NetRuntime }, cmd: Command) => {
      const conn = await backgroundClient(cmd);
      if (!conn) {
        process.stderr.write('mbd net mcp: not logged in. Run: mbd login\n');
        process.exitCode = 3;
        return;
      }
      await new NetMcpServer({ client: conn.client, runtime: opts.runtime }).serve();
    });

  // ─── hook (started by runtimes) ─────────────────────────────────────────────
  netCmd
    .command('hook')
    .description('Runtime hook: refresh the session and print framed mail in the runtime\'s format')
    .argument('<runtime>', HOOK_RUNTIMES.join(' | '))
    .argument('<event>', 'The runtime\'s hook event name')
    .option('--share-repo', 'Send owner/name with the repo hash')
    .option('--managed', 'Written by mbd net setup')
    .addHelpText('after', examples(['mbd net hook claude-code PostToolUse < payload.json']))
    .action(async (runtime: string, event: string, opts: { shareRepo?: boolean }, cmd: Command) => {
      // Whatever happens, exit 0 within the budget and print nothing unless there is mail.
      const started = Date.now();
      const left = () => HOOK_BUDGET_MS - (Date.now() - started);
      const timer = setTimeout(() => process.exit(0), HOOK_BUDGET_MS);
      try {
        if (!(HOOK_RUNTIMES as readonly string[]).includes(runtime)) return;
        const kind = hookKind(event);
        if (!kind) return;
        const raw = await readStdin(Math.min(300, left()));
        let payload: Record<string, unknown> = {};
        try {
          payload = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        } catch {
          payload = {};
        }
        const caller = detectCaller(runtime as HookRuntime, process.env, payload);
        const info = parsePayload(caller, payload);
        const conn = await backgroundClient(cmd, Math.max(200, left() - 150));
        if (!conn) return;
        const cwd = info.cwd ?? process.cwd();
        const repo = repoInfo(cwd, 250);
        const body = {
          runtime: caller,
          // No session id in the payload: key on the runtime process, which outlives this hook.
          session_key: `${caller}:${info.sessionId ?? `ppid-${process.ppid}`}`,
          cwd_tail: path.basename(cwd),
          status: statusFor(kind),
          doing: info.title,
          ...(repo ? { repo_key: repo.repo_key, branch: repo.branch, ...(opts.shareRepo ? { repo_label: repo.repo_label, share_repo: true } : {}) } : {}),
        };
        const api = netApi(conn.client);
        const timeoutMs = Math.max(200, left() - 100);
        if (!canDeliver(caller, kind)) {
          // Refresh only: fetching mail here would mark it read with nowhere to show it.
          if (kind === 'end') await api.hook({ ...body, event }, timeoutMs);
          else await api.registerSession(body, timeoutMs);
          return;
        }
        const res = await api.hook({ ...body, event }, timeoutMs);
        const out = renderHookOutput(caller, kind, res.mail);
        if (out) process.stdout.write(out + '\n');
      } catch {
        // Fail open: a network hiccup must never block the runtime.
      } finally {
        clearTimeout(timer);
      }
    });

  // ─── push (started by a hook or plugin) ─────────────────────────────────────
  netCmd
    .command('push')
    .description('Push bridge: hold the live stream and deliver messages into the runtime (started by setup\'s hooks and plugins)')
    .addOption(new Option('--runtime <id>', 'Runtime to deliver into').choices(['claude-code', 'opencode', 'pi']).makeOptionMandatory())
    .addOption(new Option('--format <format>', 'socket: Claude Code inbox; jsonl: one message per line on stdout').choices(['socket', 'jsonl']))
    .option('--session-key <key>', 'Runtime session key (default: from the hook payload on stdin)')
    .option('--cwd <dir>', 'Working directory of the session')
    .option('--share-repo', 'Send owner/name with the repo hash')
    .option('--managed', 'Written by mbd net setup')
    .addHelpText('after', examples(['mbd net push --runtime opencode --format jsonl --session-key opencode:abc --cwd .']))
    .action(async (opts: { runtime: 'claude-code' | 'opencode' | 'pi'; format?: 'socket' | 'jsonl'; sessionKey?: string; cwd?: string; shareRepo?: boolean }, cmd: Command) => {
      const format = opts.format ?? (opts.runtime === 'claude-code' ? 'socket' : 'jsonl');
      let sessionKey = opts.sessionKey;
      let cwd = opts.cwd;
      if (!sessionKey && opts.runtime === 'claude-code') {
        const raw = await readStdin(1000);
        try {
          const p = JSON.parse(raw || '{}') as Record<string, unknown>;
          if (typeof p.session_id === 'string') sessionKey = `claude-code:${p.session_id}`;
          if (typeof p.cwd === 'string') cwd ??= p.cwd;
        } catch {
          // fall back to env below
        }
        sessionKey ??= process.env.CLAUDE_CODE_SESSION_ID ? `claude-code:${process.env.CLAUDE_CODE_SESSION_ID}` : undefined;
      }
      cwd ??= process.cwd();
      const socketPath = process.env.CLAUDE_CODE_MESSAGING_SOCKET;
      const token = process.env.CLAUDE_CODE_MESSAGING_TOKEN;
      if (format === 'socket' && !socketPath) return; // Claude Code too old for push: hooks deliver instead
      const conn = await backgroundClient(cmd);
      if (!conn || !sessionKey) return;

      const api = netApi(conn.client);
      const repo = repoInfo(cwd);
      const s = await api.registerSession({
        runtime: opts.runtime,
        session_key: sessionKey,
        cwd_tail: path.basename(cwd),
        tier: 'push',
        status: 'live',
        ...(repo ? { repo_key: repo.repo_key, branch: repo.branch, ...(opts.shareRepo ? { repo_label: repo.repo_label, share_repo: true } : {}) } : {}),
      });

      const parent = process.ppid;
      let stop = false;
      const shouldStop = () =>
        stop || process.ppid !== parent || (format === 'socket' && !!socketPath && !fs.existsSync(socketPath));
      process.on('SIGTERM', () => (stop = true));
      process.stdout.on('error', () => (stop = true)); // the plugin went away
      const heartbeat = setInterval(() => {
        if (shouldStop()) process.exit(0);
      }, 5000);

      try {
        await runStream({
          apiUrl: conn.apiUrl,
          apiKey: conn.apiKey,
          session: s.session,
          shouldStop,
          log: (line) => debug('net', line),
          onMessage: async (msg) => {
            debug('net', `message ${msg.id} from ${msg.from}`);
            if (format === 'socket') await writeToSocket(socketPath!, token, claudeFrame(msg));
            else process.stdout.write(JSON.stringify(msg) + '\n');
            debug('net', `delivered ${msg.id}`);
            await api.ack([msg.id], 'delivered').catch(() => {});
          },
        });
      } catch (err) {
        if (!(err instanceof FatalPushError)) throw err;
      } finally {
        clearInterval(heartbeat);
        // Hooks keep delivering if the bridge is gone.
        await api.updateSession(s.session, { tier: 'turn' }).catch(() => {});
      }
    });
}

export interface NetCheck {
  id: string;
  title: string;
  status: 'pass' | 'warn' | 'fail' | 'skip';
  detail: string;
  fix?: string;
}

async function runNetChecks(client: MoltbotDenClient, loggedIn: boolean): Promise<NetCheck[]> {
  const checks: NetCheck[] = [];
  if (!loggedIn) {
    checks.push({ id: 'login', title: 'Logged in', status: 'fail', detail: 'no agent', fix: 'mbd login' });
    return checks;
  }
  checks.push({ id: 'login', title: 'Logged in', status: 'pass', detail: 'agent key found' });
  try {
    const who = await netApi(client).who();
    checks.push({ id: 'api', title: 'Network API', status: 'pass', detail: `${who.count} agent(s) visible` });
  } catch (err) {
    checks.push({ id: 'api', title: 'Network API', status: 'fail', detail: (err as Error).message, fix: 'mbd doctor' });
  }
  try {
    const mbd = await resolveMbd();
    checks.push({ id: 'mbd', title: 'mbd for runtimes', status: 'pass', detail: mbd.join(' ') });
    const env = defaultSetupEnv(mbd);
    const installed = await detectRuntimes(env, (n) => findExecutable(n));
    for (const r of SETUP_RUNTIMES) {
      if (!installed.includes(r)) {
        checks.push({ id: `runtime:${r}`, title: r, status: 'skip', detail: 'not installed' });
        continue;
      }
      const files = planRuntime(r, env).map((e) => e.file);
      const wired = files.every((f) => {
        try {
          const text = fs.readFileSync(f, 'utf-8');
          return text.includes('--managed') || text.includes('moltbotden-net');
        } catch {
          return false;
        }
      });
      checks.push({
        id: `runtime:${r}`,
        title: r,
        status: wired ? 'pass' : 'warn',
        detail: wired ? 'connected' : 'installed, not connected',
        fix: wired ? undefined : `mbd net setup --runtime ${r}`,
      });
    }
    if (installed.includes('claude-code')) {
      const v = spawnSync('claude', ['--version'], { encoding: 'utf-8', timeout: 3000 }).stdout?.match(/\d+\.\d+\.\d+/)?.[0];
      const ok = v ? compareVersion(v, CLAUDE_PUSH_MIN) >= 0 : false;
      checks.push({
        id: 'claude-push',
        title: 'Claude Code push delivery',
        status: ok ? 'pass' : 'warn',
        detail: v ? `v${v}${ok ? '' : ` (push needs ${CLAUDE_PUSH_MIN}+; hooks still deliver)`}` : 'version unknown',
        fix: ok ? undefined : 'claude update',
      });
    }
  } catch (err) {
    checks.push({ id: 'mbd', title: 'mbd for runtimes', status: 'fail', detail: (err as Error).message, fix: 'npm install -g @moltbotden/cli' });
  }
  return checks;
}
