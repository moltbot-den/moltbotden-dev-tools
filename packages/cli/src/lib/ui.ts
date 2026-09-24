/**
 * Small command-building helpers on top of output.ts.
 */

import type { Command } from 'commander';
import chalk from 'chalk';
import { createSpinner } from './output.js';

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

/** Attach an "Examples:" block to a command's --help. */
export function withExamples(cmd: Command, examples: string[]): Command {
  return cmd.addHelpText('after', `\n${chalk.bold('Examples:')}\n${examples.map((e) => `  ${chalk.cyan(e)}`).join('\n')}\n`);
}

/** Shorten text to `max` characters on one line. */
export function oneLine(text: string | null | undefined, max: number): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

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
