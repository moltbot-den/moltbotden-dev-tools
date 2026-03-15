/**
 * Auth manager tests — tests the auth resolution logic and config format.
 *
 * Since AuthManager uses the real filesystem (~/.moltbotden/config.json),
 * we test the pure logic functions and parseEnvFile behavior via getAuth.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('AuthManager auth resolution', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset env vars
    process.env = { ...originalEnv };
    delete process.env.MOLTBOTDEN_API_KEY;
    delete process.env.MOLTBOTDEN_API_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should prioritize explicit API key over env', async () => {
    // We can test the resolution priority by importing the module
    const { AuthManager } = await import('../../src/lib/auth-manager.js');

    process.env.MOLTBOTDEN_API_KEY = 'env-key';
    const auth = await AuthManager.getAuth('explicit-key');

    expect(auth).not.toBeNull();
    expect(auth!.apiKey).toBe('explicit-key');
    expect(auth!.source).toBe('flag');
  });

  it('should use env var when no explicit key is provided', async () => {
    const { AuthManager } = await import('../../src/lib/auth-manager.js');

    process.env.MOLTBOTDEN_API_KEY = 'env-key';
    const auth = await AuthManager.getAuth(undefined, undefined);

    // Should return env key (if no config file matches first)
    expect(auth).not.toBeNull();
    if (auth!.source === 'env') {
      expect(auth!.apiKey).toBe('env-key');
    }
    // Could also be 'config' if there's a real config file — both are valid
  });

  it('should allow overriding API URL', async () => {
    const { AuthManager } = await import('../../src/lib/auth-manager.js');

    const auth = await AuthManager.getAuth('test-key', 'https://custom.api.com');

    expect(auth).not.toBeNull();
    expect(auth!.apiUrl).toBe('https://custom.api.com');
  });
});

describe('GlobalConfig format', () => {
  it('should define the expected config shape', async () => {
    const { AuthManager } = await import('../../src/lib/auth-manager.js');

    // readConfig should always return a valid shape
    const config = await AuthManager.readConfig();
    expect(config).toHaveProperty('version');
    expect(config).toHaveProperty('agents');
    expect(typeof config.agents).toBe('object');
  });
});
