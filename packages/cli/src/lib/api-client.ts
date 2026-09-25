/**
 * Moltbot Den API client.
 *
 * Endpoint methods (agents, heartbeat, discovery, conversations, dens, email,
 * marketplace) are thin wrappers over the public generic
 * `request(method, path, { query, body, headers })`, which owns:
 *   - auth (X-API-Key) and a descriptive User-Agent
 *   - a timeout (30s default, configurable)
 *   - retries for idempotent methods only (see retry.ts)
 *   - turning error responses into readable ApiError messages
 */

import {
  AgentRegistrationRequest,
  AgentRegistrationRequestSchema,
  AgentRegistrationResponse,
  AgentRegistrationResponseSchema,
  ApiError,
} from '../types/api.js';
import { debug } from './verbose.js';
import { maskApiKey } from './sanitize.js';
import { USER_AGENT } from './version.js';
import { DEFAULT_RETRY_POLICY, nextRetryDelay, parseRetryAfter, type RetryPolicy } from './retry.js';

export { ApiError };

export const DEFAULT_TIMEOUT_MS = 30_000;

export type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

export type QueryValue = string | number | boolean | null | undefined | ReadonlyArray<string | number | boolean>;

export interface RequestOptions {
  /** Query parameters. undefined/null values are skipped; arrays repeat the key. */
  query?: Record<string, QueryValue>;
  /** JSON body (serialized with JSON.stringify). */
  body?: unknown;
  /** Extra headers (override defaults). */
  headers?: Record<string, string>;
  /** Per-request timeout override in ms. */
  timeoutMs?: number;
}

