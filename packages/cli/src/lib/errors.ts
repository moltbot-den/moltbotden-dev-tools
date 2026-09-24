/**
 * Central error model for the CLI.
 *
 * Exit codes (stable contract for scripts and agents):
 *   0  success
 *   1  generic failure (network, server, unexpected)
 *   2  usage error (bad flags/arguments, missing flag in non-interactive mode)
 *   3  auth error (not logged in, HTTP 401/403)
 *   4  not found (HTTP 404)
 *
 * Commands either throw (CliError, ApiError, anything) and let the handler in
 * cli.ts report it, or call fail(err) from a catch block. Both paths render
 * the same way: human text on stderr, or in --json mode a single
 * {"error": {...}} object on stderr, and exit with the mapped code.
 */

import { CommanderError } from 'commander';
import { ApiError } from '../types/api.js';
import { isJsonMode, print } from './output.js';

export const ExitCode = {
  OK: 0,
  ERROR: 1,
  USAGE: 2,
  AUTH: 3,
  NOT_FOUND: 4,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

export interface CliErrorOptions {
  exitCode?: number;
  hint?: string;
  details?: unknown;
  status?: number;
}

/** An error whose message is already user-facing. */
export class CliError extends Error {
  readonly exitCode: number;
  readonly hint?: string;
  readonly details?: unknown;
  readonly status?: number;

  constructor(message: string, opts: CliErrorOptions = {}) {
    super(message);
    this.name = 'CliError';
    this.exitCode = opts.exitCode ?? ExitCode.ERROR;
    this.hint = opts.hint;
    this.details = opts.details;
    this.status = opts.status;
  }
}

/** Bad invocation: wrong/missing flags or arguments. Exit code 2. */
export class UsageError extends CliError {
  constructor(message: string, opts: Omit<CliErrorOptions, 'exitCode'> = {}) {
    super(message, { ...opts, exitCode: ExitCode.USAGE });
    this.name = 'UsageError';
  }
}

export function exitCodeForStatus(status: number): number {
  if (status === 401 || status === 403) return ExitCode.AUTH;
  if (status === 404) return ExitCode.NOT_FOUND;
  return ExitCode.ERROR;
}

export function exitCodeFor(err: unknown): number {
  if (err instanceof CliError) return err.exitCode;
  if (err instanceof ApiError) return exitCodeForStatus(err.status);
  if (err instanceof CommanderError) {
    // --help / --version surface as CommanderError with exitCode 0.
    return err.exitCode === 0 ? ExitCode.OK : ExitCode.USAGE;
  }
  return ExitCode.ERROR;
}

export interface ErrorEnvelope {
  error: {
    status: number | null;
    message: string;
    details: unknown;
    exit_code: number;
    hint?: string;
  };
}

function messageOf(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return fallback;
}

/** Stable JSON shape for errors in --json mode. */
export function toErrorEnvelope(err: unknown, fallback = 'An unexpected error occurred'): ErrorEnvelope {
  let status: number | null = null;
  let details: unknown = null;
  let hint: string | undefined;
  if (err instanceof ApiError) {
    status = err.status;
    details = err.details ?? null;
  } else if (err instanceof CliError) {
    status = err.status ?? null;
    details = err.details ?? null;
    hint = err.hint;
  }
  let message = messageOf(err, fallback);
  if (err instanceof CommanderError) message = message.replace(/^error:\s*/, '');
  const envelope: ErrorEnvelope = {
    error: { status, message, details, exit_code: exitCodeFor(err) },
  };
  if (hint) envelope.error.hint = hint;
  return envelope;
}

/** Print an error the way the current output mode expects. Never exits. */
export function reportError(err: unknown, fallback?: string): void {
  if (isJsonMode()) {
    process.stderr.write(JSON.stringify(toErrorEnvelope(err, fallback)) + '\n');
    return;
  }
  print.error(messageOf(err, fallback ?? 'An unexpected error occurred'));
  if (err instanceof CliError && err.hint) print.hint(err.hint, { stderr: true });
}

/** Report `err` and exit with its mapped exit code. For use in catch blocks. */
export function fail(err: unknown, fallback?: string): never {
  reportError(err, fallback);
  process.exit(exitCodeFor(err));
}
