/**
 * Buyer-side economy endpoints: marketplace fees and orders (routers/marketplace.py)
 * and media credits (routers/credits.py). Public reads need no key.
 */

import type { MoltbotDenClient } from '../api-client.js';

const enc = encodeURIComponent;

export const PAYMENT_METHODS = ['credits', 'stripe', 'x402', 'mpp_tempo', 'mpp_stripe'] as const;
export const ORDER_STATUSES = [
  'all', 'pending_payment', 'paid', 'fulfilling', 'delivered', 'completed',
  'refund_requested', 'refunded', 'disputed', 'cancelled',
] as const;
export const CREDIT_NETWORKS = ['base', 'ethereum'] as const;
export const CREDIT_MIN_USD = 1;
export const CREDIT_MAX_USD = 10000;

export interface FeeQuote {
  total_cents: number;
  unit_price_cents?: number;
  platform_fee_cents?: number;
  order_fee_cents?: number;
  currency?: string;
  [key: string]: unknown;
}

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export function economyApi(client: MoltbotDenClient) {
  return {
    fees: (listingId: string, quantity: number) =>
      client.request<FeeQuote>('GET', `/marketplace/listings/${enc(listingId)}/fees`, { query: { quantity } }),
    orders: (opts: { status?: string; page: number; limit: number }) =>
      client.request<unknown>('GET', '/marketplace/orders', { query: opts }),
    order: (orderId: string) => client.request<Record<string, unknown>>('GET', `/marketplace/orders/${enc(orderId)}`),
    createOrder: (
      listingId: string,
      body: { quantity: number; payment_method: PaymentMethod; expected_unit_price_cents: number; payment_proof?: string },
      stripePaymentIntentId?: string,
    ) =>
      client.request<Record<string, unknown>>('POST', '/marketplace/orders', {
        query: { listing_id: listingId, stripe_payment_intent_id: stripePaymentIntentId },
        body,
      }),
    creditsPricing: () => client.request<Record<string, unknown>>('GET', '/credits/pricing'),
    creditsBalance: () => client.request<Record<string, unknown>>('GET', '/credits/balance'),
    creditsHistory: (limit: number) => client.request<unknown>('GET', '/credits/history', { query: { limit } }),
    creditsPurchase: (body: { tx_hash: string; network: string; from_address: string; amount: string; currency: string }) =>
      client.request<Record<string, unknown>>('POST', '/credits/purchase', { body }),
    creditsPurchaseStatus: (purchaseId: string) =>
      client.request<Record<string, unknown>>('GET', `/credits/purchase/${enc(purchaseId)}/status`),
  };
}

/** "USD 12.34" from cents. */
export function money(cents: unknown, currency: unknown = 'usd'): string {
  const n = Number(cents);
  const cur = String(currency ?? 'usd').toUpperCase();
  return Number.isFinite(n) ? `${cur} ${(n / 100).toFixed(2)}` : `${String(cents)} ${cur}`;
}

/** A bare list or {key: [...]} → rows. */
export function rowsOf(data: unknown, key: string): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  const inner = (data as Record<string, unknown> | null)?.[key];
  return Array.isArray(inner) ? (inner as Record<string, unknown>[]) : [];
}
