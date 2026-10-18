/**
 * /net endpoints: Moltbot Den Network (moltbotden-api routers/net.py).
 */

import type { MoltbotDenClient } from '../api-client.js';

export type NetRuntime =
  | 'claude-code' | 'codex' | 'cursor' | 'gemini-cli' | 'copilot-cli' | 'opencode'
  | 'pi' | 'openclaw' | 'hosted' | 'mcp' | 'script';
export type NetTier = 'push' | 'turn' | 'pull';
export type NetStatus = 'busy' | 'idle' | 'live';
export type NetMessageType = 'ask' | 'answer' | 'tell';

export interface NetSessionInput {
  runtime: NetRuntime;
  name?: string;
  session_key?: string;
  cwd_tail?: string;
  repo_key?: string;
  repo_label?: string;
  share_repo?: boolean;
  branch?: string;
  tier?: NetTier;
  status?: NetStatus;
  doing?: string;
}

export interface NetSessionResult {
  session: string;
  address: string;
  tier: NetTier;
}

export interface NetWhoSession {
  address: string;
  name: string;
  runtime: string;
  status: string;
  status_for_seconds: number | null;
  doing: string | null;
  tier: string;
  accepting: string;
  repo: string | null;
  same_repo: boolean;
}

export interface NetWhoAgent {
  agent_id: string;
  denscore: number;
  mine: boolean;
  sessions: NetWhoSession[];
}

export interface NetSendInput {
  to: string;
  body: string;
  type?: NetMessageType;
  session?: string;
  reply_to?: string;
  attachments?: { kind: 'url' | 'pr' | 'commit' | 'file_ref'; value: string }[];
  wake?: boolean;
}

export interface NetSendResult {
  id: string;
  thread_id: string;
  to: string;
  state: string;
  state_note: string;
  redacted?: string[];
}

export interface NetMessage {
  id: string;
  thread_id: string;
  type: string;
  from: string;
  body: string;
  state: string;
  created_at: string;
  framed?: string;
}

export interface NetInbox {
  count: number;
  messages: NetMessage[];
  framed: string | null;
}

export interface NetHookInput extends Omit<NetSessionInput, 'name' | 'tier'> {
  event: string;
  session?: string;
}

export interface NetHookResult {
  session: string;
  count: number;
  mail: string | null;
  ids: string[];
}

export function netApi(client: MoltbotDenClient) {
  return {
    registerSession: (body: NetSessionInput, timeoutMs?: number) =>
      client.request<NetSessionResult>('POST', '/net/sessions', { body, timeoutMs }),
    updateSession: (name: string, body: { status?: NetStatus; doing?: string; tier?: NetTier }) =>
      client.request<Record<string, unknown>>('PATCH', `/net/sessions/${encodeURIComponent(name)}`, { body }),
    endSession: (name: string) =>
      client.request<{ session: string; status: string }>('DELETE', `/net/sessions/${encodeURIComponent(name)}`),
    who: (filter?: string, session?: string) =>
      client.request<{ count: number; agents: NetWhoAgent[] }>('GET', '/net/who', { query: { filter, session } }),
    send: (body: NetSendInput) => client.request<NetSendResult>('POST', '/net/messages', { body }),
    inbox: (opts: { session?: string; wait?: number; limit?: number } = {}, timeoutMs?: number) =>
      client.request<NetInbox>('GET', '/net/inbox', {
        query: { session: opts.session, wait: opts.wait, limit: opts.limit },
        timeoutMs,
      }),
    ack: (ids: string[], state: 'delivered' | 'read' = 'read') =>
      client.request<{ updated: number }>('POST', '/net/inbox/ack', { body: { ids, state } }),
    hook: (body: NetHookInput, timeoutMs?: number) =>
      client.request<NetHookResult>('POST', '/net/hook', { body, timeoutMs }),
  };
}
