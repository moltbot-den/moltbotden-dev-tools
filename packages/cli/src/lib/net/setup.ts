/**
 * `mbd net setup`: wire each installed runtime to Moltbot Den Network.
 *
 * Every runtime is a list of file edits. Each edit can add our entries to a
 * file and take them out again. Before setup first changes a file, its exact
 * bytes (or its absence) are recorded in <config dir>/net-setup.json, so
 * `--remove` restores every file byte for byte. If a file changed after setup
 * wrote it, `--remove` takes only our entries out and keeps the user's edits.
 *
 * Safety rules, each from a way this can go wrong:
 * - The record is written before the file, so a crash between the two can
 *   still be undone.
 * - Re-running setup over a file the user edited since takes the edited
 *   version as the new original, so `--remove` never rolls those edits back.
 * - Symlinked configs (dotfile managers) are edited at their real path.
 * - One setup or remove runs at a time (lock file), and a file that changes
 *   while setup works on it is re-read and re-applied.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureConfigDir, getConfigDir } from '../config-store.js';
import { CliError } from '../errors.js';
import { opencodePlugin, piExtension, skillMarkdown } from './templates.js';

export const SETUP_RUNTIMES = ['claude-code', 'codex', 'cursor', 'gemini-cli', 'copilot-cli', 'opencode', 'pi', 'openclaw'] as const;
export type SetupRuntime = (typeof SETUP_RUNTIMES)[number];

export const NET_SERVER = 'moltbotden-net';
/** Marks every hook command setup writes, so removal finds exactly ours. */
export const MANAGED = '--managed';

export interface SetupEnv {
  home: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  /** How to run mbd: [command, ...leading args], e.g. ["/usr/local/bin/mbd"]. */
  mbd: string[];
  /** Send the plaintext owner/name with the repo hash. */
  shareRepo?: boolean;
  /** Send edited file paths in plaintext with their hashes. */
  sharePaths?: boolean;
}

export interface FileEdit {
  file: string;
  /** New content for the file given its current content (undefined = absent). */
  apply(current: string | undefined): string;
  /** Content with our entries removed; null deletes the file. */
  remove(current: string): string | null;
}

// ─── command strings ─────────────────────────────────────────────────────────

/** POSIX sh quoting. */
function quoteSh(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** cmd.exe quoting (Windows hooks run through cmd or a cmd-compatible shell). */
function quoteCmd(arg: string): string {
  const escaped = arg.replace(/%/g, '%%');
  return /^[\w@+=:,./\\-]+$/.test(escaped) ? escaped : `"${escaped.replace(/"/g, '""')}"`;
}

/** PowerShell: call operator plus single-quoted strings. */
function powershell(argv: string[]): string {
  return '& ' + argv.map((a) => `'${a.replace(/'/g, "''")}'`).join(' ');
}

export function shell(e: Pick<SetupEnv, 'mbd' | 'platform'>, args: string[]): string {
  const argv = [...e.mbd, ...args];
  return argv.map(e.platform === 'win32' ? quoteCmd : quoteSh).join(' ');
}

function isOurs(command: unknown): boolean {
  return typeof command === 'string' && command.includes(MANAGED) && /\bnet'? '?(hook|push)\b/.test(command);
}

// ─── JSON ─────────────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;

function parseJson(file: string, text: string | undefined): Json {
  if (text === undefined || !text.trim()) return {};
  try {
    const v = JSON.parse(text.replace(/^﻿/, '')) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Json;
  } catch {
    // fall through
  }
  throw new CliError(`${file} is not plain JSON, so it was left untouched.`, {
    hint: 'Fix the file (comments are not supported), or skip this runtime with --runtime.',
  });
}

function dump(v: Json): string {
  return JSON.stringify(v, null, 2) + '\n';
}

function obj(v: unknown): Json {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};
}

/** An edit that sets `container[key][NET_SERVER] = entry` in a JSON file. */
function jsonServerEdit(file: string, key: string, entry: Json): FileEdit {
  return {
    file,
    apply(current) {
      const data = parseJson(file, current);
      return dump({ ...data, [key]: { ...obj(data[key]), [NET_SERVER]: entry } });
    },
    remove(current) {
      const data = parseJson(file, current);
      const servers = { ...obj(data[key]) };
      delete servers[NET_SERVER];
      const out = { ...data };
      if (Object.keys(servers).length) out[key] = servers;
      else delete out[key];
      return dump(out);
    },
  };
}

