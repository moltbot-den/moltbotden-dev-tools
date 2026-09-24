import { describe, it, expect } from 'vitest';
import {
  isIdempotentMethod,
  nextRetryDelay,
  parseRetryAfter,
  MAX_RETRY_AFTER_MS,
} from '../../src/lib/retry.js';

// The retry policy exists to smooth over transient failures WITHOUT ever
// replaying a request that could have side effects twice.

describe('isIdempotentMethod', () => {
  it('treats GET/HEAD/PUT/DELETE as safe to replay', () => {
    for (const m of ['GET', 'head', 'PUT', 'DELETE']) expect(isIdempotentMethod(m)).toBe(true);
  });
  it('never treats POST/PATCH as safe to replay', () => {
    expect(isIdempotentMethod('POST')).toBe(false);
    expect(isIdempotentMethod('patch')).toBe(false);
  });
});

describe('nextRetryDelay', () => {
  it('retries idempotent requests on network errors and 502/503/504', () => {
    for (const status of [0, 502, 503, 504]) {
      expect(nextRetryDelay({ method: 'GET', attempt: 0, status })).not.toBeNull();
    }
  });

  it('never retries POST or PATCH, whatever the failure', () => {
    for (const status of [0, 429, 502, 503, 504]) {
      expect(nextRetryDelay({ method: 'POST', attempt: 0, status, retryAfterMs: 10 })).toBeNull();
      expect(nextRetryDelay({ method: 'PATCH', attempt: 0, status, retryAfterMs: 10 })).toBeNull();
    }
  });

  it('does not retry client errors or plain 500s', () => {
    for (const status of [400, 401, 403, 404, 409, 422, 500]) {
      expect(nextRetryDelay({ method: 'GET', attempt: 0, status })).toBeNull();
    }
  });

  it('retries 429 only when the server says how long to wait, and uses that wait', () => {
    expect(nextRetryDelay({ method: 'GET', attempt: 0, status: 429 })).toBeNull();
    expect(nextRetryDelay({ method: 'GET', attempt: 0, status: 429, retryAfterMs: 1500 })).toBe(1500);
    expect(
      nextRetryDelay({ method: 'GET', attempt: 0, status: 429, retryAfterMs: MAX_RETRY_AFTER_MS + 1 }),
    ).toBeNull();
  });

  it('stops after maxRetries', () => {
    const policy = { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 10 };
    expect(nextRetryDelay({ method: 'GET', attempt: 1, status: 503, policy })).not.toBeNull();
    expect(nextRetryDelay({ method: 'GET', attempt: 2, status: 503, policy })).toBeNull();
  });

  it('caps exponential backoff at maxDelayMs', () => {
    const policy = { maxRetries: 10, baseDelayMs: 1000, maxDelayMs: 3000 };
    expect(nextRetryDelay({ method: 'GET', attempt: 8, status: 503, policy })).toBe(3000);
  });
});

describe('parseRetryAfter', () => {
  it('parses delta-seconds', () => {
    expect(parseRetryAfter('3')).toBe(3000);
  });
  it('parses an HTTP date relative to now', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:05 GMT', now)).toBe(5000);
  });
  it('ignores missing or garbage values', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('soon')).toBeUndefined();
  });
});
