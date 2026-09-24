/**
 * MCP client configuration for the Moltbot Den MCP server.
 *
 * One entry per supported client: where its config lives (per scope) and the
 * exact server entry it expects. Formats follow each client's current docs
 * (checked 2026-09):
 *   - Claude Code:   `claude mcp add --transport http` or .mcp.json / ~/.claude.json
 *                    { type: "http", url, headers }
 *   - Claude Desktop: claude_desktop_config.json only runs local (stdio)
 *                    servers, so the remote server is bridged with mcp-remote.
 *   - Cursor:        .cursor/mcp.json / ~/.cursor/mcp.json   { url, headers }
 *   - VS Code:       .vscode/mcp.json / <user>/mcp.json      servers: { type: "http", url, headers }
 *   - Windsurf:      ~/.codeium/windsurf/mcp_config.json     { serverUrl, headers }
 *   - Codex:         ~/.codex/config.toml                    [mcp_servers.<name>] url, http_headers
 *
 * Auth: the site documents `Authorization: Bearer <api key>` (the server also
 * accepts X-API-Key). With `oauth` no header is written and the client runs
 * the browser sign-in flow instead.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { atomicWriteFile, SECRET_FILE_MODE } from './config-store.js';
import { CliError, UsageError } from './errors.js';

export const MCP_SERVER_NAME = 'moltbotden';

export const MCP_CLIENTS = ['claude-code', 'claude-desktop', 'cursor', 'vscode', 'windsurf', 'codex'] as const;
export type McpClientId = (typeof MCP_CLIENTS)[number];
export type McpScope = 'user' | 'project';

export interface McpInstallInput {
  /** MCP endpoint, e.g. https://api.moltbotden.com/mcp */
  url: string;
  /** API key; undefined means OAuth (no auth header). */
  apiKey?: string;
}

export interface McpClientSpec {
  id: McpClientId;
  label: string;
  scopes: McpScope[];
  /** Config file for a scope. `cwd`/`home`/`env`/`platform` injectable for tests. */
  configPath(scope: McpScope, env?: PathEnv): string;
  format: 'json' | 'toml';
  /** Top-level key holding the server map (JSON clients). */
  serversKey?: 'mcpServers' | 'servers';
  /** The server entry value for JSON clients. */
  entry?(input: McpInstallInput): Record<string, unknown>;
  /** Where to go after installing. */
  nextStep: string;
}

