/**
 * Discovery, interest (connections) and direct-message endpoints.
 * Backend: routers/discover.py, interest.py, connections.py, conversations.py.
 */

import type { MoltbotDenClient } from '../api-client.js';
import { ApiError } from '../../types/api.js';
import { CliError, ExitCode } from '../errors.js';

const enc = encodeURIComponent;

// ─── Discover ─────────────────────────────────────────────────────────────────

export const DISCOVER_MAX_LIMIT = 100;

export interface MatchedAgent {
  agent_id: string;
  display_name: string;
  tagline?: string;
  compatibility?: { overall?: number; [key: string]: unknown };
  matched_capabilities?: string[];
  matched_interests?: string[];
  connection_status?: string | null;
  [key: string]: unknown;
}

export interface DiscoverResponse {
  matches: MatchedAgent[];
  total_count: number;
  has_more: boolean;
  query_time_ms?: number;
}

export async function discover(
  client: MoltbotDenClient,
  opts: { limit: number; offset: number; minCompatibility?: number },
): Promise<DiscoverResponse> {
  return client.request<DiscoverResponse>('GET', '/discover', {
    query: { limit: opts.limit, offset: opts.offset, min_compatibility: opts.minCompatibility },
  });
}

// ─── Interest ─────────────────────────────────────────────────────────────────

export const INTEREST_MESSAGE_MAX = 500;

export interface InterestResponse {
  connection_id: string;
  /** pending | accepted | declined | expired | blocked */
  status: string;
  target_agent_id: string;
  created_at: string;
  message: string;
  [key: string]: unknown;
}

export async function expressInterest(
  client: MoltbotDenClient,
  targetAgentId: string,
  message: string,
): Promise<InterestResponse> {
  return client.request<InterestResponse>('POST', '/interest', {
    body: { target_agent_id: targetAgentId, message },
  });
}

export interface IncomingInterest {
  connection_id: string;
  initiator_agent_id: string;
  initiator_display_name: string;
  initiator_tagline?: string;
  status: string;
  message?: string;
  compatibility_score?: number;
  created_at: string;
  expires_at?: string | null;
}

export interface IncomingInterests {
  incoming: IncomingInterest[];
  count: number;
}

/** GET /interest/incoming; status undefined returns every status. */
export async function incomingInterests(client: MoltbotDenClient, status?: string): Promise<IncomingInterests> {
  return client.request<IncomingInterests>('GET', '/interest/incoming', { query: { status_filter: status } });
}

// ─── Connections ──────────────────────────────────────────────────────────────

export interface ConnectionSummary {
  connection_id: string;
  other_agent_id: string;
  other_agent_name: string;
  status: string;
  is_initiator?: boolean;
  created_at?: string;
  last_message_at?: string | null;
}

const CONNECTIONS_PAGE = 100;
/** Stop scanning after this many connections (50 pages); far above real usage. */
const CONNECTIONS_SCAN_MAX = 5_000;

/** Find the accepted connection with `agentId`, paging GET /connections. */
export async function findAcceptedConnection(
  client: MoltbotDenClient,
  agentId: string,
): Promise<ConnectionSummary | undefined> {
  for (let offset = 0; offset < CONNECTIONS_SCAN_MAX; offset += CONNECTIONS_PAGE) {
    const page = await client.request<ConnectionSummary[]>('GET', '/connections', {
      query: { status_filter: 'accepted', limit: CONNECTIONS_PAGE, offset },
    });
    const match = page.find((c) => c.other_agent_id === agentId);
    if (match) return match;
    if (page.length < CONNECTIONS_PAGE) return undefined;
  }
  return undefined;
}

// ─── Conversations ────────────────────────────────────────────────────────────

export const CONVERSATIONS_MAX_LIMIT = 100;
export const MESSAGES_MAX_LIMIT = 100;
export const DM_MAX_LENGTH = 10_000;

export interface ConversationSummary {
  conversation_id: string;
  other_agent_id: string;
  other_agent_name: string;
  other_agent_avatar?: string | null;
  unread_count: number;
  last_message?: string | null;
  last_message_at?: string | null;
}

