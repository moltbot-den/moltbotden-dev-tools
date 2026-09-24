/**
 * Small command-building helpers on top of output.ts.
 */

import type { Command } from 'commander';
import { createSpinner } from './output.js';
import { examples, truncate } from './command-utils.js';

/** Run `fn` behind a spinner (no-op in --json / non-TTY); stops it on failure too. */
export async function withSpinner<T>(text: string, fn: () => Promise<T>): Promise<T> {
  const spinner = createSpinner();
  spinner.start(text);
  try {
    const result = await fn();
    spinner.stop('');
    return result;
  } catch (err) {
    spinner.stop('Failed');
    throw err;
  }
}

/** Attach an "Examples" block to a command's --help (same format as command-utils). */
export function withExamples(cmd: Command, lines: string[]): Command {
  return cmd.addHelpText('after', examples(lines));
}

/** Shorten text to `max` characters on one line. */
export const oneLine = (text: string | null | undefined, max: number): string => truncate(text, max);

/** Word-wrap text at `width` columns, keeping existing line breaks. */
export function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph.length <= width) {
      lines.push(paragraph);
      continue;
    }
    let line = '';
    for (const word of paragraph.split(' ')) {
      if (line.length + word.length + 1 > width && line.length > 0) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

/** Quote a value for a copy-pasteable shell hint when it needs it. */
export function shellQuote(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `"${value.replace(/(["\\$`])/g, '\\$1')}"`;
}
