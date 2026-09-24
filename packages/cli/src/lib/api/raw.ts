/**
 * Raw HTTP access to the Moltbot Den API.
 *
 * MoltbotDenClient.request() returns only the parsed JSON body. A few
 * commands need more: `mbd api` (status, headers, non-JSON bodies, arbitrary
 * bodies), `mbd doctor` (latency, Date header) and the export commands (CSV /
 * file downloads). They use this client instead. It sends the same auth and
 * User-Agent headers, never retries (the caller decides), and only attaches
 * the API key to requests for the configured API origin.
 */

import { ApiError } from '../../types/api.js';
import { buildQueryString, DEFAULT_TIMEOUT_MS, formatApiErrorMessage, type QueryValue } from '../api-client.js';
import { USER_AGENT } from '../version.js';
import { debug } from '../verbose.js';

export interface RawRequestOptions {
  query?: Record<string, QueryValue>;
  headers?: Record<string, string>;
  /** Raw body (sent as is). */
  body?: string | Uint8Array;
  /** JSON body (serialized, sets Content-Type). Ignored when `body` is set. */
  json?: unknown;
  /** Throw ApiError on a non-2xx response (default true). */
  throwOnError?: boolean;
  timeoutMs?: number;
  /** Send no credentials (e.g. health checks). */
  anonymous?: boolean;
}

export interface RawResponse {
  status: number;
  statusText: string;
  headers: Headers;
  text: string;
  url: string;
  durationMs: number;
}

export class RawClient {
  readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly apiKey?: string,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
    private readonly fetchImpl: typeof globalThis.fetch = (...args) => globalThis.fetch(...args),
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  static from(ctx: { apiUrl: string; apiKey?: string; timeoutMs?: number }): RawClient {
    return new RawClient(ctx.apiUrl, ctx.apiKey, ctx.timeoutMs);
  }

  /** Build the absolute URL for an API path (leading slash optional). */
  url(path: string, query?: Record<string, QueryValue>): string {
    return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}${buildQueryString(query)}`;
  }

  async request(method: string, path: string, opts: RawRequestOptions = {}): Promise<RawResponse> {
    const upper = method.toUpperCase();
    const url = this.url(path, opts.query);
    const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': USER_AGENT };
    if (this.apiKey && !opts.anonymous) headers['X-API-Key'] = this.apiKey;
    let body: string | Uint8Array | undefined = opts.body;
    if (body === undefined && opts.json !== undefined) {
      body = JSON.stringify(opts.json);
      headers['Content-Type'] = 'application/json';
    }
    Object.assign(headers, opts.headers);

    const timeoutMs = opts.timeoutMs ?? this.timeoutMs;
    const start = Date.now();
    debug('api', `${upper} ${path} (raw)`);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: upper,
        headers,
        body: body as RequestInit['body'],
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw toNetworkError(err, timeoutMs);
    }
    const text = await res.text();
    const durationMs = Date.now() - start;
    debug('api', `${upper} ${path} → ${res.status} (${durationMs}ms)`);

    if (!res.ok && opts.throwOnError !== false) {
      const parsed = parseJsonOr(text, text.slice(0, 1000));
      throw new ApiError(res.status, formatApiErrorMessage(res.status, parsed, res.statusText), parsed);
    }
    return { status: res.status, statusText: res.statusText, headers: res.headers, text, url, durationMs };
  }
}

export function parseJsonOr<T>(text: string, fallback: T): unknown {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return fallback;
  }
}

export function toNetworkError(err: unknown, timeoutMs: number): ApiError {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return new ApiError(0, `Request timed out after ${Math.round(timeoutMs / 1000)} seconds`);
    }
    const cause = (err as Error & { cause?: { code?: string; message?: string } }).cause;
    return new ApiError(0, `Network error: ${cause?.code ?? cause?.message ?? err.message}`);
  }
  return new ApiError(0, 'Network error: unknown failure');
}
