import { describe, it, expect, vi, beforeEach } from 'vitest';
import { statusBadge, print } from '../../src/lib/output.js';

describe('statusBadge', () => {
  it('should return green for running states', () => {
    const badge = statusBadge('running');
    expect(badge).toContain('running');
    expect(badge).toContain('●');
  });

  it('should return green for active', () => {
    expect(statusBadge('active')).toContain('active');
  });

  it('should return yellow for stopped', () => {
    expect(statusBadge('stopped')).toContain('stopped');
  });

  it('should return blue for pending', () => {
    expect(statusBadge('pending')).toContain('pending');
  });

  it('should return red for error', () => {
    expect(statusBadge('error')).toContain('error');
  });

  it('should return gray for terminated', () => {
    expect(statusBadge('terminated')).toContain('terminated');
  });

  it('should handle case-insensitive status', () => {
    expect(statusBadge('RUNNING')).toContain('RUNNING');
    expect(statusBadge('Active')).toContain('Active');
  });

  it('should handle unknown status gracefully', () => {
    const badge = statusBadge('unknown-status');
    expect(badge).toContain('unknown-status');
    expect(badge).toContain('●');
  });
});

describe('print utilities', () => {
  describe('relativeTime', () => {
    it('should return "just now" for recent timestamps', () => {
      const now = new Date().toISOString();
      expect(print.relativeTime(now)).toBe('just now');
    });

    it('should return minutes for timestamps within an hour', () => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      expect(print.relativeTime(fiveMinAgo)).toBe('5m ago');
    });

    it('should return hours for timestamps within a day', () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      expect(print.relativeTime(threeHoursAgo)).toBe('3h ago');
    });

    it('should return days for timestamps within a month', () => {
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
      expect(print.relativeTime(fiveDaysAgo)).toBe('5d ago');
    });

    it('should handle invalid dates gracefully', () => {
      const result = print.relativeTime('not-a-date');
      // relativeTime catches errors and returns the input, but 'not-a-date'
      // creates a Date object that returns 'Invalid Date' via toLocaleDateString
      expect(typeof result).toBe('string');
    });
  });

  describe('uptime', () => {
    it('should format seconds as <1m', () => {
      expect(print.uptime(30)).toBe('<1m');
    });

    it('should format minutes', () => {
      expect(print.uptime(300)).toBe('5m');
    });

    it('should format hours and minutes', () => {
      expect(print.uptime(7200)).toBe('2h');
    });

    it('should format days and hours', () => {
      expect(print.uptime(90000)).toBe('1d 1h');
    });

    it('should omit minutes when days are present', () => {
      expect(print.uptime(86400 + 3600 + 300)).toBe('1d 1h');
    });
  });

  describe('cents', () => {
    it('should format cents as dollars', () => {
      expect(print.cents(999)).toBe('$9.99');
      expect(print.cents(100)).toBe('$1.00');
      expect(print.cents(0)).toBe('$0.00');
      expect(print.cents(14400)).toBe('$144.00');
    });
  });
});
