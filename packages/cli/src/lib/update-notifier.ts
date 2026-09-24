/**
 * Update notifier: tells interactive users when a newer CLI is on npm.
 *
 *   - Never blocks a command: the notice uses the cached result from the
 *     previous check; a refresh (at most once per 24h) runs in the background
 *     with a short timeout.
 *   - Skipped entirely when stdout is not a TTY, in CI, with --json,
 *     MBD_NO_UPDATE_CHECK / NO_UPDATE_NOTIFIER, or `mbd config set update_check false`.
 *   - The notice goes to stderr so stdout stays clean for pipes.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import { atomicWriteFile, ensureConfigDir, getConfigDir, peekConfigFile } from './config-store.js';

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 1_500;
export const PACKAGE_NAME = '@moltbotden/cli';

/** npm "latest" endpoint; MBD_NPM_REGISTRY overrides the registry (mirrors, tests). */
export function npmLatestUrl(env: NodeJS.ProcessEnv = process.env): string {
  const registry = (env.MBD_NPM_REGISTRY || 'https://registry.npmjs.org').replace(/\/+$/, '');
  return `${registry}/${PACKAGE_NAME}/latest`;
}

interface UpdateCheckData {
  lastChecked: number;
  latestVersion: string | null;
}

function cacheFile(): string {
  return path.join(getConfigDir(), 'update-check.json');
}

async function readCache(): Promise<UpdateCheckData | null> {
  try {
    return JSON.parse(await fs.readFile(cacheFile(), 'utf-8')) as UpdateCheckData;
  } catch {
    return null;
  }
}

async function writeCache(data: UpdateCheckData): Promise<void> {
  try {
    await ensureConfigDir();
    await atomicWriteFile(cacheFile(), JSON.stringify(data));
  } catch {
    // Non-fatal
  }
}

/** Latest published version from npm, or null on any failure. */
export async function fetchLatestVersion(timeoutMs = FETCH_TIMEOUT_MS): Promise<string | null> {
  try {
    const res = await fetch(npmLatestUrl(), {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Compare semver strings: 1 if a > b, -1 if a < b, 0 if equal.
 * A pre-release sorts before its release (2.0.0-beta.1 < 2.0.0).
 */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.replace(/^v/, '').split('-', 2);
    return { parts: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const va = pa.parts[i] ?? 0;
    const vb = pb.parts[i] ?? 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  if (pa.pre && !pb.pre) return -1;
  if (!pa.pre && pb.pre) return 1;
  if (pa.pre && pb.pre) return pa.pre < pb.pre ? -1 : pa.pre > pb.pre ? 1 : 0;
  return 0;
}

export function shouldCheckForUpdates(opts: { json?: boolean; env?: NodeJS.ProcessEnv; isTTY?: boolean }): boolean {
  const env = opts.env ?? process.env;
  const isTTY = opts.isTTY ?? Boolean(process.stdout.isTTY);
  if (opts.json || !isTTY) return false;
  if (env.CI || env.MBD_NO_UPDATE_CHECK || env.NO_UPDATE_NOTIFIER) return false;
  return true;
}

/**
 * Start an update check. Returns a function that prints the notice (if any)
 * after the command has finished. Never throws.
 */
export async function checkForUpdates(
  currentVersion: string,
  options: { json?: boolean } = {},
): Promise<() => void> {
  const noop = () => {};
  if (!shouldCheckForUpdates(options)) return noop;

  let latestVersion: string | null = null;
  try {
    const prefs = (await peekConfigFile()).preferences as Record<string, unknown> | undefined;
    if (prefs?.update_check === false) return noop;

    const cache = await readCache();
    latestVersion = cache?.latestVersion ?? null;
    if (!cache || Date.now() - cache.lastChecked >= CHECK_INTERVAL_MS) {
      void fetchLatestVersion().then((version) =>
        writeCache({ lastChecked: Date.now(), latestVersion: version ?? latestVersion }),
      );
    }
  } catch {
    return noop;
  }

  return () => {
    if (!latestVersion || compareSemver(latestVersion, currentVersion) <= 0) return;
    process.stderr.write(
      '\n' +
        chalk.yellow(`  Update available: ${chalk.gray(currentVersion)} → ${chalk.green(latestVersion)}\n`) +
        chalk.gray(`  Run ${chalk.cyan('mbd update')} or ${chalk.cyan(`npm install -g ${PACKAGE_NAME}`)}\n`),
    );
  };
}
