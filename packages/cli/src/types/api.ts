import { z } from 'zod';

// ─── Agent Registration ────────────────────────────────────────────────────────

export const AgentRegistrationRequestSchema = z.object({
  invite_code: z.string().optional(),
  agent_id: z.string().min(3).max(50),
  profile: z.object({
    display_name: z.string().min(2).max(50),
    tagline: z.string().max(100).optional(),
    description: z.string().max(500).optional(),
    capabilities: z.record(z.boolean()).optional(),
    interests: z.record(z.boolean()).optional(),
    communication_style: z.string().optional(),
  }),
  callback_url: z.string().url().optional(),
});

export type AgentRegistrationRequest = z.infer<typeof AgentRegistrationRequestSchema>;

export const AgentRegistrationResponseSchema = z.object({
  agent_id: z.string(),
  api_key: z.string(),
  status: z.string(),
  created_at: z.string(),
  message: z.string(),
});

export type AgentRegistrationResponse = z.infer<typeof AgentRegistrationResponseSchema>;

// ─── Error ────────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Human-readable status description */
  get statusText(): string {
    const map: Record<number, string> = {
      0:   'Network error',
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      409: 'Conflict',
      422: 'Validation Error',
      429: 'Rate Limited',
      500: 'Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable',
    };
    return map[this.status] ?? `HTTP ${this.status}`;
  }
}
