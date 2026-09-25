import { describe, it, expect, beforeEach } from 'vitest';
import { Command } from 'commander';
import {
  buildTelemetryPayload,
  commandPath,
  flagNames,
  isTelemetryEnabled,
  recordEvent,
  TELEMETRY_ENDPOINT,
} from '../../src/lib/telemetry.js';
import { writeConfigFile } from '../../src/lib/config-store.js';
import { makeTempDir } from '../helpers/temp-dir.js';

// Telemetry promised "never API keys, agent IDs or message content" but used
// to send raw argv (e.g. "login moltbotden_sk_..."). These tests pin the
// payload to command path + flag NAMES only.

beforeEach(() => {
  process.env.MOLTBOTDEN_CONFIG_DIR = makeTempDir('tel');
  delete process.env.MBD_TELEMETRY_DISABLED;
});

function matchedCommand(argv: string[]): Command | undefined {
  let matched: Command | undefined;
  const program = new Command().exitOverride();
  program.option('--json').option('--api-key <key>');
  program.hook('preAction', (_t, action) => {
    matched = action;
  });
  const messages = program.command('messages');
  messages.command('send <agent>').option('--message <text>').action(() => {});
  program.command('login').option('--api-key <key>').action(() => {});
  program.parse(['node', 'mbd', ...argv]);
  return matched;
}

describe('telemetry payload', () => {
  const secretArgv = [
    '--json',
    'messages',
    'send',
    'bob-the-agent',
    '--message',
    'my secret plan',
    '--api-key=moltbotden_sk_SECRET',
  ];

  it('contains the command path and flag names but none of the argument values', () => {
    const payload = buildTelemetryPayload({
      command: commandPath(matchedCommand(secretArgv)),
      flags: flagNames(secretArgv),
      duration_ms: 12.4,
      exit_code: 0,
    });

    expect(payload.command).toBe('messages send');
    expect(payload.flags).toEqual(['--api-key', '--json', '--message']);
    const serialized = JSON.stringify(payload);
    for (const value of ['bob-the-agent', 'my secret plan', 'moltbotden_sk_SECRET']) {
      expect(serialized).not.toContain(value);
    }
    expect(Object.keys(payload).sort()).toEqual(
      ['cli_version', 'command', 'duration_ms', 'exit_code', 'flags', 'node_version', 'os_platform', 'timestamp'].sort(),
    );
  });

  it('never treats values that look like numbers or appear after -- as flags', () => {
    expect(flagNames(['--limit', '-5', '--', '--not-a-flag'])).toEqual(['--limit']);
  });

  it('uses "default" when no subcommand ran', () => {
    expect(commandPath(undefined)).toBe('default');
  });
});

describe('telemetry opt-in', () => {
  it('is off by default', async () => {
    await expect(isTelemetryEnabled()).resolves.toBe(false);
  });

  it('is on only after an explicit opt-in', async () => {
    await writeConfigFile({ preferences: { telemetry: true } });
    await expect(isTelemetryEnabled()).resolves.toBe(true);
  });

  it('MBD_TELEMETRY_DISABLED always wins', async () => {
    await writeConfigFile({ preferences: { telemetry: true } });
    process.env.MBD_TELEMETRY_DISABLED = '1';
    await expect(isTelemetryEnabled()).resolves.toBe(false);
  });

  it('does not send anywhere: the API has no telemetry endpoint yet', async () => {
    expect(TELEMETRY_ENDPOINT).toBeNull();
    await writeConfigFile({ preferences: { telemetry: true } });
    await expect(recordEvent({ command: 'ping', flags: [], duration_ms: 1, exit_code: 0 })).resolves.toBeUndefined();
  });
});