/** A file setup owns entirely. */
function wholeFile(file: string, content: string): FileEdit {
  return { file, apply: () => content, remove: () => null };
}

type HookGroup = { matcher?: string; hooks: Json[] };

/**
 * Claude Code / Codex / Gemini hook layout: hooks.<Event> = [{ matcher?, hooks: [handler] }].
 * Ours is one matcher group per event, so removal drops our handlers and any group left empty.
 */
function groupedHooksEdit(file: string, events: Record<string, HookGroup>): FileEdit {
  const strip = (hooks: Json): Json => {
    const out: Json = {};
    for (const [event, groups] of Object.entries(hooks)) {
      if (!Array.isArray(groups)) {
        out[event] = groups;
        continue;
      }
      const kept = groups
        .map((g) => {
          const group = obj(g);
          const handlers = Array.isArray(group.hooks) ? group.hooks.filter((h) => !isOurs(obj(h).command)) : group.hooks;
          return { ...group, hooks: handlers };
        })
        .filter((g) => !Array.isArray(g.hooks) || g.hooks.length > 0);
      if (kept.length) out[event] = kept;
    }
    return out;
  };
  return {
    file,
    apply(current) {
      const data = parseJson(file, current);
      const hooks = strip(obj(data.hooks));
      for (const [event, group] of Object.entries(events)) {
        hooks[event] = [...(Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : []), group];
      }
      return dump({ ...data, hooks });
    },
    remove(current) {
      const data = parseJson(file, current);
      const hooks = strip(obj(data.hooks));
      const out = { ...data };
      if (Object.keys(hooks).length) out.hooks = hooks;
      else delete out.hooks;
      return dump(out);
    },
  };
}

/** Cursor layout: { version: 1, hooks: { event: [handler] } }. */
function flatHooksEdit(file: string, events: Record<string, Json>, commandKeys: string[] = ['command']): FileEdit {
  const ours = (h: unknown) => commandKeys.some((k) => isOurs(obj(h)[k]));
  const strip = (hooks: Json): Json => {
    const out: Json = {};
    for (const [event, handlers] of Object.entries(hooks)) {
      const kept = Array.isArray(handlers) ? handlers.filter((h) => !ours(h)) : handlers;
      if (!Array.isArray(kept) || kept.length) out[event] = kept;
    }
    return out;
  };
  return {
    file,
    apply(current) {
      const data = parseJson(file, current);
      const hooks = strip(obj(data.hooks));
      for (const [event, handler] of Object.entries(events)) {
        hooks[event] = [...(Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : []), handler];
      }
      return dump({ version: 1, ...data, hooks });
    },
    remove(current) {
      const data = parseJson(file, current);
      return dump({ ...data, hooks: strip(obj(data.hooks)) });
    },
  };
}

// ─── TOML (Codex) ─────────────────────────────────────────────────────────────

