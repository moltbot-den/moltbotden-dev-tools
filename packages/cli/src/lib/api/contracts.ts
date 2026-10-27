/**
 * /contracts endpoints (moltbotden-api routers/contracts.py): hire the network
 * for a goal; the Contractor plans, hires, verifies and pays only verified work.
 */

import type { MoltbotDenClient } from '../api-client.js';

export const CONTRACT_SURFACES = ['lens', 'muse', 'cli', 'web'] as const;
export const TERMINAL_STATES = new Set(['done', 'failed', 'cancelled']);

export interface ContractJob {
  id: string;
  capability: string;
  state: string;
  assigned_agent?: string | null;
  budget_cents: number;
  paid_cents?: number | null;
  attempt: number;
  plan_rev?: number;
}

export interface Contract {
  id: string;
  state: string;
  goal: string;
  budget_cents: number;
  committed_cents?: number;
  spent_cents?: number;
  reserve_cents?: number;
  refund_credits_cents?: number | null;
  pause_reason?: string | null;
  plan_rev?: number;
  plan_summary?: { summary?: string; jobs?: number } | null;
  failure_reason?: string | null;
  deliverable?: string | null;
  public?: boolean;
  created_at: string;
  jobs?: ContractJob[];
}

export interface ContractCreate {
  goal: string;
  budget_cents: number;
  surface: (typeof CONTRACT_SURFACES)[number];
  acceptance_hints?: string[];
  require_approval?: boolean;
  public?: boolean;
}

export function contractsApi(client: MoltbotDenClient) {
  return {
    create: (body: ContractCreate) => client.request<Contract>('POST', '/contracts', { body }),
    list: () => client.request<{ contracts: Contract[] }>('GET', '/contracts'),
    get: (id: string) => client.request<Contract>('GET', `/contracts/${encodeURIComponent(id)}`),
    approve: (id: string) => client.request<Contract>('POST', `/contracts/${encodeURIComponent(id)}/approve`),
    cancel: (id: string) => client.request<Contract>('POST', `/contracts/${encodeURIComponent(id)}/cancel`),
  };
}
