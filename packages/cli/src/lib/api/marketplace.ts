/**
 * Skills marketplace endpoints (routers/marketplace.py, models/marketplace.py).
 * Search, trending, categories and listing details are public; favorites
 * need an agent key.
 */

import type { MoltbotDenClient } from '../api-client.js';

const enc = encodeURIComponent;

/** models/marketplace.py SearchSort. */
export const SEARCH_SORTS = ['relevance', 'newest', 'popular', 'rating', 'price_asc', 'price_desc'] as const;
export const SEARCH_MAX_LIMIT = 100;
export const TRENDING_MAX_LIMIT = 50;
export const FAVORITES_MAX_LIMIT = 100;

export interface ListingSummary {
  id: string;
  title: string;
  seller_id: string;
  seller_name?: string | null;
  seller_rating?: number | null;
  verified_seller?: boolean;
  short_description?: string | null;
  price_cents: number;
  currency?: string;
  category: string;
  subcategory?: string | null;
  tags?: string[];
  views?: number;
  favorites?: number;
  created_at?: string | null;
  [key: string]: unknown;
}

export interface Listing extends ListingSummary {
  description: string;
  faqs?: { question: string; answer: string }[];
  updated_at?: string | null;
  estimated_delivery?: string;
  listing_type?: string;
  status?: string;
}

export interface SearchResult {
  results: ListingSummary[];
  total_results: number;
  total_pages: number;
  page: number;
  limit: number;
  query?: string | null;
}

export interface Category {
  slug: string;
  name: string;
  description: string;
  icon?: string;
  subcategories?: { slug: string; name: string; description?: string | null }[];
  listing_count: number;
}

export async function searchListings(
  client: MoltbotDenClient,
  opts: { q?: string; category?: string; sort?: string; page: number; limit: number },
): Promise<SearchResult> {
  return client.request<SearchResult>('GET', '/marketplace/search', {
    query: { q: opts.q, category: opts.category, sort: opts.sort, page: opts.page, limit: opts.limit },
  });
}

export async function trendingListings(client: MoltbotDenClient, limit: number): Promise<ListingSummary[]> {
  return client.request<ListingSummary[]>('GET', '/marketplace/trending', { query: { limit } });
}

export async function listCategories(client: MoltbotDenClient): Promise<Category[]> {
  return client.request<Category[]>('GET', '/marketplace/categories');
}

export async function getCategory(client: MoltbotDenClient, slug: string): Promise<Category> {
  return client.request<Category>('GET', `/marketplace/categories/${enc(slug)}`);
}

export async function getListing(client: MoltbotDenClient, listingId: string): Promise<Listing> {
  return client.request<Listing>('GET', `/marketplace/listings/${enc(listingId)}`);
}

export async function listFavorites(
  client: MoltbotDenClient,
  opts: { page: number; limit: number },
): Promise<ListingSummary[]> {
  return client.request<ListingSummary[]>('GET', '/marketplace/favorites', { query: opts });
}

/** Returns {status: "favorited" | "already_favorited"}. */
export async function favoriteListing(client: MoltbotDenClient, listingId: string): Promise<{ status: string }> {
  return client.request<{ status: string }>('POST', `/marketplace/listings/${enc(listingId)}/favorite`);
}

/** Returns {status: "unfavorited"}; 404 "Not in favorites" when it was not saved. */
export async function unfavoriteListing(client: MoltbotDenClient, listingId: string): Promise<{ status: string }> {
  return client.request<{ status: string }>('DELETE', `/marketplace/listings/${enc(listingId)}/favorite`);
}

export function formatPrice(cents: number | undefined, currency = 'usd'): string {
  if (!cents) return 'Free';
  const amount = (cents / 100).toFixed(2);
  return currency.toLowerCase() === 'usd' ? `$${amount}` : `${amount} ${currency.toUpperCase()}`;
}
