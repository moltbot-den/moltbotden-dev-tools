/**
 * Types and catalog constants for the Moltbot Den hosting API (/v1/hosting).
 *
 * Source of truth (moltbotden repo, moltbotden-api/):
 *   - models/hosting/*.py      request/response shapes and status enums
 *   - models/hosting/tiers.py  VM tiers and database/storage/OpenClaw plans
 *   - routers/hosting/*.py     what each endpoint actually returns
 *
 * The API has no endpoint that lists tiers, plans or images, so the catalog
 * below mirrors those backend constants. It deliberately carries no prices:
 * prices change on the server and the CLI never shows a price it did not get
 * from the API. Update this file when tiers.py changes.
 */

// ─── Catalog (mirrors models/hosting/tiers.py) ───────────────────────────────

export type VMTier = 'nano' | 'micro' | 'standard' | 'pro' | 'power' | 'ultra';

export interface VMTierSpec {
  name: string;
  vcpus: number;
  ram_gb: number;
  ssd_gb: number;
  transfer_tb: number;
  machine_type: string;
}

export const VM_TIER_SPECS: Record<VMTier, VMTierSpec> = {
  nano:     { name: 'Nano',     vcpus: 1, ram_gb: 1,  ssd_gb: 25,  transfer_tb: 1,  machine_type: 'e2-micro' },
  micro:    { name: 'Micro',    vcpus: 1, ram_gb: 2,  ssd_gb: 50,  transfer_tb: 2,  machine_type: 'e2-small' },
  standard: { name: 'Standard', vcpus: 2, ram_gb: 4,  ssd_gb: 80,  transfer_tb: 3,  machine_type: 'e2-medium' },
  pro:      { name: 'Pro',      vcpus: 2, ram_gb: 8,  ssd_gb: 160, transfer_tb: 5,  machine_type: 'e2-standard-2' },
  power:    { name: 'Power',    vcpus: 4, ram_gb: 16, ssd_gb: 320, transfer_tb: 8,  machine_type: 'e2-standard-4' },
  ultra:    { name: 'Ultra',    vcpus: 8, ram_gb: 32, ssd_gb: 640, transfer_tb: 15, machine_type: 'e2-standard-8' },
};

/**
 * Boot images. The backend builds `projects/ubuntu-os-cloud/global/images/family/<image>`
 * (services/hosting/gcp_compute.py) and does not validate the value, so an
 * unknown family is charged for and then fails to provision. Only offer
 * families that exist. The server default is `ubuntu-2204-lts` (models/hosting/vm.py).
 * There is no region or zone choice: every resource goes to the server's
 * configured zone (config_hosting.py hosting_gcp_zone).
 */
export const VM_IMAGES = ['ubuntu-2204-lts', 'ubuntu-2404-lts-amd64'] as const;
export const DEFAULT_VM_IMAGE = 'ubuntu-2204-lts';

/** The Linux user the startup script creates and installs SSH keys for (gcp_compute.py). */
export const VM_SSH_USER = 'agent';

export type DiskType = 'pd-ssd' | 'pd-standard';
export const DISK_TYPES: readonly DiskType[] = ['pd-ssd', 'pd-standard'];
/** VolumeCreateRequest.size_gb bounds (models/hosting/vm.py). */
export const VOLUME_SIZE_GB = { min: 10, max: 10_000 } as const;

export type DatabasePlan = 'starter' | 'standard' | 'pro' | 'business';
export type DatabaseType = 'postgres' | 'redis';
export const DATABASE_TYPES: readonly DatabaseType[] = ['postgres', 'redis'];

export interface DatabasePlanSpec {
  name: string;
  vcpus: number;
  ram_gb: number;
  storage_gb: number;
  max_connections: number;
  engines: DatabaseType[];
}

export const DB_PLAN_SPECS: Record<DatabasePlan, DatabasePlanSpec> = {
  starter:  { name: 'Starter',  vcpus: 0.6, ram_gb: 1, storage_gb: 10,  max_connections: 25,  engines: ['postgres'] },
  standard: { name: 'Standard', vcpus: 1.0, ram_gb: 2, storage_gb: 25,  max_connections: 100, engines: ['postgres', 'redis'] },
  pro:      { name: 'Pro',      vcpus: 1.0, ram_gb: 4, storage_gb: 50,  max_connections: 200, engines: ['postgres', 'redis'] },
  business: { name: 'Business', vcpus: 2.0, ram_gb: 8, storage_gb: 100, max_connections: 500, engines: ['postgres', 'redis'] },
};

export type StoragePlan = 'starter' | 'standard' | 'business';

export interface StoragePlanSpec {
  name: string;
  storage_gb: number;
  egress_gb: number;
}

export const STORAGE_PLAN_SPECS: Record<StoragePlan, StoragePlanSpec> = {
  starter:  { name: 'Starter',  storage_gb: 250,  egress_gb: 100 },
  standard: { name: 'Standard', storage_gb: 1000, egress_gb: 500 },
  business: { name: 'Business', storage_gb: 5000, egress_gb: 2000 },
};

