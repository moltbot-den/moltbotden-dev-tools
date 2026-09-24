/**
 * Configuration management command.
 *
 * Manages CLI preferences stored in config.json (see lib/config-store.ts) under a
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
import chalk from 'chalk';
import * as clack from '@clack/prompts';
import { getConfigDir, getConfigFile, readConfigFile, updateConfigFile } from '../lib/config-store.js';
import { print } from '../lib/output.js';
import { UsageError } from '../lib/errors.js';

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
    key: 'page_size',
    description: 'Default --limit for list commands (capped at each endpoint max)',
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

async function readPreferences(): Promise<Preferences> {
  const config = await readConfigFile();
  return (config.preferences as Preferences | undefined) ?? {};
}

async function writePreferences(prefs: Preferences): Promise<void> {
  await updateConfigFile((config) => {
    config.preferences = prefs;
    if (typeof config.version !== 'number') config.version = 1;
    if (!config.agents) config.agents = {};
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Determine the source of a config value: env, config file, or default.
 */
function resolveSource(
  def: ConfigKeyDef,
  prefs: Preferences,
): 'env' | 'config' | 'default' {
  // Check env override (MBD_TELEMETRY_DISABLED only overrides when it disables)
  const envVal = def.envVar ? process.env[def.envVar] : undefined;
  if (envVal !== undefined && (def.key !== 'telemetry' || envVal === '1' || envVal.toLowerCase() === 'true')) {
    return 'env';
  }
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
    // Special: MBD_TELEMETRY_DISABLED / NO_COLOR invert the boolean.
    // MBD_TELEMETRY_DISABLED can only turn telemetry off; any other value
    // leaves the opt-in preference in charge.
    if (def.key === 'telemetry') {
      if (envVal === '1' || envVal.toLowerCase() === 'true') return false;
      return def.key in prefs ? prefs[def.key] : def.default;
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
        throw new UsageError(`Unknown config key: ${key}`, {
          details: { known_keys: CONFIG_KEYS.map((k) => k.key) },
          hint: `Valid keys: ${CONFIG_KEYS.map((k) => k.key).join(', ')}`,
        });
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
        throw new UsageError(`Unknown config key: ${key}`, {
          details: { known_keys: CONFIG_KEYS.map((k) => k.key) },
          hint: `Valid keys: ${CONFIG_KEYS.map((k) => k.key).join(', ')}`,
        });
      }

      const result = validateValue(def, rawValue);
      if (!result.ok) {
        throw new UsageError(`Invalid value for ${key}: ${result.error}`, {
          details: { key },
          hint: def.allowed ? `Allowed values: ${def.allowed.join(', ')}` : undefined,
        });
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
        console.log(JSON.stringify({ config_file: getConfigFile(), config_dir: getConfigDir() }));
      } else {
        print.keyValue([
          { label: 'Config file', value: chalk.cyan(getConfigFile()) },
          { label: 'Config dir',  value: chalk.gray(getConfigDir()) },
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

  print.header('Configuration', getConfigFile());
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
