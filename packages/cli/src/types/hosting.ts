/**
 * TypeScript types for the MoltbotDen Hosting Platform.
 *
 * Mirrors the server-side Pydantic models in:
 *   moltbot-den-hosting/moltbotden-api/models/hosting/
 */

// ─── VM ───────────────────────────────────────────────────────────────────────

export type VMTier = 'nano' | 'micro' | 'standard' | 'pro' | 'power' | 'ultra';
export type VMStatus = 'pending' | 'running' | 'stopped' | 'starting' | 'stopping' | 'rebuilding' | 'error' | 'terminated';
export type DiskType = 'pd-ssd' | 'pd-standard';
export type VolumeStatus = 'available' | 'attached' | 'error';

export interface VM {
  id: string;
  name: string;
  tier: VMTier;
  status: VMStatus;
  ip_address: string | null;
  internal_ip: string | null;
  gcp_instance_name: string;
  gcp_zone: string;
  image: string;
  ssh_public_key: string | null;
  labels: Record<string, string>;
  created_at: string;
  started_at: string | null;
  stopped_at: string | null;
  error_message: string | null;
}

export interface VMTierSpec {
  name: string;
  vcpus: number;
  ram_gb: number;
  ssd_gb: number;
  transfer_tb: number;
  price_cents: number;
  machine_type: string;
}

export const VM_TIER_SPECS: Record<VMTier, VMTierSpec> = {
  nano:     { name: 'Nano',     vcpus: 1, ram_gb: 1,  ssd_gb: 25,  transfer_tb: 1,  price_cents: 999,   machine_type: 'e2-micro' },
  micro:    { name: 'Micro',    vcpus: 1, ram_gb: 2,  ssd_gb: 50,  transfer_tb: 2,  price_cents: 1800,  machine_type: 'e2-small' },
  standard: { name: 'Standard', vcpus: 2, ram_gb: 4,  ssd_gb: 80,  transfer_tb: 3,  price_cents: 3600,  machine_type: 'e2-medium' },
  pro:      { name: 'Pro',      vcpus: 2, ram_gb: 8,  ssd_gb: 160, transfer_tb: 5,  price_cents: 7200,  machine_type: 'e2-standard-2' },
  power:    { name: 'Power',    vcpus: 4, ram_gb: 16, ssd_gb: 320, transfer_tb: 8,  price_cents: 14400, machine_type: 'e2-standard-4' },
  ultra:    { name: 'Ultra',    vcpus: 8, ram_gb: 32, ssd_gb: 640, transfer_tb: 15, price_cents: 28800, machine_type: 'e2-standard-8' },
};

// ─── Database ─────────────────────────────────────────────────────────────────

export type DatabasePlan = 'starter' | 'standard' | 'pro' | 'business';
export type DatabaseEngine = 'postgres' | 'redis';
export type DatabaseStatus = 'provisioning' | 'ready' | 'stopped' | 'error' | 'deleted';

export interface Database {
  id: string;
  name: string;
  plan: DatabasePlan;
  engine: DatabaseEngine;
  status: DatabaseStatus;
  host: string | null;
  port: number | null;
  database_name: string | null;
  created_at: string;
  error_message: string | null;
}

export interface DatabasePlanSpec {
  name: string;
  vcpus: number;
  ram_gb: number;
  storage_gb: number;
  max_connections: number;
  engines: DatabaseEngine[];
  price_cents: number;
}

export const DB_PLAN_SPECS: Record<DatabasePlan, DatabasePlanSpec> = {
  starter:  { name: 'Starter',  vcpus: 0.6, ram_gb: 1,  storage_gb: 10,  max_connections: 25,  engines: ['postgres'],                price_cents: 1200  },
  standard: { name: 'Standard', vcpus: 1.0, ram_gb: 2,  storage_gb: 25,  max_connections: 100, engines: ['postgres', 'redis'],        price_cents: 2800  },
  pro:      { name: 'Pro',      vcpus: 1.0, ram_gb: 4,  storage_gb: 50,  max_connections: 200, engines: ['postgres', 'redis'],        price_cents: 5500  },
  business: { name: 'Business', vcpus: 2.0, ram_gb: 8,  storage_gb: 100, max_connections: 500, engines: ['postgres', 'redis'],        price_cents: 11000 },
};

// ─── Storage ──────────────────────────────────────────────────────────────────

export type StoragePlan = 'starter' | 'standard' | 'business';
export type BucketStatus = 'active' | 'provisioning' | 'error' | 'deleted';

export interface Bucket {
  id: string;
  name: string;
  plan: StoragePlan;
  status: BucketStatus;
  region: string;
  storage_used_bytes: number | null;
  object_count: number | null;
  created_at: string;
}

export interface StoragePlanSpec {
  name: string;
  storage_gb: number;
  egress_gb: number;
  price_cents: number;
}

export const STORAGE_PLAN_SPECS: Record<StoragePlan, StoragePlanSpec> = {
  starter:  { name: 'Starter',  storage_gb: 250,  egress_gb: 100,  price_cents: 800   },
  standard: { name: 'Standard', storage_gb: 1000, egress_gb: 500,  price_cents: 3500  },
  business: { name: 'Business', storage_gb: 5000, egress_gb: 2000, price_cents: 12000 },
};

// ─── OpenClaw ─────────────────────────────────────────────────────────────────

export type OpenClawPlan = 'shared' | 'dedicated';
export type OpenClawStatus = 'provisioning' | 'running' | 'stopped' | 'error' | 'deleted';

export interface OpenClawInstance {
  id: string;
  name: string;
  plan: OpenClawPlan;
  status: OpenClawStatus;
  agent_id: string | null;
  channels: string[];
  skill_count: number;
  created_at: string;
  last_seen_at: string | null;
  error_message: string | null;
}

export interface OpenClawPlanSpec {
  name: string;
  max_channels: number;
  max_skills: number;
  sla_uptime: number;
  price_cents: number;
  dedicated: boolean;
}

export const OPENCLAW_PLAN_SPECS: Record<OpenClawPlan, OpenClawPlanSpec> = {
  shared:    { name: 'Shared',    max_channels: 3, max_skills: 5,  sla_uptime: 99.0, price_cents: 1900, dedicated: false },
  dedicated: { name: 'Dedicated', max_channels: 6, max_skills: 20, sla_uptime: 99.9, price_cents: 6900, dedicated: true  },
};

// ─── Domains ──────────────────────────────────────────────────────────────────

export type DomainStatus = 'pending_verification' | 'active' | 'error' | 'released';

export interface Domain {
  id: string;
  domain: string;
  status: DomainStatus;
  verified: boolean;
  nameservers: string[];
  dns_records: DnsRecord[];
  created_at: string;
  verified_at: string | null;
}

export interface DnsRecord {
  type: string;
  name: string;
  value: string;
  ttl: number;
}

// ─── Billing ──────────────────────────────────────────────────────────────────

export interface HostingAccount {
  id: string;
  email: string;
  display_name: string | null;
  status: string;
  usdc_balance_cents: number;
  wallet_address: string | null;
  nft_holder: boolean;
  referral_code: string;
  created_at: string;
}

export interface BillingUsage {
  period_start: string;
  period_end: string;
  total_cents: number;
  breakdown: UsageLineItem[];
}

export interface UsageLineItem {
  resource_type: string;
  resource_id: string;
  resource_name: string;
  amount_cents: number;
}

export interface BillingHistory {
  transactions: BillingTransaction[];
}

export interface BillingTransaction {
  id: string;
  type: 'credit' | 'debit' | 'refund';
  amount_cents: number;
  description: string;
  created_at: string;
}
