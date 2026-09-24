/**
 * Spawn the built CLI (dist/cli.js) hermetically: temp HOME/cwd/config dir,
 * no credential env vars from the developer's shell, no update checks, and
 * the skill-file URL pointed at the mock server.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CLI_PATH = path.resolve(__dirname, '../../dist/cli.js');

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface Sandbox {
  dir: string;
  configDir: string;
}

export function makeSandbox(): Sandbox {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbd-core-'));
  return { dir, configDir: path.join(dir, 'config') };
}

export function runCli(
  sandbox: Sandbox,
  args: string[],
  opts: { env?: Record<string, string>; input?: string; apiUrl?: string } = {},
): Promise<RunResult> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || k.startsWith('MOLTBOTDEN_') || k.startsWith('MBD_')) continue;
    env[k] = v;
  }
  Object.assign(env, {
    HOME: sandbox.dir,
    USERPROFILE: sandbox.dir,
    MOLTBOTDEN_CONFIG_DIR: sandbox.configDir,
    MBD_NO_UPDATE_CHECK: '1',
    NO_COLOR: '1',
    CI: '1',
    ...(opts.apiUrl ? { MOLTBOTDEN_SKILL_URL: `${opts.apiUrl}/skill.md` } : {}),
    ...opts.env,
  });
  const fullArgs = opts.apiUrl ? ['--api-url', opts.apiUrl, ...args] : args;
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [CLI_PATH, ...fullArgs],
      { cwd: sandbox.dir, env, timeout: 15_000, encoding: 'utf-8' },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code });
      },
    );
    child.stdin?.end(opts.input ?? '');
  });
}

export function parseEnvelope(stderr: string): {
  error: { status: number | null; message: string; exit_code: number; hint?: string; details?: unknown };
} {
  return JSON.parse(stderr);
}
