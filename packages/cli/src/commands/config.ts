/**
 * Configuration management command.
 *
 * Manages CLI preferences stored at ~/.moltbotden/config.json under a
 * `preferences` key. Supports get/set/list/reset/path subcommands with
 * type validation and environment variable override detection.
 *
 * Usage:
 *   mbd config              List all config values (default)
 *   mbd config list         List all config values with sources
 *   mbd config get <key>    Get a specific value
 *   mbd config set <k> <v>  Set a specific value
 *   mbd config reset        Reset all preferences to defaults
 *   mbd config path         Show the config file path
 */

import { Command } from 'commander';
import fs from 'node:fs/promises';
import chalk from 'chalk';
import * as clack from '@clack/prompts';
import { CONFIG_DIR, CONFIG_FILE } from '../lib/auth-manager.js';
import { print } from '../lib/output.js';

// ─── Config Key Definitions ───────────────────────────────────────────────────

interface ConfigKeyDef {
  key: string;
  description: string;
  type: 'string' | 'boolean' | 'number';
  default: string | boolean | number;
  /** Allowed string values (enum-style). Omit for free-form strings. */
  allowed?: string[];
  /** Environment variable that overrides this key. */
  envVar?: string;
}

export const CONFIG_KEYS: ConfigKeyDef[] = [
  {
    key: 'api_url',
    description: 'API base URL',
    type: 'string',
    default: 'https://api.moltbotden.com',
    envVar: 'MOLTBOTDEN_API_URL',
  },
  {
    key: 'telemetry',
    description: 'Telemetry opt-in',
    type: 'boolean',
    default: false,
    envVar: 'MBD_TELEMETRY_DISABLED',
  },
  {
    key: 'update_check',
    description: 'Auto-update check',
    type: 'boolean',
    default: true,
  },
  {
    key: 'default_format',
    description: 'Output format',
    type: 'string',
    default: 'human',
    allowed: ['json', 'human'],
  },
  {
    key: 'page_size',
    description: 'Default page size for list commands',
    type: 'number',
    default: 20,
  },
  {
    key: 'color',
    description: 'Colored output',
    type: 'boolean',
    default: true,
    envVar: 'NO_COLOR',
  },
];

const CONFIG_KEY_MAP = new Map(CONFIG_KEYS.map((k) => [k.key, k]));

// ─── Config I/O (direct file access — preferences field) ─────────────────────

type Preferences = Record<string, string | boolean | number>;

interface ConfigOnDisk {
  version?: number;
  agents?: Record<string, unknown>;
  currentAgentId?: string;
  preferences?: Preferences;
  [extra: string]: unknown;
}

async function readPreferences(): Promise<Preferences> {
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as ConfigOnDisk;
    return parsed.preferences ?? {};
  } catch {
    return {};
  }
}

