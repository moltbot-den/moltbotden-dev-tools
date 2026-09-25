/**
 * Client for the Moltbot Den hosting API (/v1/hosting/*).
 *
 * Every method is a thin, typed wrapper over MoltbotDenClient.request(). Paths,
 * bodies and response shapes follow moltbotden-api/routers/hosting/*.py; see
 * types/hosting.ts for the models. Nothing here prompts or prints.
 */

import type { MoltbotDenClient, QueryValue } from '../api-client.js';
import type {
  BillingHistory, BillingStatus, Bucket, BucketCreateResponse, BucketUsage,
  CheckoutSessionRequest, Database, DatabaseBackup, DatabaseCreateResponse, DatabaseMetrics,
  DatabasePlan, DatabaseType, DiskType, DnsRecord, DnsRecordCreateRequest, Domain,
  DomainCreateResponse, DomainType, FirewallRuleRequest, HostingAccount, HostingAccountUpdate,
  OpenClawCreateRequest, OpenClawCreateResponse, OpenClawInstance, OpenClawLogs,
  OpenClawUpdateRequest, PlatformStatus, StoragePlan, UsdcTopupRequest, UsdcTopupResponse,
  VM, VMCreateRequest, VMCreateResponse, VMVolume, VolumeAttachResponse,
} from '../../types/hosting.js';

const seg = (id: string): string => encodeURIComponent(id);

export class HostingApi {
  constructor(private readonly client: MoltbotDenClient) {}

  // ─── Platform & account ───────────────────────────────────────────────────

  /** Public platform health (no auth). */
  platformStatus(): Promise<PlatformStatus> {
    return this.client.request('GET', '/v1/hosting/status');
  }

  getAccount(): Promise<HostingAccount> {
    return this.client.request('GET', '/v1/hosting/accounts/me');
  }

  updateAccount(body: HostingAccountUpdate): Promise<{ status: string }> {
    return this.client.request('PATCH', '/v1/hosting/accounts/me', { body });
  }

  // ─── VMs ──────────────────────────────────────────────────────────────────

  listVMs(opts: { status?: string; limit?: number } = {}): Promise<{ vms: VM[]; count: number }> {
    return this.client.request('GET', '/v1/hosting/compute/vms', { query: opts as Record<string, QueryValue> });
  }

  getVM(vmId: string): Promise<VM> {
    return this.client.request('GET', `/v1/hosting/compute/vms/${seg(vmId)}`);
  }

  createVM(body: VMCreateRequest): Promise<VMCreateResponse> {
    return this.client.request('POST', '/v1/hosting/compute/vms', { body });
  }

  startVM(vmId: string): Promise<{ status: string }> {
    return this.client.request('POST', `/v1/hosting/compute/vms/${seg(vmId)}/start`);
  }

  stopVM(vmId: string): Promise<{ status: string }> {
    return this.client.request('POST', `/v1/hosting/compute/vms/${seg(vmId)}/stop`);
  }

  restartVM(vmId: string): Promise<{ status: string }> {
    return this.client.request('POST', `/v1/hosting/compute/vms/${seg(vmId)}/restart`);
  }

  deleteVM(vmId: string): Promise<{ status: string }> {
    return this.client.request('DELETE', `/v1/hosting/compute/vms/${seg(vmId)}`);
  }

  /** Full serial console buffer; the API has no line limit. */
  getVMConsole(vmId: string): Promise<{ vm_id: string; output: string }> {
    return this.client.request('GET', `/v1/hosting/compute/vms/${seg(vmId)}/console`);
  }

  /** Replaces every SSH key on a running VM. */
  setVMSshKeys(vmId: string, keys: string[]): Promise<{ status: string; key_count: number }> {
    return this.client.request('PUT', `/v1/hosting/compute/vms/${seg(vmId)}/ssh-keys`, {
      body: { ssh_public_keys: keys },
    });
  }

  listVolumes(vmId: string): Promise<{ vm_id: string; volumes: VMVolume[]; count: number }> {
    return this.client.request('GET', `/v1/hosting/compute/vms/${seg(vmId)}/volumes`);
  }

  attachVolume(vmId: string, body: { size_gb: number; disk_type: DiskType }): Promise<VolumeAttachResponse> {
    return this.client.request('POST', `/v1/hosting/compute/vms/${seg(vmId)}/volumes`, { body });
  }

  /** Detaches AND deletes the disk. */
  detachVolume(vmId: string, volumeId: string): Promise<{ status: string; volume_id: string }> {
    return this.client.request('DELETE', `/v1/hosting/compute/vms/${seg(vmId)}/volumes/${seg(volumeId)}`);
  }

  snapshotVolume(vmId: string, volumeId: string): Promise<{ snapshot_name: string; source_volume: string; status: string }> {
    return this.client.request('POST', `/v1/hosting/compute/vms/${seg(vmId)}/volumes/${seg(volumeId)}/snapshot`);
  }

  addFirewallRule(body: FirewallRuleRequest): Promise<{ status: string; rule: Record<string, unknown> }> {
    return this.client.request('POST', '/v1/hosting/networking/firewalls', { body });
  }

  // ─── Databases ────────────────────────────────────────────────────────────

  listDatabases(opts: { limit?: number } = {}): Promise<{ databases: Database[]; count: number }> {
    return this.client.request('GET', '/v1/hosting/databases', { query: opts });
  }

  getDatabase(dbId: string): Promise<Database> {
    return this.client.request('GET', `/v1/hosting/databases/${seg(dbId)}`);
  }

