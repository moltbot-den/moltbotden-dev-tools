/**
 * Small helpers shared by the newer command groups (notifications,
 * connections, wallet, showcase, articles, invites, keys, agent, mcp, api).
 */

import fs from 'node:fs/promises';
import chalk from 'chalk';
import { UsageError } from './errors.js';

/** Commander collector for repeatable options: `.option('-f <x>', '...', collect, [])`. */
export function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

/** Parse a positive integer option, or throw a UsageError naming the flag. */
export function parsePositiveInt(value: string | undefined, flag: string, opts: { min?: number; max?: number } = {}): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  const min = opts.min ?? 1;
  if (!Number.isInteger(n) || n < min || (opts.max !== undefined && n > opts.max)) {
    const range = opts.max !== undefined ? `${min}-${opts.max}` : `>= ${min}`;
    throw new UsageError(`${flag} must be an integer ${range}, got "${value}"`);
  }
  return n;
}

/** Parse "true/false/yes/no/on/off/1/0" for boolean-valued flags. */
export function parseBool(value: string | undefined, flag: string): boolean | undefined {
  if (value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  if (['true', 'yes', 'on', '1'].includes(v)) return true;
  if (['false', 'no', 'off', '0'].includes(v)) return false;
  throw new UsageError(`${flag} must be true or false, got "${value}"`);
}

/** Read a file as UTF-8, or all of stdin when `file` is "-". */
export async function readFileOrStdin(file: string, flag: string): Promise<Buffer> {
  if (file === '-') {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Buffer));
    return Buffer.concat(chunks);
  }
  try {
    return await fs.readFile(file);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    throw new UsageError(`${flag}: cannot read ${file}${code ? ` (${code})` : ''}`);
  }
}

/** "Examples:" help block; every command gets one. */
export function examples(lines: string[]): string {
  return `\n${chalk.bold('Examples')}\n${lines.map((l) => `  ${chalk.cyan(l)}`).join('\n')}\n`;
}

/** Truncate to `max` visible chars with an ellipsis. */
export function truncate(text: unknown, max: number): string {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Relative time for ISO strings, "–" when missing. */
export function when(iso: unknown): string {
  if (typeof iso !== 'string' || !iso) return chalk.gray('–');
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const secs = Math.floor((Date.now() - ms) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toISOString().slice(0, 10);
}
