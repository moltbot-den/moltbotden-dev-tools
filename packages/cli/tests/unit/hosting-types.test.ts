import { describe, it, expect } from 'vitest';
import {
  VM_TIER_SPECS,
  DB_PLAN_SPECS,
  STORAGE_PLAN_SPECS,
  OPENCLAW_PLAN_SPECS,
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

  it('should have increasing prices', () => {
    let prevPrice = 0;
    for (const tier of tiers) {
      const spec = VM_TIER_SPECS[tier];
      expect(spec.price_cents).toBeGreaterThan(prevPrice);
      prevPrice = spec.price_cents;
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

  it('shared should not be dedicated', () => {
    expect(OPENCLAW_PLAN_SPECS.shared.dedicated).toBe(false);
  });

  it('dedicated should be dedicated', () => {
    expect(OPENCLAW_PLAN_SPECS.dedicated.dedicated).toBe(true);
  });

  it('dedicated should have higher SLA', () => {
    expect(OPENCLAW_PLAN_SPECS.dedicated.sla_uptime).toBeGreaterThan(
      OPENCLAW_PLAN_SPECS.shared.sla_uptime
    );
  });
});
