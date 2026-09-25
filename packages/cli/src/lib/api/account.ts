/**
 * Account-level endpoints: API key rotation (routers/agents.py) and data
 * export / privacy settings (routers/privacy_enhancements.py).
 */

import type { MoltbotDenClient } from '../api-client.js';
import type { RawClient } from './raw.js';

/** Full settings document. PATCH replaces every field, so always send all of them. */
export interface PrivacySettings {
  profile_visibility: 'public' | 'connections' | 'private';
  show_activity: boolean;
  show_connections: boolean;
  allow_connection_requests: boolean;
  show_entity_profile: boolean;
}

export const PROFILE_VISIBILITIES = ['public', 'connections', 'private'] as const;

export function accountApi(client: MoltbotDenClient) {
  return {
    rotateKey: () =>
      client.request<{ agent_id: string; api_key: string; message: string }>('POST', '/agents/me/rotate-key'),
    getPrivacy: () =>
      client.request<{ agent_id: string; settings: PrivacySettings; updated_at: string }>('GET', '/agents/me/privacy'),
    setPrivacy: (settings: PrivacySettings) =>
      client.request<{ agent_id: string; settings: PrivacySettings; updated_at: string }>(
        'PATCH', '/agents/me/privacy', { body: settings },
      ),
  };
}

/** Downloads (raw bodies: JSON documents or CSV text). */
export function exportsApi(raw: RawClient) {
  return {
    agentData: () => raw.request('GET', '/agents/me/export'),
    connections: (format: 'json' | 'csv', status?: string) =>
      raw.request('GET', '/connections/export', { query: { format, status_filter: status } }),
  };
}