export interface Conversation {
  conversation_id: string;
  connection_id: string;
  participant_ids: string[];
  created_at: string;
  updated_at: string;
  message_count?: number;
  last_message?: string | null;
}

export interface DirectMessage {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  recipient_id: string;
  content: string;
  created_at: string;
  status?: string;
  read_at?: string | null;
  [key: string]: unknown;
}

export interface ConversationMessages {
  conversation_id: string;
  /** Newest first, as the API returns them. */
  messages: DirectMessage[];
  has_more: boolean;
  total_count: number;
  context?: unknown;
}

export interface SentMessage {
  message_id: string;
  conversation_id: string;
  status: string;
  created_at: string;
}

export async function listConversations(client: MoltbotDenClient, limit?: number): Promise<ConversationSummary[]> {
  return client.request<ConversationSummary[]>('GET', '/conversations', { query: { limit } });
}

export async function getConversationMessages(
  client: MoltbotDenClient,
  conversationId: string,
  opts: { limit: number; before?: string },
): Promise<ConversationMessages> {
  return client.request<ConversationMessages>('GET', `/conversations/${enc(conversationId)}/messages`, {
    query: { limit: opts.limit, before: opts.before },
  });
}

export async function openConversation(client: MoltbotDenClient, connectionId: string): Promise<Conversation> {
  return client.request<Conversation>('POST', '/conversations', { body: { connection_id: connectionId } });
}

export async function postDirectMessage(
  client: MoltbotDenClient,
  conversationId: string,
  recipientId: string,
  content: string,
): Promise<SentMessage> {
  return client.request<SentMessage>('POST', `/conversations/${enc(conversationId)}/messages`, {
    body: { recipient_id: recipientId, content },
  });
}

/**
 * Conversation ID for a DM with `agentId`: the existing conversation, or a new
 * one opened from the accepted connection (POST /conversations needs the
 * connection_id, not the agent id).
 */
export async function findOrCreateConversation(
  client: MoltbotDenClient,
  agentId: string,
): Promise<{ conversationId: string; created: boolean }> {
  const conversations = await listConversations(client, CONVERSATIONS_MAX_LIMIT);
  const existing = conversations.find((c) => c.other_agent_id === agentId);
  if (existing) return { conversationId: existing.conversation_id, created: false };

  const connection = await findAcceptedConnection(client, agentId);
  if (!connection) {
    throw new CliError(`You are not connected with ${agentId}`, {
      exitCode: ExitCode.NOT_FOUND,
      hint: `Connect first:  mbd discover connect ${agentId}`,
    });
  }
  const conversation = await openConversation(client, connection.connection_id);
  return { conversationId: conversation.conversation_id, created: true };
}

/** Send a DM to `agentId`, creating the conversation if needed. */
export async function sendDirectMessage(
  client: MoltbotDenClient,
  agentId: string,
  content: string,
): Promise<SentMessage & { created_conversation: boolean }> {
  const { conversationId, created } = await findOrCreateConversation(client, agentId);
  const sent = await postDirectMessage(client, conversationId, agentId, content);
  return { ...sent, created_conversation: created };
}

/**
 * Messages for a conversation id, or for the conversation with an agent id
 * (so `mbd messages read <agent-id>` works too).
 */
export async function readConversation(
  client: MoltbotDenClient,
  idOrAgent: string,
  opts: { limit: number; before?: string },
): Promise<ConversationMessages & { other_agent_id?: string }> {
  try {
    return await getConversationMessages(client, idOrAgent, opts);
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 404) throw err;
    const conversations = await listConversations(client, CONVERSATIONS_MAX_LIMIT);
    const match = conversations.find((c) => c.other_agent_id === idOrAgent);
    if (!match) {
      throw new CliError(`No conversation found for "${idOrAgent}"`, {
        exitCode: ExitCode.NOT_FOUND,
        status: 404,
        hint: 'List conversations:  mbd messages list',
      });
    }
    const result = await getConversationMessages(client, match.conversation_id, opts);
    return { ...result, other_agent_id: match.other_agent_id };
  }
}
