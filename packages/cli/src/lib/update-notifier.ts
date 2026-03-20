/**
 * Update notifier — checks for new CLI versions and notifies the user.
 *
 * Strategy:
 *   - On every CLI invocation, check if we should query npm (at most once per 24h)
 *   - Store last-check timestamp + latest version in ~/.moltbotden/update-check.json
 *   - If a newer version is available, print a one-line notice after command output
 *   - Never blocks the main command — check happens async in background
 *   - Respects --json mode (no notification) and CI environments
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import chalk from 'chalk';

const CONFIG_DIR = path.join(os.homedir(), '.moltbotden');
const UPDATE_CHECK_FILE = path.join(CONFIG_DIR, 'update-check.json');
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PACKAGE_NAME = '@moltbotden/cli';

interface UpdateCheckData {
  lastChecked: number;
  latestVersion: string | null;
  currentVersion: string;
}

/**
 * Read the cached update check data.
 */
async function readCache(): Promise<UpdateCheckData | null> {
  try {
    const raw = await fs.readFile(UPDATE_CHECK_FILE, 'utf-8');
    return JSON.parse(raw) as UpdateCheckData;
  } catch {
    return null;
  }
}

/**
 * Write update check data to cache.
 */
async function writeCache(data: UpdateCheckData): Promise<void> {
  try {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(UPDATE_CHECK_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch {
    // Non-fatal — cache write failures are silently ignored
  }
}

/**
 * Fetch the latest version from the npm registry.
 * Returns null on any error (network, parse, etc.).
 */
async function fetchLatestVersion(): Promise<string | null> {
  try {
    const { fetch } = await import('undici');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);

    const res = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    clearTimeout(timeout);

    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Compare two semver strings. Returns:
 *   1  if a > b
 *   0  if a === b
 *  -1  if a < b
 */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

/**
 * Check for updates (non-blocking). Call this early in CLI startup.
 * Returns a function that, when called, prints the update notice if needed.
 *
 * Usage:
 *   const showNotice = await checkForUpdates('2.1.0');
 *   // ... run the command ...
 *   showNotice(); // prints notice if update available
 */
export async function checkForUpdates(
  currentVersion: string,
  options: { json?: boolean } = {}
): Promise<() => void> {
  // Skip in JSON mode, CI, or when stdout is not a TTY
  if (options.json || process.env.CI || process.env.MBD_NO_UPDATE_CHECK || !process.stdout.isTTY) {
    return () => {};
  }

  let latestVersion: string | null = null;

  try {
    const cache = await readCache();

    // Check if we need to fetch (once per 24h)
    const now = Date.now();
    if (cache && (now - cache.lastChecked) < CHECK_INTERVAL_MS) {
      // Use cached data
      latestVersion = cache.latestVersion;
    } else {
      // Fetch in background — don't await it to block the command
      // Instead, we fire-and-forget the fetch and use cached data if available
      latestVersion = cache?.latestVersion ?? null;

      // Do the actual fetch (fire-and-forget for next time)
      fetchLatestVersion().then(async (version) => {
        if (version) {
          await writeCache({
            lastChecked: Date.now(),
            latestVersion: version,
            currentVersion,
          });
        }
      }).catch(() => {});
    }
  } catch {
    // Non-fatal
  }

  // Return the notice printer
  return () => {
    if (!latestVersion) return;
    if (compareSemver(latestVersion, currentVersion) <= 0) return;

    console.log('');
    console.log(
      chalk.yellow('  ╭─────────────────────────────────────────────────────╮')
    );
    console.log(
      chalk.yellow('  │') +
      `  Update available: ${chalk.gray(currentVersion)} → ${chalk.green(latestVersion)}` +
      ' '.repeat(Math.max(0, 20 - currentVersion.length - latestVersion.length)) +
      chalk.yellow('│')
    );
    console.log(
      chalk.yellow('  │') +
      `  Run ${chalk.cyan('npm install -g @moltbotden/cli')} to update` +
      '     ' +
      chalk.yellow('│')
    );
    console.log(
      chalk.yellow('  ╰─────────────────────────────────────────────────────╯')
    );
  };
}

export { compareSemver };
