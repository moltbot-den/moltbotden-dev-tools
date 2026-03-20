/**
 * Exponential backoff retry utility for MoltbotDen API requests.
 *
 * Wraps any async operation with configurable retry logic that handles
 * transient failures: network errors, rate limits (429), and server
 * errors (500+). Client errors (400, 401, 403, 404, 409) are never
 * retried — they indicate a problem with the request itself.
 *
 * Backoff formula: `baseDelay * 2^attempt + random(0, baseDelay / 2)`
 *
 * For 429 responses, the Retry-After header is honored when present,
 * overriding the calculated backoff delay.
 *
 * @example
 * ```ts
 * import { withRetry } from './retry.js';
 *
 * const result = await withRetry(() => client.heartbeat());
 *
 * const result = await withRetry(() => client.registerAgent(data), {
 *   maxRetries: 5,
 *   baseDelay: 2000,
 * });
 * ```
 *
 * @module
 */

import { ApiError } from '../types/api.js';
import { debug } from './verbose.js';

// ─── Configuration ──────────────────────────────────────────────────────────

/** Options for configuring retry behavior. */
export interface RetryOptions {
  /**
   * Maximum number of retry attempts after the initial call.
   * Total attempts = 1 (initial) + maxRetries.
   * @default 3
   */
  maxRetries: number;

  /**
   * Base delay in milliseconds before the first retry.
   * Subsequent retries double this value (exponential backoff).
   * @default 1000
   */
  baseDelay: number;

  /**
   * Upper bound on the computed delay in milliseconds.
   * Prevents excessively long waits on high retry counts.
   * @default 10000
   */
  maxDelay: number;
}

/** Default retry configuration. */
const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10_000,
};

// ─── Internals ──────────────────────────────────────────────────────────────

/**
 * HTTP status codes that indicate a client error — these should never
 * be retried because the request itself is invalid and resending it
 * will always produce the same result.
 */
const NON_RETRYABLE_STATUSES = new Set([400, 401, 403, 404, 409, 422]);

/**
 * Determine whether an error is transient and worth retrying.
 *
 * Retryable:
 *   - Network errors (ApiError with status 0)
 *   - Rate limits  (429)
 *   - Server errors (500+)
 *   - Non-ApiError exceptions (unexpected runtime issues)
 *
 * Not retryable:
 *   - Client errors (400, 401, 403, 404, 409, 422)
 */
function isRetryable(error: unknown): boolean {
  if (!(error instanceof ApiError)) {
    // Unexpected errors (TypeError, network blips) are retryable
    return true;
  }

  // Status 0 = network error / timeout
  if (error.status === 0) return true;

  // Client errors are never retryable
  if (NON_RETRYABLE_STATUSES.has(error.status)) return false;

  // 429 and 5xx are retryable
  return error.status === 429 || error.status >= 500;
}

/**
 * Parse a `Retry-After` value from an ApiError's details.
 *
 * The Retry-After header can be either a delay in seconds (e.g. "5")
 * or an HTTP-date. We only handle the numeric form — dates are rare
 * in practice and add complexity without clear benefit.
 *
 * @returns Delay in milliseconds, or `undefined` if not parseable.
 */
function parseRetryAfter(error: ApiError): number | undefined {
  const details = error.details as Record<string, unknown> | undefined;
  if (!details) return undefined;

  // The API may surface Retry-After in the error body
  const raw = details['retry_after'] ?? details['Retry-After'];
  if (raw === undefined || raw === null) return undefined;

  const seconds = typeof raw === 'number' ? raw : Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  return undefined;
}

/**
 * Calculate the backoff delay for a given attempt.
 *
 * Formula: min(baseDelay × 2^attempt + jitter, maxDelay)
 * Jitter:  random value in [0, baseDelay / 2)
 *
 * @param attempt - Zero-based retry attempt index (0 = first retry)
 * @param options - Retry configuration
 * @returns Delay in milliseconds
 */
function calculateDelay(attempt: number, options: RetryOptions): number {
  const exponential = options.baseDelay * Math.pow(2, attempt);
  const jitter = Math.random() * (options.baseDelay / 2);
  return Math.min(exponential + jitter, options.maxDelay);
}

/**
 * Sleep for a given number of milliseconds.
 *
 * @param ms - Duration in milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Execute an async operation with exponential backoff retry logic.
 *
 * Only transient errors are retried: network failures, 429 rate limits,
 * and 500+ server errors. Client errors (400, 401, 403, 404, 409, 422)
 * are thrown immediately.
 *
 * For 429 responses with a `Retry-After` value in the error details,
 * that value is used as the delay instead of the calculated backoff.
 *
 * @typeParam T - The return type of the async operation
 * @param operation - Async function to execute (and potentially retry)
 * @param options  - Partial retry configuration (merged with defaults)
 * @returns The result of the operation on success
 * @throws The last error encountered after all retries are exhausted,
 *         or immediately for non-retryable errors
 *
 * @example
 * ```ts
 * // Basic usage with defaults (3 retries, 1s base delay)
 * const data = await withRetry(() => client.getMe());
 *
 * // Custom configuration
 * const data = await withRetry(() => client.discover(), {
 *   maxRetries: 5,
 *   baseDelay: 500,
 *   maxDelay: 15000,
 * });
 * ```
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options?: Partial<RetryOptions>,
): Promise<T> {
  const opts: RetryOptions = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      // Don't retry non-retryable errors
      if (!isRetryable(error)) {
        throw error;
      }

      // Don't retry if we've exhausted all attempts
      if (attempt >= opts.maxRetries) {
        break;
      }

      // Calculate delay — honor Retry-After for 429s
      let delay = calculateDelay(attempt, opts);
      if (error instanceof ApiError && error.status === 429) {
        const retryAfter = parseRetryAfter(error);
        if (retryAfter !== undefined) {
          delay = Math.min(retryAfter, opts.maxDelay);
        }
      }

      const errorLabel =
        error instanceof ApiError
          ? `${error.statusText} (${error.status})`
          : error instanceof Error
            ? error.message
            : 'Unknown error';

      debug(
        'retry',
        `Attempt ${attempt + 1}/${opts.maxRetries} failed: ${errorLabel}. ` +
        `Retrying in ${Math.round(delay)}ms…`,
      );

      await sleep(delay);
    }
  }

  // All retries exhausted — throw the last error
  throw lastError;
}
