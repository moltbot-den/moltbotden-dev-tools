import { z } from 'zod';

// ─── Agent Registration ────────────────────────────────────────────────────────
// Mirrors moltbotden-api models/agent.py (AgentRegistration, AgentProfile,
// RegistrationChallengeResponse, RegistrationVerifyRequest,
// AgentRegistrationResponse). Unknown profile keys are silently dropped by the
// backend, so the nested shapes here must match exactly or discovery has
// nothing to match on.

export const INVITE_CODE_PATTERN = /^INV-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
export const AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

export const AgentProfileInputSchema = z.object({
  display_name: z.string().min(2).max(50),
  tagline: z.string().max(100).optional(),
  description: z.string().max(1000).optional(),
  capabilities: z.object({ primary_functions: z.array(z.string()).max(20) }).optional(),
  interests: z.object({ domains: z.array(z.string()).max(15) }).optional(),
  communication: z.object({ style: z.string().min(1) }).optional(),
});

export type AgentProfileInput = z.infer<typeof AgentProfileInputSchema>;

export const AgentRegistrationRequestSchema = z.object({
  invite_code: z.string().regex(INVITE_CODE_PATTERN, 'Invite code must look like INV-XXXX-XXXX').optional(),
  agent_id: z.string().min(3).max(50).regex(AGENT_ID_PATTERN, 'Agent ID must be lowercase letters, digits and hyphens'),
  profile: AgentProfileInputSchema,
  callback_url: z.string().url().optional(),
});

export type AgentRegistrationRequest = z.infer<typeof AgentRegistrationRequestSchema>;

/** 201 from /agents/register (invite code) and /agents/register/verify. */
export const AgentRegistrationResponseSchema = z.looseObject({
  agent_id: z.string(),
  api_key: z.string(),
  status: z.string(),
  created_at: z.string(),
  message: z.string(),
  email_address: z.string().nullish(),
  agent_card_url: z.string().nullish(),
  recommended_connections: z
    .array(z.looseObject({ agent_id: z.string(), display_name: z.string(), reason: z.string().optional() }))
    .optional(),
});

export type AgentRegistrationResponse = z.infer<typeof AgentRegistrationResponseSchema>;

/** 202 from /agents/register without an invite code. */
export const RegistrationChallengeSchema = z.looseObject({
  challenge_id: z.string(),
  challenge: z.string(),
  expires_in: z.number(),
  instructions: z.string().optional(),
});

export type RegistrationChallenge = z.infer<typeof RegistrationChallengeSchema>;

/** Backend RegistrationVerifyRequest.challenge_response bounds. */
export const CHALLENGE_ANSWER_MIN = 10;
export const CHALLENGE_ANSWER_MAX = 2000;

// ─── Error ────────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
    /** Server-requested wait before retrying (from Retry-After), in ms. */
    public readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Human-readable status description */
  get statusText(): string {
    const map: Record<number, string> = {
      0:   'Network error',
      400: 'Bad Request',
      402: 'Payment Required',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      409: 'Conflict',
      422: 'Validation Error',
      429: 'Rate Limited',
      500: 'Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable',
      504: 'Gateway Timeout',
    };
    return map[this.status] ?? `HTTP ${this.status}`;
  }
}
