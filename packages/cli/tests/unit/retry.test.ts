import { describe, it, expect, vi } from 'vitest';
import { withRetry } from '../../src/lib/retry.js';
import { ApiError } from '../../src/types/api.js';

describe('withRetry', () => {
  it('returns immediately on success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { maxRetries: 3, baseDelay: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on 500 errors', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new ApiError(500, 'Server Error'))
      .mockResolvedValue('ok');

    const result = await withRetry(fn, { maxRetries: 3, baseDelay: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries on 429 rate limit', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new ApiError(429, 'Rate limited'))
      .mockResolvedValue('ok');

    const result = await withRetry(fn, { maxRetries: 3, baseDelay: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries on network errors (status 0)', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new ApiError(0, 'Network error'))
      .mockResolvedValue('ok');

    const result = await withRetry(fn, { maxRetries: 3, baseDelay: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on 400 client errors', async () => {
    const fn = vi.fn().mockRejectedValue(new ApiError(400, 'Bad Request'));
    await expect(withRetry(fn, { maxRetries: 3, baseDelay: 10 })).rejects.toThrow('Bad Request');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 401', async () => {
    const fn = vi.fn().mockRejectedValue(new ApiError(401, 'Unauthorized'));
    await expect(withRetry(fn, { maxRetries: 3, baseDelay: 10 })).rejects.toThrow('Unauthorized');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 403', async () => {
    const fn = vi.fn().mockRejectedValue(new ApiError(403, 'Forbidden'));
    await expect(withRetry(fn, { maxRetries: 3, baseDelay: 10 })).rejects.toThrow('Forbidden');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 404', async () => {
    const fn = vi.fn().mockRejectedValue(new ApiError(404, 'Not Found'));
    await expect(withRetry(fn, { maxRetries: 3, baseDelay: 10 })).rejects.toThrow('Not Found');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 409', async () => {
    const fn = vi.fn().mockRejectedValue(new ApiError(409, 'Conflict'));
    await expect(withRetry(fn, { maxRetries: 3, baseDelay: 10 })).rejects.toThrow('Conflict');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('exhausts max retries and throws', async () => {
    const fn = vi.fn().mockRejectedValue(new ApiError(500, 'Server Error'));
    await expect(withRetry(fn, { maxRetries: 2, baseDelay: 10 })).rejects.toThrow('Server Error');
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it('retries on non-ApiError errors', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValue('ok');

    const result = await withRetry(fn, { maxRetries: 3, baseDelay: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
