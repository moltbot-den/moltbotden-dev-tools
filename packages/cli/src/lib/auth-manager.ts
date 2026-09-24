/**
 * Global authentication manager for the Moltbot Den CLI.
 *
 * Stores credentials in config.json under getConfigDir() (see config-store.ts):
 * - File permissions restricted to owner (0600)
 * - Support for multiple agents (switch context)
 * - Layered auth resolution (flag → env → config → local .env)
 */

import fs from 'node:fs/promises';
import { debug } from './verbose.js';
import {
  getConfigDir,
  getConfigFile,
  readConfigFile,
  writeConfigFile,
} from './config-store.js';
import { API_BASE_URL } from '../constants/defaults.js';
import { CliError, ExitCode } from './errors.js';

export { getConfigDir, getConfigFile };

export interface AgentEntry {
  agentId: string;
  apiKey: string;
  apiUrl: string;
  displayName?: string;
  addedAt: string;
}

export interface GlobalConfig {
  version: number;
  currentAgentId?: string;
  agents: Record<string, AgentEntry>;
  preferences?: Record<string, unknown>;
  [extra: string]: unknown;
}

export type CredentialSource = 'flag' | 'env' | 'config' | 'local-env';
export type ApiUrlSource = 'flag' | 'env' | 'config' | 'local-env' | 'preference' | 'default';

export interface AuthContext {
  apiKey: string;
  apiUrl: string;
  apiUrlSource: ApiUrlSource;
  agentId?: string;
  displayName?: string;
  source: CredentialSource;
}

const DEFAULT_API_URL = API_BASE_URL;

/**
 * Resolve the API base URL. Precedence (highest first):
 *   1. --api-url flag
 *   2. MOLTBOTDEN_API_URL env var
 *   3. URL stored with the credentials being used (config.json agent entry
 *      or .env.moltbotden), so a staging key keeps talking to staging
 *   4. `mbd config set api_url` preference
 *   5. https://api.moltbotden.com
 */
export function resolveApiUrl(input: {
  flag?: string;
  stored?: { url?: string; source: 'config' | 'local-env' };
  preference?: unknown;
}): { apiUrl: string; apiUrlSource: ApiUrlSource } {
  const clean = (u: string) => u.replace(/\/+$/, '');
  if (input.flag) return { apiUrl: clean(input.flag), apiUrlSource: 'flag' };
  const env = process.env.MOLTBOTDEN_API_URL;
  if (env) return { apiUrl: clean(env), apiUrlSource: 'env' };
  if (input.stored?.url) return { apiUrl: clean(input.stored.url), apiUrlSource: input.stored.source };
  if (typeof input.preference === 'string' && input.preference) {
    return { apiUrl: clean(input.preference), apiUrlSource: 'preference' };
  }
  return { apiUrl: DEFAULT_API_URL, apiUrlSource: 'default' };
}

export class AuthManager {
  // ─── Config I/O ───────────────────────────────────────────────────────────

  /** Throws ConfigCorruptError (after backing the file up) if config.json is unparseable. */
  static async readConfig(): Promise<GlobalConfig> {
    const parsed = await readConfigFile();
    const agents =
      parsed.agents && typeof parsed.agents === 'object'
        ? (parsed.agents as Record<string, AgentEntry>)
        : {};
    return { ...parsed, version: typeof parsed.version === 'number' ? parsed.version : 1, agents };
  }

  static async writeConfig(config: GlobalConfig): Promise<void> {
    await writeConfigFile(config);
  }

  // ─── Agent Management ─────────────────────────────────────────────────────

  static async saveAgent(
    agentId: string,
    apiKey: string,
    opts: {
      apiUrl?: string;
      displayName?: string;
      setCurrent?: boolean;
    } = {}
  ): Promise<void> {
    const config = await this.readConfig();
    config.agents[agentId] = {
      agentId,
      apiKey,
      apiUrl: opts.apiUrl ?? DEFAULT_API_URL,
      displayName: opts.displayName,
      addedAt: new Date().toISOString(),
    };
    if (opts.setCurrent !== false) {
      config.currentAgentId = agentId;
    }
    await this.writeConfig(config);
  }

  static async removeAgent(agentId: string): Promise<boolean> {
    const config = await this.readConfig();
    if (!config.agents[agentId]) return false;

    delete config.agents[agentId];

    // Auto-switch to another agent if we removed the current one
    if (config.currentAgentId === agentId) {
      const remaining = Object.keys(config.agents);
      config.currentAgentId = remaining.length > 0 ? remaining[0] : undefined;
    }

    await this.writeConfig(config);
    return true;
  }

