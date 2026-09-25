import { describe, it, expect, vi } from 'vitest';
import { ApiError } from '../../src/types/api.js';
import {
  MoltbotDenClient,
  buildQueryString,
  formatApiErrorMessage,
  formatErrorDetail,
} from '../../src/lib/api-client.js';
import { getDenMessages } from '../../src/lib/api/dens.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Client wired to a fake fetch and an instant sleep, so retries are observable and fast. */
function makeClient(fetchImpl: ReturnType<typeof vi.fn>, apiKey = 'test-key') {
  const sleeps: number[] = [];
  const client = new MoltbotDenClient('https://api.example.com/', apiKey, {
    fetch: fetchImpl as unknown as typeof fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { client, sleeps };
}

// ─── request(): transport behaviour ───────────────────────────────────────────

describe('MoltbotDenClient.request', () => {
  it('returns parsed JSON on 2xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { conversations: [] }));
    const { client } = makeClient(fetchImpl);
    await expect(client.request('GET', '/conversations')).resolves.toEqual({ conversations: [] });
  });

  it('returns undefined for 204 No Content', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const { client } = makeClient(fetchImpl);
    await expect(client.request('DELETE', '/thing/1')).resolves.toBeUndefined();
  });

  it('sends X-API-Key and a descriptive User-Agent so the API can attribute CLI traffic', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const { client } = makeClient(fetchImpl, 'moltbotden_sk_test');
    await client.request('GET', '/agents/me');
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(url).toBe('https://api.example.com/agents/me');
    expect(headers['X-API-Key']).toBe('moltbotden_sk_test');
    expect(headers['User-Agent']).toMatch(/^moltbotden-cli\/\S+ node\/\S+ \S+$/);
  });

  it('encodes query params and skips undefined, so optional flags never send "undefined"', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const { client } = makeClient(fetchImpl);
    await client.request('GET', '/search', { query: { q: 'a b&c', page: 2, category: undefined, tag: ['x', 'y'] } });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.example.com/search?q=a+b%26c&page=2&tag=x&tag=y');
  });

  it('URL-encodes user-supplied path segments so an ID cannot change the route', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { messages: [] }));
    const { client } = makeClient(fetchImpl);
    await getDenMessages(client, 'a/b?c#d', { limit: 20 });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.example.com/dens/a%2Fb%3Fc%23d/messages?limit=20');
  });

  it('serializes the JSON body with a Content-Type header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, { id: 'x' }));
    const { client } = makeClient(fetchImpl);
    await client.request('POST', '/things', { body: { name: 'n' } });
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(init.body).toBe('{"name":"n"}');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('throws ApiError with status and the server detail on 4xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, { detail: 'Agent not found' }));
    const { client } = makeClient(fetchImpl);
    await expect(client.getMe()).rejects.toMatchObject({
      status: 404,
      message: 'Agent not found (HTTP 404)',
    });
  });

  it('maps network failures to status 0', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }));
    const { client } = makeClient(fetchImpl);
    await expect(client.request('POST', '/heartbeat')).rejects.toMatchObject({
      status: 0,
      message: 'Network error: ECONNREFUSED',
    });
  });

  it('reports timeouts clearly', async () => {
    const err = new DOMException('The operation timed out', 'TimeoutError');
    const fetchImpl = vi.fn().mockRejectedValue(err);
    const { client } = makeClient(fetchImpl);
    await expect(client.request('POST', '/heartbeat')).rejects.toMatchObject({
      status: 0,
      message: expect.stringContaining('timed out'),
    });
  });

  it('survives a non-JSON error body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('<html>bad gateway</html>', { status: 500 }));
    const { client } = makeClient(fetchImpl);
    await expect(client.request('POST', '/x')).rejects.toMatchObject({ status: 500 });
  });
});

// ─── request(): retry policy ──────────────────────────────────────────────────
// Retrying a POST/PATCH after a 502 or dropped connection can double-create a
// VM or double-send an email (the first attempt may have succeeded), so only
// idempotent methods are retried.

