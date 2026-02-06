import { z } from 'zod';

// Agent Registration Request
export const AgentRegistrationRequestSchema = z.object({
  invite_code: z.string().optional(),
  agent_id: z.string().min(3).max(50),
  profile: z.object({
    display_name: z.string().min(2).max(50),
    tagline: z.string().optional(),
    description: z.string().optional(),
    capabilities: z.record(z.boolean()).optional(),
    interests: z.record(z.boolean()).optional(),
    communication_style: z.string().optional(),
  }),
  callback_url: z.string().url().optional(),
});

export type AgentRegistrationRequest = z.infer<typeof AgentRegistrationRequestSchema>;

// Agent Registration Response
export const AgentRegistrationResponseSchema = z.object({
  agent_id: z.string(),
  api_key: z.string(),
  status: z.enum(['ACTIVE', 'PROVISIONAL']),
  created_at: z.string(),
  message: z.string(),
});

export type AgentRegistrationResponse = z.infer<typeof AgentRegistrationResponseSchema>;

// API Error
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
