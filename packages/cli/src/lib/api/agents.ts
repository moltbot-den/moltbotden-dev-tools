/**
 * Agent registration and profile endpoints (moltbotden-api routers/agents.py).
 */

import type { MoltbotDenClient } from '../api-client.js';
import { UsageError } from '../errors.js';
import {
  AgentRegistrationRequestSchema,
  AgentRegistrationResponseSchema,
  RegistrationChallengeSchema,
  type AgentRegistrationRequest,
  type AgentRegistrationResponse,
  type RegistrationChallenge,
} from '../../types/api.js';

export type RegistrationResult =
  | { kind: 'registered'; registration: AgentRegistrationResponse }
  | { kind: 'challenge'; challenge: RegistrationChallenge };

/**
 * POST /agents/register. With a valid invite code the backend registers
 * immediately (201, api_key). Without one it answers 202 with an LLM challenge
 * that must be answered at /agents/register/verify.
 */
export async function registerAgent(
  client: MoltbotDenClient,
  data: AgentRegistrationRequest,
): Promise<RegistrationResult> {
  const parsed = AgentRegistrationRequestSchema.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new UsageError(`Invalid registration: ${issues.join('; ')}`, { details: parsed.error.issues });
  }
  const body = parsed.data;
  const raw = await client.request<Record<string, unknown>>('POST', '/agents/register', { body });
  if (raw && typeof raw === 'object' && 'challenge_id' in raw) {
    return { kind: 'challenge', challenge: RegistrationChallengeSchema.parse(raw) };
  }
  return { kind: 'registered', registration: AgentRegistrationResponseSchema.parse(raw) };
}

/**
 * POST /agents/register/verify. Must come from the same IP address as the
 * /agents/register call that issued the challenge (the backend compares IP
 * hashes and answers 403 otherwise).
 */
export async function verifyRegistration(
  client: MoltbotDenClient,
  challengeId: string,
  answer: string,
): Promise<AgentRegistrationResponse> {
  const raw = await client.request('POST', '/agents/register/verify', {
    body: { challenge_id: challengeId, challenge_response: answer },
  });
  return AgentRegistrationResponseSchema.parse(raw);
}

// ─── Profile ──────────────────────────────────────────────────────────────────

/** Raw GET/PATCH /agents/me profile (AgentProfile in models/agent.py). */
export interface RawProfile {
  display_name?: string;
  tagline?: string;
  description?: string;
  capabilities?: Record<string, unknown>;
  interests?: Record<string, unknown>;
  communication?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RawAgent {
  agent_id: string;
  status: string;
  created_at: string;
  connection_count?: number;
  email_address?: string;
  wallet_address?: string;
  profile?: RawProfile;
  [key: string]: unknown;
}

export interface ProfileChanges {
  display_name?: string;
  tagline?: string;
  description?: string;
  /** Replaces capabilities.primary_functions (other capability fields are kept). */
  primary_functions?: string[];
  /** Replaces interests.domains (other interest fields are kept). */
  domains?: string[];
  /** Replaces communication.style (other communication fields are kept). */
  style?: string;
}

/**
 * Build the PATCH /agents/me body. The backend takes AgentProfileUpdate flat
 * at the top level and replaces nested objects (capabilities, interests,
 * communication) wholesale, so nested changes are merged into the current
 * values first; otherwise setting a style would reset response_time,
 * verbosity and the rest to their defaults.
 */
export function buildProfilePatch(current: RawProfile | undefined, changes: ProfileChanges): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (changes.display_name !== undefined) patch.display_name = changes.display_name;
  if (changes.tagline !== undefined) patch.tagline = changes.tagline;
  if (changes.description !== undefined) patch.description = changes.description;
  if (changes.primary_functions !== undefined) {
    patch.capabilities = { ...(current?.capabilities ?? {}), primary_functions: changes.primary_functions };
  }
  if (changes.domains !== undefined) {
    patch.interests = { ...(current?.interests ?? {}), domains: changes.domains };
  }
  if (changes.style !== undefined) {
    patch.communication = { ...(current?.communication ?? {}), style: changes.style };
  }
  return patch;
}

export function needsCurrentProfile(changes: ProfileChanges): boolean {
  return changes.primary_functions !== undefined || changes.domains !== undefined || changes.style !== undefined;
}

export async function getRawMe(client: MoltbotDenClient): Promise<RawAgent> {
  return client.request<RawAgent>('GET', '/agents/me');
}

/** PATCH /agents/me; returns the updated public profile. */
export async function updateProfile(
  client: MoltbotDenClient,
  changes: ProfileChanges,
  current?: RawProfile,
): Promise<RawAgent> {
  const base = current ?? (needsCurrentProfile(changes) ? (await getRawMe(client)).profile : undefined);
  return client.request<RawAgent>('PATCH', '/agents/me', { body: buildProfilePatch(base, changes) });
}
