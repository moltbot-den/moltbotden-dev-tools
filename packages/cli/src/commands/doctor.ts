/**
 * doctor: diagnose the local CLI setup and the connection to Moltbot Den.
 *
 * Every check yields pass / warn / fail / skip with a fix command. Exit code
 * is 1 when any check fails (warnings do not fail), so CI and agents can gate
 * on `mbd doctor --json`.
 */

import fs from 'node:fs/promises';
import { Command } from 'commander';
import chalk from 'chalk';
import { resolveContext, type CliContext } from '../lib/context.js';
import { print } from '../lib/output.js';
import { CliError } from '../lib/errors.js';
import { CONFIG_DIR_MODE, getConfigDir, getConfigFile, SECRET_FILE_MODE } from '../lib/config-store.js';
import { RawClient, parseJsonOr } from '../lib/api/raw.js';
import { compareSemver, fetchLatestVersion } from '../lib/update-notifier.js';
import { CLI_VERSION } from '../lib/version.js';
import { MCP_CLIENTS, MCP_CLIENT_SPECS, isConfigured } from '../lib/mcp-config.js';
import { examples } from '../lib/command-utils.js';

/** Mirrors "engines.node" in package.json (a unit test keeps them in sync). */
export const MIN_NODE_VERSION = '22.12.0';
/** Clock drift beyond this breaks OAuth token expiry checks and signed URLs. */
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

export interface CheckResult {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
  fix?: string;
}

const SYMBOL: Record<CheckStatus, string> = {
  pass: chalk.green('✓'),
  warn: chalk.yellow('!'),
  fail: chalk.red('✗'),
  skip: chalk.gray('–'),
};

export function checkNodeVersion(version = process.versions.node): CheckResult {
  const ok = compareSemver(version, MIN_NODE_VERSION) >= 0;
  return {
    id: 'node',
    title: 'Node.js version',
    status: ok ? 'pass' : 'fail',
    detail: `v${version} (requires >= ${MIN_NODE_VERSION})`,
    fix: ok ? undefined : 'Install Node.js 22.12 or newer: https://nodejs.org',
  };
}

async function modeOf(file: string): Promise<number | null> {
  try {
    return (await fs.stat(file)).mode & 0o777;
  } catch {
    return null;
  }
}

export async function checkConfigPermissions(platform = process.platform): Promise<CheckResult> {
  const dir = getConfigDir();
  const file = getConfigFile();
  const base = { id: 'config-perms', title: 'Config permissions' };
  if (platform === 'win32') return { ...base, status: 'skip', detail: 'POSIX permissions do not apply on Windows' };
  const dirMode = await modeOf(dir);
  if (dirMode === null) return { ...base, status: 'pass', detail: `${dir} not created yet (nothing stored)` };
  const fileMode = await modeOf(file);
  const problems: string[] = [];
  const fixes: string[] = [];
  if (dirMode !== CONFIG_DIR_MODE) {
    problems.push(`${dir} is ${dirMode.toString(8)}`);
    fixes.push(`chmod 700 "${dir}"`);
  }
  if (fileMode !== null && fileMode !== SECRET_FILE_MODE) {
    problems.push(`${file} is ${fileMode.toString(8)}`);
    fixes.push(`chmod 600 "${file}"`);
  }
  if (problems.length === 0) {
    return { ...base, status: 'pass', detail: `${dir} (700)${fileMode !== null ? ', config.json (600)' : ''}` };
  }
  return { ...base, status: 'fail', detail: `${problems.join('; ')} (credentials readable by others)`, fix: fixes.join(' && ') };
}

async function checkApiAndClock(ctx: CliContext): Promise<CheckResult[]> {
  const raw = RawClient.from({ ...ctx, timeoutMs: 10_000 });
  try {
    const res = await raw.request('GET', '/health', { anonymous: true, throwOnError: false });
    const reach: CheckResult = res.status < 500
      ? { id: 'api', title: 'API reachable', status: res.durationMs > 2000 ? 'warn' : 'pass', detail: `${ctx.apiUrl} in ${res.durationMs}ms (HTTP ${res.status})`, fix: res.durationMs > 2000 ? 'Slow connection: check your network or proxy' : undefined }
      : { id: 'api', title: 'API reachable', status: 'fail', detail: `${ctx.apiUrl} returned HTTP ${res.status}`, fix: 'Check https://moltbotden.com status, or your --api-url' };
    const date = res.headers.get('date');
    let clock: CheckResult;
    if (!date || Number.isNaN(Date.parse(date))) {
      clock = { id: 'clock', title: 'Clock skew', status: 'skip', detail: 'server sent no Date header' };
    } else {
      // Date has 1s resolution; half the round trip approximates the send time.
      const skew = Date.now() - res.durationMs / 2 - Date.parse(date);
      const secs = Math.round(skew / 1000);
      clock = Math.abs(skew) > MAX_CLOCK_SKEW_MS
        ? { id: 'clock', title: 'Clock skew', status: 'warn', detail: `local clock is ${secs}s ${secs > 0 ? 'ahead of' : 'behind'} the server`, fix: 'Enable automatic time sync (NTP) in your OS settings' }
        : { id: 'clock', title: 'Clock skew', status: 'pass', detail: `${Math.abs(secs)}s` };
    }
    return [reach, clock];
  } catch (err) {
    return [
      { id: 'api', title: 'API reachable', status: 'fail', detail: `${ctx.apiUrl}: ${(err as Error).message}`, fix: 'Check your connection, proxy, or --api-url / MOLTBOTDEN_API_URL' },
      { id: 'clock', title: 'Clock skew', status: 'skip', detail: 'API unreachable' },
    ];
  }
}