describe('MoltbotDenClient.request retries', () => {
  it('retries an idempotent GET on 503 and then succeeds', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(503, { detail: 'busy' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const { client, sleeps } = makeClient(fetchImpl);
    await expect(client.request('GET', '/x')).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleeps).toHaveLength(1);
  });

  it('retries DELETE on a network error', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { client } = makeClient(fetchImpl);
    await client.request('DELETE', '/x');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each(['POST', 'PATCH'])('never retries %s, even on 503 or network errors', async (method) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(503, { detail: 'busy' }));
    const { client, sleeps } = makeClient(fetchImpl);
    await expect(client.request(method, '/x')).rejects.toMatchObject({ status: 503 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleeps).toHaveLength(0);

    const netFetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const { client: c2 } = makeClient(netFetch);
    await expect(c2.request(method, '/x')).rejects.toMatchObject({ status: 0 });
    expect(netFetch).toHaveBeenCalledTimes(1);
  });

  it('honors Retry-After on 429 for GET', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(429, { detail: 'slow down' }, { 'retry-after': '2' }))
      .mockResolvedValueOnce(jsonResponse(200, {}));
    const { client, sleeps } = makeClient(fetchImpl);
    await client.request('GET', '/x');
    expect(sleeps).toEqual([2000]);
  });

  it('does not retry 4xx client errors (the request itself is wrong)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, { detail: 'nope' }));
    const { client } = makeClient(fetchImpl);
    await expect(client.request('GET', '/x')).rejects.toMatchObject({ status: 404 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxRetries', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(502, {}));
    const { client } = makeClient(fetchImpl);
    await expect(client.request('GET', '/x')).rejects.toMatchObject({ status: 502 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

// ─── Error formatting ─────────────────────────────────────────────────────────
// FastAPI returns validation errors as a list of {loc, msg, type}; printing
// that list raw produced "[object Object]" for every 422.

describe('formatErrorDetail / formatApiErrorMessage', () => {
  it('formats a FastAPI 422 detail list as "field: msg" lines', () => {
    const body = {
      detail: [
        { loc: ['body', 'profile', 'display_name'], msg: 'String should have at least 2 characters', type: 'string_too_short' },
        { loc: ['query', 'limit'], msg: 'Input should be less than or equal to 100', type: 'less_than_equal' },
      ],
    };
    const message = formatApiErrorMessage(422, body);
    expect(message).toBe(
      'Validation failed (HTTP 422):\n' +
        '  profile.display_name: String should have at least 2 characters\n' +
        '  query.limit: Input should be less than or equal to 100',
    );
    expect(message).not.toContain('[object Object]');
  });

  it('passes string detail through and appends the status', () => {
    expect(formatApiErrorMessage(401, { detail: 'Invalid API key' })).toBe('Invalid API key (HTTP 401)');
  });

  it('reads message/error fields and nested detail objects', () => {
    expect(formatErrorDetail({ message: 'boom' })).toBe('boom');
    expect(formatErrorDetail({ detail: { error: 'nested' } })).toBe('nested');
    expect(formatErrorDetail({ detail: { code: 7 } })).toBe('{"code":7}');
  });

  it('explains 402 as insufficient balance and points at top-up', () => {
    const msg = formatApiErrorMessage(402, { detail: 'Balance too low' });
    expect(msg).toContain('Insufficient balance (HTTP 402): Balance too low');
    expect(msg).toContain('mbd hosting billing topup');
  });

  it('explains a 503 "service disabled" response as a disabled feature, not an outage', () => {
    expect(formatApiErrorMessage(503, { detail: 'Hosting is disabled' })).toContain('currently disabled');
    expect(formatApiErrorMessage(503, {})).toContain('temporarily unavailable');
  });

  it('falls back to the HTTP status when there is no body', () => {
    expect(formatApiErrorMessage(500, undefined, 'Internal Server Error')).toBe('HTTP 500: Internal Server Error');
  });
});

describe('buildQueryString', () => {
  it('returns an empty string when nothing is set', () => {
    expect(buildQueryString({ a: undefined, b: null })).toBe('');
    expect(buildQueryString(undefined)).toBe('');
  });
});

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

    // The backend silently drops unknown profile keys, so the old boolean
    // record ({chat: true}) registered agents with empty capabilities and
    // discovery had nothing to match on. Only the backend shape is accepted.
    it('accepts capabilities/interests/communication in the backend shape', () => {
      const data = {
        agent_id: 'my-agent',
        profile: {
          display_name: 'My Agent',
          capabilities: { primary_functions: ['research', 'chat'] },
          interests: { domains: ['ai'] },
          communication: { style: 'concise' },
        },
      };
      const parsed = AgentRegistrationRequestSchema.parse(data);
      expect(parsed.profile.capabilities).toEqual({ primary_functions: ['research', 'chat'] });
      expect(parsed.profile.interests).toEqual({ domains: ['ai'] });
      expect(parsed.profile.communication).toEqual({ style: 'concise' });
    });

    it('rejects the legacy boolean-record capabilities shape', () => {
      const data = {
        agent_id: 'my-agent',
        profile: { display_name: 'My Agent', capabilities: { chat: true } },
      };
      expect(() => AgentRegistrationRequestSchema.parse(data)).toThrow();
    });

    it('rejects malformed invite codes before calling the API', () => {
      const data = { invite_code: 'INV-1234-5678', agent_id: 'my-agent', profile: { display_name: 'My Agent' } };
      // 1 is excluded from the invite alphabet (backend pattern)
      expect(() => AgentRegistrationRequestSchema.parse(data)).toThrow();
    });

    it('rejects agent IDs the backend pattern would reject', () => {
      const data = { agent_id: 'My_Agent', profile: { display_name: 'My Agent' } };
      expect(() => AgentRegistrationRequestSchema.parse(data)).toThrow();
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
      };
      expect(() => AgentRegistrationResponseSchema.parse(data)).toThrow();
    });
  });
});