  createDatabase(body: { name: string; db_type: DatabaseType; plan: DatabasePlan }): Promise<DatabaseCreateResponse> {
    return this.client.request('POST', '/v1/hosting/databases', { body });
  }

  deleteDatabase(dbId: string): Promise<{ status: string }> {
    return this.client.request('DELETE', `/v1/hosting/databases/${seg(dbId)}`);
  }

  getDatabaseMetrics(dbId: string): Promise<DatabaseMetrics> {
    return this.client.request('GET', `/v1/hosting/databases/${seg(dbId)}/metrics`);
  }

  listDatabaseBackups(dbId: string): Promise<{ db_id: string; backups: DatabaseBackup[]; count: number }> {
    return this.client.request('GET', `/v1/hosting/databases/${seg(dbId)}/backups`);
  }

  /** Rotates the Postgres password; the only call that returns it (once). */
  resetDatabasePassword(dbId: string): Promise<{ password: string; connection_string: string }> {
    return this.client.request('POST', `/v1/hosting/databases/${seg(dbId)}/reset-password`);
  }

  // ─── Storage ──────────────────────────────────────────────────────────────

  listBuckets(opts: { limit?: number } = {}): Promise<{ buckets: Bucket[]; count: number }> {
    return this.client.request('GET', '/v1/hosting/storage/buckets', { query: opts });
  }

  getBucket(bucketId: string): Promise<Bucket> {
    return this.client.request('GET', `/v1/hosting/storage/buckets/${seg(bucketId)}`);
  }

  createBucket(body: { name: string; plan: StoragePlan }): Promise<BucketCreateResponse> {
    return this.client.request('POST', '/v1/hosting/storage/buckets', { body });
  }

  getBucketUsage(bucketId: string): Promise<BucketUsage> {
    return this.client.request('GET', `/v1/hosting/storage/buckets/${seg(bucketId)}/usage`);
  }

  deleteBucket(bucketId: string): Promise<{ status: string }> {
    return this.client.request('DELETE', `/v1/hosting/storage/buckets/${seg(bucketId)}`);
  }

  // ─── OpenClaw ─────────────────────────────────────────────────────────────

  listOpenClaw(opts: { limit?: number } = {}): Promise<{ instances: OpenClawInstance[]; count: number }> {
    return this.client.request('GET', '/v1/hosting/openclaw', { query: opts });
  }

  getOpenClaw(instanceId: string): Promise<OpenClawInstance> {
    return this.client.request('GET', `/v1/hosting/openclaw/${seg(instanceId)}`);
  }

  createOpenClaw(body: OpenClawCreateRequest): Promise<OpenClawCreateResponse> {
    return this.client.request('POST', '/v1/hosting/openclaw', { body });
  }

  updateOpenClaw(instanceId: string, body: OpenClawUpdateRequest): Promise<{ status: string }> {
    return this.client.request('PATCH', `/v1/hosting/openclaw/${seg(instanceId)}`, { body });
  }

  restartOpenClaw(instanceId: string): Promise<{ status: string }> {
    return this.client.request('POST', `/v1/hosting/openclaw/${seg(instanceId)}/restart`);
  }

  getOpenClawLogs(instanceId: string, limit?: number): Promise<OpenClawLogs> {
    return this.client.request('GET', `/v1/hosting/openclaw/${seg(instanceId)}/logs`, { query: { limit } });
  }

  deleteOpenClaw(instanceId: string): Promise<{ status: string }> {
    return this.client.request('DELETE', `/v1/hosting/openclaw/${seg(instanceId)}`);
  }

  // ─── Domains ──────────────────────────────────────────────────────────────

  listDomains(opts: { limit?: number } = {}): Promise<{ domains: Domain[]; count: number }> {
    return this.client.request('GET', '/v1/hosting/domains', { query: opts });
  }

  getDomain(domainId: string): Promise<Domain> {
    return this.client.request('GET', `/v1/hosting/domains/${seg(domainId)}`);
  }

  addDomain(body: { hostname: string; domain_type: DomainType; target_vm_id?: string }): Promise<DomainCreateResponse> {
    return this.client.request('POST', '/v1/hosting/domains', { body });
  }

  removeDomain(domainId: string): Promise<{ status: string }> {
    return this.client.request('DELETE', `/v1/hosting/domains/${seg(domainId)}`);
  }

  addDnsRecord(domainId: string, body: DnsRecordCreateRequest): Promise<DnsRecord> {
    return this.client.request('POST', `/v1/hosting/domains/${seg(domainId)}/records`, { body });
  }

  removeDnsRecord(domainId: string, recordId: string): Promise<{ status: string }> {
    return this.client.request('DELETE', `/v1/hosting/domains/${seg(domainId)}/records/${seg(recordId)}`);
  }

  // ─── Billing ──────────────────────────────────────────────────────────────

  getBilling(): Promise<BillingStatus> {
    return this.client.request('GET', '/v1/hosting/billing');
  }

  getBillingHistory(opts: { event_type?: string; limit?: number; offset?: number } = {}): Promise<BillingHistory> {
    return this.client.request('GET', '/v1/hosting/billing/history', { query: opts });
  }

  getBillingPortal(): Promise<{ url: string }> {
    return this.client.request('GET', '/v1/hosting/billing/portal');
  }

  createCheckoutSession(body: CheckoutSessionRequest): Promise<{ session_id: string; url: string }> {
    return this.client.request('POST', '/v1/hosting/billing/checkout-session', { body });
  }

  topupUsdc(body: UsdcTopupRequest): Promise<UsdcTopupResponse> {
    return this.client.request('POST', '/v1/hosting/billing/topup', { body });
  }
}
