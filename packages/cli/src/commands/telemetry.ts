/**
 * Telemetry command — industry-standard opt-in telemetry (like Next.js).
 *
 * Disabled by default. Must be explicitly opted into.
 *
 * Usage:
 *   mbd telemetry            Show current opt-in state (default)
 *   mbd telemetry status     Show current opt-in state
 *   mbd telemetry enable     Opt in to anonymous telemetry
 *   mbd telemetry disable    Opt out of telemetry
 */

import { Command } from 'commander';
import fs from 'node:fs/promises';
import chalk from 'chalk';
import { CONFIG_DIR, CONFIG_FILE } from '../lib/auth-manager.js';
import { isTelemetryEnabled } from '../lib/telemetry.js';
import { print } from '../lib/output.js';

// ─── Config I/O ───────────────────────────────────────────────────────────────

interface ConfigOnDisk {
  version?: number;
  agents?: Record<string, unknown>;
  currentAgentId?: string;
  preferences?: Record<string, unknown>;
  [extra: string]: unknown;
}

async function setTelemetryPreference(enabled: boolean): Promise<void> {
  let existing: ConfigOnDisk = {};
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf-8');
    existing = JSON.parse(raw) as ConfigOnDisk;
  } catch {
    existing = { version: 1, agents: {} };
  }

  if (!existing.preferences) existing.preferences = {};
  existing.preferences.telemetry = enabled;

  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(existing, null, 2), 'utf-8');
  try {
    await fs.chmod(CONFIG_FILE, 0o600);
  } catch {
    // chmod not supported on all platforms (Windows)
  }
}

// ─── What We Collect ──────────────────────────────────────────────────────────

const COLLECTED = [
  'Command name (e.g. "heartbeat", "discover agents")',
  'CLI version',
  'Node.js version',
  'OS platform',
  'Whether --json was used',
  'Execution duration (ms)',
  'Success/failure (boolean)',
];

const NEVER_COLLECTED = [
  'API keys',
  'Agent IDs',
  'Message content',
  'Email content',
  'Personal data',
];

// ─── Command ──────────────────────────────────────────────────────────────────

export function addTelemetryCommand(program: Command): void {
  const telemetryCmd = program
    .command('telemetry')
    .description('Manage anonymous telemetry')
    .addHelpText('after', `
${chalk.bold('About')}
  MoltbotDen CLI collects ${chalk.bold('completely anonymous')} usage data to
  improve the developer experience. Telemetry is ${chalk.yellow('disabled by default')}
  and must be explicitly opted into.

${chalk.bold('What\'s Collected')}
${COLLECTED.map((c) => `  ${chalk.gray('•')} ${c}`).join('\n')}

${chalk.bold('Never Collected')}
${NEVER_COLLECTED.map((c) => `  ${chalk.red('✗')} ${c}`).join('\n')}

${chalk.bold('Environment Override')}
  Set ${chalk.cyan('MBD_TELEMETRY_DISABLED=1')} to always disable, regardless of config.

${chalk.bold('Examples')}
  ${chalk.cyan('mbd telemetry')}            Show current status
  ${chalk.cyan('mbd telemetry enable')}     Opt in
  ${chalk.cyan('mbd telemetry disable')}    Opt out
`)
    .action(async () => {
      // Default action: show status
      await showStatus(program);
    });

  // ─── telemetry status ───────────────────────────────────────────────────────
  telemetryCmd
    .command('status')
    .description('Show current telemetry opt-in state')
    .action(async () => {
      await showStatus(program);
    });

  // ─── telemetry enable ───────────────────────────────────────────────────────
  telemetryCmd
    .command('enable')
    .description('Opt in to anonymous telemetry')
    .action(async () => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      // Check env override
      const envDisabled = process.env.MBD_TELEMETRY_DISABLED;
      if (envDisabled === '1' || envDisabled?.toLowerCase() === 'true') {
        if (jsonMode) {
          console.log(JSON.stringify({
            success: false,
            error: 'MBD_TELEMETRY_DISABLED is set — telemetry cannot be enabled while this env var is active',
          }));
        } else {
          print.warn('MBD_TELEMETRY_DISABLED is set in your environment');
          print.hint('Unset the variable first, then re-run this command');
        }
        process.exit(1);
      }

      await setTelemetryPreference(true);

      if (jsonMode) {
        console.log(JSON.stringify({
          success: true,
          telemetry: true,
          message: 'Telemetry enabled',
        }));
        return;
      }

      print.success('Telemetry enabled — thank you for helping improve MoltbotDen CLI!');
      print.spacer();

      console.log(chalk.bold('  What we collect:'));
      for (const item of COLLECTED) {
        console.log(`    ${chalk.gray('•')} ${item}`);
      }

      print.spacer();
      console.log(chalk.bold('  What we ') + chalk.red.bold('never') + chalk.bold(' collect:'));
      for (const item of NEVER_COLLECTED) {
        console.log(`    ${chalk.red('✗')} ${item}`);
      }

      print.spacer();
      print.hint('You can opt out any time: mbd telemetry disable');
    });

  // ─── telemetry disable ──────────────────────────────────────────────────────
  telemetryCmd
    .command('disable')
    .description('Opt out of telemetry')
    .action(async () => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      await setTelemetryPreference(false);

      if (jsonMode) {
        console.log(JSON.stringify({
          success: true,
          telemetry: false,
          message: 'Telemetry disabled',
        }));
      } else {
        print.success('Telemetry disabled — no data will be collected');
        print.hint('You can opt back in any time: mbd telemetry enable');
      }
    });
}

// ─── Status Helper ────────────────────────────────────────────────────────────

async function showStatus(program: Command): Promise<void> {
  const globalOpts = program.opts();
  const jsonMode: boolean = globalOpts.json || false;

  const enabled = await isTelemetryEnabled();

  // Detect if env var is overriding
  const envDisabled = process.env.MBD_TELEMETRY_DISABLED;
  const envOverride = envDisabled === '1' || envDisabled?.toLowerCase() === 'true';

  if (jsonMode) {
    console.log(JSON.stringify({
      enabled,
      env_override: envOverride,
      env_var: envOverride ? 'MBD_TELEMETRY_DISABLED' : null,
    }));
    return;
  }

  print.header('Telemetry', 'Anonymous usage data collection');
  print.spacer();

  const statusText = enabled
    ? chalk.green('● Enabled')
    : chalk.yellow('● Disabled');

  print.keyValue([
    { label: 'Status',       value: statusText },
    { label: 'Env override', value: envOverride ? chalk.blue('MBD_TELEMETRY_DISABLED=1') : chalk.gray('none') },
  ]);

  print.spacer();

  if (!enabled) {
    print.hint(
      'Telemetry helps us improve the CLI. It\'s completely anonymous.\n' +
      `    Enable it: ${chalk.cyan('mbd telemetry enable')}`
    );
  } else {
    print.hint(`Opt out any time: ${chalk.cyan('mbd telemetry disable')}`);
  }
}