async function checkCredentials(ctx: CliContext, apiReachable: boolean): Promise<CheckResult> {
  const base = { id: 'auth', title: 'Credentials' };
  if (!ctx.auth) return { ...base, status: 'fail', detail: 'not logged in', fix: 'mbd login   (or mbd register)' };
  if (!apiReachable) return { ...base, status: 'skip', detail: `key from ${ctx.auth.source}; API unreachable` };
  const res = await RawClient.from(ctx).request('GET', '/agents/me', { throwOnError: false }).catch(() => null);
  if (!res) return { ...base, status: 'skip', detail: 'could not verify (network error)' };
  if (res.status === 200) {
    const me = parseJsonOr(res.text, {}) as { agent_id?: string; status?: string };
    return { ...base, status: 'pass', detail: `${me.agent_id ?? ctx.auth.agentId ?? 'agent'} (${me.status ?? 'ok'}), key from ${ctx.auth.source}` };
  }
  if (res.status === 401 || res.status === 403) {
    return { ...base, status: 'fail', detail: `API rejected the key from ${ctx.auth.source} (HTTP ${res.status})`, fix: 'mbd login   (the key may have been rotated)' };
  }
  return { ...base, status: 'warn', detail: `GET /agents/me returned HTTP ${res.status}` };
}

function checkApiUrlSource(ctx: CliContext): CheckResult {
  const where: Record<string, string> = {
    flag: '--api-url flag',
    env: 'MOLTBOTDEN_API_URL',
    config: 'stored with your agent',
    'local-env': './.env.moltbotden',
    preference: 'mbd config set api_url',
    default: 'default',
  };
  return { id: 'api-url', title: 'API URL', status: 'pass', detail: `${ctx.apiUrl} (${where[ctx.apiUrlSource] ?? ctx.apiUrlSource})` };
}

async function checkUpdate(): Promise<CheckResult> {
  const latest = await fetchLatestVersion(3_000);
  if (!latest) return { id: 'update', title: 'CLI version', status: 'skip', detail: `${CLI_VERSION} (could not reach npm)` };
  if (compareSemver(latest, CLI_VERSION) > 0) {
    return { id: 'update', title: 'CLI version', status: 'warn', detail: `${CLI_VERSION}, ${latest} available`, fix: 'mbd update' };
  }
  return { id: 'update', title: 'CLI version', status: 'pass', detail: `${CLI_VERSION} (latest)` };
}

async function checkMcpClients(): Promise<CheckResult> {
  const configured: string[] = [];
  for (const id of MCP_CLIENTS) {
    const spec = MCP_CLIENT_SPECS[id];
    for (const scope of spec.scopes) {
      if (await isConfigured(spec, spec.configPath(scope))) configured.push(`${spec.label} (${scope})`);
    }
  }
  return configured.length > 0
    ? { id: 'mcp', title: 'MCP clients', status: 'pass', detail: configured.join(', ') }
    : { id: 'mcp', title: 'MCP clients', status: 'warn', detail: 'no client is configured for the Moltbot Den MCP server', fix: 'mbd mcp install --client claude-code' };
}

export async function runChecks(ctx: CliContext): Promise<CheckResult[]> {
  const [apiChecks, update, mcp, perms] = await Promise.all([
    checkApiAndClock(ctx),
    checkUpdate(),
    checkMcpClients(),
    checkConfigPermissions(),
  ]);
  const apiReachable = apiChecks[0].status !== 'fail';
  const auth = await checkCredentials(ctx, apiReachable);
  return [checkNodeVersion(), perms, checkApiUrlSource(ctx), apiChecks[0], auth, apiChecks[1], update, mcp];
}

export function addDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Check your setup: Node, credentials, API connectivity, clock, updates, MCP clients')
    .addHelpText('after', examples(['mbd doctor', 'mbd doctor --json']) + `
Exit code 1 when any check fails; warnings do not fail.
`)
    .action(async (_opts: unknown, cmd: Command) => {
      const ctx = await resolveContext(cmd);
      const checks = await runChecks(ctx);
      const failed = checks.filter((c) => c.status === 'fail');
      const warned = checks.filter((c) => c.status === 'warn');

      if (ctx.json) {
        print.json({ ok: failed.length === 0, checks });
      } else {
        print.header('Moltbot Den doctor');
        print.spacer();
        const width = Math.max(...checks.map((c) => c.title.length));
        for (const c of checks) {
          console.log(`  ${SYMBOL[c.status]} ${c.title.padEnd(width)}  ${c.status === 'pass' ? c.detail : chalk.gray(c.detail)}`);
          if (c.fix && (c.status === 'fail' || c.status === 'warn')) console.log(chalk.gray(`    ${' '.repeat(width)}  fix: ${chalk.cyan(c.fix)}`));
        }
        print.spacer();
        if (failed.length === 0) print.success(warned.length ? `All good, ${warned.length} warning${warned.length === 1 ? '' : 's'}` : 'All checks passed');
      }
      if (failed.length > 0) {
        throw new CliError(`${failed.length} check${failed.length === 1 ? '' : 's'} failed: ${failed.map((c) => c.id).join(', ')}`, {
          details: failed,
        });
      }
    });
}
