import { describe, it, expect } from 'vitest';
import { didYouMean, levenshtein, KNOWN_COMMANDS } from '../../src/lib/did-you-mean.js';

describe('levenshtein', () => {
  it('should return 0 for identical strings', () => {
    expect(levenshtein('hello', 'hello')).toBe(0);
  });

  it('should return string length for empty comparisons', () => {
    expect(levenshtein('hello', '')).toBe(5);
    expect(levenshtein('', 'hello')).toBe(5);
  });

  it('should return 1 for single char difference', () => {
    expect(levenshtein('cat', 'bat')).toBe(1);
    expect(levenshtein('cat', 'car')).toBe(1);
  });

  it('should handle insertions', () => {
    expect(levenshtein('cat', 'cats')).toBe(1);
  });

  it('should handle deletions', () => {
    expect(levenshtein('cats', 'cat')).toBe(1);
  });

  it('should calculate complex distances', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });
});

describe('didYouMean', () => {
  it('should suggest close matches', () => {
    const suggestions = didYouMean('regiser', KNOWN_COMMANDS);
    expect(suggestions).toContain('register');
  });

  it('should suggest heartbeat for heartbeet', () => {
    const suggestions = didYouMean('heartbeet', KNOWN_COMMANDS);
    expect(suggestions).toContain('heartbeat');
  });

  it('should suggest status for staus', () => {
    const suggestions = didYouMean('staus', KNOWN_COMMANDS);
    expect(suggestions).toContain('status');
  });

  it('should suggest login for logn', () => {
    const suggestions = didYouMean('logn', KNOWN_COMMANDS);
    expect(suggestions).toContain('login');
  });

  it('should suggest hosting for hostin', () => {
    const suggestions = didYouMean('hostin', KNOWN_COMMANDS);
    expect(suggestions).toContain('hosting');
  });

  it('should suggest discover for discovr', () => {
    const suggestions = didYouMean('discovr', KNOWN_COMMANDS);
    expect(suggestions).toContain('discover');
  });

  it('should return empty for completely unrelated input', () => {
    const suggestions = didYouMean('xyzqwerty', KNOWN_COMMANDS);
    expect(suggestions).toHaveLength(0);
  });

  it('should return empty for empty input', () => {
    expect(didYouMean('', KNOWN_COMMANDS)).toHaveLength(0);
  });

  it('should return at most 3 suggestions', () => {
    const suggestions = didYouMean('s', KNOWN_COMMANDS, 10);
    expect(suggestions.length).toBeLessThanOrEqual(3);
  });

  it('should handle exact case-insensitive match (no suggestion needed)', () => {
    // An exact match (just different case) has distance 0, which is excluded
    // because you don't need a "did you mean?" for a correct command
    const suggestions = didYouMean('REGISTER', KNOWN_COMMANDS);
    expect(suggestions).toHaveLength(0);
  });

  it('should be case-insensitive for close matches', () => {
    const suggestions = didYouMean('REGISER', KNOWN_COMMANDS);
    expect(suggestions).toContain('register');
  });

  it('should suggest init for int', () => {
    const suggestions = didYouMean('int', KNOWN_COMMANDS);
    expect(suggestions).toContain('init');
  });

  it('should suggest update for updae', () => {
    const suggestions = didYouMean('updae', KNOWN_COMMANDS);
    expect(suggestions).toContain('update');
  });
});
