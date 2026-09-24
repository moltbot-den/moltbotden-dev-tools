import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  atomicWriteFile,
  ConfigCorruptError,
  ensureGitignored,
  getConfigDir,
  getConfigFile,
  readConfigFile,
  updateConfigFile,
  writeConfigFile,
  writeProjectSecretFile,
} from '../../src/lib/config-store.js';

// config.json holds every stored API key, so it must be private (0600 in a
// 0700 dir), never half-written, and never silently discarded.

const isWindows = process.platform === 'win32';
const mode = (p: string) => fs.statSync(p).mode & 0o777;

function freshDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

beforeEach(() => {
  process.env.MOLTBOTDEN_CONFIG_DIR = path.join(freshDir('mbd-cfg-'), 'nested', '.moltbotden');
});

describe('config location', () => {
  it('honors MOLTBOTDEN_CONFIG_DIR so tests and power users can relocate state', () => {
    expect(getConfigDir()).toBe(path.resolve(process.env.MOLTBOTDEN_CONFIG_DIR!));
    expect(getConfigFile()).toBe(path.join(getConfigDir(), 'config.json'));
  });

  it('defaults to ~/.moltbotden for backward compatibility', () => {
    const saved = process.env.MOLTBOTDEN_CONFIG_DIR;
    delete process.env.MOLTBOTDEN_CONFIG_DIR;
    try {
      expect(getConfigDir()).toBe(path.join(os.homedir(), '.moltbotden'));
    } finally {
      process.env.MOLTBOTDEN_CONFIG_DIR = saved;
    }
  });
});

describe('writeConfigFile', () => {
  it('creates the dir and file with owner-only permissions', async () => {
    await writeConfigFile({ agents: { a: { apiKey: 'secret' } } });
    expect(JSON.parse(fs.readFileSync(getConfigFile(), 'utf-8'))).toEqual({ agents: { a: { apiKey: 'secret' } } });
    if (!isWindows) {
      expect(mode(getConfigFile())).toBe(0o600);
      expect(mode(getConfigDir())).toBe(0o700);
    }
  });

  it('leaves no temp files behind (write is temp + rename)', async () => {
    await writeConfigFile({ a: 1 });
    await writeConfigFile({ a: 2 });
    expect(fs.readdirSync(getConfigDir())).toEqual(['config.json']);
  });

  it('tightens an existing world-readable file on rewrite', async () => {
    await writeConfigFile({ a: 1 });
    if (isWindows) return;
    fs.chmodSync(getConfigFile(), 0o644);
    await writeConfigFile({ a: 2 });
    expect(mode(getConfigFile())).toBe(0o600);
  });
});

describe('atomicWriteFile', () => {
  it('writes the requested mode from the first byte', async () => {
    const file = path.join(freshDir('mbd-atomic-'), 'f.txt');
    await atomicWriteFile(file, 'x', 0o600);
    expect(fs.readFileSync(file, 'utf-8')).toBe('x');
    if (!isWindows) expect(mode(file)).toBe(0o600);
  });
});

describe('readConfigFile', () => {
  it('returns {} when no config exists yet', async () => {
    await expect(readConfigFile()).resolves.toEqual({});
  });

  it('backs up a corrupt config and refuses to treat it as empty', async () => {
    // Treating unparseable JSON as {} used to let the next write wipe every
    // stored API key. Now the file is preserved and the user is told.
    fs.mkdirSync(getConfigDir(), { recursive: true });
    fs.writeFileSync(getConfigFile(), '{"agents": {"a": {"apiKey": "keep-me"}', 'utf-8');

    const err = await readConfigFile().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConfigCorruptError);
    const backup = (err as ConfigCorruptError).backupFile;
    expect(path.basename(backup)).toMatch(/^config\.json\.corrupt-\d+$/);
    expect(fs.readFileSync(backup, 'utf-8')).toContain('keep-me');
    expect(fs.existsSync(getConfigFile())).toBe(false);
  });

  it('rejects a non-object top level (e.g. an array) the same way', async () => {
    fs.mkdirSync(getConfigDir(), { recursive: true });
    fs.writeFileSync(getConfigFile(), '[]', 'utf-8');
    await expect(readConfigFile()).rejects.toBeInstanceOf(ConfigCorruptError);
  });

  it('updateConfigFile never overwrites a corrupt file', async () => {
    fs.mkdirSync(getConfigDir(), { recursive: true });
    fs.writeFileSync(getConfigFile(), 'not json', 'utf-8');
    await expect(updateConfigFile((c) => ({ ...c, x: 1 }))).rejects.toBeInstanceOf(ConfigCorruptError);
    expect(fs.existsSync(getConfigFile())).toBe(false);
  });
});

describe('project secrets (.env.moltbotden)', () => {
  it('writes 0600 and adds the file to an existing .gitignore', async () => {
    const dir = freshDir('mbd-proj-');
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules', 'utf-8');
    const { gitignored } = await writeProjectSecretFile(dir, '.env.moltbotden', 'MOLTBOTDEN_API_KEY=x\n');
    expect(gitignored).toBe(true);
    expect(fs.readFileSync(path.join(dir, '.gitignore'), 'utf-8')).toBe('node_modules\n.env.moltbotden\n');
    if (!isWindows) expect(mode(path.join(dir, '.env.moltbotden'))).toBe(0o600);
  });

  it('creates .gitignore inside a git repo that lacks one', async () => {
    const dir = freshDir('mbd-git-');
    fs.mkdirSync(path.join(dir, '.git'));
    expect(await ensureGitignored(dir, '.env.moltbotden')).toBe(true);
    expect(fs.readFileSync(path.join(dir, '.gitignore'), 'utf-8')).toBe('.env.moltbotden\n');
  });

  it('does not duplicate an existing entry', async () => {
    const dir = freshDir('mbd-dup-');
    fs.writeFileSync(path.join(dir, '.gitignore'), '.env.moltbotden\n', 'utf-8');
    expect(await ensureGitignored(dir, '.env.moltbotden')).toBe(false);
  });

  it('leaves non-git directories without a .gitignore alone', async () => {
    const dir = freshDir('mbd-nogit-');
    expect(await ensureGitignored(dir, '.env.moltbotden')).toBe(false);
    expect(fs.existsSync(path.join(dir, '.gitignore'))).toBe(false);
  });
});
