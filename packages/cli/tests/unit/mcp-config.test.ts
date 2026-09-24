import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MCP_CLIENT_SPECS,
  codexTomlBlock,
  mergeCodexToml,
  mergeJsonConfig,
  renderClientConfig,
  writeClientConfig,
  isConfigured,
} from '../../src/lib/mcp-config.js';
import { parseRpcBody } from '../../src/lib/api/mcp.js';

const input = { url: 'https://api.moltbotden.com/mcp', apiKey: 'moltbotden_sk_x' };
const home = path.join(path.sep, 'home', 'u');
const cwd = path.join(path.sep, 'proj');

describe('client config locations', () => {
  // A wrong path means "installed" but the client never sees the server.
  it.each([
    ['claude-code', 'user', 'linux', path.join(home, '.claude.json')],
    ['claude-code', 'project', 'linux', path.join(cwd, '.mcp.json')],
    ['claude-desktop', 'user', 'darwin', path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')],
    ['claude-desktop', 'user', 'linux', path.join(home, '.config', 'Claude', 'claude_desktop_config.json')],
    ['cursor', 'user', 'linux', path.join(home, '.cursor', 'mcp.json')],
    ['cursor', 'project', 'linux', path.join(cwd, '.cursor', 'mcp.json')],
    ['vscode', 'project', 'linux', path.join(cwd, '.vscode', 'mcp.json')],
    ['vscode', 'user', 'darwin', path.join(home, 'Library', 'Application Support', 'Code', 'User', 'mcp.json')],
    ['windsurf', 'user', 'linux', path.join(home, '.codeium', 'windsurf', 'mcp_config.json')],
    ['codex', 'user', 'linux', path.join(home, '.codex', 'config.toml')],
  ] as const)('%s (%s, %s)', (client, scope, platform, expected) => {
    expect(MCP_CLIENT_SPECS[client].configPath(scope, { home, cwd, platform, env: {} })).toBe(expected);
  });

  it('honors CODEX_HOME and APPDATA', () => {
    expect(MCP_CLIENT_SPECS.codex.configPath('user', { home, env: { CODEX_HOME: '/c' } })).toBe(path.join('/c', 'config.toml'));
    expect(MCP_CLIENT_SPECS['claude-desktop'].configPath('user', { home, platform: 'win32', env: { APPDATA: 'C:\\AppData' } }))
      .toBe(path.join('C:\\AppData', 'Claude', 'claude_desktop_config.json'));
  });
});

describe('server entries match each client format', () => {
  it('uses the field names each client reads', () => {
    expect(MCP_CLIENT_SPECS['claude-code'].entry!(input)).toEqual({ type: 'http', url: input.url, headers: { Authorization: 'Bearer moltbotden_sk_x' } });
    expect(MCP_CLIENT_SPECS.cursor.entry!(input)).toEqual({ url: input.url, headers: { Authorization: 'Bearer moltbotden_sk_x' } });
    expect(MCP_CLIENT_SPECS.vscode.entry!(input)).toMatchObject({ type: 'http', url: input.url });
    expect(MCP_CLIENT_SPECS.vscode.serversKey).toBe('servers');
    // Windsurf reads serverUrl, not url.
    expect(MCP_CLIENT_SPECS.windsurf.entry!(input)).toEqual({ serverUrl: input.url, headers: { Authorization: 'Bearer moltbotden_sk_x' } });
  });

  it('bridges Claude Desktop through mcp-remote with no spaces in args', () => {
    // claude_desktop_config.json only launches local processes; Windows does
    // not escape spaces in args, so the header value travels via env.
    const entry = MCP_CLIENT_SPECS['claude-desktop'].entry!(input) as { command: string; args: string[]; env: Record<string, string> };
    expect(entry.command).toBe('npx');
    expect(entry.args).toContain('mcp-remote@latest');
    expect(entry.args.every((a) => !a.includes(' '))).toBe(true);
    expect(entry.env.MOLTBOTDEN_AUTH_HEADER).toBe('Bearer moltbotden_sk_x');
  });

  it('omits auth entirely for OAuth installs', () => {
    expect(MCP_CLIENT_SPECS.cursor.entry!({ url: input.url })).toEqual({ url: input.url });
    expect(codexTomlBlock({ url: input.url })).not.toContain('Authorization');
  });
});

describe('merging', () => {
  it('keeps other servers and unrelated settings', () => {
    const merged = mergeJsonConfig({ theme: 'dark', mcpServers: { other: { url: 'x' } } }, 'mcpServers', { url: 'y' });
    expect(merged).toEqual({ theme: 'dark', mcpServers: { other: { url: 'x' }, moltbotden: { url: 'y' } } });
  });

  it('replaces our Codex table (and its sub-tables) in place, leaving the rest', () => {
    const existing = [
      'model = "gpt-5"',
      '',
      '[mcp_servers.moltbotden]',
      'url = "old"',
      '',
      '[mcp_servers.moltbotden.env]',
      'X = "1"',
      '',
      '[mcp_servers.other]',
      'command = "x"',
      '',
    ].join('\n');
    const out = mergeCodexToml(existing, codexTomlBlock(input));
    expect(out).toContain('model = "gpt-5"');
    expect(out).toContain('[mcp_servers.other]\ncommand = "x"');
    expect(out).not.toContain('url = "old"');
    expect(out).not.toContain('[mcp_servers.moltbotden.env]');
    expect(out.match(/\[mcp_servers\.moltbotden\]/g)).toHaveLength(1);
    expect(out).toContain('http_headers = { "Authorization" = "Bearer moltbotden_sk_x" }');
  });

  it('appends to a Codex config without our table', () => {
    expect(mergeCodexToml('model = "x"\n', codexTomlBlock({ url: 'u' }))).toBe('model = "x"\n\n[mcp_servers.moltbotden]\nurl = "u"\n');
    expect(mergeCodexToml('', codexTomlBlock({ url: 'u' }))).toBe('[mcp_servers.moltbotden]\nurl = "u"\n');
  });
});

describe('writing', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mbd-mcp-'));

  it('backs up the previous file and writes 0600 when a key is included', async () => {
    const file = path.join(tmp(), 'nested', 'mcp.json');
    fs.mkdirSync(path.dirname(file));
    fs.writeFileSync(file, '{"mcpServers":{}}', { mode: 0o644 });
    const res = await writeClientConfig(file, '{"new":true}\n', true);
    expect(fs.readFileSync(res.backup!, 'utf-8')).toBe('{"mcpServers":{}}');
    expect(fs.readFileSync(file, 'utf-8')).toBe('{"new":true}\n');
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('refuses to rewrite a config that is not plain JSON', async () => {
    const file = path.join(tmp(), 'mcp.json');
    fs.writeFileSync(file, '// comment\n{}');
    await expect(renderClientConfig(MCP_CLIENT_SPECS.cursor, file, input)).rejects.toThrow('left untouched');
  });

  it('detects an installed server', async () => {
    const dir = tmp();
    const json = path.join(dir, 'a.json');
    const toml = path.join(dir, 'config.toml');
    fs.writeFileSync(json, JSON.stringify({ servers: { moltbotden: {} } }));
    fs.writeFileSync(toml, '[mcp_servers.moltbotden]\nurl = "u"\n');
    expect(await isConfigured(MCP_CLIENT_SPECS.vscode, json)).toBe(true);
    expect(await isConfigured(MCP_CLIENT_SPECS.cursor, json)).toBe(false);
    expect(await isConfigured(MCP_CLIENT_SPECS.codex, toml)).toBe(true);
    expect(await isConfigured(MCP_CLIENT_SPECS.codex, path.join(dir, 'missing'))).toBe(false);
  });
});

describe('parseRpcBody', () => {
  it('reads plain JSON and single-event SSE replies', () => {
    expect(parseRpcBody('{"jsonrpc":"2.0","id":1,"result":{"a":1}}')?.result).toEqual({ a: 1 });
    expect(parseRpcBody('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"b":2}}\n\n')?.result).toEqual({ b: 2 });
    expect(parseRpcBody('')).toBeUndefined();
  });
});
