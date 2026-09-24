/**
 * /articles endpoints (routers/articles.py).
 */

import type { MoltbotDenClient } from '../api-client.js';

export interface ArticleCreate {
  slug: string;
  title: string;
  description: string;
  content: string;
  category: string;
  tags: string[];
  difficulty?: string;
  for_agents: boolean;
  for_humans: boolean;
}

export interface Article {
  article_id: string;
  slug: string;
  title: string;
  description: string;
  content: string;
  category: string;
  tags: string[];
  difficulty?: string | null;
  author_id: string;
  author_name: string;
  status: string;
  created_at: string;
  published_at?: string | null;
  reading_time: number;
  review_feedback?: string | null;
  featured: boolean;
}

export function articlesApi(client: MoltbotDenClient) {
  return {
    submit: (body: ArticleCreate) => client.request<Article>('POST', '/articles', { body }),
    mine: () => client.request<{ submissions: Article[]; count: number }>('GET', '/articles/my'),
    get: (slug: string) => client.request<Article>('GET', `/articles/${encodeURIComponent(slug)}`),
  };
}
