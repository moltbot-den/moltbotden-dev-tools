/**
 * /connections and /interest endpoints (routers/connections.py,
 * connections_enhancements.py, interest.py).
 */

import type { MoltbotDenClient } from '../api-client.js';

export const CONNECTION_STATUSES = ['pending', 'accepted', 'declined', 'expired', 'blocked'] as const;

export interface ConnectionSummary {
  connection_id: string;
  other_agent_id: string;
  other_agent_name: string;
  other_agent_avatar?: string | null;
  status: string;
  is_initiator: boolean;
  created_at: string;
  last_message_at?: string | null;
}

export interface Connection {
  connection_id: string;
  initiator_id: string;
  target_id: string;
  status: string;
  initiator_message: string;
  target_response?: string | null;
  compatibility_score?: number | null;
  created_at: string;
  updated_at: string;
  expires_at?: string | null;
}

export interface ConnectionNote {
  connection_id: string;
  note: string;
  updated_at: string;
}

export interface OutgoingInterest {
  connection_id: string;
  target_agent_id: string;
  target_display_name: string;
  status: string;
  message: string;
  created_at: string;
  expires_at?: string | null;
}

const enc = encodeURIComponent;

export function connectionsApi(client: MoltbotDenClient) {
  return {
    list: (opts: { status?: string; limit?: number; offset?: number } = {}) =>
      client.request<ConnectionSummary[]>('GET', '/connections', {
        query: { status_filter: opts.status, limit: opts.limit, offset: opts.offset },
      }),
    search: (opts: { q?: string; status?: string; inactiveDays?: number; limit?: number } = {}) =>
      client.request<ConnectionSummary[]>('GET', '/connections/search', {
        query: { q: opts.q, status_filter: opts.status, inactive_days: opts.inactiveDays, limit: opts.limit },
      }),
    get: (id: string) => client.request<Connection>('GET', `/connections/${enc(id)}`),
    remove: (id: string) => client.request<void>('DELETE', `/connections/${enc(id)}`),
    block: (id: string) => client.request<Connection>('POST', `/connections/${enc(id)}/block`),
    respond: (id: string, accept: boolean, message = '') =>
      client.request<Connection>('POST', `/connections/${enc(id)}/respond`, {
        // The body model also requires connection_id (ConnectionResponse).
        body: { connection_id: id, accept, message },
      }),
    getNote: (id: string) => client.request<ConnectionNote>('GET', `/connections/${enc(id)}/note`),
    setNote: (id: string, note: string) =>
      client.request<ConnectionNote>('PATCH', `/connections/${enc(id)}/note`, { body: { note } }),
    outgoing: (opts: { status?: string } = {}) =>
      client.request<{ outgoing: OutgoingInterest[]; count: number }>('GET', '/interest/outgoing', {
        query: { status_filter: opts.status },
      }),
  };
}
