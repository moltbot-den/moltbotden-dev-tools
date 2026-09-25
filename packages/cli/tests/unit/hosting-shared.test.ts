/**
 * Hosting command helpers: error translation, input validation that must run
 * before the server charges the balance, --wait polling, and formatting.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ApiError } from '../../src/types/api.js';
import { CliError, UsageError } from '../../src/lib/errors.js';
import type { HostingApi } from '../../src/lib/api/hosting.js';
import {
  explainHostingError, formatBytes, money, nameProblem, readSshKey, waitForStatus,
} from '../../src/commands/hosting/shared.js';
import { newContent, tail } from '../../src/commands/hosting/vm.js';
import { parseUsd, signedAmount } from '../../src/commands/hosting/billing.js';
import { defaultDomainType } from '../../src/commands/hosting/domains.js';

const KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl me@host';

describe('explainHostingError', () => {
  it('turns a feature-flag 503 into "isn\'t enabled on this server yet" instead of an outage message', async () => {
    const err = new ApiError(503, 'x', { detail: 'Compute service is not yet available' });
    const out = await explainHostingError(err, 'compute');
    expect(out).toBeInstanceOf(CliError);
    expect((out as CliError).message).toBe("Hosting compute isn't enabled on this server yet.");
    expect((out as CliError).message).not.toMatch(/coming soon/i);
    expect((out as CliError).status).toBe(503);
  });

  it('leaves a real 503 outage alone, so users are not told a working feature is off', async () => {
    const err = new ApiError(503, 'Service Unavailable', { detail: 'upstream timeout' });
    expect(await explainHostingError(err, 'compute')).toBe(err);
  });

  it('on 402 shows the current balance and both ways to add funds', async () => {
    const api = { getAccount: vi.fn().mockResolvedValue({ usdc_balance_cents: 150 }) } as unknown as HostingApi;
    const err = new ApiError(402, 'x', { detail: 'Insufficient balance for nano tier (999 cents/mo)' });
    const out = (await explainHostingError(err, 'compute', api)) as CliError;
    expect(out.message).toContain('Insufficient balance for nano tier (999 cents/mo)');
    expect(out.message).toContain('Your balance is $1.50.');
    expect(out.hint).toContain('mbd hosting billing topup');
    expect(out.hint).toContain('mbd hosting billing checkout');
  });

  it('still explains a 402 when the balance lookup itself fails', async () => {
    const api = { getAccount: vi.fn().mockRejectedValue(new Error('boom')) } as unknown as HostingApi;
    const out = (await explainHostingError(new ApiError(402, 'x', { detail: 'no money' }), 'compute', api)) as CliError;
    expect(out.message).toBe('Insufficient hosting balance: no money.');
  });
});

describe('name validation (runs before the server charges for the resource)', () => {
  it('rejects a leading digit, which the API rejects with a 422', () => {
    expect(nameProblem('1web')).toBeDefined();
  });

  it('rejects names over 50 characters (the cloud name mbd-<8>-<name> is capped at 63)', () => {
    expect(nameProblem('a'.repeat(51))).toBeDefined();
    expect(nameProblem('a'.repeat(50))).toBeUndefined();
  });

  it('rejects a trailing hyphen, which the API rejects', () => {
    expect(nameProblem('web-')).toBeDefined();
    expect(nameProblem('web-1')).toBeUndefined();
  });

  it('enforces the 3-character bucket minimum when asked', () => {
    expect(nameProblem('ab', 3)).toBeDefined();
    expect(nameProblem('abc', 3)).toBeUndefined();
  });
});

describe('readSshKey', () => {
  it('accepts a raw public key', () => {
    expect(readSshKey(KEY)).toBe(KEY);
  });

  it('reads a key from a file path (the old CLI sent the path itself as the key)', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mbd-key-')), 'id.pub');
    fs.writeFileSync(file, `${KEY}\n`);
    expect(readSshKey(file)).toBe(KEY);
  });

  it('refuses a private key file rather than uploading it', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mbd-key-')), 'id');
    fs.writeFileSync(file, '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----\n');
    expect(() => readSshKey(file)).toThrow(UsageError);
  });

  it('rejects garbage before the VM is paid for', () => {
    expect(() => readSshKey('not-a-key')).toThrow(UsageError);
  });
});

describe('waitForStatus', () => {
  const clock = () => {
    let t = 0;
    return { now: () => t, sleep: async (ms: number) => { t += ms; } };
  };

  it('polls until a done status', async () => {
    const statuses = ['pending', 'provisioning', 'running'];
    const fetch = vi.fn().mockImplementation(async () => ({ status: statuses.shift()! }));
    const c = clock();
    const r = await waitForStatus({ fetch, done: ['running'], label: 'VM', timeoutSec: 60, showCommand: 'x', intervalMs: 5, ...c });
    expect(r.status).toBe('running');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('fails fast on an error status and includes the server error message', async () => {
    const fetch = vi.fn().mockResolvedValue({ status: 'error', error_message: 'quota exceeded' });
    await expect(waitForStatus({ fetch, done: ['running'], label: 'VM web', timeoutSec: 60, showCommand: 'mbd hosting vm show 1', ...clock() }))
      .rejects.toThrow('VM web ended in status "error": quota exceeded');
  });

  it('times out with a hint instead of polling forever', async () => {
    const fetch = vi.fn().mockResolvedValue({ status: 'provisioning' });
    const err = await waitForStatus({ fetch, done: ['running'], label: 'VM', timeoutSec: 20, showCommand: 'mbd hosting vm show 1', intervalMs: 5000, ...clock() })
      .catch((e: unknown) => e as CliError);
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).message).toContain('Timed out after 20s');
    expect((err as CliError).hint).toContain('mbd hosting vm show 1');
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(5);
  });
});

describe('console log helpers', () => {
  it('tail keeps the last N lines (the API ignores ?lines= and returns the whole buffer)', () => {
    expect(tail('a\nb\nc\n', 2)).toBe('b\nc');
  });

  it('newContent returns only what was appended, so --follow never reprints the buffer', () => {
    expect(newContent('a\nb', 'a\nb\nc\nd')).toBe('c\nd');
    expect(newContent('a\nb', 'a\nb')).toBe('');
  });
});

describe('billing helpers', () => {
  it('parses USD into exact cents (the API rejects a top-up whose cents do not match the chain)', () => {
    expect(parseUsd('25', '--amount')).toBe(2500);
    expect(parseUsd('$25.5', '--amount')).toBe(2550);
    expect(parseUsd('0.07', '--amount')).toBe(7);
    expect(() => parseUsd('25.123', '--amount')).toThrow(UsageError);
    expect(() => parseUsd('0', '--amount')).toThrow(UsageError);
  });

  it('shows top-ups, credits and refunds as positive and charges as negative', () => {
    expect(signedAmount({ event_type: 'topup', amount_cents: 1000 })).toContain('+$10.00');
    expect(signedAmount({ event_type: 'refund', amount_cents: 500 })).toContain('+$5.00');
    expect(signedAmount({ event_type: 'charge', amount_cents: 999 })).toBe('-$9.99');
  });
});

describe('formatters', () => {
  it('never prints "NaN undefined" for missing byte counts', () => {
    expect(formatBytes(undefined)).toBe('–');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('formats cents', () => {
    expect(money(999)).toBe('$9.99');
    expect(money(undefined)).toBe('–');
  });

  it('defaults platform hostnames to subdomain and everything else to custom', () => {
    expect(defaultDomainType('bot.moltbotden.com')).toBe('subdomain');
    expect(defaultDomainType('bot.example.com')).toBe('custom');
  });
});