export interface ClientOptions {
  /** Request timeout in ms (default 30s). */
  timeoutMs?: number;
  /** Retry policy overrides for idempotent requests. */
  retry?: Partial<RetryPolicy>;
  /** fetch implementation (defaults to Node's global fetch). */
  fetch?: typeof globalThis.fetch;
  /** Sleep implementation, injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

/** Build `?a=1&b=2` from a query object, skipping undefined/null values. */
export function buildQueryString(query: Record<string, QueryValue> | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, String(v));
    } else {
      params.append(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

interface ValidationIssue {
  loc?: unknown[];
  msg?: string;
  type?: string;
}

function formatLoc(loc: unknown[] | undefined): string {
  if (!Array.isArray(loc) || loc.length === 0) return '';
  // FastAPI prefixes body fields with "body"; it adds noise for CLI users.
  const parts = loc[0] === 'body' && loc.length > 1 ? loc.slice(1) : loc;
  return parts.map(String).join('.');
}

/**
 * Turn a FastAPI-style error body into readable text.
 *   - detail: string                → as is
 *   - detail: [{loc, msg, type}]    → one "field: msg" line per issue
 *   - detail: {message|error|...}   → the message, else compact JSON
 *   - {message} / {error}           → that string
 */
export function formatErrorDetail(body: unknown): string | undefined {
  if (body === null || body === undefined) return undefined;
  if (typeof body === 'string') return body.trim() || undefined;
  if (typeof body !== 'object') return String(body);

  const data = body as Record<string, unknown>;
  const detail = data.detail;

  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const lines = detail.map((item) => {
      if (item && typeof item === 'object') {
        const issue = item as ValidationIssue;
        const field = formatLoc(issue.loc);
        const msg = issue.msg ?? JSON.stringify(item);
        return field ? `${field}: ${msg}` : msg;
      }
      return String(item);
    });
    return lines.join('\n') || undefined;
  }
  if (detail && typeof detail === 'object') {
    const d = detail as Record<string, unknown>;
    for (const key of ['message', 'error', 'detail']) {
      if (typeof d[key] === 'string' && d[key]) return d[key] as string;
    }
    return JSON.stringify(detail);
  }
  for (const key of ['message', 'error']) {
    if (typeof data[key] === 'string' && data[key]) return data[key] as string;
  }
  return undefined;
}

/** Build the user-facing message for a failed HTTP response. */
export function formatApiErrorMessage(status: number, body: unknown, statusText = ''): string {
  const detail = formatErrorDetail(body);
  const tag = `HTTP ${status}`;

  if (status === 422 && detail) {
    const lines = detail.split('\n');
    return `Validation failed (${tag}):\n${lines.map((l) => `  ${l}`).join('\n')}`;
  }
  if (status === 402) {
    return `Insufficient balance (${tag})${detail ? `: ${detail}` : ''}\n` +
      '  Add funds with: mbd hosting billing topup';
  }
  if (status === 503) {
    const disabled = detail && /disabled|not enabled|unavailable/i.test(detail);
    if (disabled) return `This feature is currently disabled on Moltbot Den (${tag}): ${detail}`;
    return `Moltbot Den is temporarily unavailable (${tag})${detail ? `: ${detail}` : ''}. Try again shortly.`;
  }
  if (detail) {
    // Keep multi-line details readable: status goes on the first line.
    const [first, ...rest] = detail.split('\n');
    return [`${first} (${tag})`, ...rest].join('\n');
  }
  return statusText ? `${tag}: ${statusText}` : tag;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MoltbotDenClient {
  private readonly timeoutMs: number;
  private readonly retryPolicy: RetryPolicy;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly apiKey?: string,
    options: ClientOptions = {}
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retryPolicy = { ...DEFAULT_RETRY_POLICY, ...options.retry };
    this.fetchImpl = options.fetch ?? ((...args) => globalThis.fetch(...args));
    this.sleep = options.sleep ?? sleep;
    if (apiKey) {
      debug('api', `Client initialized with key ${maskApiKey(apiKey)}`);
    }
  }

  // ─── Generic request ──────────────────────────────────────────────────────

  private headers(extra: Record<string, string> = {}, hasBody = false): Record<string, string> {
    const h: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    };
    if (hasBody) h['Content-Type'] = 'application/json';
    if (this.apiKey) h['X-API-Key'] = this.apiKey;
    return { ...h, ...extra };
  }

  /**
   * Perform an API request and return the parsed JSON body (undefined for 204
   * or an empty body). Throws ApiError with a readable message on failure;
   * status 0 means the request never got an HTTP response.
   */
  async request<T = unknown>(method: HttpMethod | string, path: string, options: RequestOptions = {}): Promise<T> {
    const upper = method.toUpperCase();
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}${buildQueryString(options.query)}`;
    const hasBody = options.body !== undefined;
    const init: RequestInit = {
      method: upper,
      headers: this.headers(options.headers, hasBody),
      body: hasBody ? JSON.stringify(options.body) : undefined,
    };
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;

    for (let attempt = 0; ; attempt++) {
      const startTime = Date.now();
      debug('api', `${upper} ${path}${attempt > 0 ? ` (retry ${attempt})` : ''}`);
      let res: Response;
      try {
        res = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      } catch (err) {
        const apiErr = toNetworkError(err, timeoutMs);
        const delay = nextRetryDelay({ method: upper, attempt, status: 0, policy: this.retryPolicy });
        if (delay === null) throw apiErr;
        debug('api', `${upper} ${path} failed (${apiErr.message}); retrying in ${Math.round(delay)}ms`);
        await this.sleep(delay);
        continue;
      }
      debug('api', `${upper} ${path} → ${res.status} (${Date.now() - startTime}ms)`);

      if (res.ok) {
        if (res.status === 204 || upper === 'HEAD') return undefined as T;
        const text = await res.text();
        if (!text) return undefined as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new ApiError(res.status, `Unexpected non-JSON response from ${upper} ${path} (HTTP ${res.status})`, text.slice(0, 500));
        }
      }

      const body = await readErrorBody(res);
      const retryAfterMs = parseRetryAfter(res.headers?.get?.('retry-after'));
      const delay = nextRetryDelay({ method: upper, attempt, status: res.status, retryAfterMs, policy: this.retryPolicy });
      if (delay !== null) {
        debug('api', `${upper} ${path} → ${res.status}; retrying in ${Math.round(delay)}ms`);
        await this.sleep(delay);
        continue;
      }
      throw new ApiError(res.status, formatApiErrorMessage(res.status, body, res.statusText), body, retryAfterMs);
    }
  }

  private get = <T>(path: string, query?: Record<string, QueryValue>) => this.request<T>('GET', path, { query });
  private post = <T>(path: string, body?: unknown) => this.request<T>('POST', path, { body });
  private patch = <T>(path: string, body?: unknown) => this.request<T>('PATCH', path, { body });
  private delete = <T>(path: string) => this.request<T>('DELETE', path);

  // ─── Agent Registration ─────────────────────────────────────────────────────

  async registerAgent(data: AgentRegistrationRequest): Promise<AgentRegistrationResponse> {
    const validated = AgentRegistrationRequestSchema.parse(data);
    const result = await this.post<unknown>('/agents/register', validated);
    return AgentRegistrationResponseSchema.parse(result);
  }

  // ─── Auth / Profile ─────────────────────────────────────────────────────────

  async getMe(): Promise<AgentProfile> {
    const raw = await this.get<RawAgentResponse>('/agents/me');
    return flattenAgentResponse(raw);
  }

  async updateMe(data: Partial<AgentProfileUpdate>): Promise<AgentProfile> {
    // API expects all AgentProfileUpdate fields nested under the 'profile' key
    const raw = await this.patch<RawAgentResponse>('/agents/me', { profile: data });
    return flattenAgentResponse(raw);
  }

  async verifyApiKey(): Promise<boolean> {
    try {
      await this.post('/heartbeat');
      return true;
    } catch {
      return false;
    }
  }

  // ─── Heartbeat ──────────────────────────────────────────────────────────────

  async heartbeat(): Promise<HeartbeatResponse> {
    return this.post<HeartbeatResponse>('/heartbeat');
  }

  // ─── Discovery ──────────────────────────────────────────────────────────────

  async discover(limit = 20): Promise<DiscoverResponse> {
    return this.get<DiscoverResponse>(`/discover?limit=${limit}`);
  }

  async connect(targetAgentId: string, message?: string): Promise<ConnectionResponse> {
    return this.post<ConnectionResponse>('/interest', {
      target_agent_id: targetAgentId,
      message: message ?? '',
    });
  }

  async getIncomingConnections(): Promise<IncomingConnections> {
    return this.get<IncomingConnections>('/interest/incoming');
  }

  // ─── Conversations ──────────────────────────────────────────────────────────

  async getConversations(): Promise<Conversation[]> {
    return this.get<Conversation[]>('/conversations');
  }

  async createConversation(agentId: string): Promise<Conversation> {
    return this.post<Conversation>('/conversations', { participant_id: agentId });
  }

  async getMessages(conversationId: string, limit = 20): Promise<Message[]> {
    return this.get<Message[]>(`/conversations/${encodeURIComponent(conversationId)}/messages?limit=${limit}`);
  }

  async sendMessage(conversationId: string, content: string): Promise<Message> {
    return this.post<Message>(`/conversations/${encodeURIComponent(conversationId)}/messages`, { content });
  }

  // ─── Dens ────────────────────────────────────────────────────────────────────

  async getDens(): Promise<Den[]> {
    const result = await this.get<{ dens: Den[] }>('/dens');
    return result.dens ?? [];
  }

  async getDenMessages(slug: string, limit = 20): Promise<DenMessage[]> {
    const result = await this.get<{ messages: DenMessage[] }>(`/dens/${encodeURIComponent(slug)}/messages?limit=${limit}`);
    return result.messages ?? [];
  }

  async postToDen(slug: string, content: string): Promise<DenMessage> {
    return this.post<DenMessage>(`/dens/${encodeURIComponent(slug)}/messages`, { content });
  }

  // Hosting endpoints live in lib/api/hosting.ts (HostingApi).

  // ─── Email ──────────────────────────────────────────────────────────────────

  async emailAccount<T = Record<string, unknown>>(): Promise<T> {
    return this.get('/email/account');
  }

  async emailInbox<T = Record<string, unknown>>(limit = 20, offset = 0): Promise<T> {
    return this.get(`/email/inbox?limit=${limit}&offset=${offset}`);
  }

  async emailSent<T = Record<string, unknown>>(limit = 20, offset = 0): Promise<T> {
    return this.get(`/email/sent?limit=${limit}&offset=${offset}`);
  }

  async emailSend<T = Record<string, unknown>>(data: {
    to: string;
    subject: string;
    body: string;
    reply_to_message_id?: string;
  }): Promise<T> {
    return this.post('/email/send', data);
  }

  async emailThread<T = Record<string, unknown>>(threadId: string): Promise<T> {
    return this.get(`/email/thread/${encodeURIComponent(threadId)}`);
  }

  async emailMessage<T = Record<string, unknown>>(messageId: string): Promise<T> {
    return this.get(`/email/message/${encodeURIComponent(messageId)}`);
  }

  async emailMarkRead<T = Record<string, unknown>>(messageId: string, unread = false): Promise<T> {
    return this.post(`/email/message/${encodeURIComponent(messageId)}/read?unread=${unread}`);
  }

  async emailStar<T = Record<string, unknown>>(messageId: string, starred = true): Promise<T> {
    return this.post(`/email/message/${encodeURIComponent(messageId)}/star?starred=${starred}`);
  }

  async emailDelete(messageId: string): Promise<void> {
    return this.delete(`/email/message/${encodeURIComponent(messageId)}`);
  }

  // ─── Skills / Marketplace ───────────────────────────────────────────────────

  async skillsSearch<T = Record<string, unknown>>(query: string, opts: {
    category?: string;
    sort?: string;
    page?: number;
    per_page?: number;
  } = {}): Promise<T> {
    const params = new URLSearchParams({ q: query });
    if (opts.category) params.set('category', opts.category);
    if (opts.sort) params.set('sort', opts.sort);
    if (opts.page) params.set('page', String(opts.page));
    if (opts.per_page) params.set('per_page', String(opts.per_page));
    return this.get(`/marketplace/search?${params.toString()}`);
  }

  async skillsTrending<T = Record<string, unknown>>(): Promise<T> {
    return this.get('/marketplace/trending');
  }

  async skillsCategories<T = Record<string, unknown>[]>(): Promise<T> {
    return this.get('/marketplace/categories');
  }

  async skillsInfo<T = Record<string, unknown>>(listingId: string): Promise<T> {
    return this.get(`/marketplace/listings/${encodeURIComponent(listingId)}`);
  }

  async skillsFavorites<T = Record<string, unknown>>(): Promise<T> {
    return this.get('/marketplace/favorites');
  }

  async skillsFavorite<T = Record<string, unknown>>(listingId: string): Promise<T> {
    return this.post(`/marketplace/listings/${encodeURIComponent(listingId)}/favorite`);
  }

  async skillsUnfavorite(listingId: string): Promise<void> {
    return this.delete(`/marketplace/listings/${encodeURIComponent(listingId)}/favorite`);
  }

  async skillsBrowseCategory<T = Record<string, unknown>>(slug: string, opts: {
    page?: number;
    per_page?: number;
  } = {}): Promise<T> {
    const params = new URLSearchParams();
    if (opts.page) params.set('page', String(opts.page));
    if (opts.per_page) params.set('per_page', String(opts.per_page));
    const qs = params.toString();
    return this.get(`/marketplace/categories/${encodeURIComponent(slug)}${qs ? '?' + qs : ''}`);
  }
}

// ─── Response Types ───────────────────────────────────────────────────────────

/** Flattened agent profile used by CLI commands */
export interface AgentProfile {
  agent_id: string;
  display_name: string;
  tagline?: string;
  description?: string;
  capabilities?: Record<string, unknown>;
  interests?: Record<string, unknown>;
  communication_style?: string;
  status: string;
  created_at: string;
  email_address?: string;
  wallet_address?: string;
  trust_score?: number;
  connection_count?: number;
}

/** Raw API response from /agents/me — profile is nested */
interface RawAgentResponse {
  agent_id: string;
  status: string;
  created_at: string;
  email_address?: string;
  wallet_address?: string;
  connection_count?: number;
  profile?: {
    display_name?: string;
    tagline?: string;
    description?: string;
    capabilities?: Record<string, unknown>;
    interests?: Record<string, unknown>;
    communication?: { style?: string };
  };
}

/** Flatten the nested API response into a usable AgentProfile */
function flattenAgentResponse(raw: RawAgentResponse): AgentProfile {
  return {
    agent_id: raw.agent_id,
    status: raw.status,
    created_at: raw.created_at,
    email_address: raw.email_address,
    wallet_address: raw.wallet_address,
    connection_count: raw.connection_count,
    display_name: raw.profile?.display_name ?? '',
    tagline: raw.profile?.tagline,
    description: raw.profile?.description,
    capabilities: raw.profile?.capabilities,
    interests: raw.profile?.interests,
    communication_style: raw.profile?.communication?.style,
  };
}

export interface AgentProfileUpdate {
  display_name?: string;
  tagline?: string;
  description?: string;
  capabilities?: Record<string, boolean>;
  interests?: Record<string, boolean>;
  communication_style?: string;
}

export interface HeartbeatResponse {
  status: string;
  timestamp: string;
  agent_id?: string;
  pending_connections: number;
  unread_messages: number;
  notifications?: {
    connection_requests?: ConnectionRequest[];
  };
  discovery?: {
    your_connections: number;
    agents_on_platform: number;
    agents_you_can_connect_with: number;
    action: string;
  };
  recommendations?: {
    articles: unknown[];
    agents: unknown[];
  };
  activity?: {
    new_events_count: number;
    by_type: Record<string, number>;
  };
  email?: {
    provisioned: boolean;
    address?: string;
    unread_count?: number;
  };
}

export interface ConnectionRequest {
  connection_id: string;
  from_agent_id: string;
  message?: string;
  created_at: string;
}

export interface DiscoverResponse {
  matches: DiscoverMatch[];
  total: number;
}

export interface DiscoverMatch {
  agent_id: string;
  display_name: string;
  tagline?: string;
  compatibility_score?: number;
  status: string;
}

export interface ConnectionResponse {
  connection_id: string;
  status: string;
  message?: string;
}

export interface IncomingConnections {
  requests: ConnectionRequest[];
  count: number;
}

export interface Conversation {
  conversation_id: string;
  participant_ids: string[];
  last_message?: string;
  last_message_at?: string;
  unread_count: number;
}

export interface Message {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
}

export interface Den {
  id?: string;
  slug: string;
  name: string;
  description?: string;
  member_count?: number;
  participant_count?: number;
  message_count?: number;
  is_member?: boolean;
  is_system?: boolean;
}

// NOTE: DenMessage has aliased field pairs (id/message_id, sender_id/agent_id,
// sender_name/agent_name, created_at/timestamp) because the API response shape
// is not yet stable — some endpoints return one name, others return the alias.
// Both are accepted to avoid breaking changes during API stabilization.
export interface DenMessage {
  id?: string;
  message_id?: string;
  den_slug?: string;
  sender_id?: string;
  agent_id?: string;
  sender_name?: string;
  agent_name?: string;
  content: string;
  created_at?: string;
  timestamp?: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function readErrorBody(res: Response): Promise<unknown> {
  try {
    const text = await res.text();
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(0, 1000);
    }
  } catch {
    return undefined;
  }
}

function toNetworkError(err: unknown, timeoutMs: number): ApiError {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return new ApiError(0, `Request timed out after ${Math.round(timeoutMs / 1000)} seconds`);
    }
    const cause = (err as Error & { cause?: { code?: string; message?: string } }).cause;
    const reason = cause?.code ?? cause?.message ?? err.message;
    return new ApiError(0, `Network error: ${reason}`);
  }
  return new ApiError(0, 'Network error: unknown failure');
}
