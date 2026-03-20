/**
 * Auth manager tests — tests the auth resolution logic and config format.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the filesystem so tests don't read/write real config files
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
    writeFile: vi.fn().mockResolvedValue(undefined),
    chmod: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
  };
});

describe('AuthManager auth resolution', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.MOLTBOTDEN_API_KEY;
    delete process.env.MOLTBOTDEN_API_URL;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should prioritize explicit API key over env var', async () => {
    const { AuthManager } = await import('../../src/lib/auth-manager.js');

    process.env.MOLTBOTDEN_API_KEY = 'env-key';
    const auth = await AuthManager.getAuth('explicit-key');

    expect(auth).not.toBeNull();
    expect(auth!.apiKey).toBe('explicit-key');
    expect(auth!.source).toBe('flag');
  });

  it('should use env var when no explicit key and no config file exists', async () => {
    const { AuthManager } = await import('../../src/lib/auth-manager.js');

    process.env.MOLTBOTDEN_API_KEY = 'env-key';
    const auth = await AuthManager.getAuth(undefined, undefined);

    // With config file mocked to throw ENOENT, env var should always win
    expect(auth).not.toBeNull();
    expect(auth!.source).toBe('env');
    expect(auth!.apiKey).toBe('env-key');
  });

  it('should return null when no credentials are available', async () => {
    const { AuthManager } = await import('../../src/lib/auth-manager.js');

    const auth = await AuthManager.getAuth(undefined, undefined);

    expect(auth).toBeNull();
  });

  it('should allow overriding API URL via explicit parameter', async () => {
    const { AuthManager } = await import('../../src/lib/auth-manager.js');

    const auth = await AuthManager.getAuth('test-key', 'https://custom.api.com');

    expect(auth).not.toBeNull();
    expect(auth!.apiUrl).toBe('https://custom.api.com');
  });

  it('should use MOLTBOTDEN_API_URL env var for the URL when resolving from env', async () => {
    const { AuthManager } = await import('../../src/lib/auth-manager.js');

    process.env.MOLTBOTDEN_API_KEY = 'env-key';
    process.env.MOLTBOTDEN_API_URL = 'https://env-url.com';
    const auth = await AuthManager.getAuth(undefined, undefined);

    expect(auth).not.toBeNull();
    expect(auth!.apiUrl).toBe('https://env-url.com');
  });
});

describe('GlobalConfig format', () => {
  it('should define the expected config shape', async () => {
    const { AuthManager } = await import('../../src/lib/auth-manager.js');

    const config = await AuthManager.readConfig();
    expect(config).toHaveProperty('version');
    expect(config).toHaveProperty('agents');
    expect(typeof config.agents).toBe('object');
  });
});
