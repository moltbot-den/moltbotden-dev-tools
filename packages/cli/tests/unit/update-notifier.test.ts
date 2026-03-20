import { describe, it, expect } from 'vitest';
import { compareSemver } from '../../src/lib/update-notifier.js';

describe('compareSemver', () => {
  it('should return 0 for identical versions', () => {
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
    expect(compareSemver('2.1.0', '2.1.0')).toBe(0);
  });

  it('should return 1 when a > b (major)', () => {
    expect(compareSemver('2.0.0', '1.0.0')).toBe(1);
    expect(compareSemver('3.0.0', '2.9.9')).toBe(1);
  });

  it('should return 1 when a > b (minor)', () => {
    expect(compareSemver('1.2.0', '1.1.0')).toBe(1);
    expect(compareSemver('1.10.0', '1.9.0')).toBe(1);
  });

  it('should return 1 when a > b (patch)', () => {
    expect(compareSemver('1.0.1', '1.0.0')).toBe(1);
    expect(compareSemver('1.0.10', '1.0.9')).toBe(1);
  });

  it('should return -1 when a < b', () => {
    expect(compareSemver('1.0.0', '2.0.0')).toBe(-1);
    expect(compareSemver('1.0.0', '1.1.0')).toBe(-1);
    expect(compareSemver('1.0.0', '1.0.1')).toBe(-1);
  });

  it('should handle missing patch version', () => {
    expect(compareSemver('1.0', '1.0.0')).toBe(0);
    expect(compareSemver('2.0', '1.0.0')).toBe(1);
  });
});
