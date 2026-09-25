/**
 * Helpers shared by every `mbd hosting` command: context, error translation,
 * input validation, --wait polling and small formatters.
 */

import fs from 'node:fs';
import chalk from 'chalk';
import * as clack from '@clack/prompts';
import type { Command } from 'commander';
import { ApiError, formatErrorDetail } from '../../lib/api-client.js';
import { resolveContext } from '../../lib/context.js';
import { CliError, UsageError } from '../../lib/errors.js';
import { createSpinner, isJsonMode, print } from '../../lib/output.js';
import { HostingApi } from '../../lib/api/hosting.js';

// ─── Context ─────────────────────────────────────────────────────────────────

export interface Hosting {
  api: HostingApi;
  json: boolean;
  /** False only when requireAuth was false and no credentials were found. */
  authed: boolean;
}

export async function getHosting(program: Command, requireAuth = true): Promise<Hosting> {
  const ctx = await resolveContext(program, { requireAuth });
  return { api: new HostingApi(ctx.client), json: ctx.json || isJsonMode(), authed: ctx.auth !== null };
}

/** Service names as the "not enabled" message shows them. */
export type HostingService =
  | 'compute' | 'databases' | 'storage' | 'OpenClaw' | 'domains' | 'networking' | 'billing' | 'accounts';

/**
 * Wrap a command action: resolve an authenticated hosting context, run the
 * action, and translate hosting-specific API errors into actionable ones.
 */
export function hostingAction<A extends unknown[]>(
  program: Command,
  service: HostingService,
  fn: (h: Hosting, ...args: A) => Promise<void>,
): (...args: A) => Promise<void> {
  return async (...args: A) => {
    const h = await getHosting(program);
    try {
      await fn(h, ...args);
    } catch (err) {
      throw await explainHostingError(err, service, h.api);
    }
  };
}

// ─── Errors ──────────────────────────────────────────────────────────────────

const DISABLED_RE = /not yet available|not enabled|not configured|disabled/i;

export const TOPUP_HINT =
  'Add funds with USDC:  mbd hosting billing topup --tx-hash <0x...> --amount <usd>\n' +
  'Or pay by card:       mbd hosting billing checkout <resource-type> <plan>';

/**
 * 503 from a feature flag → "isn't enabled on this server yet".
 * 402 → the current balance plus how to add funds.
 * Anything else is returned unchanged.
 */
export async function explainHostingError(err: unknown, service: HostingService, api?: HostingApi): Promise<unknown> {
  if (!(err instanceof ApiError)) return err;
  const detail = formatErrorDetail(err.details);

  if (err.status === 503 && detail && DISABLED_RE.test(detail)) {
    return new CliError(`Hosting ${service} isn't enabled on this server yet.`, {
      status: 503,
      details: err.details ?? null,
      hint: `Server said: ${detail}\nCheck platform status: mbd hosting status`,
    });
  }

  if (err.status === 402) {
    let balance = '';
    if (api) {
      try {
        const account = await api.getAccount();
        balance = ` Your balance is ${money(account.usdc_balance_cents)}.`;
      } catch {
        // The balance is a nicety; never hide the real error behind a second failure.
      }
    }
    return new CliError(`Insufficient hosting balance${detail ? `: ${detail}` : ''}.${balance}`, {
      status: 402,
      details: err.details ?? null,
      hint: TOPUP_HINT,
    });
  }
  return err;
}

// ─── Output helpers ──────────────────────────────────────────────────────────

/** Add an "Examples:" block to a command's help. */
export function examples(cmd: Command, lines: string[]): Command {
  return cmd.addHelpText('after', `\n${chalk.bold('Examples')}\n${lines.map((l) => `  ${chalk.cyan(l)}`).join('\n')}\n`);
}

/** Run `fn` under a spinner (no-op in --json mode or without a TTY). */
export async function withSpinner<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const spinner = createSpinner();
  spinner.start(label);
  try {
    const result = await fn();
    spinner.stop(label);
    return result;
  } catch (err) {
    spinner.stop(`${label} failed`);
    throw err;
  }
}

