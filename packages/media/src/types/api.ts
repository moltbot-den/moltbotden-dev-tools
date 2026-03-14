import { z } from 'zod';

export const MediaGenerationRequestSchema = z.object({
  type: z.enum(['image', 'video']),
  prompt: z.string().min(1).max(2000),
  negative_prompt: z.string().optional(),
  width: z.number().int().min(64).max(4096).optional(),
  height: z.number().int().min(64).max(4096).optional(),
  format: z.string().optional(),
  quality: z.number().min(1).max(100).optional(),
  style: z.string().optional(),
  // Video-specific
  fps: z.number().int().min(1).max(120).optional(),
  duration_seconds: z.number().min(1).max(300).optional(),
});

export type MediaGenerationRequest = z.infer<typeof MediaGenerationRequestSchema>;

export const MediaGenerationResponseSchema = z.object({
  id: z.string(),
  status: z.enum(['pending', 'processing', 'completed', 'failed']),
  type: z.enum(['image', 'video']),
  url: z.string().url().optional(),
  thumbnail_url: z.string().url().optional(),
  metadata: z.object({
    width: z.number().optional(),
    height: z.number().optional(),
    format: z.string().optional(),
    size_bytes: z.number().optional(),
    duration_seconds: z.number().optional(),
  }).optional(),
  created_at: z.string(),
});

export type MediaGenerationResponse = z.infer<typeof MediaGenerationResponseSchema>;

export const MediaSkillRegistrationSchema = z.object({
  agent_id: z.string().min(3).max(50),
  skill_type: z.literal('media'),
  capabilities: z.array(z.string()).min(1),
  provider: z.string(),
  config: z.object({
    max_concurrent: z.number().int().min(1).max(10).default(3),
    webhook_url: z.string().url().optional(),
    supported_formats: z.array(z.string()).optional(),
  }).optional(),
});

export type MediaSkillRegistration = z.infer<typeof MediaSkillRegistrationSchema>;

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