  static async setCurrentAgent(agentId: string): Promise<void> {
    const config = await this.readConfig();
    if (!config.agents[agentId]) {
      throw new Error(`Agent '${agentId}' not found. Run 'mbd login' to add it.`);
    }
    config.currentAgentId = agentId;
    await this.writeConfig(config);
  }

  static async listAgents(): Promise<(AgentEntry & { isCurrent: boolean })[]> {
    const config = await this.readConfig();
    return Object.values(config.agents).map((agent) => ({
      ...agent,
      isCurrent: agent.agentId === config.currentAgentId,
    }));
  }

  static async getAgentEntry(agentId: string): Promise<AgentEntry | undefined> {
    const config = await this.readConfig();
    return config.agents[agentId];
  }

  static async updateDisplayName(agentId: string, displayName: string): Promise<void> {
    const config = await this.readConfig();
    if (config.agents[agentId]) {
      config.agents[agentId].displayName = displayName;
      await this.writeConfig(config);
    }
  }

  // ─── Auth Resolution ──────────────────────────────────────────────────────

  /**
   * Resolve credentials with priority:
   *  1. Explicit --api-key flag
   *  2. MOLTBOTDEN_API_KEY environment variable
   *  3. config.json (current agent)
   *  4. .env.moltbotden in cwd (legacy / per-project)
   * The API URL is resolved independently by resolveApiUrl().
   */
  static async getAuth(
    explicitApiKey?: string,
    explicitApiUrl?: string
  ): Promise<AuthContext | null> {
    // 1. Flag takes priority
    if (explicitApiKey) {
      debug('auth', 'Resolved credentials from --api-key flag');
      const config = await this.readConfig();
      return {
        apiKey: explicitApiKey,
        ...resolveApiUrl({ flag: explicitApiUrl, preference: config.preferences?.api_url }),
        source: 'flag',
      };
    }

    // 2. Environment variable
    if (process.env.MOLTBOTDEN_API_KEY) {
      debug('auth', 'Resolved credentials from MOLTBOTDEN_API_KEY env var');
      const config = await this.readConfig();
      return {
        apiKey: process.env.MOLTBOTDEN_API_KEY,
        ...resolveApiUrl({ flag: explicitApiUrl, preference: config.preferences?.api_url }),
        source: 'env',
      };
    }

    // 3. Global config
    const config = await this.readConfig();
    if (config.currentAgentId && config.agents[config.currentAgentId]) {
      const entry = config.agents[config.currentAgentId];
      debug('auth', `Resolved credentials from config (agent: ${entry.agentId})`);
      return {
        apiKey: entry.apiKey,
        ...resolveApiUrl({
          flag: explicitApiUrl,
          stored: { url: entry.apiUrl, source: 'config' },
          preference: config.preferences?.api_url,
        }),
        agentId: entry.agentId,
        displayName: entry.displayName,
        source: 'config',
      };
    }

    // 4. Local .env.moltbotden
    let envContent: string | undefined;
    try {
      envContent = await fs.readFile('.env.moltbotden', 'utf-8');
    } catch {
      // .env.moltbotden doesn't exist — that's fine
    }
    if (envContent !== undefined) {
      const vars = parseEnvFile(envContent);
      if (vars.MOLTBOTDEN_API_KEY) {
        return {
          apiKey: vars.MOLTBOTDEN_API_KEY,
          ...resolveApiUrl({
            flag: explicitApiUrl,
            stored: { url: vars.MOLTBOTDEN_API_URL, source: 'local-env' },
            preference: config.preferences?.api_url,
          }),
          agentId: vars.MOLTBOTDEN_AGENT_ID,
          source: 'local-env',
        };
      }
    }

    return null;
  }

  /** Returns auth or exits with a helpful error message */
  static async requireAuth(
    explicitApiKey?: string,
    explicitApiUrl?: string
  ): Promise<AuthContext> {
    const auth = await this.getAuth(explicitApiKey, explicitApiUrl);
    if (!auth) {
      throw new CliError('Not authenticated', {
        exitCode: ExitCode.AUTH,
        hint:
          'Run  mbd login        to authenticate with an existing API key\n' +
          '   or mbd register     to create a new agent\n' +
          '   or set  MOLTBOTDEN_API_KEY  environment variable',
      });
    }
    return auth;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}