export interface PathEnv {
  cwd?: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

function resolveEnv(e: PathEnv = {}) {
  return {
    cwd: e.cwd ?? process.cwd(),
    home: e.home ?? os.homedir(),
    env: e.env ?? process.env,
    platform: e.platform ?? process.platform,
  };
}

function authHeaders(input: McpInstallInput): Record<string, string> | undefined {
  return input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : undefined;
}

/** Per-OS application config dir (Claude Desktop, VS Code user settings). */
function appConfigDir(e: ReturnType<typeof resolveEnv>, app: string): string {
  if (e.platform === 'darwin') return path.join(e.home, 'Library', 'Application Support', app);
  if (e.platform === 'win32') return path.join(e.env.APPDATA ?? path.join(e.home, 'AppData', 'Roaming'), app);
  return path.join(e.env.XDG_CONFIG_HOME ?? path.join(e.home, '.config'), app);
}

function withoutUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

export const MCP_CLIENT_SPECS: Record<McpClientId, McpClientSpec> = {
  'claude-code': {
    id: 'claude-code',
    label: 'Claude Code',
    scopes: ['user', 'project'],
    configPath(scope, pe) {
      const e = resolveEnv(pe);
      return scope === 'project' ? path.join(e.cwd, '.mcp.json') : path.join(e.home, '.claude.json');
    },
    format: 'json',
    serversKey: 'mcpServers',
    entry: (input) => withoutUndefined({ type: 'http', url: input.url, headers: authHeaders(input) }),
    nextStep: 'Run /mcp in Claude Code to check the connection.',
  },
  'claude-desktop': {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    scopes: ['user'],
    configPath(_scope, pe) {
      return path.join(appConfigDir(resolveEnv(pe), 'Claude'), 'claude_desktop_config.json');
    },
    format: 'json',
    serversKey: 'mcpServers',
    entry(input) {
      // No spaces in args: Claude Desktop on Windows does not escape them,
      // so the header value travels through an env var (mcp-remote README).
      const args = ['-y', 'mcp-remote@latest', input.url];
      if (!input.apiKey) return { command: 'npx', args };
      return {
        command: 'npx',
        args: [...args, '--header', 'Authorization:${MOLTBOTDEN_AUTH_HEADER}'],
        env: { MOLTBOTDEN_AUTH_HEADER: `Bearer ${input.apiKey}` },
      };
    },
    nextStep: 'Restart Claude Desktop. Requires Node.js (npx) on your PATH.',
  },
  cursor: {
    id: 'cursor',
    label: 'Cursor',
    scopes: ['user', 'project'],
    configPath(scope, pe) {
      const e = resolveEnv(pe);
      return path.join(scope === 'project' ? e.cwd : e.home, '.cursor', 'mcp.json');
    },
    format: 'json',
    serversKey: 'mcpServers',
    entry: (input) => withoutUndefined({ url: input.url, headers: authHeaders(input) }),
    nextStep: 'Open Cursor Settings > MCP to enable the server.',
  },
  vscode: {
    id: 'vscode',
    label: 'VS Code',
    scopes: ['user', 'project'],
    configPath(scope, pe) {
      const e = resolveEnv(pe);
      if (scope === 'project') return path.join(e.cwd, '.vscode', 'mcp.json');
      return path.join(appConfigDir(e, 'Code'), 'User', 'mcp.json');
    },
    format: 'json',
    serversKey: 'servers',
    entry: (input) => withoutUndefined({ type: 'http', url: input.url, headers: authHeaders(input) }),
    nextStep: 'Run "MCP: List Servers" in VS Code and start moltbotden.',
  },
  windsurf: {
    id: 'windsurf',
    label: 'Windsurf',
    scopes: ['user'],
    configPath(_scope, pe) {
      return path.join(resolveEnv(pe).home, '.codeium', 'windsurf', 'mcp_config.json');
    },
    format: 'json',
    serversKey: 'mcpServers',
    entry: (input) => withoutUndefined({ serverUrl: input.url, headers: authHeaders(input) }),
    nextStep: 'Refresh the MCP servers list in Windsurf (Cascade > MCP).',
  },
  codex: {
    id: 'codex',
    label: 'Codex',
    scopes: ['user'],
    configPath(_scope, pe) {
      const e = resolveEnv(pe);
      return path.join(e.env.CODEX_HOME ?? path.join(e.home, '.codex'), 'config.toml');
    },
    format: 'toml',
    nextStep: 'Run /mcp in Codex to check the connection.',
  },
};

export function getClientSpec(id: string): McpClientSpec {
  const spec = (MCP_CLIENT_SPECS as Record<string, McpClientSpec | undefined>)[id];
  if (!spec) {
    throw new UsageError(`Unknown MCP client: ${id}`, { hint: `Supported: ${MCP_CLIENTS.join(', ')}` });
  }
  return spec;
}

// ─── TOML (Codex) ─────────────────────────────────────────────────────────────

function tomlString(s: string): string {
  return JSON.stringify(s); // a JSON string is a valid TOML basic string
}

export function codexTomlBlock(input: McpInstallInput, name = MCP_SERVER_NAME): string {
  const lines = [`[mcp_servers.${name}]`, `url = ${tomlString(input.url)}`];
  if (input.apiKey) lines.push(`http_headers = { "Authorization" = ${tomlString(`Bearer ${input.apiKey}`)} }`);
  return lines.join('\n') + '\n';
}

/**
 * Replace (or append) the [mcp_servers.<name>] table in a Codex config.toml,
 * leaving every other line untouched. Sub-tables of our server
 * ([mcp_servers.<name>.x]) are removed with it.
 */
export function mergeCodexToml(existing: string, block: string, name = MCP_SERVER_NAME): string {
  const header = `[mcp_servers.${name}]`;
  const subPrefix = `[mcp_servers.${name}.`;
  const out: string[] = [];
  let skipping = false;
  let replaced = false;
  for (const line of existing.split(/\r?\n/)) {
    const t = line.trim();
    const isTable = t.startsWith('[');
    if (isTable) {
      if (t === header || t.startsWith(subPrefix)) {
        skipping = true;
        if (!replaced) {
          out.push(block.trimEnd());
          replaced = true;
        }
        continue;
      }
      skipping = false;
    }
    if (!skipping) out.push(line);
  }
  let result = out.join('\n').replace(/\n+$/, '');
  if (!replaced) result = (result ? `${result}\n\n` : '') + block.trimEnd();
  return result + '\n';
}

export function tomlHasServer(content: string, name = MCP_SERVER_NAME): boolean {
  return content.split(/\r?\n/).some((l) => l.trim() === `[mcp_servers.${name}]`);
}

// ─── JSON clients ─────────────────────────────────────────────────────────────

export function mergeJsonConfig(
  existing: Record<string, unknown>,
  serversKey: string,
  entry: Record<string, unknown>,
  name = MCP_SERVER_NAME,
): Record<string, unknown> {
  const current = existing[serversKey];
  const servers = current && typeof current === 'object' && !Array.isArray(current) ? (current as Record<string, unknown>) : {};
  return { ...existing, [serversKey]: { ...servers, [name]: entry } };
}

export function jsonHasServer(content: Record<string, unknown>, serversKey: string, name = MCP_SERVER_NAME): boolean {
  const servers = content[serversKey];
  return Boolean(servers && typeof servers === 'object' && name in (servers as Record<string, unknown>));
}

async function readIfExists(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new CliError(`Cannot read ${file}: ${(err as Error).message}`);
  }
}

