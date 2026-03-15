import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '../../src/types/api.js';

describe('ApiError', () => {
  it('should store status and message', () => {
    const err = new ApiError(404, 'Not Found');
    expect(err.status).toBe(404);
    expect(err.message).toBe('Not Found');
    expect(err.name).toBe('ApiError');
  });

  it('should store details', () => {
    const details = { field: 'agent_id', reason: 'already exists' };
    const err = new ApiError(409, 'Conflict', details);
    expect(err.details).toEqual(details);
  });

  it('should provide human-readable status text', () => {
    expect(new ApiError(0, '').statusText).toBe('Network error');
    expect(new ApiError(400, '').statusText).toBe('Bad Request');
    expect(new ApiError(401, '').statusText).toBe('Unauthorized');
    expect(new ApiError(403, '').statusText).toBe('Forbidden');
    expect(new ApiError(404, '').statusText).toBe('Not Found');
    expect(new ApiError(409, '').statusText).toBe('Conflict');
    expect(new ApiError(422, '').statusText).toBe('Validation Error');
    expect(new ApiError(429, '').statusText).toBe('Rate Limited');
    expect(new ApiError(500, '').statusText).toBe('Server Error');
    expect(new ApiError(502, '').statusText).toBe('Bad Gateway');
    expect(new ApiError(503, '').statusText).toBe('Service Unavailable');
    expect(new ApiError(418, '').statusText).toBe('HTTP 418');
  });

  it('should be an instance of Error', () => {
    const err = new ApiError(500, 'Oops');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiError);
  });
});

describe('MoltbotDenClient', () => {
  // Test the Zod schemas used by the client
  describe('AgentRegistrationRequestSchema', () => {
    let AgentRegistrationRequestSchema: typeof import('../../src/types/api.js').AgentRegistrationRequestSchema;

    beforeEach(async () => {
      const mod = await import('../../src/types/api.js');
      AgentRegistrationRequestSchema = mod.AgentRegistrationRequestSchema;
    });

    it('should accept valid registration data', () => {
      const data = {
        agent_id: 'my-agent',
        profile: {
          display_name: 'My Agent',
          tagline: 'An awesome agent',
        },
      };
      expect(() => AgentRegistrationRequestSchema.parse(data)).not.toThrow();
    });

    it('should reject agent_id shorter than 3 chars', () => {
      const data = {
        agent_id: 'ab',
        profile: { display_name: 'My Agent' },
      };
      expect(() => AgentRegistrationRequestSchema.parse(data)).toThrow();
    });

    it('should reject agent_id longer than 50 chars', () => {
      const data = {
        agent_id: 'a'.repeat(51),
        profile: { display_name: 'My Agent' },
      };
      expect(() => AgentRegistrationRequestSchema.parse(data)).toThrow();
    });

    it('should reject display_name shorter than 2 chars', () => {
      const data = {
        agent_id: 'my-agent',
        profile: { display_name: 'A' },
      };
      expect(() => AgentRegistrationRequestSchema.parse(data)).toThrow();
    });

    it('should accept optional invite_code', () => {
      const data = {
        invite_code: 'INV-ABCD-2345',
        agent_id: 'my-agent',
        profile: { display_name: 'My Agent' },
      };
      expect(() => AgentRegistrationRequestSchema.parse(data)).not.toThrow();
    });

    it('should accept capabilities as boolean record', () => {
      const data = {
        agent_id: 'my-agent',
        profile: {
          display_name: 'My Agent',
          capabilities: { chat: true, research: true },
        },
      };
      const parsed = AgentRegistrationRequestSchema.parse(data);
      expect(parsed.profile.capabilities).toEqual({ chat: true, research: true });
    });

    it('should reject invalid callback_url', () => {
      const data = {
        agent_id: 'my-agent',
        profile: { display_name: 'My Agent' },
        callback_url: 'not-a-url',
      };
      expect(() => AgentRegistrationRequestSchema.parse(data)).toThrow();
    });

    it('should accept valid callback_url', () => {
      const data = {
        agent_id: 'my-agent',
        profile: { display_name: 'My Agent' },
        callback_url: 'https://example.com/webhook',
      };
      expect(() => AgentRegistrationRequestSchema.parse(data)).not.toThrow();
    });
  });

  describe('AgentRegistrationResponseSchema', () => {
    let AgentRegistrationResponseSchema: typeof import('../../src/types/api.js').AgentRegistrationResponseSchema;

    beforeEach(async () => {
      const mod = await import('../../src/types/api.js');
      AgentRegistrationResponseSchema = mod.AgentRegistrationResponseSchema;
    });

    it('should validate a valid response', () => {
      const data = {
        agent_id: 'my-agent',
        api_key: 'moltbotden_sk_abc123',
        status: 'provisional',
        created_at: '2026-03-15T00:00:00Z',
        message: 'Welcome to MoltbotDen!',
      };
      expect(() => AgentRegistrationResponseSchema.parse(data)).not.toThrow();
    });

    it('should reject missing fields', () => {
      const data = {
        agent_id: 'my-agent',
        // missing api_key, status, created_at, message
      };
      expect(() => AgentRegistrationResponseSchema.parse(data)).toThrow();
    });
  });
});
