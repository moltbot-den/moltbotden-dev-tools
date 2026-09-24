/**
 * Retry policy for API requests (used by MoltbotDenClient.request).
 *
 * Only idempotent methods are ever retried. Replaying a POST or PATCH after a
 * network blip or 502 can create a second VM, send a second email or charge
 * twice, because the first attempt may have reached the server.
 *
 * Retried: network errors/timeouts and 502/503/504, plus 429 when the server
 * says how long to wait (Retry-After) and that wait is reasonable.
 */

export const IDEMPOTENT_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']);

const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

/** Longest Retry-After we are willing to sleep through before giving up. */
export const MAX_RETRY_AFTER_MS = 30_000;

export interface RetryPolicy {
  /** Retries after the first attempt (total attempts = maxRetries + 1). */
  maxRetries: number;
  /** Base for exponential backoff, in ms. */
  baseDelayMs: number;
  /** Upper bound for a computed backoff delay, in ms. */
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 2,
  baseDelayMs: 500,
  maxDelayMs: 5_000,
};

export function isIdempotentMethod(method: string): boolean {
  return IDEMPOTENT_METHODS.has(method.toUpperCase());
}

/**
 * Parse a Retry-After header (delta-seconds or HTTP-date) into milliseconds.
 * Returns undefined when absent or unparseable.
 */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}

export function backoffDelay(attempt: number, policy: RetryPolicy = DEFAULT_RETRY_POLICY): number {
  const exp = policy.baseDelayMs * 2 ** attempt;
  const jitter = Math.random() * (policy.baseDelayMs / 2);
  return Math.min(policy.maxDelayMs, exp + jitter);
}

export interface RetryDecisionInput {
  method: string;
  /** Number of retries already performed (0 on the first failure). */
  attempt: number;
  /** HTTP status, or 0 for a network error / timeout. */
  status: number;
  /** Parsed Retry-After in ms, if the response carried one. */
  retryAfterMs?: number;
  policy?: RetryPolicy;
}

/**
 * Returns the delay in ms before the next attempt, or null to stop retrying.
 */
export function nextRetryDelay(input: RetryDecisionInput): number | null {
  const policy = input.policy ?? DEFAULT_RETRY_POLICY;
  if (!isIdempotentMethod(input.method)) return null;
  if (input.attempt >= policy.maxRetries) return null;

  if (input.status === 429) {
    if (input.retryAfterMs === undefined || input.retryAfterMs > MAX_RETRY_AFTER_MS) return null;
    return input.retryAfterMs;
  }
  if (input.status === 0 || RETRYABLE_STATUSES.has(input.status)) {
    if (input.retryAfterMs !== undefined && input.retryAfterMs <= MAX_RETRY_AFTER_MS) {
      return input.retryAfterMs;
    }
    return backoffDelay(input.attempt, policy);
  }
  return null;
}