export type OpenClawPlan = 'shared' | 'dedicated';

export interface OpenClawPlanSpec {
  name: string;
  max_channels: number;
  max_skills: number;
  sla_uptime: number;
  dedicated: boolean;
}

export const OPENCLAW_PLAN_SPECS: Record<OpenClawPlan, OpenClawPlanSpec> = {
  shared:    { name: 'Shared',    max_channels: 3, max_skills: 5,  sla_uptime: 99.0, dedicated: false },
  dedicated: { name: 'Dedicated', max_channels: 6, max_skills: 20, sla_uptime: 99.9, dedicated: true },
};

/** models/hosting/openclaw.py VALID_CHANNELS / VALID_LLM_PROVIDERS and field patterns. */
export const OPENCLAW_CHANNELS = ['telegram', 'discord', 'slack', 'whatsapp', 'imessage', 'teams'] as const;
export const OPENCLAW_LLM_PROVIDERS = ['anthropic', 'openai', 'google', 'deepseek', 'together', 'mistral'] as const;
export const OPENCLAW_PROACTIVITY = ['reactive', 'scheduled', 'autonomous'] as const;
export const OPENCLAW_MEMORY = ['standard', 'cloud_backup'] as const;
export const OPENCLAW_USE_CASE_LENGTH = { min: 10, max: 1000 } as const;

/** models/hosting/domain.py DNSRecordCreate. */
export const DNS_RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS'] as const;
export const DNS_TTL = { min: 60, max: 86_400, default: 3600 } as const;

/** models/hosting/billing.py ResourceType (checkout) and BillingEventType. */
export const BILLING_RESOURCE_TYPES = ['vm', 'database', 'storage', 'openclaw', 'addon'] as const;
export type BillingResourceType = (typeof BILLING_RESOURCE_TYPES)[number];
export const BILLING_EVENT_TYPES = ['charge', 'refund', 'topup', 'tier_change', 'credit'] as const;
export const USDC_NETWORKS = ['base', 'ethereum'] as const;

// ─── VMs ─────────────────────────────────────────────────────────────────────

/** models/hosting/vm.py VMStatus, plus `stopping` written by the stop endpoint. */
export type VMStatus = 'pending' | 'provisioning' | 'running' | 'stopping' | 'stopped' | 'error' | 'deleting' | 'deleted';

export interface VM {
  id: string;
  account_id?: string;
  name: string;
  tier: VMTier;
  status: VMStatus;
  ip_address: string | null;
  internal_ip: string | null;
  gcp_instance_name: string;
  gcp_zone: string;
  image: string;
  ssh_public_key: string | null;
  labels?: Record<string, string>;
  created_at: string;
  started_at: string | null;
  stopped_at: string | null;
  error_message: string | null;
}

export interface VMCreateRequest {
  name: string;
  tier: VMTier;
  image?: string;
  ssh_public_key?: string;
}

export interface VMCreateResponse {
  id: string;
  name: string;
  tier: VMTier;
  status: string;
  gcp_instance_name: string;
  machine_type: string;
}

export interface VMVolume {
  id: string;
  name?: string;
  device_name?: string;
  size_gb?: number;
  disk_type?: string;
  status?: string;
  [key: string]: unknown;
}

export interface VolumeAttachResponse {
  volume_id: string;
  name: string;
  size_gb: number;
  disk_type: DiskType;
  status: string;
  monthly_cost_cents: number;
}

export interface FirewallRuleRequest {
  vm_id: string;
  direction: 'ingress' | 'egress';
  protocol: 'tcp' | 'udp' | 'icmp';
  port_range: string;
  source_ranges?: string[];
}

// ─── Databases ───────────────────────────────────────────────────────────────

/** models/hosting/database.py DatabaseStatus, plus `deleting` written by delete. */
export type DatabaseStatus = 'pending' | 'provisioning' | 'running' | 'stopped' | 'error' | 'deleting' | 'deleted';

export interface Database {
  id: string;
  name: string;
  db_type: DatabaseType;
  plan: DatabasePlan;
  status: DatabaseStatus;
  gcp_instance_name?: string | null;
  host: string | null;
  port: number | null;
  database_name: string | null;
  username: string | null;
  size_gb?: number;
  max_size_gb?: number;
  created_at: string;
  updated_at?: string;
  error_message: string | null;
}

export interface DatabaseCreateResponse {
  id: string;
  name: string;
  db_type: DatabaseType;
  plan: DatabasePlan;
  status: string;
}

export interface DatabaseMetrics {
  db_id: string;
  size_gb: number;
  max_size_gb: number;
  connections_active: number;
  cpu_utilization: number;
  storage_used_gb: number;
}

export interface DatabaseBackup {
  id: string;
  created_at: string;
  status: string;
  size_bytes?: number | null;
  backup_type: string;
}

// ─── Storage ─────────────────────────────────────────────────────────────────

export type BucketStatus = 'provisioning' | 'active' | 'suspended' | 'error' | 'deleting' | 'deleted';

