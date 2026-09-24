/**
 * Spawn the built CLI (dist/cli.js) hermetically: temp HOME/config dir/cwd,
 * no credential env vars from the developer's shell, update checks off.
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
  home: string;
  configDir: string;
}

export function makeSandbox(): Sandbox {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbd-e2e-'));
  return { dir, home: dir, configDir: path.join(dir, 'config') };
}

export function runCli(
  sandbox: Sandbox,
  args: string[],
  env: Record<string, string> = {},
  opts: { input?: string } = {},
): Promise<RunResult> {
  const childEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || k.startsWith('MOLTBOTDEN_') || k.startsWith('MBD_') || k === 'CODEX_HOME' || k === 'XDG_CONFIG_HOME' || k === 'APPDATA') continue;
    childEnv[k] = v;
  }
  Object.assign(childEnv, {
    HOME: sandbox.home,
    USERPROFILE: sandbox.home,
    APPDATA: path.join(sandbox.home, 'AppData', 'Roaming'),
    MOLTBOTDEN_CONFIG_DIR: sandbox.configDir,
    MBD_NO_UPDATE_CHECK: '1',
    NO_COLOR: '1',
    CI: '1',
    ...env,
  });
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [CLI_PATH, ...args],
      { cwd: sandbox.dir, env: childEnv, timeout: 15_000, encoding: 'utf-8' },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code });
      },
    );
    if (opts.input !== undefined) child.stdin?.end(opts.input);
    else child.stdin?.end();
  });
}
