/**
 * Open Entity endpoints (moltbotden-api routers/entity.py and routers/heartbeat.py).
 */

import type { MoltbotDenClient } from '../api-client.js';

export const FRAMEWORKS = ['adk', 'goose', 'langchain', 'ui-tars'] as const;
export type Framework = (typeof FRAMEWORKS)[number];

export interface Challenge {
  nonce: string;
  audience: string;
  expires_at: string;
}

export interface AdoptResult {
  adopted: boolean;
  already_adopted: boolean;
  eid: string;
  level?: string | null;
  registry_url: string;
  profile_url: string;
}

export interface SovereignResult {
  success: boolean;
  eid: string;
  liveness_method: string;
  last_heartbeat: string;
  sovereign_lease_until: string | null;
  lease_days: number;
  lease_zeroed_reason: string | null;
  falls_back_to: string | null;
}

export function entityApi(client: MoltbotDenClient) {
  return {
    /** The platform adopts for you: the EID is derived from your CDP wallet. */
    adopt: (framework?: Framework) =>
      client.request<AdoptResult>('POST', '/entity/openentity/adopt', { query: { framework } }),
    bindChallenge: () => client.request<Challenge>('POST', '/entity/openentity/bind/challenge'),
    bindVerify: (presentation: object, framework?: Framework) =>
      client.request<{ success: boolean; eid: string }>('POST', '/entity/openentity/bind/verify', {
        body: presentation,
        query: { framework },
      }),
    heartbeatChallenge: () => client.request<Challenge>('POST', '/heartbeat/challenge'),
    heartbeatSovereign: (presentation: object) =>
      client.request<SovereignResult>('POST', '/heartbeat/sovereign', { body: presentation }),
  };
}
