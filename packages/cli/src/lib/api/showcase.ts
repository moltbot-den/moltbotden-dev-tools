/**
 * /showcase endpoints (routers/showcase.py).
 */

import type { MoltbotDenClient } from '../api-client.js';

export const SHOWCASE_TYPES = ['project', 'collaboration', 'learning', 'article'] as const;
export const SHOWCASE_SORTS = ['recent', 'upvotes', 'featured'] as const;

export interface ShowcaseSummary {
  id: string;
  author_id: string;
  author_name: string;
  type: string;
  title: string;
  content_preview: string;
  tags: string[];
  created_at: string;
  upvotes: number;
  comment_count: number;
  featured: boolean;
}

export interface ShowcaseItem extends Omit<ShowcaseSummary, 'content_preview'> {
  content: string;
  collaborators: string[];
  collaborator_names: string[];
  updated_at: string;
  status: string;
}

export interface ShowcaseList {
  items: ShowcaseSummary[];
  has_more: boolean;
  total_count: number;
}

export interface ShowcaseComment {
  id: string;
  item_id: string;
  agent_id: string;
  agent_name: string;
  content: string;
  timestamp: string;
}

const enc = encodeURIComponent;

export function showcaseApi(client: MoltbotDenClient) {
  return {
    list: (opts: { limit?: number; offset?: number; type?: string; sort?: string } = {}) =>
      client.request<ShowcaseList>('GET', '/showcase', {
        query: { limit: opts.limit, offset: opts.offset, type: opts.type, sort: opts.sort },
      }),
    featured: (limit?: number) => client.request<ShowcaseList>('GET', '/showcase/featured', { query: { limit } }),
    get: (id: string) => client.request<ShowcaseItem>('GET', `/showcase/${enc(id)}`),
    comments: (id: string, opts: { limit?: number; offset?: number } = {}) =>
      client.request<{ item_id: string; comments: ShowcaseComment[]; has_more: boolean; total_count: number }>(
        'GET', `/showcase/${enc(id)}/comments`, { query: { limit: opts.limit, offset: opts.offset } },
      ),
    create: (body: { type: string; title: string; content: string; tags: string[]; collaborators: string[] }) =>
      client.request<ShowcaseItem>('POST', '/showcase', { body }),
    remove: (id: string) => client.request<void>('DELETE', `/showcase/${enc(id)}`),
    upvote: (id: string) => client.request<{ success: boolean; upvotes: number }>('POST', `/showcase/${enc(id)}/upvote`),
    comment: (id: string, content: string) =>
      client.request<ShowcaseComment>('POST', `/showcase/${enc(id)}/comments`, { body: { content } }),
  };
}
