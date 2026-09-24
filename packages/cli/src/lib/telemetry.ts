/**
 * Opt-in CLI telemetry.
 *
 * Disabled by default. Enabled only via `mbd telemetry enable` (or
 * `mbd config set telemetry true`). MBD_TELEMETRY_DISABLED=1 always wins.
 *
 * Payload (see buildTelemetryPayload), and nothing else:
 *   - command path, e.g. "hosting vm create" (from the command tree, never argv)
 *   - flag NAMES used, e.g. ["--json", "--tier"] (never their values)
 *   - duration, exit code, CLI version, OS platform, Node version
 * Positional arguments and option values (API keys, IDs, message text,
 * emails) are never read, so they cannot leak.
 *
 * Sending: the Moltbot Den API has no CLI telemetry endpoint today (checked
 * against openapi.json), so TELEMETRY_ENDPOINT is null and recordEvent is a
 * local no-op that only prints the payload under --verbose. When an endpoint
 * ships, set TELEMETRY_ENDPOINT; the payload contract stays the same.
 */

import os from 'node:os';
import type { Command } from 'commander';
import { peekConfigFile } from './config-store.js';
import { CLI_VERSION } from './version.js';
import { debug } from './verbose.js';

export const TELEMETRY_ENDPOINT: string | null = null;

export interface TelemetryEvent {
  /** Command path from the command tree, e.g. "hosting vm create". */
  command: string;
  /** Flag names only, e.g. ["--json"]. */
  flags: string[];
  duration_ms: number;
  exit_code: number;
}

export interface TelemetryPayload extends TelemetryEvent {
  cli_version: string;
  os_platform: string;
  node_version: string;
  timestamp: string;
}

/** "hosting vm create" for the matched command (root name excluded). */
export function commandPath(cmd: Command | undefined): string {
  const names: string[] = [];
  let current: Command | null | undefined = cmd;
  while (current && current.parent) {
    names.unshift(current.name());
    current = current.parent;
  }
  return names.join(' ') || 'default';
}

const FLAG_NAME = /^--?[A-Za-z][A-Za-z0-9-]*$/;

/**
 * Extract flag names from argv, dropping `=value` suffixes and every token
 * that is not itself a flag (values, positionals, anything after `--`).
 */
export function flagNames(argv: readonly string[]): string[] {
  const names = new Set<string>();
  for (const token of argv) {
    if (token === '--') break;
    if (!token.startsWith('-')) continue;
    const name = token.split('=')[0];
    if (FLAG_NAME.test(name)) names.add(name);
  }
  return [...names].sort();
}

export function buildTelemetryPayload(event: TelemetryEvent, now: Date = new Date()): TelemetryPayload {
  return {
    command: event.command,
    flags: [...event.flags],
    duration_ms: Math.max(0, Math.round(event.duration_ms)),
    exit_code: event.exit_code,
    cli_version: CLI_VERSION,
    os_platform: os.platform(),
    node_version: process.version,
    timestamp: now.toISOString(),
  };
}

/**
 * Resolution order:
 *  1. MBD_TELEMETRY_DISABLED=1|true → off
 *  2. config.json preferences.telemetry === true → on
 *  3. otherwise off
 */
export async function isTelemetryEnabled(): Promise<boolean> {
  const envDisabled = process.env.MBD_TELEMETRY_DISABLED;
  if (envDisabled === '1' || envDisabled?.toLowerCase() === 'true') return false;
  const prefs = (await peekConfigFile()).preferences as Record<string, unknown> | undefined;
  return prefs?.telemetry === true;
}

/** Record an event if the user opted in. Never throws, never blocks on the network. */
export async function recordEvent(event: TelemetryEvent): Promise<void> {
  try {
    if (!(await isTelemetryEnabled())) return;
    const payload = buildTelemetryPayload(event);
    debug('telemetry', JSON.stringify(payload));
    if (!TELEMETRY_ENDPOINT) return;
    await fetch(TELEMETRY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(2_000),
    });
  } catch {
    // Telemetry must never break the CLI.
  }
}
