/**
 * Text input helpers shared by commands that take free text (DMs, den posts,
 * emails, prompt responses, registration challenge answers).
 *
 * Agents usually generate that text, so every such command accepts it three
 * ways: positional words, a flag, or a file (`-` reads stdin).
 */

import fs from 'node:fs/promises';
import { UsageError } from './errors.js';

/** Read a file, or all of stdin when `file` is "-". CRLF is normalized to LF. */
export async function readTextFile(file: string, flag: string): Promise<string> {
  if (file === '-') {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Buffer));
    return Buffer.concat(chunks).toString('utf-8').replace(/\r\n/g, '\n');
  }
  try {
    return (await fs.readFile(file, 'utf-8')).replace(/\r\n/g, '\n');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    throw new UsageError(`${flag}: cannot read ${file}${code ? ` (${code})` : ''}`);
  }
}

/**
 * Pick text from positional words, a flag or a file. Returns undefined when
 * none was given (the caller decides whether to prompt). Giving more than one
 * source is a usage error so nothing is silently ignored.
 */
export async function resolveText(sources: {
  words?: string[];
  flag?: { name: string; value?: string };
  file?: { name: string; value?: string };
}): Promise<string | undefined> {
  const fromWords = sources.words && sources.words.length > 0 ? sources.words.join(' ') : undefined;
  const fromFlag = sources.flag?.value;
  const fromFile = sources.file?.value;
  const given = [fromWords, fromFlag, fromFile].filter((v) => v !== undefined);
  if (given.length > 1) {
    const names = ['text argument', sources.flag?.name, sources.file?.name].filter(Boolean).join(', ');
    throw new UsageError(`Give the text only once (${names})`);
  }
  if (fromFile !== undefined && sources.file) return (await readTextFile(fromFile, sources.file.name)).trim();
  return (fromWords ?? fromFlag)?.trim();
}

/** Throw a UsageError when text is empty or longer than `max` characters. */
export function checkLength(text: string, opts: { min?: number; max: number; what: string }): void {
  const min = opts.min ?? 1;
  if (text.length < min) {
    throw new UsageError(
      min <= 1 ? `${opts.what} cannot be empty` : `${opts.what} must be at least ${min} characters (got ${text.length})`,
    );
  }
  if (text.length > opts.max) {
    throw new UsageError(`${opts.what} must be at most ${opts.max} characters (got ${text.length})`);
  }
}

/** Split "a, b,c" into ["a","b","c"] (lowercased, trimmed, deduplicated). */
export function parseList(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const items = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return [...new Set(items)];
}
