/**
 * `mbd net setup` and `--remove`.
 *
 * Why it matters: setup edits the user's own runtime configs (Claude Code
 * settings, Codex TOML, Cursor hooks, ...). Undoing it must give back exactly
 * what was there, byte for byte, including files that did not exist, and must
 * never take out the user's own servers or hooks.
 */

import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { applySetup, MANAGED, planRuntime, removeSetup, SETUP_RUNTIMES, statePath, type SetupEnv } from '../../src/lib/net/setup.js';
import { makeTempDir } from '../helpers/temp-dir.js';

let home: string;
let env: SetupEnv;

beforeEach(() => {
  home = makeTempDir('net-setup');
  env = { home, env: {}, platform: process.platform, mbd: ['/usr/local/bin/mbd'] };
});

/** Snapshot every file under home except setup's own state. */
function snapshot(): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else out.set(path.relative(home, p), fs.readFileSync(p).toString('base64'));
    }
  };
  walk(home);
  return out;
}

function dirs(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        out.push(path.relative(home, path.join(dir, e.name)));
        walk(path.join(dir, e.name));
      }
    }
  };
  walk(home);
  return out.sort();
}

function write(rel: string, text: string) {
  const p = path.join(home, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}

/** Pre-existing configs with the user's own entries and unusual formatting. */
function seedExistingConfigs() {
  write('.claude.json', '{"mcpServers":{"mine":{"type":"http","url":"https://x"}},"numStartups":3}');
  write('.claude/settings.json', '{\n    "hooks": {\n        "PostToolUse": [{"matcher":"Edit","hooks":[{"type":"command","command":"lint.sh"}]}]\n    },\n    "theme": "dark"\n}\n');
  write('.codex/config.toml', '# my codex config\nmodel = "gpt-6"\n\n[mcp_servers.other]\ncommand = "other"\n');
  write('.cursor/mcp.json', '{"mcpServers":{}}');
  write('.gemini/settings.json', '{"theme":"x"}');
}

describe('setup then --remove', () => {
  it('restores every file byte for byte and removes every file and directory it created', async () => {
    seedExistingConfigs();
    const before = snapshot();
    const beforeDirs = dirs();

    await applySetup([...SETUP_RUNTIMES], env);
    expect(snapshot()).not.toEqual(before);
    expect(fs.existsSync(statePath())).toBe(true);

    await removeSetup('all', env);
    expect(snapshot()).toEqual(before);
    expect(dirs()).toEqual(beforeDirs);
    expect(fs.existsSync(statePath())).toBe(false);
  });

  it('keeps the original bytes when setup runs twice', async () => {
    seedExistingConfigs();
    const before = snapshot();
    await applySetup(['claude-code', 'codex'], env);
    await applySetup(['claude-code', 'codex'], { ...env, shareRepo: true });
    await removeSetup('all', env);
    expect(snapshot()).toEqual(before);
  });

  it('removes only one runtime when asked, leaving the others connected', async () => {
    await applySetup(['cursor', 'codex'], env);
    await removeSetup(['cursor'], env);
    expect(fs.existsSync(path.join(home, '.cursor', 'hooks.json'))).toBe(false);
    expect(fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf-8')).toContain('[mcp_servers.moltbotden-net]');
  });

  it('keeps edits the user made after setup and takes out only our entries', async () => {
    seedExistingConfigs();
    await applySetup(['claude-code'], env);
    const settings = path.join(home, '.claude', 'settings.json');
    const data = JSON.parse(fs.readFileSync(settings, 'utf-8'));
    data.model = 'opus';
    data.hooks.Stop.push({ hooks: [{ type: 'command', command: 'notify.sh' }] });
    fs.writeFileSync(settings, JSON.stringify(data));

    await removeSetup('all', env);
    const after = JSON.parse(fs.readFileSync(settings, 'utf-8'));
    expect(after.model).toBe('opus');
    expect(after.theme).toBe('dark');
    expect(after.hooks.PostToolUse[0].hooks[0].command).toBe('lint.sh');
    expect(after.hooks.Stop[0].hooks[0].command).toBe('notify.sh');
    expect(JSON.stringify(after)).not.toContain(MANAGED);
  });
});

describe('what setup writes', () => {
  it('wires Claude Code hooks for every event plus the async push bridge', async () => {
    await applySetup(['claude-code'], env);
    const settings = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf-8'));
    for (const event of ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SessionEnd']) {
      const handlers = settings.hooks[event].flatMap((g: { hooks: { command: string }[] }) => g.hooks);
      expect(handlers.some((h: { command: string }) => h.command === `/usr/local/bin/mbd net hook claude-code ${event} ${MANAGED}`)).toBe(true);
    }
    const start = settings.hooks.SessionStart.flatMap((g: { hooks: { command: string; async?: boolean }[] }) => g.hooks);
    expect(start.find((h: { command: string }) => h.command.includes('net push'))?.async).toBe(true);
    const claudeJson = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf-8'));
    expect(claudeJson.mcpServers['moltbotden-net']).toEqual({ type: 'stdio', command: '/usr/local/bin/mbd', args: ['net', 'mcp', '--runtime', 'claude-code'] });
  });

  it('keeps the user\'s own Codex servers and TOML lines', async () => {
    seedExistingConfigs();
    await applySetup(['codex'], env);
    const toml = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf-8');
    expect(toml).toContain('# my codex config');
    expect(toml).toContain('[mcp_servers.other]');
    expect(toml).toContain('[mcp_servers.moltbotden-net]\ncommand = "/usr/local/bin/mbd"\nargs = ["net", "mcp", "--runtime", "codex"]');
  });

  it('refuses to rewrite a config it cannot parse, rather than clobbering it', async () => {
    write('.cursor/mcp.json', '{ // comment\n}');
    const changes = await applySetup(['cursor'], env);
    expect(changes[0]).toMatchObject({ action: 'failed', error: expect.stringMatching(/not plain JSON/) });
    expect(fs.readFileSync(path.join(home, '.cursor', 'mcp.json'), 'utf-8')).toBe('{ // comment\n}');
  });

  it('quotes an mbd path with spaces so shell hooks still run it', () => {
    const edits = planRuntime('cursor', { ...env, platform: 'darwin', mbd: ["/Applications/My Tools/O'Brien/mbd"] });
    const hooks = JSON.parse(edits[1].apply(undefined));
    expect(hooks.hooks.postToolUse[0].command).toBe(`'/Applications/My Tools/O'\\''Brien/mbd' net hook cursor postToolUse ${MANAGED}`);
  });

  it('quotes for cmd on Windows and gives Copilot a PowerShell form too', () => {
    const win = { ...env, platform: 'win32' as const, mbd: ['C:\\Program Files\\nodejs\\node.exe', 'C:\\mbd\\cli.js'] };
    const cursor = JSON.parse(planRuntime('cursor', win)[1].apply(undefined));
    expect(cursor.hooks.stop[0].command).toBe(`"C:\\Program Files\\nodejs\\node.exe" C:\\mbd\\cli.js net hook cursor stop ${MANAGED}`);
    const copilot = JSON.parse(planRuntime('copilot-cli', win)[1].apply(undefined));
    expect(copilot.hooks.agentStop[0].powershell).toBe(`& 'C:\\Program Files\\nodejs\\node.exe' 'C:\\mbd\\cli.js' 'net' 'hook' 'copilot-cli' 'agentStop' '${MANAGED}'`);
  });
});

describe('review regressions', () => {
  it('keeps edits the user made between two setup runs when removing', async () => {
    seedExistingConfigs();
    await applySetup(['claude-code'], env);
    const settings = path.join(home, '.claude', 'settings.json');
    const edited = JSON.parse(fs.readFileSync(settings, 'utf-8'));
    edited.model = 'opus';
    fs.writeFileSync(settings, JSON.stringify(edited));
    await applySetup(['claude-code'], { ...env, shareRepo: true }); // run again over the edit
    await removeSetup('all', env);
    const after = JSON.parse(fs.readFileSync(settings, 'utf-8'));
    expect(after.model).toBe('opus');
    expect(JSON.stringify(after)).not.toContain(MANAGED);
  });

  it('edits a symlinked config at its target and leaves the link in place', async () => {
    if (process.platform === 'win32') return;
    const dotfiles = path.join(home, 'dotfiles');
    fs.mkdirSync(dotfiles);
    const target = path.join(dotfiles, 'mcp.json');
    fs.writeFileSync(target, '{"mcpServers":{"mine":{}}}');
    fs.mkdirSync(path.join(home, '.cursor'));
    fs.symlinkSync(target, path.join(home, '.cursor', 'mcp.json'));

    await applySetup(['cursor'], env);
    expect(fs.lstatSync(path.join(home, '.cursor', 'mcp.json')).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(target, 'utf-8')).toContain('moltbotden-net');
    await removeSetup('all', env);
    expect(fs.lstatSync(path.join(home, '.cursor', 'mcp.json')).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(target, 'utf-8')).toBe('{"mcpServers":{"mine":{}}}');
  });

  it('can undo a setup that crashed after recording a file but before writing it', async () => {
    seedExistingConfigs();
    const before = snapshot();
    await applySetup(['cursor'], env);
    // Simulate the crash: the file went back to its original bytes, the record stayed.
    fs.writeFileSync(path.join(home, '.cursor', 'mcp.json'), '{"mcpServers":{}}');
    fs.rmSync(path.join(home, '.cursor', 'hooks.json'));
    await removeSetup('all', env);
    expect(snapshot()).toEqual(before);
  });

  it('refuses to run while another setup holds the lock', async () => {
    const { getConfigDir } = await import('../../src/lib/config-store.js');
    fs.mkdirSync(getConfigDir(), { recursive: true });
    fs.writeFileSync(path.join(getConfigDir(), 'net-setup.lock'), String(process.pid));
    await expect(applySetup(['cursor'], env)).rejects.toThrow(/Another mbd net setup/);
    fs.rmSync(path.join(getConfigDir(), 'net-setup.lock'));
  });

  it('reports a runtime it cannot parse and still connects the others', async () => {
    write('.cursor/mcp.json', '{ // comment\n}');
    const changes = await applySetup(['cursor', 'codex'], env);
    expect(changes.find((c) => c.runtime === 'cursor')?.action).toBe('failed');
    expect(fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf-8')).toContain('moltbotden-net');
  });

  it('reads a JSON config saved with a byte order mark', async () => {
    write('.cursor/mcp.json', '\uFEFF{"mcpServers":{"mine":{}}}');
    const changes = await applySetup(['cursor'], env);
    expect(changes.every((c) => c.action !== 'failed')).toBe(true);
    await removeSetup('all', env);
    expect(fs.readFileSync(path.join(home, '.cursor', 'mcp.json'), 'utf-8')).toBe('\uFEFF{"mcpServers":{"mine":{}}}');
  });
});

describe('Codex TOML', () => {
  it('recognizes our table written with quotes, spaces or a comment and never duplicates it', () => {
    const existing = 'model = "x"\r\n\r\n[ mcp_servers."moltbotden-net" ] # old\r\ncommand = "old"\r\n\r\n[mcp_servers.other]\r\ncommand = "o"\r\n';
    const edit = planRuntime('codex', env)[0];
    const next = edit.apply(existing);
    expect(next.match(/moltbotden-net/g)?.length).toBe(1);
    expect(next).toContain('[mcp_servers.other]\r\ncommand = "o"');
    expect(next).not.toContain('command = "old"');
    expect(next.includes('\r\n')).toBe(true);
  });

  it('does not end our table at a line starting with [ inside a multi-line string or array', () => {
    const toml = '[mcp_servers.moltbotden-net]\nargs = [\n  "a",\n]\nnote = """\n[not a table]\n"""\n\n[mcp_servers.other]\nx = 1\n';
    const out = planRuntime('codex', env)[0].remove(toml)!;
    expect(out).not.toContain('not a table');
    expect(out).toContain('[mcp_servers.other]\nx = 1');
  });
});
