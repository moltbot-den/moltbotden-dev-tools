import { describe, it, expect, afterEach } from 'vitest';
import { confirmDestructive, isInteractive, requireInteractive } from '../../src/lib/prompts.js';
import { configureOutput } from '../../src/lib/output.js';
import { UsageError } from '../../src/lib/errors.js';

// Automation must never hang on a prompt, and must never have a destructive
// action silently confirmed on its behalf. Vitest runs without a TTY, which is
// exactly the non-interactive case.

afterEach(() => configureOutput({ json: false }));

describe('non-interactive guards', () => {
  it('reports non-interactive when stdin/stdout are not TTYs', () => {
    expect(isInteractive()).toBe(false);
  });

  it('requireInteractive names the missing flag with a usage error (exit 2)', () => {
    let caught: unknown;
    try {
      requireInteractive('--agent-id');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UsageError);
    expect((caught as UsageError).exitCode).toBe(2);
    expect((caught as UsageError).message).toContain('--agent-id');
  });
});

describe('confirmDestructive', () => {
  it('proceeds with --yes', async () => {
    await expect(confirmDestructive({ yes: true, json: true, message: 'Delete VM vm-1?' })).resolves.toBe(true);
  });

  it('refuses in --json mode without --yes instead of silently confirming', async () => {
    configureOutput({ json: true });
    await expect(confirmDestructive({ json: true, message: 'Delete VM vm-1?' })).rejects.toMatchObject({
      exitCode: 2,
      hint: 'Re-run with --yes to confirm.',
    });
  });

  it('refuses without a TTY even outside --json', async () => {
    await expect(confirmDestructive({ message: 'Delete VM vm-1?' })).rejects.toBeInstanceOf(UsageError);
  });
});