export function money(cents: number | null | undefined): string {
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return '–';
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export function formatBytes(bytes: unknown): string {
  const n = typeof bytes === 'number' ? bytes : Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '–';
  if (n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function relTime(value: unknown): string {
  return typeof value === 'string' && value ? print.relativeTime(value) : '–';
}

export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

/** Hint printed under a list when it may have been truncated by --limit. */
export function moreHint(count: number, limit: number, command: string): void {
  if (count >= limit && limit < 100) print.hint(`More may be available: ${command} --limit ${Math.min(limit * 2, 100)}`);
  else if (count >= limit) print.hint('Showing the first 100 (the API maximum).');
}

export function cancelled(): never {
  clack.cancel('Cancelled');
  process.exit(0);
}

// ─── Input validation ────────────────────────────────────────────────────────

/**
 * Resource names as the API validates them (models/hosting/*.py): 1-50
 * characters (the cloud name is `mbd-<8 hex>-<name>`, capped at 63),
 * lowercase letters, digits and hyphens, starting with a letter and not
 * ending with a hyphen. Checked here so the user hears about it before any prompt.
 */
export const NAME_MAX = 50;

export function nameProblem(value: string, min = 1): string | undefined {
  if (value.length < min) return `Must be at least ${min} character${min === 1 ? '' : 's'}`;
  if (value.length > NAME_MAX) return `Must be at most ${NAME_MAX} characters`;
  if (!/^[a-z]([a-z0-9-]*[a-z0-9])?$/.test(value)) return 'Use lowercase letters, digits and hyphens; start with a letter and do not end with a hyphen';
  return undefined;
}

export function validateName(value: string, flag = '--name', min = 1): string {
  const problem = nameProblem(value, min);
  if (problem) throw new UsageError(`Invalid ${flag} "${value}": ${problem}.`);
  return value;
}

export function validateChoice<T extends string>(value: string, choices: readonly T[], flag: string): T {
  if (!(choices as readonly string[]).includes(value)) {
    throw new UsageError(`Invalid ${flag} "${value}". Choose one of: ${choices.join(', ')}.`);
  }
  return value as T;
}

export function parseIntOption(value: string, flag: string, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new UsageError(`${flag} must be a whole number from ${min} to ${max} (got "${value}").`);
  }
  return n;
}

export function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Commander collector for repeatable options. */
export function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

const SSH_KEY_RE = /^(ssh-rsa|ssh-ed25519|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521) [A-Za-z0-9+/=]+( .+)?$/;

/**
 * Accept a public key or a path to one. The backend rejects a bad key only
 * after it has charged for the VM, so validate here first.
 */
export function readSshKey(value: string, flag = '--ssh-key'): string {
  let key = value.trim();
  if (!SSH_KEY_RE.test(key)) {
    const expanded = key.startsWith('~/') ? `${process.env.HOME ?? process.env.USERPROFILE ?? ''}${key.slice(1)}` : key;
    if (fs.existsSync(expanded) && fs.statSync(expanded).isFile()) {
      key = fs.readFileSync(expanded, 'utf-8').trim();
      if (/PRIVATE KEY/.test(key)) {
        throw new UsageError(`${flag} points at a private key. Pass the public key (usually the .pub file).`);
      }
    }
  }
  if (!SSH_KEY_RE.test(key)) {
    throw new UsageError(`${flag} is not an SSH public key or a file containing one.`, {
      hint: 'Expected "ssh-ed25519 AAAA... comment" (also ssh-rsa, ecdsa-sha2-nistp256/384/521), e.g. --ssh-key ~/.ssh/id_ed25519.pub',
    });
  }
  return key;
}

// ─── --wait polling ──────────────────────────────────────────────────────────

export const DEFAULT_WAIT_TIMEOUT_S = 600;
export const POLL_INTERVAL_MS = 5000;

export interface WaitOptions<T extends { status: string }> {
  /** Fetch the resource. */
  fetch: () => Promise<T>;
  /** Statuses that mean success. */
  done: readonly string[];
  /** Statuses that mean failure. */
  failed?: readonly string[];
  label: string;
  timeoutSec: number;
  /** Command that shows the resource, for the timeout hint. */
  showCommand: string;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onStatus?: (status: string) => void;
}

/**
 * Poll until the resource reaches a terminal status. Provisioning is async on
 * the server, so a create/start/stop returns long before the work is done.
 */
export async function waitForStatus<T extends { status: string; error_message?: string | null }>(
  opts: WaitOptions<T>,
): Promise<T> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const interval = opts.intervalMs ?? POLL_INTERVAL_MS;
  const deadline = now() + opts.timeoutSec * 1000;
  const failed = opts.failed ?? ['error'];

  for (;;) {
    const resource = await opts.fetch();
    opts.onStatus?.(resource.status);
    if (opts.done.includes(resource.status)) return resource;
    if (failed.includes(resource.status)) {
      throw new CliError(`${opts.label} ended in status "${resource.status}"${resource.error_message ? `: ${resource.error_message}` : ''}`, {
        details: resource,
        hint: `Inspect it: ${opts.showCommand}`,
      });
    }
    if (now() + interval > deadline) {
      throw new CliError(`Timed out after ${opts.timeoutSec}s waiting for ${opts.label}; it is still "${resource.status}".`, {
        details: resource,
        hint: `It keeps going on the server. Check again with: ${opts.showCommand}`,
      });
    }
    await sleep(interval);
  }
}

/** Wait with a spinner that shows the live status. */
export async function waitWithSpinner<T extends { status: string; error_message?: string | null }>(
  opts: WaitOptions<T>,
): Promise<T> {
  const spinner = createSpinner();
  spinner.start(`Waiting for ${opts.label}...`);
  try {
    const result = await waitForStatus({
      ...opts,
      onStatus: (s) => spinner.message(`Waiting for ${opts.label}... (${s})`),
    });
    spinner.stop(`${opts.label}: ${result.status}`);
    return result;
  } catch (err) {
    spinner.stop(`${opts.label}: not ready`);
    throw err;
  }
}

export function parseTimeout(value: string | undefined): number {
  return value === undefined ? DEFAULT_WAIT_TIMEOUT_S : parseIntOption(value, '--timeout', 1, 86_400);
}

/** Adds --wait / --timeout to a command. */
export function withWaitOptions(cmd: Command): Command {
  return cmd
    .option('--wait', 'Wait until the operation finishes (polls every 5s)')
    .option('--timeout <seconds>', `Give up waiting after this many seconds (default ${DEFAULT_WAIT_TIMEOUT_S})`);
}
