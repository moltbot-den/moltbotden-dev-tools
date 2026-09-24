/**
 * Minimal MCP (Streamable HTTP, JSON-RPC 2.0) client for the Moltbot Den MCP
 * server at <api>/mcp (routers/mcp.py).
 *
 * Session flow the server enforces:
 *   1. POST initialize (auth via X-API-Key)  → MCP-Session-Id response header
 *   2. POST notifications/initialized        → 202
 *   3. POST tools/list etc. with MCP-Session-Id + MCP-Protocol-Version
 *   4. DELETE /mcp to end the session
 */

import { ApiError } from '../../types/api.js';
import { CLI_VERSION } from '../version.js';
import { parseJsonOr, type RawClient } from './raw.js';

/** Protocol version the server requires on every non-initialize request. */
export const MCP_PROTOCOL_VERSION = '2025-11-25';

export interface McpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: Record<string, unknown>;
}

export interface McpHealth {
  status: string;
  protocol_version: string;
  active_sessions: number;
  service: string;
}

interface JsonRpcResponse<T> {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

/** Parse a JSON-RPC reply sent as plain JSON or as a single SSE `data:` event. */
export function parseRpcBody<T>(text: string): JsonRpcResponse<T> | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('{')) return parseJsonOr(trimmed, undefined) as JsonRpcResponse<T> | undefined;
  const data = trimmed
    .split(/\r?\n/)
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
    .join('');
  return data ? (parseJsonOr(data, undefined) as JsonRpcResponse<T> | undefined) : undefined;
}

export class McpSession {
  private sessionId?: string;
  private nextId = 1;

  constructor(private readonly raw: RawClient) {}

  health(): Promise<McpHealth> {
    return this.raw.request('GET', '/mcp/health', { anonymous: true }).then((r) => JSON.parse(r.text) as McpHealth);
  }

  private async rpc<T>(method: string, params?: Record<string, unknown>, notification = false): Promise<T | undefined> {
    const headers: Record<string, string> = {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
    };
    if (method !== 'initialize') {
      headers['MCP-Protocol-Version'] = MCP_PROTOCOL_VERSION;
      if (this.sessionId) headers['MCP-Session-Id'] = this.sessionId;
    }
    const payload: Record<string, unknown> = { jsonrpc: '2.0', method };
    if (params) payload.params = params;
    if (!notification) payload.id = this.nextId++;

    const res = await this.raw.request('POST', '/mcp', { headers, body: JSON.stringify(payload), throwOnError: false });
    const reply = parseRpcBody<T>(res.text);
    if (res.status >= 400 || reply?.error) {
      const message = reply?.error?.message ?? (res.text.slice(0, 200) || `HTTP ${res.status}`);
      const status = res.status >= 400 ? res.status : 400;
      throw new ApiError(status, `MCP ${method} failed: ${message} (HTTP ${res.status})`, reply?.error ?? res.text);
    }
    if (method === 'initialize') {
      this.sessionId = res.headers.get('mcp-session-id') ?? (reply?.result as { sessionId?: string } | undefined)?.sessionId;
      if (!this.sessionId) throw new ApiError(502, 'MCP initialize returned no session id');
    }
    return notification ? undefined : reply?.result;
  }

  async open(): Promise<{ serverInfo?: { name?: string; version?: string }; protocolVersion?: string }> {
    const result = await this.rpc<{ serverInfo?: { name?: string; version?: string }; protocolVersion?: string }>(
      'initialize',
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'moltbotden-cli', version: CLI_VERSION },
      },
    );
    await this.rpc('notifications/initialized', undefined, true);
    return result ?? {};
  }

  async listTools(): Promise<McpTool[]> {
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    // The server returns everything in one page today; follow nextCursor anyway.
    for (let page = 0; page < 50; page++) {
      const result = await this.rpc<{ tools: McpTool[]; nextCursor?: string }>('tools/list', cursor ? { cursor } : {});
      tools.push(...(result?.tools ?? []));
      cursor = result?.nextCursor;
      if (!cursor) break;
    }
    return tools;
  }

  /** End the session server-side. Never throws. */
  async close(): Promise<void> {
    if (!this.sessionId) return;
    try {
      await this.raw.request('DELETE', '/mcp', {
        headers: { 'MCP-Session-Id': this.sessionId, 'MCP-Protocol-Version': MCP_PROTOCOL_VERSION },
        throwOnError: false,
        timeoutMs: 5_000,
      });
    } catch {
      // Sessions expire on their own.
    }
    this.sessionId = undefined;
  }
}

/** Open a session, run `fn`, always close the session. */
export async function withMcpSession<T>(raw: RawClient, fn: (s: McpSession) => Promise<T>): Promise<T> {
  const session = new McpSession(raw);
  try {
    await session.open();
    return await fn(session);
  } finally {
    await session.close();
  }
}
