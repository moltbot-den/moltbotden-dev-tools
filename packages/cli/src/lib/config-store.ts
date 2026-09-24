/**
 * Secure on-disk storage for CLI state.
 *
 * Everything the CLI persists (API keys, preferences, update-check cache)
 * lives under one config directory:
 *
 *   MOLTBOTDEN_CONFIG_DIR   if set (used by tests and power users)
 *   ~/.moltbotden           otherwise (kept for backward compatibility)
 *
 * Guarantees:
 *   - The directory is created 0700 and files holding secrets 0600.
 *   - Writes are atomic: data goes to a temp file created with the final
 *     mode, then is renamed into place, so a crash never leaves a
 *     half-written config and the file is never briefly world-readable.
 *   - A config.json that fails to parse is never treated as empty (which
 *     would let the next write wipe every stored API key). It is moved to
 *     config.json.corrupt-<timestamp> and a ConfigCorruptError is thrown.
 */

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SECRET_FILE_MODE = 0o600;
export const CONFIG_DIR_MODE = 0o700;

/** Resolve the config directory at call time so env overrides always apply. */
export function getConfigDir(): string {
  const override = process.env.MOLTBOTDEN_CONFIG_DIR;
  if (override && override.trim() !== '') return path.resolve(override);
  return path.join(os.homedir(), '.moltbotden');
}

export function getConfigFile(): string {
  return path.join(getConfigDir(), 'config.json');
}

export class ConfigCorruptError extends Error {
  constructor(
    public readonly file: string,
    public readonly backupFile: string,
    cause: unknown,
  ) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(
      `Config file ${file} could not be parsed (${reason}). ` +
        `It was moved to ${backupFile} so nothing is lost. ` +
        `Fix and move it back, or run "mbd login" to start a fresh config.`,
    );
    this.name = 'ConfigCorruptError';
  }
}

export async function ensureConfigDir(): Promise<string> {
  const dir = getConfigDir();
  await fs.mkdir(dir, { recursive: true, mode: CONFIG_DIR_MODE });
  // mkdir's mode is masked by umask and ignored when the dir already exists.
  await fs.chmod(dir, CONFIG_DIR_MODE).catch(() => {
    /* not supported on Windows */
  });
  return dir;
}

/**
 * Atomically write `data` to `file` with `mode` (default 0600).
 * The temp file is created with the final mode, so there is no window in
 * which the content is readable by other users.
 */
export async function atomicWriteFile(
  file: string,
  data: string,
  mode: number = SECRET_FILE_MODE,
): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fs.writeFile(tmp, data, { encoding: 'utf-8', mode, flag: 'wx' });
    await fs.chmod(tmp, mode).catch(() => {
      /* not supported on Windows */
    });
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}

export type ConfigData = Record<string, unknown>;

/**
 * Read and parse config.json.
 * Returns `{}` when the file does not exist. Throws ConfigCorruptError (after
 * backing the file up) when it exists but is not a JSON object.
 */
export async function readConfigFile(): Promise<ConfigData> {
  const file = getConfigFile();
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('top-level value is not an object');
    }
    return parsed as ConfigData;
  } catch (err) {
    const backup = `${file}.corrupt-${Date.now()}`;
    await fs.rename(file, backup);
    throw new ConfigCorruptError(file, backup, err);
  }
}

/**
 * Best-effort read with no side effects: {} when missing OR unparseable.
 * For non-critical readers (update notifier, telemetry) that must never be
 * the ones to move a corrupt file aside and hide the error from the command.
 */
export async function peekConfigFile(): Promise<ConfigData> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(getConfigFile(), 'utf-8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as ConfigData) : {};
  } catch {
    return {};
  }
}

export async function writeConfigFile(data: ConfigData): Promise<void> {
  await ensureConfigDir();
  await atomicWriteFile(getConfigFile(), JSON.stringify(data, null, 2) + '\n');
}

/** Read-modify-write config.json, preserving keys the mutator doesn't touch. */
export async function updateConfigFile(
  mutate: (config: ConfigData) => ConfigData | void,
): Promise<ConfigData> {
  const current = await readConfigFile();
  const next = mutate(current) ?? current;
  await writeConfigFile(next);
  return next;
}

// ─── Project-local secrets (.env.moltbotden) ─────────────────────────────────

function isInsideGitRepo(dir: string): boolean {
  let current = path.resolve(dir);
  for (;;) {
    if (existsSync(path.join(current, '.git'))) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

/**
 * Add `entry` to `<dir>/.gitignore` when the directory already has a
 * .gitignore or is inside a git repository. Returns true if the file changed.
 */
export async function ensureGitignored(dir: string, entry: string): Promise<boolean> {
  const gitignore = path.join(dir, '.gitignore');
  let content = '';
  let exists = true;
  try {
    content = await fs.readFile(gitignore, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    exists = false;
  }
  if (!exists && !isInsideGitRepo(dir)) return false;

  const lines = content.split(/\r?\n/).map((l) => l.trim());
  if (lines.includes(entry) || lines.includes(`/${entry}`)) return false;

  const prefix = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
  await fs.writeFile(gitignore, `${content}${prefix}${entry}\n`, 'utf-8');
  return true;
}

/** Write a secrets file (0600, atomic) into a project dir and gitignore it. */
export async function writeProjectSecretFile(
  dir: string,
  name: string,
  content: string,
): Promise<{ file: string; gitignored: boolean }> {
  const file = path.join(dir, name);
  await atomicWriteFile(file, content);
  const gitignored = await ensureGitignored(dir, name);
  return { file, gitignored };
}
