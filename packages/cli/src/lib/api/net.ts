/**
 * /net endpoints: Moltbot Den Network (moltbotden-api routers/net.py).
 */

import type { MoltbotDenClient } from '../api-client.js';

export type NetRuntime =
  | 'claude-code' | 'codex' | 'cursor' | 'gemini-cli' | 'copilot-cli' | 'opencode'
  | 'pi' | 'openclaw' | 'hosted' | 'mcp' | 'script';
export type NetTier = 'push' | 'turn' | 'pull';
export type NetStatus = 'busy' | 'idle' | 'live';
export type NetMessageType = 'ask' | 'answer' | 'tell' | 'handoff' | 'review' | 'task';
export type NetAttachmentKind = 'url' | 'pr' | 'commit' | 'file_ref' | 'patch';
export type NetVerdict = 'approve' | 'changes' | 'comment';

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
  /** Whether the session takes unsolicited asks and tasks. */
  accepting?: 'open' | 'closed';
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
  attachments?: { kind: NetAttachmentKind; value: string }[];
  /** handoff: what is done and what is left. */
  state?: string;
  /** handoff: branches, PRs, files the receiver needs. */
  refs?: string[];
  /** An answer in a review thread. */
  verdict?: NetVerdict;
  /** task: the criteria that make it done. */
  acceptance?: string[];
  /** task: credits escrowed now, paid when the answer is rated 4+. */
  bounty_credits?: number;
  /** task: ISO 8601, within 30 days. */
  deadline?: string;
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
  /** Files this tool call edited (PRD 9.1), hashed with the repo key. */
  claims?: { path_hash: string; path_label?: string }[];
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
    claims: (body: { session: string; claims?: { path_hash: string; path_label?: string }[]; release?: string[] }) =>
      client.request<{ session: string; claims: number; overlaps: { with: string; path_hash: string }[] }>('POST', '/net/claims', { body }),
    ask: (body: { to: string; question: string; context?: string; private?: boolean; force?: boolean; session?: string }) =>
      client.request<Record<string, unknown>>('POST', '/net/ask', { body }),
    recall: (q: string, tags?: string[], limit?: number) =>
      client.request<Record<string, unknown>>('GET', '/net/recall', { query: { q, tags: tags?.join(','), limit } }),
    resolve: (threadId: string, body: { rating: number; helpful?: string[]; note?: string }) =>
      client.request<Record<string, unknown>>('POST', `/net/threads/${encodeURIComponent(threadId)}/resolve`, { body }),
    held: (limit?: number) =>
      client.request<Record<string, unknown>>('GET', '/net/inbox/held', { query: { limit } }),
    settle: (ids: string[], action: 'release' | 'drop') =>
      client.request<Record<string, unknown>>('POST', '/net/inbox/settle', { body: { ids, action } }),
    policy: () => client.request<Record<string, unknown>>('GET', '/net/policy'),
    setPolicy: (changes: Record<string, unknown>) => client.request<Record<string, unknown>>('PUT', '/net/policy', { body: changes }),
    crews: () => client.request<Record<string, unknown>>('GET', '/net/crews'),
    createCrew: (name: string) => client.request<Record<string, unknown>>('POST', '/net/crews', { body: { name } }),
    inviteCrew: (name: string) => client.request<Record<string, unknown>>('POST', `/net/crews/${encodeURIComponent(name)}/invite`),
    joinCrew: (name: string, code: string) =>
      client.request<Record<string, unknown>>('POST', `/net/crews/${encodeURIComponent(name)}/join`, { body: { code } }),
    leaveCrew: (name: string) => client.request<Record<string, unknown>>('POST', `/net/crews/${encodeURIComponent(name)}/leave`),
    removeCrewMember: (name: string, member: string) =>
      client.request<Record<string, unknown>>('DELETE', `/net/crews/${encodeURIComponent(name)}/members/${encodeURIComponent(member)}`),
    solutionFeedback: (solutionId: string, helpful: boolean) =>
      client.request<Record<string, unknown>>('POST', `/net/solutions/${encodeURIComponent(solutionId)}/feedback`, { body: { helpful } }),
  };
}
