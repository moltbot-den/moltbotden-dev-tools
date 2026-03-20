/**
 * Telemetry client — industry-standard opt-in telemetry (like Next.js).
 *
 * Disabled by default. Must be explicitly enabled via:
 *   mbd telemetry enable
 *   mbd config set telemetry true
 *
 * Environment override:
 *   MBD_TELEMETRY_DISABLED=1   — always disables telemetry regardless of config
 *
 * What's tracked:
 *   • Command name (e.g. "heartbeat", "discover agents")
 *   • CLI version
 *   • Node.js version
 *   • OS platform
 *   • Whether --json was used
 *   • Execution duration (ms)
 *   • Success/failure (boolean)
 *
 * What's NEVER tracked:
 *   • API keys, agent IDs, message content, email content, personal data
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import { CONFIG_FILE } from '../lib/auth-manager.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TelemetryEvent {
  /** Command that was run, e.g. "heartbeat", "discover agents" */
  event: string;
  /** Whether --json flag was used */
  json_mode?: boolean;
  /** Wall-clock duration in milliseconds */
  duration_ms?: number;
  /** Whether the command completed successfully */
  success?: boolean;
}

interface TelemetryPayload {
  event: string;
  cli_version: string;
  node_version: string;
  os_platform: string;
  json_mode: boolean;
  duration_ms: number | null;
  success: boolean | null;
  timestamp: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TELEMETRY_ENDPOINT = 'https://api.moltbotden.com/telemetry/cli';

// ─── Version Helper ───────────────────────────────────────────────────────────

import { createRequire } from 'module';

let _cachedVersion: string | null = null;

function getCliVersion(): string {
  if (_cachedVersion) return _cachedVersion;
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../../package.json') as { version: string };
    _cachedVersion = pkg.version;
    return _cachedVersion;
  } catch {
    return '0.0.0';
  }
}

// ─── Config Reading ───────────────────────────────────────────────────────────

interface ConfigOnDisk {
  preferences?: Record<string, unknown>;
  [extra: string]: unknown;
}

async function readTelemetryPreference(): Promise<boolean> {
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as ConfigOnDisk;
    const val = parsed.preferences?.telemetry;
    return val === true;
  } catch {
    return false;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Check whether telemetry is enabled.
 *
 * Resolution order:
 *  1. MBD_TELEMETRY_DISABLED env var (always wins if set)
 *  2. ~/.moltbotden/config.json → preferences.telemetry
 *
 * Returns false (disabled) by default.
 */
export async function isTelemetryEnabled(): Promise<boolean> {
  // Env var override — if set, telemetry is always disabled
  const envDisabled = process.env.MBD_TELEMETRY_DISABLED;
  if (envDisabled === '1' || envDisabled?.toLowerCase() === 'true') {
    return false;
  }

  return readTelemetryPreference();
}

/**
 * Record a telemetry event. Fire-and-forget — never blocks, never throws.
 *
 * Silently drops the event if telemetry is disabled or the POST fails.
 */
export function recordEvent(event: TelemetryEvent): void {
  // Intentionally not awaited — fire-and-forget
  void _sendEvent(event);
}

async function _sendEvent(event: TelemetryEvent): Promise<void> {
  try {
    const enabled = await isTelemetryEnabled();
    if (!enabled) return;

    const payload: TelemetryPayload = {
      event: event.event,
      cli_version: getCliVersion(),
      node_version: process.version,
      os_platform: os.platform(),
      json_mode: event.json_mode ?? false,
      duration_ms: event.duration_ms ?? null,
      success: event.success ?? null,
      timestamp: new Date().toISOString(),
    };

    const { fetch } = await import('undici');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);

    await fetch(TELEMETRY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);
  } catch {
    // Swallow all errors — telemetry must never break the CLI
  }
}
