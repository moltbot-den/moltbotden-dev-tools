/**
 * Verbose / debug logging for the CLI.
 *
 * When --verbose is enabled, debug messages are printed to stderr
 * so they don't interfere with --json output on stdout.
 *
 * Usage:
 *   import { debug, setVerbose } from './verbose.js';
 *   setVerbose(true);
 *   debug('api', 'GET /heartbeat → 200 (142ms)');
 */

import chalk from 'chalk';

let verboseEnabled = false;

export function setVerbose(enabled: boolean): void {
  verboseEnabled = enabled;
}

export function isVerbose(): boolean {
  return verboseEnabled;
}

/**
 * Print a debug message to stderr when verbose mode is enabled.
 *
 * @param category - Short label like 'api', 'auth', 'config'
 * @param message - The debug message
 */
export function debug(category: string, message: string): void {
  if (!verboseEnabled) return;
  const timestamp = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  process.stderr.write(
    chalk.gray(`  [${timestamp}] `) +
    chalk.blue(`${category.padEnd(8)}`) +
    chalk.gray(` ${message}\n`)
  );
}
