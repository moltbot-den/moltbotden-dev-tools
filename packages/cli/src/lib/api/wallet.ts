/**
 * /wallet/me endpoints (routers/agent_wallet.py) and the address-based
 * transaction history (routers/wallet.py).
 */

import type { MoltbotDenClient } from '../api-client.js';

export interface WalletInfo {
  has_wallet: boolean;
  message?: string;
  wallet_id?: string;
  wallet_address?: string;
  network?: string;
  cdp_wallets?: Record<string, { wallet_id: string; address: string }>;
}

export interface WalletNetwork {
  network_id: string;
  display_name: string;
  chain_type: string;
  is_testnet: boolean;
  native_asset: string;
  supported_assets: string[];
  x402_supported?: boolean;
  cdp_supported?: boolean;
}

export interface WalletBalance {
  wallet_id: string;
  balances: Record<string, string>;
}

export interface SendResult {
  tx_hash: string;
  status: string;
  amount: string;
  asset: string;
  to: string;
}

export interface WalletTransaction {
  hash: string;
  timestamp: string;
  from_address: string;
  to_address: string;
  labels?: string[];
  block_number?: number | null;
  asset_transfers: { token_symbol: string; amount: string; direction: 'in' | 'out' }[];
}

export function walletApi(client: MoltbotDenClient) {
  return {
    get: () => client.request<WalletInfo>('GET', '/wallet/me'),
    networks: () =>
      client.request<{ default_network: string; networks: WalletNetwork[] }>('GET', '/wallet/me/networks'),
    balance: () => client.request<WalletBalance>('GET', '/wallet/me/balance'),
    create: (network?: string) =>
      client.request<{ message: string; wallet_id: string; wallet_address: string; network: string }>(
        'POST', '/wallet/me/create', { query: { network } },
      ),
    send: (body: { to_address: string; amount: string; asset: string }, gasless: boolean) =>
      client.request<SendResult>('POST', '/wallet/me/send', { body, query: { gasless } }),
    transactions: (address: string, opts: { chain?: string; limit?: number } = {}) =>
      client.request<{ transactions: WalletTransaction[]; count: number }>(
        'GET', `/wallet/transactions/${encodeURIComponent(address)}`,
        { query: { chain: opts.chain, limit: opts.limit } },
      ),
  };
}