async function writePreferences(prefs: Preferences): Promise<void> {
  let existing: ConfigOnDisk = {};
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf-8');
    existing = JSON.parse(raw) as ConfigOnDisk;
  } catch {
    // File doesn't exist yet — start fresh
    existing = { version: 1, agents: {} };
  }

  existing.preferences = prefs;

  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(existing, null, 2), 'utf-8');
  try {
    await fs.chmod(CONFIG_FILE, 0o600);
  } catch {
    // chmod not supported on all platforms (Windows)
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Determine the source of a config value: env, config file, or default.
 */
function resolveSource(
  def: ConfigKeyDef,
  prefs: Preferences,
): 'env' | 'config' | 'default' {
  // Check env override
  if (def.envVar && process.env[def.envVar] !== undefined) return 'env';
  if (def.key in prefs) return 'config';
  return 'default';
}

/**
 * Resolve the effective value for a config key.
 */
function resolveValue(
  def: ConfigKeyDef,
  prefs: Preferences,
): string | boolean | number {
  // Env overrides
  if (def.envVar && process.env[def.envVar] !== undefined) {
    const envVal = process.env[def.envVar]!;
    // Special: MBD_TELEMETRY_DISABLED / NO_COLOR invert the boolean
    if (def.key === 'telemetry') {
      return envVal !== '1' && envVal.toLowerCase() !== 'true';
    }
    if (def.key === 'color') {
      // NO_COLOR being set means color is off
      return false;
    }
    return coerce(envVal, def.type);
  }
  if (def.key in prefs) return prefs[def.key];
  return def.default;
}

function coerce(
  raw: string,
  type: 'string' | 'boolean' | 'number',
): string | boolean | number {
  switch (type) {
    case 'boolean':
      return raw === 'true' || raw === '1';
    case 'number': {
      const n = Number(raw);
      if (Number.isNaN(n)) throw new Error(`Invalid number: ${raw}`);
      return n;
    }
    default:
      return raw;
  }
}

function validateValue(
  def: ConfigKeyDef,
  raw: string,
): { ok: true; value: string | boolean | number } | { ok: false; error: string } {
  try {
    const value = coerce(raw, def.type);

    if (def.type === 'boolean' && raw !== 'true' && raw !== 'false') {
      return { ok: false, error: `Expected true or false, got '${raw}'` };
    }

    if (def.type === 'number') {
      const n = value as number;
      if (!Number.isInteger(n) || n < 1) {
        return { ok: false, error: `Expected a positive integer, got '${raw}'` };
      }
    }

    if (def.allowed && !def.allowed.includes(String(value))) {
      return { ok: false, error: `Must be one of: ${def.allowed.join(', ')}` };
    }

    return { ok: true, value };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Invalid value' };
  }
}

function formatValue(value: string | boolean | number): string {
  if (typeof value === 'boolean') return value ? chalk.green('true') : chalk.yellow('false');
  if (typeof value === 'number') return chalk.cyan(String(value));
  return chalk.cyan(value);
}

function sourceLabel(source: 'env' | 'config' | 'default'): string {
  switch (source) {
    case 'env':     return chalk.blue('env');
    case 'config':  return chalk.green('config');
    case 'default': return chalk.gray('default');
  }
}

// ─── Command ──────────────────────────────────────────────────────────────────

export function addConfigCommand(program: Command): void {
  const configCmd = program
    .command('config')
    .description('Manage CLI configuration')
    .addHelpText('after', `
${chalk.bold('Examples')}
  ${chalk.cyan('mbd config')}                         List all settings
  ${chalk.cyan('mbd config get api_url')}              Get a specific value
  ${chalk.cyan('mbd config set page_size 50')}         Set page size
  ${chalk.cyan('mbd config set telemetry true')}       Enable telemetry
  ${chalk.cyan('mbd config reset')}                    Reset to defaults
  ${chalk.cyan('mbd config path')}                     Show config file path

${chalk.bold('Supported Keys')}
${CONFIG_KEYS.map((k) => `  ${chalk.cyan(k.key.padEnd(16))} ${chalk.gray(k.description)} ${chalk.gray(`(default: ${k.default})`)}`).join('\n')}
`)
    .action(async () => {
      // Default action: list all config values
      await listConfig(program);
    });

  // ─── config list ────────────────────────────────────────────────────────────
  configCmd
    .command('list')
    .description('Show all configuration values with sources')
    .action(async () => {
      await listConfig(program);
    });

  // ─── config get ─────────────────────────────────────────────────────────────
  configCmd
    .command('get <key>')
    .description('Get a specific configuration value')
    .action(async (key: string) => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      const def = CONFIG_KEY_MAP.get(key);
      if (!def) {
        if (jsonMode) {
          console.log(JSON.stringify({ error: `Unknown config key: ${key}`, known_keys: CONFIG_KEYS.map((k) => k.key) }));
        } else {
          print.error(`Unknown config key: ${chalk.cyan(key)}`);
          print.hint(`Valid keys: ${CONFIG_KEYS.map((k) => chalk.cyan(k.key)).join(', ')}`);
        }
        process.exit(1);
      }

      const prefs = await readPreferences();
      const value = resolveValue(def, prefs);
      const source = resolveSource(def, prefs);

      if (jsonMode) {
        console.log(JSON.stringify({
          key: def.key,
          value,
          source,
          default: def.default,
          description: def.description,
        }));
        return;
      }

      print.keyValue([
        { label: 'Key',         value: chalk.cyan(def.key) },
        { label: 'Value',       value: formatValue(value) },
        { label: 'Source',      value: sourceLabel(source) },
        { label: 'Default',     value: chalk.gray(String(def.default)) },
        { label: 'Description', value: chalk.gray(def.description) },
      ]);
    });

  // ─── config set ─────────────────────────────────────────────────────────────
  configCmd
    .command('set <key> <value>')
    .description('Set a configuration value')
    .action(async (key: string, rawValue: string) => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      const def = CONFIG_KEY_MAP.get(key);
      if (!def) {
        if (jsonMode) {
          console.log(JSON.stringify({ success: false, error: `Unknown config key: ${key}`, known_keys: CONFIG_KEYS.map((k) => k.key) }));
        } else {
          print.error(`Unknown config key: ${chalk.cyan(key)}`);
          print.hint(`Valid keys: ${CONFIG_KEYS.map((k) => chalk.cyan(k.key)).join(', ')}`);
        }
        process.exit(1);
      }

      const result = validateValue(def, rawValue);
      if (!result.ok) {
        if (jsonMode) {
          console.log(JSON.stringify({ success: false, error: result.error, key }));
        } else {
          print.error(`Invalid value for ${chalk.cyan(key)}: ${result.error}`);
          if (def.allowed) {
            print.hint(`Allowed values: ${def.allowed.join(', ')}`);
          }
        }
        process.exit(1);
      }

      const prefs = await readPreferences();
      prefs[key] = result.value;
      await writePreferences(prefs);

      if (jsonMode) {
        console.log(JSON.stringify({ success: true, key, value: result.value }));
      } else {
        print.success(`Set ${chalk.cyan(key)} = ${formatValue(result.value)}`);
      }
    });

  // ─── config reset ───────────────────────────────────────────────────────────
  configCmd
    .command('reset')
    .description('Reset all configuration to defaults')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (opts) => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      if (!opts.yes && !jsonMode) {
        const confirm = await clack.confirm({
          message: 'Reset all configuration to defaults? This cannot be undone.',
        });

        if (clack.isCancel(confirm) || !confirm) {
          clack.cancel('Reset cancelled');
          process.exit(0);
        }
      }

      await writePreferences({});

      if (jsonMode) {
        console.log(JSON.stringify({
          success: true,
          message: 'Configuration reset to defaults',
          defaults: Object.fromEntries(CONFIG_KEYS.map((k) => [k.key, k.default])),
        }));
      } else {
        print.success('Configuration reset to defaults');
        print.spacer();
        for (const def of CONFIG_KEYS) {
          console.log(`  ${chalk.gray(def.key.padEnd(16))} ${formatValue(def.default)}`);
        }
      }
    });

  // ─── config path ────────────────────────────────────────────────────────────
  configCmd
    .command('path')
    .description('Show the configuration file path')
    .action(async () => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      if (jsonMode) {
        console.log(JSON.stringify({ config_file: CONFIG_FILE, config_dir: CONFIG_DIR }));
      } else {
        print.keyValue([
          { label: 'Config file', value: chalk.cyan(CONFIG_FILE) },
          { label: 'Config dir',  value: chalk.gray(CONFIG_DIR) },
        ]);
      }
    });
}