/** A table header line for our server or one of its sub-tables, tolerant of quotes, spaces and a trailing comment. */
const OUR_TABLE = new RegExp(`^\\s*\\[\\s*mcp_servers\\s*\\.\\s*"?${NET_SERVER}"?\\s*(\\.[^\\]]*)?\\]\\s*(#.*)?$`);
/** Any table header line: `[a.b]` / `[[a.b]]`, key characters only (an array literal line has commas or values). */
const ANY_TABLE = /^\s*\[{1,2}\s*[A-Za-z0-9_."' -]+\s*\]{1,2}\s*(#.*)?$/;

function eolOf(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/** Remove our [mcp_servers.moltbotden-net] table (and sub-tables), keeping every other byte's line. */
export function removeCodexServer(existing: string): string {
  const eol = eolOf(existing);
  const lines = existing.split(/\r?\n/);
  const out: string[] = [];
  let skipping = false;
  let inMultiline: '"""' | "'''" | null = null;
  for (const line of lines) {
    if (!inMultiline && ANY_TABLE.test(line)) skipping = OUR_TABLE.test(line);
    if (!skipping) out.push(line);
    for (const q of ['"""', "'''"] as const) {
      const n = line.split(q).length - 1;
      if (n % 2 === 1) inMultiline = inMultiline === q ? null : inMultiline ?? q;
    }
  }
  // Drop blank lines left at the end where our table was, but nowhere else.
  while (out.length > 1 && out[out.length - 1] === '' && out[out.length - 2] === '') out.pop();
  return out.join(eol);
}

function addCodexServer(existing: string | undefined, block: string): string {
  const base = existing === undefined ? '' : removeCodexServer(existing);
  const eol = existing ? eolOf(existing) : '\n';
  const trimmed = base.replace(/(\r?\n)+$/, '');
  return (trimmed ? trimmed + eol + eol : '') + block.split('\n').join(eol) + (block.endsWith('\n') ? '' : eol);
}

function tomlString(s: string): string {
  return JSON.stringify(s); // TOML basic strings use JSON-compatible escapes
}

// ─── runtimes ─────────────────────────────────────────────────────────────────

export function runtimeConfigDir(runtime: SetupRuntime, e: Pick<SetupEnv, 'home' | 'env'>): string {
  switch (runtime) {
    case 'claude-code':
      return path.join(e.home, '.claude');
    case 'codex':
      return e.env.CODEX_HOME ?? path.join(e.home, '.codex');
    case 'cursor':
      return path.join(e.home, '.cursor');
    case 'gemini-cli':
      return path.join(e.home, '.gemini');
    case 'copilot-cli':
      return e.env.COPILOT_HOME ?? path.join(e.home, '.copilot');
    case 'opencode':
      return path.join(e.env.XDG_CONFIG_HOME ?? path.join(e.home, '.config'), 'opencode');
    case 'pi':
      return path.join(e.home, '.pi');
    case 'openclaw':
      return path.join(e.home, '.openclaw');
  }
}

export const RUNTIME_BINARY: Record<SetupRuntime, string> = {
  'claude-code': 'claude',
  codex: 'codex',
  cursor: 'cursor-agent',
  'gemini-cli': 'gemini',
  'copilot-cli': 'copilot',
  opencode: 'opencode',
  pi: 'pi',
  openclaw: 'openclaw',
};

/** The file edits that connect one runtime. */
export function planRuntime(runtime: SetupRuntime, e: SetupEnv): FileEdit[] {
  const dir = runtimeConfigDir(runtime, e);
  const extra = [...(e.shareRepo ? ['--share-repo'] : []), ...(e.sharePaths ? ['--share-paths'] : [])];
  const hookArgs = (event: string) => ['net', 'hook', runtime, event, ...extra, MANAGED];
  const hook = (event: string) => shell(e, hookArgs(event));
  const mcpArgs = [...e.mbd.slice(1), 'net', 'mcp', '--runtime', runtime];
  const command = e.mbd[0];

  switch (runtime) {
    case 'claude-code': {
      const handler = (event: string): Json => ({ type: 'command', command: hook(event), timeout: 5 });
      return [
        jsonServerEdit(path.join(e.home, '.claude.json'), 'mcpServers', { type: 'stdio', command, args: mcpArgs }),
        groupedHooksEdit(path.join(dir, 'settings.json'), {
          SessionStart: {
            hooks: [
              handler('SessionStart'),
              // Long-lived push bridge; async so the session does not wait on it.
              { type: 'command', command: shell(e, ['net', 'push', '--runtime', 'claude-code', ...extra, MANAGED]), async: true },
            ],
          },
          UserPromptSubmit: { hooks: [handler('UserPromptSubmit')] },
          PostToolUse: { matcher: '*', hooks: [handler('PostToolUse')] },
          Stop: { hooks: [handler('Stop')] },
          SessionEnd: { hooks: [handler('SessionEnd')] },
        }),
        wholeFile(path.join(dir, 'skills', 'moltbotden-network', 'SKILL.md'), skillMarkdown()),
      ];
    }
    case 'codex': {
      const handler = (event: string): HookGroup => ({ hooks: [{ type: 'command', command: hook(event), timeout: 5 }] });
      const block = `[mcp_servers.${NET_SERVER}]\ncommand = ${tomlString(command)}\nargs = [${mcpArgs.map(tomlString).join(', ')}]\n`;
      return [
        {
          file: path.join(dir, 'config.toml'),
          apply: (current) => addCodexServer(current, block),
          remove: (current) => removeCodexServer(current),
        },
        groupedHooksEdit(path.join(dir, 'hooks.json'), {
          SessionStart: handler('SessionStart'),
          UserPromptSubmit: handler('UserPromptSubmit'),
          PostToolUse: handler('PostToolUse'),
          Stop: handler('Stop'),
          SessionEnd: handler('SessionEnd'),
        }),
      ];
    }
    case 'cursor': {
      const handler = (event: string): Json => ({ command: hook(event), timeout: 5 });
      return [
        jsonServerEdit(path.join(dir, 'mcp.json'), 'mcpServers', { command, args: mcpArgs }),
        flatHooksEdit(path.join(dir, 'hooks.json'), {
          sessionStart: handler('sessionStart'),
          postToolUse: handler('postToolUse'),
          stop: handler('stop'),
          sessionEnd: handler('sessionEnd'),
        }),
      ];
    }
    case 'gemini-cli': {
      const handler = (event: string, matcher?: string): HookGroup => ({
        ...(matcher ? { matcher } : {}),
        hooks: [{ type: 'command', command: hook(event), name: NET_SERVER, timeout: 5000 }],
      });
      const settings = path.join(dir, 'settings.json');
      const server = jsonServerEdit(settings, 'mcpServers', { command, args: mcpArgs, timeout: 15000 });
      const hooks = groupedHooksEdit(settings, {
        SessionStart: handler('SessionStart'),
        AfterTool: handler('AfterTool', '.*'),
        AfterAgent: handler('AfterAgent'),
        SessionEnd: handler('SessionEnd'),
      });
      // One file, two edits: apply and remove both in sequence.
      return [{
        file: settings,
        apply: (c) => hooks.apply(server.apply(c)),
        remove: (c) => hooks.remove(server.remove(c) ?? ''),
      }];
    }
    case 'copilot-cli': {
      const handler = (event: string): Json => ({
        type: 'command',
        bash: shell({ mbd: e.mbd, platform: 'linux' }, hookArgs(event)),
        powershell: powershell([...e.mbd, ...hookArgs(event)]),
        timeoutSec: 5,
      });
      return [
        jsonServerEdit(path.join(dir, 'mcp-config.json'), 'mcpServers', { type: 'local', command, args: mcpArgs, tools: ['*'] }),
        wholeFile(
          path.join(dir, 'hooks', `${NET_SERVER}.json`),
          dump({
            version: 1,
            hooks: {
              sessionStart: [handler('sessionStart')],
              postToolUse: [handler('postToolUse')],
              agentStop: [handler('agentStop')],
              sessionEnd: [handler('sessionEnd')],
            },
          }),
        ),
      ];
    }
    case 'opencode':
      return [
        jsonServerEdit(path.join(dir, 'opencode.json'), 'mcp', {
          type: 'local',
          command: [...e.mbd, 'net', 'mcp', '--runtime', 'opencode'],
          enabled: true,
        }),
        wholeFile(path.join(dir, 'plugins', `${NET_SERVER}.js`), opencodePlugin(e.mbd)),
      ];
    case 'pi':
      return [wholeFile(path.join(dir, 'agent', 'extensions', `${NET_SERVER}.ts`), piExtension(e.mbd))];
    case 'openclaw':
      // OpenClaw's config is JSON5; its MCP entry is set with `openclaw mcp set`
      // (printed by setup), so only the skill file is written here.
      return [wholeFile(path.join(e.home, '.agents', 'skills', 'moltbotden-network', 'SKILL.md'), skillMarkdown())];
  }
}

/** The `openclaw mcp set` command that registers the MCP server (POSIX shell). */
export function openclawMcpCommand(e: SetupEnv): string {
  const entry = JSON.stringify({ command: e.mbd[0], args: [...e.mbd.slice(1), 'net', 'mcp', '--runtime', 'openclaw'] });
  return `openclaw mcp set ${NET_SERVER} ${quoteSh(entry)}`;
}

// ─── state: original bytes for byte-for-byte removal ─────────────────────────

interface FileRecord {
  runtime: SetupRuntime;
  /** Index of the edit in planRuntime(runtime), so removal works even if paths moved. */
  edit: number;
  existed: boolean;
  /** Original bytes, base64 (absent when the file did not exist). */
  original?: string;
  /** sha256 of what setup last wrote. */
  written: string;
  mode?: number;
}

interface SetupState {
  version: 1;
  files: Record<string, FileRecord>;
  /** Directories setup created, removed again if empty. */
  dirs: string[];
}

export function statePath(): string {
  return path.join(getConfigDir(), 'net-setup.json');
}

async function readState(): Promise<SetupState> {
  try {
    const data = JSON.parse(await fs.readFile(statePath(), 'utf-8')) as SetupState;
    return { version: 1, files: data.files ?? {}, dirs: data.dirs ?? [] };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, files: {}, dirs: [] };
    throw new CliError(`Cannot read ${statePath()}: ${(err as Error).message}`);
  }
}

async function writeBytes(file: string, data: Buffer | string, mode: number): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fs.writeFile(tmp, data, { mode, flag: 'wx' });
    await fs.chmod(tmp, mode).catch(() => {});
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}

async function writeState(state: SetupState): Promise<void> {
  if (!Object.keys(state.files).length && !state.dirs.length) {
    await fs.rm(statePath(), { force: true });
    return;
  }
  await ensureConfigDir();
  await writeBytes(statePath(), JSON.stringify(state, null, 2) + '\n', 0o600);
}

/** Run `fn` holding the setup lock, so two setups never interleave. */
async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  await ensureConfigDir();
  const lock = path.join(getConfigDir(), 'net-setup.lock');
  try {
    await fs.writeFile(lock, String(process.pid), { flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    const pid = Number(await fs.readFile(lock, 'utf-8').catch(() => ''));
    let alive = false;
    try {
      if (pid) process.kill(pid, 0);
      alive = Boolean(pid);
    } catch {
      alive = false;
    }
    if (alive) throw new CliError('Another mbd net setup is running.', { hint: 'Wait for it to finish, then retry.' });
    await fs.writeFile(lock, String(process.pid)); // stale lock from a crashed run
  }
  try {
    return await fn();
  } finally {
    await fs.rm(lock, { force: true });
  }
}

function sha(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

async function readBytes(file: string): Promise<Buffer | undefined> {
  try {
    return await fs.readFile(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

/** The real path of a config file (follows symlinks of the file and its directories). */
async function realFile(file: string): Promise<string> {
  try {
    return await fs.realpath(file);
  } catch {
    try {
      return path.join(await fs.realpath(path.dirname(file)), path.basename(file));
    } catch {
      return file;
    }
  }
}

/** Create missing parent directories, returning the ones created. */
async function mkdirs(dir: string): Promise<string[]> {
  const created: string[] = [];
  let d = dir;
  while (!(await fs.stat(d).then(() => true, () => false))) {
    created.push(d);
    const parent = path.dirname(d);
    if (parent === d) break;
    d = parent;
  }
  await fs.mkdir(dir, { recursive: true });
  return created;
}

export interface Change {
  runtime: SetupRuntime;
  file: string;
  action: 'created' | 'updated' | 'unchanged' | 'restored' | 'deleted' | 'cleaned' | 'failed';
  error?: string;
}

async function applyEdit(runtime: SetupRuntime, index: number, edit: FileEdit, state: SetupState): Promise<Change> {
  const file = await realFile(edit.file);
  for (let attempt = 0; ; attempt++) {
    const before = await readBytes(file);
    const next = edit.apply(before?.toString('utf-8'));
    if (before !== undefined && before.toString('utf-8') === next) return { runtime, file, action: 'unchanged' };

    const rec = state.files[file];
    const mode = before ? (await fs.stat(file)).mode & 0o777 : undefined;
    if (!rec) {
      // First touch: what is there now is the original to restore.
      state.files[file] = { runtime, edit: index, existed: before !== undefined, original: before?.toString('base64'), written: sha(next), mode };
    } else if ((before !== undefined && sha(before) !== rec.written) || (before === undefined && rec.existed)) {
      // The user changed the file since setup last wrote it. Their version,
      // minus our earlier entries, becomes the original, so --remove keeps it.
      const theirs = before === undefined ? null : edit.remove(before.toString('utf-8'));
      state.files[file] = {
        runtime,
        edit: index,
        existed: theirs !== null,
        original: theirs === null ? undefined : Buffer.from(theirs).toString('base64'),
        written: sha(next),
        mode: mode ?? rec.mode,
      };
    } else {
      state.files[file] = { ...rec, runtime, edit: index, written: sha(next) };
    }
    for (const d of await mkdirs(path.dirname(file))) if (!state.dirs.includes(d)) state.dirs.push(d);
    // Record first: a crash after this line can still be undone by --remove.
    await writeState(state);

    // A live writer (Claude Code rewrites ~/.claude.json) may have changed the
    // file meanwhile; re-apply on the fresh content once instead of clobbering it.
    const again = await readBytes(file);
    if ((again === undefined) !== (before === undefined) || (again && before && !again.equals(before))) {
      if (attempt === 0) continue;
      throw new CliError(`${file} keeps changing while setup writes it; close the program using it and retry.`);
    }
    await writeBytes(file, next, state.files[file].mode ?? 0o644);
    return { runtime, file, action: before === undefined ? 'created' : 'updated' };
  }
}

export async function applySetup(runtimes: SetupRuntime[], e: SetupEnv): Promise<Change[]> {
  return withLock(async () => {
    const state = await readState();
    const changes: Change[] = [];
    for (const runtime of runtimes) {
      const edits = planRuntime(runtime, e);
      for (let i = 0; i < edits.length; i++) {
        try {
          changes.push(await applyEdit(runtime, i, edits[i], state));
        } catch (err) {
          // One unreadable file must not leave the other runtimes half done.
          changes.push({ runtime, file: edits[i].file, action: 'failed', error: (err as Error).message });
          break;
        }
      }
    }
    return changes;
  });
}

export async function removeSetup(runtimes: SetupRuntime[] | 'all', e: SetupEnv): Promise<Change[]> {
  return withLock(async () => {
    const state = await readState();
    const changes: Change[] = [];
    for (const [file, rec] of Object.entries(state.files)) {
      if (runtimes !== 'all' && !runtimes.includes(rec.runtime)) continue;
      const original = rec.existed ? Buffer.from(rec.original ?? '', 'base64') : undefined;
      try {
        const current = await readBytes(file);
        if (current === undefined) {
          changes.push({ runtime: rec.runtime, file, action: 'unchanged' });
        } else if (original && current.equals(original)) {
          changes.push({ runtime: rec.runtime, file, action: 'unchanged' }); // setup never got to write it
        } else if (sha(current) === rec.written) {
          // Untouched since setup: put the original bytes back exactly.
          if (original) {
            await writeBytes(file, original, rec.mode ?? 0o644);
            changes.push({ runtime: rec.runtime, file, action: 'restored' });
          } else {
            await fs.rm(file, { force: true });
            changes.push({ runtime: rec.runtime, file, action: 'deleted' });
          }
        } else {
          // Edited since setup: take out only our entries, keep the rest.
          const edit = planRuntime(rec.runtime, e)[rec.edit];
          if (!edit) throw new CliError(`no edit recorded for ${file}`);
          const next = edit.remove(current.toString('utf-8'));
          if (next === null) {
            if (original) await writeBytes(file, original, rec.mode ?? 0o644);
            else await fs.rm(file, { force: true });
            changes.push({ runtime: rec.runtime, file, action: original ? 'restored' : 'deleted' });
          } else {
            await writeBytes(file, next, rec.mode ?? 0o644);
            changes.push({ runtime: rec.runtime, file, action: 'cleaned' });
          }
        }
        delete state.files[file];
      } catch (err) {
        changes.push({ runtime: rec.runtime, file, action: 'failed', error: (err as Error).message });
      }
      await writeState(state); // after each file, so a failure midway resumes cleanly
    }

    // Directories setup created: remove each one no tracked file still needs,
    // deepest first; rmdir only succeeds when the user put nothing else there.
    const needed = (dir: string) => Object.keys(state.files).some((f) => f.startsWith(dir + path.sep));
    for (const dir of [...state.dirs].sort((a, b) => b.length - a.length)) {
      if (!needed(dir)) await fs.rmdir(dir).catch(() => {});
    }
    state.dirs = state.dirs.filter(needed);
    await writeState(state);
    return changes;
  });
}

/** Runtimes that look installed: config dir present or binary on PATH. */
export async function detectRuntimes(
  e: Pick<SetupEnv, 'home' | 'env'>,
  findExecutable: (name: string) => Promise<string | undefined>,
): Promise<SetupRuntime[]> {
  const found: SetupRuntime[] = [];
  for (const runtime of SETUP_RUNTIMES) {
    const dirExists = await fs.stat(runtimeConfigDir(runtime, e)).then(() => true, () => false);
    if (dirExists || (await findExecutable(RUNTIME_BINARY[runtime]))) found.push(runtime);
  }
  return found;
}

export function defaultSetupEnv(mbd: string[], shareRepo = false, sharePaths = false): SetupEnv {
  return { home: os.homedir(), env: process.env, platform: process.platform, mbd, shareRepo, sharePaths };
}