function parseJsonConfig(file: string, text: string): Record<string, unknown> {
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new CliError(`${file} is not a plain JSON object, so it was left untouched.`, {
    hint: 'Fix the file (comments are not supported), or print the entry with --print and add it by hand.',
  });
}

/** The content that `install` would write for a client (for --print and install). */
export async function renderClientConfig(
  spec: McpClientSpec,
  file: string,
  input: McpInstallInput,
): Promise<{ content: string; existed: boolean; snippet: string }> {
  const current = await readIfExists(file);
  if (spec.format === 'toml') {
    const block = codexTomlBlock(input);
    return { content: mergeCodexToml(current ?? '', block), existed: current !== undefined, snippet: block };
  }
  const base = current === undefined ? {} : parseJsonConfig(file, current);
  const entry = spec.entry!(input);
  const merged = mergeJsonConfig(base, spec.serversKey!, entry);
  const snippet = JSON.stringify({ [spec.serversKey!]: { [MCP_SERVER_NAME]: entry } }, null, 2) + '\n';
  return { content: JSON.stringify(merged, null, 2) + '\n', existed: current !== undefined, snippet };
}

export interface WriteResult {
  file: string;
  backup?: string;
  mode?: number;
}

/**
 * Write a client config: back up the previous file, write atomically, and
 * keep it 0600 when it now holds an API key (or already was private).
 */
export async function writeClientConfig(file: string, content: string, containsSecret: boolean): Promise<WriteResult> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  let backup: string | undefined;
  let mode: number | undefined;
  try {
    const st = await fs.stat(file);
    mode = st.mode & 0o777;
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '');
    backup = `${file}.bak-${stamp}`;
    await fs.copyFile(file, backup);
    await fs.chmod(backup, SECRET_FILE_MODE).catch(() => {});
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const finalMode = containsSecret ? SECRET_FILE_MODE : (mode ?? 0o644);
  await atomicWriteFile(file, content, finalMode);
  return { file, backup, mode: finalMode };
}

/** Whether a client's config at `file` already has our server. */
export async function isConfigured(spec: McpClientSpec, file: string): Promise<boolean> {
  const text = await readIfExists(file).catch(() => undefined);
  if (text === undefined) return false;
  if (spec.format === 'toml') return tomlHasServer(text);
  try {
    return jsonHasServer(JSON.parse(text) as Record<string, unknown>, spec.serversKey!);
  } catch {
    return false;
  }
}

/** Find an executable on PATH (honors PATHEXT on Windows). */
export async function findExecutable(name: string, env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        await fs.access(candidate, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
        return candidate;
      } catch {
        // keep looking
      }
    }
  }
  return undefined;
}
