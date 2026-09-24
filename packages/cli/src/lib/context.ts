/**
 * resolveContext(): the single place commands get global flags, credentials
 * and an API client from.
 *
 *   const ctx = await resolveContext(program);                       // auth optional
 *   const ctx = await resolveContext(program, { requireAuth: true }); // throws exit 3 if none
 *   const data = await ctx.client.request('GET', '/agents/me');
 *
 * API URL precedence: --api-url > MOLTBOTDEN_API_URL > URL stored with the
 * credentials in use > `mbd config set api_url` > https://api.moltbotden.com.
 * API key precedence: --api-key > MOLTBOTDEN_API_KEY > config.json current
 * agent > ./.env.moltbotden.
 */

import type { Command } from 'commander';
import { AuthManager, resolveApiUrl, type ApiUrlSource, type AuthContext } from './auth-manager.js';
import { MoltbotDenClient, DEFAULT_TIMEOUT_MS } from './api-client.js';
import { CliError, ExitCode } from './errors.js';

export interface GlobalFlags {
  json: boolean;
  verbose: boolean;
  apiKey?: string;
  apiUrl?: string;
}

export interface CliContext extends GlobalFlags {
  /** Effective API base URL (no trailing slash). */
  apiUrl: string;
  apiUrlSource: ApiUrlSource;
  /** Resolved credentials, or null when not logged in (only if requireAuth is false). */
  auth: AuthContext | null;
  /** Client bound to apiUrl and the resolved API key (if any). */
  client: MoltbotDenClient;
  /** Request timeout in ms (MOLTBOTDEN_TIMEOUT_MS, default 30000). */
  timeoutMs: number;
}

export interface AuthedCliContext extends CliContext {
  auth: AuthContext;
  apiKey: string;
}

/** Read global flags from any command in the tree. */
export function getGlobalFlags(cmd: Command): GlobalFlags {
  const opts = cmd.optsWithGlobals() as Record<string, unknown>;
  return {
    json: Boolean(opts.json),
    verbose: Boolean(opts.verbose),
    apiKey: typeof opts.apiKey === 'string' && opts.apiKey ? opts.apiKey : undefined,
    apiUrl: typeof opts.apiUrl === 'string' && opts.apiUrl ? opts.apiUrl : undefined,
  };
}

export function resolveTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.MOLTBOTDEN_TIMEOUT_MS;
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new CliError(`MOLTBOTDEN_TIMEOUT_MS must be a positive number of milliseconds, got "${raw}"`, {
      exitCode: ExitCode.USAGE,
    });
  }
  return n;
}

export async function resolveContext(cmd: Command, opts: { requireAuth: true }): Promise<AuthedCliContext>;
export async function resolveContext(cmd: Command, opts?: { requireAuth?: boolean }): Promise<CliContext>;
export async function resolveContext(
  cmd: Command,
  opts: { requireAuth?: boolean } = {},
): Promise<CliContext> {
  const flags = getGlobalFlags(cmd);
  const timeoutMs = resolveTimeoutMs();

  const auth = opts.requireAuth
    ? await AuthManager.requireAuth(flags.apiKey, flags.apiUrl)
    : await AuthManager.getAuth(flags.apiKey, flags.apiUrl);

  let apiUrl: string;
  let apiUrlSource: ApiUrlSource;
  if (auth) {
    apiUrl = auth.apiUrl;
    apiUrlSource = auth.apiUrlSource;
  } else {
    const config = await AuthManager.readConfig();
    ({ apiUrl, apiUrlSource } = resolveApiUrl({ flag: flags.apiUrl, preference: config.preferences?.api_url }));
  }

  const client = new MoltbotDenClient(apiUrl, auth?.apiKey, { timeoutMs });
  return { ...flags, apiKey: auth?.apiKey, apiUrl, apiUrlSource, auth, client, timeoutMs };
}

/**
 * API URL for commands that create credentials (login, register): the stored
 * agent's URL is deliberately ignored, since the new key may target a
 * different environment. Precedence: --api-url > MOLTBOTDEN_API_URL >
 * `api_url` preference > default.
 */
export async function resolveBaseUrl(cmd: Command): Promise<string> {
  const flags = getGlobalFlags(cmd);
  const config = await AuthManager.readConfig();
  return resolveApiUrl({ flag: flags.apiUrl, preference: config.preferences?.api_url }).apiUrl;
}
