/**
 * Read-side of `mbd config` preferences that change command behavior.
 *
 *   page_size  default --limit for list commands (clamped to each endpoint's max)
 *   color      false turns colors off (same as --no-color / NO_COLOR)
 *
 * Reads never move a corrupt config aside (peekConfigFile): a bad file is
 * reported by the command that actually needs credentials, not by a list
 * command asking for its page size.
 */

import chalk from 'chalk';
import { peekConfigFile } from './config-store.js';
import { UsageError } from './errors.js';

export const DEFAULT_PAGE_SIZE = 20;

async function readPrefs(): Promise<Record<string, unknown>> {
  const config = await peekConfigFile();
  const prefs = config.preferences;
  return prefs && typeof prefs === 'object' ? (prefs as Record<string, unknown>) : {};
}

/** `page_size` preference, or 20. */
export async function getPageSize(): Promise<number> {
  const value = (await readPrefs()).page_size;
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : DEFAULT_PAGE_SIZE;
}

/**
 * Resolve a --limit flag: explicit value (validated) or the page_size
 * preference, clamped to the endpoint's maximum so a large preference never
 * turns into a 422.
 */
export async function resolveLimit(raw: unknown, max: number, flag = '--limit'): Promise<number> {
  if (raw === undefined || raw === null || raw === '') {
    return Math.min(await getPageSize(), max);
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    throw new UsageError(`${flag} must be an integer between 1 and ${max}, got "${String(raw)}"`);
  }
  return n;
}

/** Parse a non-negative integer flag such as --offset. */
export function parseOffset(raw: unknown, flag = '--offset', max = 10_000): number {
  if (raw === undefined || raw === null || raw === '') return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > max) {
    throw new UsageError(`${flag} must be an integer between 0 and ${max}, got "${String(raw)}"`);
  }
  return n;
}

/** Parse a positive integer flag such as --page. */
export function parsePage(raw: unknown, flag = '--page'): number {
  if (raw === undefined || raw === null || raw === '') return 1;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new UsageError(`${flag} must be a positive integer, got "${String(raw)}"`);
  }
  return n;
}

/**
 * Apply `mbd config set color false`. FORCE_COLOR still wins, matching the
 * precedence of NO_COLOR.
 */
export async function applyColorPreference(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if ('FORCE_COLOR' in env) return;
  if ((await readPrefs()).color === false) chalk.level = 0;
}