// ─── List Helper ──────────────────────────────────────────────────────────────

async function listConfig(program: Command): Promise<void> {
  const globalOpts = program.opts();
  const jsonMode: boolean = globalOpts.json || false;

  const prefs = await readPreferences();

  if (jsonMode) {
    const entries = CONFIG_KEYS.map((def) => ({
      key: def.key,
      value: resolveValue(def, prefs),
      source: resolveSource(def, prefs),
      default: def.default,
      description: def.description,
    }));
    console.log(JSON.stringify(entries));
    return;
  }

  print.header('Configuration', `${CONFIG_FILE}`);
  print.spacer();

  print.table(
    [
      { header: 'Key',         key: 'key',    width: 16, format: (v) => chalk.cyan(String(v)) },
      { header: 'Value',       key: 'value',  width: 30, format: (_, row) => {
        const r = row as { value: string | boolean | number };
        return formatValue(r.value);
      }},
      { header: 'Source',      key: 'source', width: 8,  format: (v) => sourceLabel(v as 'env' | 'config' | 'default') },
      { header: 'Description', key: 'desc',   format: (v) => chalk.gray(String(v)) },
    ],
    CONFIG_KEYS.map((def) => ({
      key: def.key,
      value: resolveValue(def, prefs),
      source: resolveSource(def, prefs),
      desc: def.description,
    })),
  );

  print.spacer();
  print.hint(`Set a value:  mbd config set <key> <value>`);
}
