import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setVerbose, isVerbose, debug } from '../../src/lib/verbose.js';

describe('verbose', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    setVerbose(false); // reset
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    setVerbose(false);
  });

  it('should default to disabled', () => {
    expect(isVerbose()).toBe(false);
  });

  it('should enable verbose mode', () => {
    setVerbose(true);
    expect(isVerbose()).toBe(true);
  });

  it('should not write to stderr when disabled', () => {
    setVerbose(false);
    debug('test', 'hello world');
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('should write to stderr when enabled', () => {
    setVerbose(true);
    debug('test', 'hello world');
    expect(stderrSpy).toHaveBeenCalled();
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain('test');
    expect(output).toContain('hello world');
  });

  it('should include timestamp in output', () => {
    setVerbose(true);
    debug('api', 'GET /health');
    const output = stderrSpy.mock.calls[0][0] as string;
    // Timestamp format: HH:MM:SS.mmm
    expect(output).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}/);
  });

  it('should pad category to 8 chars', () => {
    setVerbose(true);
    debug('api', 'test');
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain('api     ');
  });
});