export interface Bucket {
  id: string;
  name: string;
  plan: StoragePlan;
  status: BucketStatus;
  gcs_bucket_name: string;
  storage_bytes: number;
  max_storage_bytes: number;
  egress_bytes_month: number;
  max_egress_bytes_month: number;
  created_at: string;
  updated_at?: string;
}

export interface BucketCreateResponse {
  id: string;
  name: string;
  plan: StoragePlan;
  gcs_bucket_name: string;
  status?: string;
}

export interface BucketUsage {
  bucket_id: string;
  storage_bytes: number;
  max_storage_bytes: number;
  egress_bytes_month: number;
  max_egress_bytes_month: number;
}

// ─── OpenClaw ────────────────────────────────────────────────────────────────

/** models/hosting/openclaw.py OpenClawStatus, plus `restarting`/`deleting` written by the router. */
export type OpenClawStatus =
  | 'pending_setup' | 'provisioning' | 'running' | 'restarting' | 'stopped' | 'error' | 'deleting' | 'deleted';

export interface OpenClawInstance {
  id: string;
  plan: OpenClawPlan;
  status: OpenClawStatus;
  vm_id: string | null;
  agent_name: string | null;
  llm_provider: string;
  llm_model: string | null;
  channels: string[];
  skills: string[];
  use_case: string;
  proactivity_level: string;
  agent_personality?: string | null;
  special_instructions?: string | null;
  connection_instructions: string | null;
  uptime_percentage?: number;
  created_at: string;
  setup_completed_at: string | null;
  last_active_at: string | null;
  error_message: string | null;
}

export interface OpenClawCreateRequest {
  plan: OpenClawPlan;
  llm_provider: string;
  channels: string[];
  use_case: string;
  skills?: string[];
  proactivity_level?: string;
  agent_name?: string;
  agent_personality?: string;
  special_instructions?: string;
  memory_preference?: string;
}

export interface OpenClawCreateResponse {
  id: string;
  plan: OpenClawPlan;
  status: string;
  channels: string[];
}

export interface OpenClawUpdateRequest {
  channels?: string[];
  skills?: string[];
  proactivity_level?: string;
  agent_name?: string;
  agent_personality?: string;
  special_instructions?: string;
  llm_model?: string;
}

export interface OpenClawLogs {
  instance_id: string;
  logs: string[];
  message?: string;
}

// ─── Domains ─────────────────────────────────────────────────────────────────

export type DomainType = 'subdomain' | 'custom';
export type SSLStatus = 'pending' | 'active' | 'error';

export interface DnsRecord {
  id?: string;
  record_type: string;
  name: string;
  value: string;
  ttl: number;
  proxied: boolean;
  cloudflare_id?: string | null;
}

export interface Domain {
  id: string;
  hostname: string;
  domain_type: DomainType;
  ssl_status: SSLStatus;
  dns_records: DnsRecord[];
  target_ip: string | null;
  target_vm_id: string | null;
  created_at: string;
  updated_at?: string;
}

export interface DomainCreateResponse {
  id: string;
  hostname: string;
  ssl_status: SSLStatus;
}

export interface DnsRecordCreateRequest {
  record_type: string;
  name: string;
  value: string;
  ttl?: number;
  proxied?: boolean;
}

// ─── Account & billing ───────────────────────────────────────────────────────

export interface HostingAccount {
  id: string;
  email: string;
  display_name: string | null;
  status: string;
  usdc_balance_cents: number;
  wallet_address: string | null;
  wallet_verified?: boolean;
  nft_holder?: boolean;
  referral_code: string | null;
  created_at: string;
}

export interface HostingAccountUpdate {
  display_name?: string;
  wallet_address?: string;
  wallet_signature?: string;
}

export interface Subscription {
  id: string;
  resource_type: string;
  resource_id: string;
  plan: string;
  status: string;
  current_period_start?: string;
  current_period_end?: string;
  created_at?: string;
}

export interface BillingStatus {
  account_id: string;
  usdc_balance_cents: number;
  stripe_customer_id: string | null;
  active_subscriptions: number;
  subscriptions: Subscription[];
}

export interface BillingEvent {
  id: string;
  amount_cents: number;
  currency: string;
  payment_method: 'stripe' | 'usdc';
  event_type: string;
  description: string;
  tx_hash?: string | null;
  stripe_invoice_id?: string | null;
  created_at: string;
}

export interface BillingHistory {
  events: BillingEvent[];
  count: number;
}

export interface CheckoutSessionRequest {
  resource_type: BillingResourceType;
  plan: string;
  resource_id?: string;
  success_url: string;
  cancel_url: string;
}

export interface UsdcTopupRequest {
  tx_hash: string;
  amount_cents: number;
  chain: string;
}

export interface UsdcTopupResponse {
  status: string;
  amount_cents: number;
  new_balance_cents: number;
  tx_hash: string;
  chain: string;
}

export interface PlatformStatus {
  status: string;
  timestamp: string;
  services: Record<string, { status: string; error?: string }>;
}
