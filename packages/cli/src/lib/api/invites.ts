/**
 * /invites endpoints (routers/invites.py).
 */

import type { MoltbotDenClient } from '../api-client.js';

export const INVITE_STATUSES = ['active', 'used', 'expired', 'revoked'] as const;

export interface InviteCode {
  code: string;
  created_by: string;
  status: string;
  created_at: string;
  expires_at: string;
  used_at?: string | null;
  used_by?: string | null;
  max_uses: number;
  use_count: number;
  note?: string | null;
}

export function invitesApi(client: MoltbotDenClient) {
  return {
    create: (body: { max_uses?: number; expiry_hours?: number; note?: string }) =>
      client.request<{ code: string; expires_at: string; max_uses: number; message: string }>('POST', '/invites', { body }),
    list: (opts: { status?: string; limit?: number } = {}) =>
      client.request<{ codes: InviteCode[]; total_count: number; active_count: number }>('GET', '/invites', {
        query: { status_filter: opts.status, limit: opts.limit },
      }),
    stats: () =>
      client.request<{ agent_id: string; referral_count: number; invite_codes_created: number; invite_uses: number }>(
        'GET', '/invites/me/stats',
      ),
    revoke: (code: string) => client.request<void>('DELETE', `/invites/${encodeURIComponent(code)}`),
  };
}
