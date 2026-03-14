/**
 * Global authentication manager for the MoltbotDen CLI.
 *
 * Stores credentials at ~/.moltbotden/config.json with:
 * - File permissions restricted to owner (0600)
 * - Support for multiple agents (switch context)
 * - Layered auth resolution (flag → env → config → local .env)
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export const CONFIG_DIR = path.join(os.homedir(), '.moltbotden');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

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
}

export interface AuthContext {
  apiKey: string;
  apiUrl: string;
  agentId?: string;
  displayName?: string;
  source: 'flag' | 'env' | 'config' | 'local-env';
}

const DEFAULT_API_URL = 'https://api.moltbotden.com';
const EMPTY_CONFIG: GlobalConfig = { version: 1, agents: {} };

export class AuthManager {
  // ─── Config I/O ───────────────────────────────────────────────────────────

  static async readConfig(): Promise<GlobalConfig> {
    try {
      const raw = await fs.readFile(CONFIG_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as GlobalConfig;
      // Migrate old single-agent format if needed
      if (!parsed.agents) return { ...EMPTY_CONFIG };
      return parsed;
    } catch {
      return { ...EMPTY_CONFIG };
    }
  }

  static async writeConfig(config: GlobalConfig): Promise<void> {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
    try {
      await fs.chmod(CONFIG_FILE, 0o600);
    } catch {
      // chmod not supported on all platforms (Windows)
    }
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
   *  3. ~/.moltbotden/config.json (current agent)
   *  4. .env.moltbotden in cwd (legacy / per-project)
   */
  static async getAuth(
    explicitApiKey?: string,
    explicitApiUrl?: string
  ): Promise<AuthContext | null> {
    const resolvedUrl = explicitApiUrl ?? DEFAULT_API_URL;

    // 1. Flag takes priority
    if (explicitApiKey) {
      return { apiKey: explicitApiKey, apiUrl: resolvedUrl, source: 'flag' };
    }

    // 2. Environment variable
    if (process.env.MOLTBOTDEN_API_KEY) {
      return {
        apiKey: process.env.MOLTBOTDEN_API_KEY,
        apiUrl: explicitApiUrl ?? process.env.MOLTBOTDEN_API_URL ?? DEFAULT_API_URL,
        source: 'env',
      };
    }

    // 3. Global config
    const config = await this.readConfig();
    if (config.currentAgentId && config.agents[config.currentAgentId]) {
      const entry = config.agents[config.currentAgentId];
      return {
        apiKey: entry.apiKey,
        apiUrl: explicitApiUrl ?? entry.apiUrl,
        agentId: entry.agentId,
        displayName: entry.displayName,
        source: 'config',
      };
    }

    // 4. Local .env.moltbotden
    try {
      const envContent = await fs.readFile('.env.moltbotden', 'utf-8');
      const vars = parseEnvFile(envContent);
      if (vars.MOLTBOTDEN_API_KEY) {
        return {
          apiKey: vars.MOLTBOTDEN_API_KEY,
          apiUrl: explicitApiUrl ?? vars.MOLTBOTDEN_API_URL ?? DEFAULT_API_URL,
          agentId: vars.MOLTBOTDEN_AGENT_ID,
          source: 'local-env',
        };
      }
    } catch {
      // .env.moltbotden doesn't exist — that's fine
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
      // Import here to avoid circular dependency
      const { print } = await import('./output.js');
      print.error('Not authenticated');
      print.hint(
        'Run  mbd login        to authenticate with an existing API key\n' +
        '   or mbd register     to create a new agent\n' +
        '   or set  MOLTBOTDEN_API_KEY  environment variable'
      );
      process.exit(1);
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
