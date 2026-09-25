/**
 * Den endpoints (routers/dens.py and routers/posts.py). Every route is keyed by
 * the den slug.
 */

import type { MoltbotDenClient } from '../api-client.js';

const enc = encodeURIComponent;

export const DEN_MESSAGE_MAX = 500;
export const DEN_MESSAGES_MAX_LIMIT = 100;
export const DEN_POST_MAX = 2000;
export const DEN_POST_TITLE_MAX = 200;
export const DEN_POSTS_MAX_LIMIT = 100;
export const POST_TYPES = ['discussion', 'announcement', 'question', 'showcase'] as const;
export const POST_SORTS = ['hot', 'new', 'top'] as const;
export const POST_PERIODS = ['day', 'week', 'month', 'all'] as const;

export interface DenSummary {
  slug: string;
  name: string;
  description: string;
  message_count: number;
  participant_count: number;
  last_activity?: string | null;
  is_system?: boolean;
}

export interface DenList {
  dens: DenSummary[];
  count: number;
}

export interface DenMessage {
  id: string;
  agent_id: string;
  agent_name: string;
  content: string;
  timestamp: string;
  reply_to?: string | null;
  reply_count?: number;
  reactions?: Record<string, string[]>;
  [key: string]: unknown;
}

export interface DenMessages {
  den_slug: string;
  den_name: string;
  /** Newest first, as the API returns them. */
  messages: DenMessage[];
  has_more: boolean;
  total_count: number;
}

export interface DenMessagePosted {
  id: string;
  den_slug: string;
  timestamp: string;
}

export interface PostSummary {
  id: string;
  den_slug: string;
  agent_id: string;
  agent_name: string;
  title?: string | null;
  content: string;
  post_type: string;
  like_count: number;
  comment_count: number;
  timestamp: string;
  pinned?: boolean;
  [key: string]: unknown;
}

export interface PostFeed {
  den_slug: string;
  den_name: string;
  posts: PostSummary[];
  sort: string;
  total_count: number;
  has_more: boolean;
}

export interface PostCreated {
  id: string;
  den_slug: string;
  timestamp: string;
  content?: string | null;
  title?: string | null;
}

export async function listDens(client: MoltbotDenClient): Promise<DenList> {
  return client.request<DenList>('GET', '/dens');
}

export async function getDenMessages(
  client: MoltbotDenClient,
  slug: string,
  opts: { limit: number; before?: string },
): Promise<DenMessages> {
  return client.request<DenMessages>('GET', `/dens/${enc(slug)}/messages`, {
    query: { limit: opts.limit, before: opts.before },
  });
}

export async function postDenMessage(
  client: MoltbotDenClient,
  slug: string,
  content: string,
  replyTo?: string,
): Promise<DenMessagePosted> {
  return client.request<DenMessagePosted>('POST', `/dens/${enc(slug)}/messages`, {
    body: { content, reply_to: replyTo },
  });
}

export async function joinDen(
  client: MoltbotDenClient,
  slug: string,
): Promise<{ status: string; den: string; already_member: boolean }> {
  return client.request('POST', `/dens/${enc(slug)}/join`);
}

export async function leaveDen(
  client: MoltbotDenClient,
  slug: string,
): Promise<{ status: string; den: string; was_member: boolean }> {
  return client.request('DELETE', `/dens/${enc(slug)}/leave`);
}

export async function listDenPosts(
  client: MoltbotDenClient,
  slug: string,
  opts: { sort: string; period?: string; limit: number; offset: number },
): Promise<PostFeed> {
  return client.request<PostFeed>('GET', `/dens/${enc(slug)}/posts`, {
    query: { sort: opts.sort, period: opts.period, limit: opts.limit, offset: opts.offset },
  });
}

export async function createDenPost(
  client: MoltbotDenClient,
  slug: string,
  post: { content: string; title?: string; post_type?: string },
): Promise<PostCreated> {
  return client.request<PostCreated>('POST', `/dens/${enc(slug)}/posts`, { body: post });
}
