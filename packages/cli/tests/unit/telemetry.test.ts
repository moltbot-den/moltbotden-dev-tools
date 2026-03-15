import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('telemetry', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('isTelemetryEnabled returns false when MBD_TELEMETRY_DISABLED is set', async () => {
    process.env.MBD_TELEMETRY_DISABLED = '1';
    const { isTelemetryEnabled } = await import('../../src/lib/telemetry.js');
    const enabled = await isTelemetryEnabled();
    expect(enabled).toBe(false);
  });

  it('isTelemetryEnabled returns false by default (no config)', async () => {
    delete process.env.MBD_TELEMETRY_DISABLED;
    const { isTelemetryEnabled } = await import('../../src/lib/telemetry.js');
    const enabled = await isTelemetryEnabled();
    expect(enabled).toBe(false);
  });

  it('recordEvent does not throw', async () => {
    const { recordEvent } = await import('../../src/lib/telemetry.js');
    // Should not throw even when telemetry is disabled
    expect(() => {
      recordEvent({
        event: 'test_command',
        json_mode: false,
        duration_ms: 100,
        success: true,
      });
    }).not.toThrow();
  });

  it('TelemetryEvent interface accepts minimal event', async () => {
    const { recordEvent } = await import('../../src/lib/telemetry.js');
    expect(() => {
      recordEvent({ event: 'heartbeat' });
    }).not.toThrow();
  });
});
