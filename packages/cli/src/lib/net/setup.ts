/**
 * `mbd net setup`: wire each installed runtime to Moltbot Den Network.
 *
 * Every runtime is a list of file edits. Each edit can add our entries to a
 * file and take them out again. Before touching a file the first time, its
 * exact bytes (or its absence) are saved in <config dir>/net-setup.json, so
 * `--remove` restores every file byte for byte. If a file changed after
 * setup wrote it, `--remove` takes only our entries out instead and keeps
 * the user's edits.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { atomicWriteFile, ensureConfigDir, getConfigDir } from '../config-store.js';
import { CliError } from '../errors.js';
import { mergeCodexToml } from '../mcp-config.js';
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
}

export interface FileEdit {
  file: string;
  /** New content for the file given its current content (undefined = absent). */
  apply(current: string | undefined): string;
  /** Content with our entries removed; null deletes the file. */
  remove(current: string): string | null;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function quote(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `"${arg.replace(/(["\\$`])/g, '\\$1')}"`;
}

function shell(e: SetupEnv, args: string[]): string {
  return [...e.mbd, ...args].map(quote).join(' ');
}

function isOurs(command: unknown): boolean {
  return typeof command === 'string' && command.includes(MANAGED) && /\bnet (hook|push)\b/.test(command);
}

type Json = Record<string, unknown>;

function parseJson(file: string, text: string | undefined): Json {
  if (text === undefined || !text.trim()) return {};
  try {
    const v = JSON.parse(text) as unknown;
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
function flatHooksEdit(file: string, events: Record<string, Json>): FileEdit {
  const strip = (hooks: Json): Json => {
    const out: Json = {};
    for (const [event, handlers] of Object.entries(hooks)) {
      const kept = Array.isArray(handlers) ? handlers.filter((h) => !isOurs(obj(h).command)) : handlers;
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

export function removeCodexServer(existing: string, name = NET_SERVER): string {
  const header = `[mcp_servers.${name}]`;
  const sub = `[mcp_servers.${name}.`;
  const out: string[] = [];
  let skipping = false;
  for (const line of existing.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('[')) skipping = t === header || t.startsWith(sub);
    if (!skipping) out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '') + '\n';
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
  const extra = e.shareRepo ? ['--share-repo'] : [];
  const hook = (event: string) => shell(e, ['net', 'hook', runtime, event, ...extra, MANAGED]);
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
      const toml = path.join(dir, 'config.toml');
      return [
        {
          file: toml,
          apply: (current) => mergeCodexToml(current ?? '', block, NET_SERVER),
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
      const handler = (event: string): Json => ({ type: 'command', bash: hook(event), powershell: hook(event), timeoutSec: 5 });
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

/** The `openclaw mcp set` command that registers the MCP server. */
export function openclawMcpCommand(e: SetupEnv): string {
  const entry = JSON.stringify({ command: e.mbd[0], args: [...e.mbd.slice(1), 'net', 'mcp', '--runtime', 'openclaw'] });
  return `openclaw mcp set ${NET_SERVER} '${entry}'`;
}

// ─── state: original bytes for byte-for-byte removal ─────────────────────────

interface FileRecord {
  runtime: SetupRuntime;
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
  /** Directories setup created, deepest first, removed if empty. */
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

async function writeState(state: SetupState): Promise<void> {
  if (!Object.keys(state.files).length && !state.dirs.length) {
    await fs.rm(statePath(), { force: true });
    return;
  }
  await ensureConfigDir();
  await atomicWriteFile(statePath(), JSON.stringify(state, null, 2) + '\n');
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

/** Create missing parent directories, returning the ones created (deepest first). */
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
  action: 'created' | 'updated' | 'unchanged' | 'restored' | 'deleted' | 'cleaned';
}

export async function applySetup(runtimes: SetupRuntime[], e: SetupEnv): Promise<Change[]> {
  const state = await readState();
  const changes: Change[] = [];
  for (const runtime of runtimes) {
    for (const edit of planRuntime(runtime, e)) {
      const before = await readBytes(edit.file);
      const next = edit.apply(before?.toString('utf-8'));
      if (before !== undefined && before.toString('utf-8') === next) {
        changes.push({ runtime, file: edit.file, action: 'unchanged' });
        continue;
      }
      if (!state.files[edit.file]) {
        const mode = before ? (await fs.stat(edit.file)).mode & 0o777 : undefined;
        state.files[edit.file] = {
          runtime,
          existed: before !== undefined,
          original: before?.toString('base64'),
          written: '',
          mode,
        };
      }
      const created = await mkdirs(path.dirname(edit.file));
      for (const d of created) if (!state.dirs.includes(d)) state.dirs.push(d);
      await atomicWriteFile(edit.file, next, state.files[edit.file].mode ?? 0o644);
      state.files[edit.file].written = sha(next);
      await writeState(state); // after each file, so a crash midway can still be undone
      changes.push({ runtime, file: edit.file, action: before === undefined ? 'created' : 'updated' });
    }
  }
  return changes;
}

export async function removeSetup(runtimes: SetupRuntime[] | 'all', e: SetupEnv): Promise<Change[]> {
  const state = await readState();
  const changes: Change[] = [];
  const editsByFile = new Map<string, FileEdit>();
  for (const runtime of SETUP_RUNTIMES) for (const edit of planRuntime(runtime, e)) editsByFile.set(edit.file, edit);

  for (const [file, rec] of Object.entries(state.files)) {
    if (runtimes !== 'all' && !runtimes.includes(rec.runtime)) continue;
    const current = await readBytes(file);
    if (current === undefined) {
      changes.push({ runtime: rec.runtime, file, action: 'unchanged' });
    } else if (sha(current) === rec.written) {
      // Untouched since setup: put the original bytes back exactly.
      if (rec.existed) {
        await fs.writeFile(file, Buffer.from(rec.original ?? '', 'base64'));
        if (rec.mode !== undefined) await fs.chmod(file, rec.mode).catch(() => {});
        changes.push({ runtime: rec.runtime, file, action: 'restored' });
      } else {
        await fs.rm(file, { force: true });
        changes.push({ runtime: rec.runtime, file, action: 'deleted' });
      }
    } else {
      // Edited since setup: take out only our entries, keep the rest.
      const edit = editsByFile.get(file);
      const next = edit ? edit.remove(current.toString('utf-8')) : current.toString('utf-8');
      if (next === null) {
        await fs.rm(file, { force: true });
        changes.push({ runtime: rec.runtime, file, action: 'deleted' });
      } else {
        await atomicWriteFile(file, next, rec.mode ?? 0o644);
        changes.push({ runtime: rec.runtime, file, action: 'cleaned' });
      }
    }
    delete state.files[file];
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

export function defaultSetupEnv(mbd: string[], shareRepo = false): SetupEnv {
  return { home: os.homedir(), env: process.env, platform: process.platform, mbd, shareRepo };
}
