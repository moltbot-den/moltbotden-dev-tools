import { describe, it, expect } from 'vitest';
import {
  VM_TIER_SPECS,
  DB_PLAN_SPECS,
  STORAGE_PLAN_SPECS,
  OPENCLAW_PLAN_SPECS,
  OPENCLAW_CHANNELS,
  OPENCLAW_LLM_PROVIDERS,
  OPENCLAW_TOKEN_RE,
  type VMTier,
  type DatabasePlan,
  type StoragePlan,
  type OpenClawPlan,
} from '../../src/types/hosting.js';

describe('VM Tier Specs', () => {
  const tiers: VMTier[] = ['nano', 'micro', 'standard', 'pro', 'power', 'ultra'];

  it('should have all tier definitions', () => {
    for (const tier of tiers) {
      expect(VM_TIER_SPECS[tier]).toBeDefined();
    }
  });

  it('should have increasing specs as tier goes up', () => {
    let prevRam = 0;
    for (const tier of tiers) {
      const spec = VM_TIER_SPECS[tier];
      expect(spec.ram_gb).toBeGreaterThan(prevRam);
      prevRam = spec.ram_gb;
    }
  });

  it('carries no prices: the CLI must never show a price it did not get from the API', () => {
    for (const spec of [
      ...Object.values(VM_TIER_SPECS),
      ...Object.values(DB_PLAN_SPECS),
      ...Object.values(STORAGE_PLAN_SPECS),
      ...Object.values(OPENCLAW_PLAN_SPECS),
    ]) {
      expect(Object.keys(spec).some((k) => /price|cost|cents/.test(k))).toBe(false);
    }
  });

  it('should have valid GCP machine types', () => {
    for (const tier of tiers) {
      expect(VM_TIER_SPECS[tier].machine_type).toMatch(/^e2-/);
    }
  });
});

describe('Database Plan Specs', () => {
  const plans: DatabasePlan[] = ['starter', 'standard', 'pro', 'business'];

  it('should have all plan definitions', () => {
    for (const plan of plans) {
      expect(DB_PLAN_SPECS[plan]).toBeDefined();
    }
  });

  it('should have increasing storage', () => {
    let prevStorage = 0;
    for (const plan of plans) {
      const spec = DB_PLAN_SPECS[plan];
      expect(spec.storage_gb).toBeGreaterThan(prevStorage);
      prevStorage = spec.storage_gb;
    }
  });

  it('starter should only support postgres', () => {
    expect(DB_PLAN_SPECS.starter.engines).toEqual(['postgres']);
  });

  it('standard+ should support postgres and redis', () => {
    for (const plan of ['standard', 'pro', 'business'] as DatabasePlan[]) {
      expect(DB_PLAN_SPECS[plan].engines).toContain('postgres');
      expect(DB_PLAN_SPECS[plan].engines).toContain('redis');
    }
  });
});

describe('Storage Plan Specs', () => {
  const plans: StoragePlan[] = ['starter', 'standard', 'business'];

  it('should have all plan definitions', () => {
    for (const plan of plans) {
      expect(STORAGE_PLAN_SPECS[plan]).toBeDefined();
    }
  });

  it('should have increasing storage', () => {
    let prevStorage = 0;
    for (const plan of plans) {
      const spec = STORAGE_PLAN_SPECS[plan];
      expect(spec.storage_gb).toBeGreaterThan(prevStorage);
      prevStorage = spec.storage_gb;
    }
  });
});

describe('OpenClaw Plan Specs', () => {
  const plans: OpenClawPlan[] = ['shared', 'dedicated'];

  it('should have all plan definitions', () => {
    for (const plan of plans) {
      expect(OPENCLAW_PLAN_SPECS[plan]).toBeDefined();
    }
  });

  it('every plan is its own VM, and dedicated is the bigger machine with the higher uptime target', () => {
    // The old catalog advertised a shared multi-tenant plan; the backend now gives every instance a VM.
    for (const plan of plans) expect(OPENCLAW_PLAN_SPECS[plan].machine_type).toMatch(/^e2-/);
    expect(OPENCLAW_PLAN_SPECS.dedicated.ram_gb).toBeGreaterThan(OPENCLAW_PLAN_SPECS.shared.ram_gb);
    expect(OPENCLAW_PLAN_SPECS.dedicated.sla_uptime).toBeGreaterThan(OPENCLAW_PLAN_SPECS.shared.sla_uptime);
  });

  it('offers only the channels and providers the pinned OpenClaw image can run on a Linux VM', () => {
    // WhatsApp, iMessage, Teams and the dropped LLM providers are rejected by the API after the questionnaire.
    expect([...OPENCLAW_CHANNELS]).toEqual(['telegram', 'discord', 'slack']);
    expect([...OPENCLAW_LLM_PROVIDERS]).toEqual(['anthropic', 'openai', 'google']);
    for (const plan of plans) expect(OPENCLAW_PLAN_SPECS[plan].max_channels).toBeLessThanOrEqual(OPENCLAW_CHANNELS.length);
  });

  it('token shapes match what each platform issues, so a token pasted into the wrong flag fails locally', () => {
    expect(OPENCLAW_TOKEN_RE.telegram_bot.test(`123456789:${'A'.repeat(35)}`)).toBe(true);
    expect(OPENCLAW_TOKEN_RE.slack_bot.test(`xoxb-${'1'.repeat(24)}`)).toBe(true);
    expect(OPENCLAW_TOKEN_RE.slack_app.test(`xoxb-${'1'.repeat(24)}`)).toBe(false);
    expect(OPENCLAW_TOKEN_RE.slack_bot.test(`xapp-${'1'.repeat(24)}`)).toBe(false);
    expect(OPENCLAW_TOKEN_RE.telegram_bot.test(`xoxb-${'1'.repeat(24)}`)).toBe(false);
  });
});
