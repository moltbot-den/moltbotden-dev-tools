import { describe, it, expect } from 'vitest';
import { sanitizeMessage, sanitizeAgentId, maskApiKey } from '../../src/lib/sanitize.js';

describe('sanitizeMessage', () => {
  it('strips HTML tags', () => {
    expect(sanitizeMessage('<script>alert("xss")</script>Hello')).toBe('alert("xss")Hello');
  });

  it('strips nested HTML', () => {
    expect(sanitizeMessage('<b>bold</b> and <i>italic</i>')).toBe('bold and italic');
  });

  it('trims whitespace', () => {
    expect(sanitizeMessage('  hello world  ')).toBe('hello world');
  });

  it('truncates to 2000 characters', () => {
    const long = 'a'.repeat(2500);
    expect(sanitizeMessage(long).length).toBe(2000);
  });

  it('handles empty string', () => {
    expect(sanitizeMessage('')).toBe('');
  });

  it('preserves normal text', () => {
    expect(sanitizeMessage('Hello from agent!')).toBe('Hello from agent!');
  });

  it('handles angle brackets in normal text', () => {
    // HTML tag stripping treats < ... > as a tag, leaving surrounding text
    expect(sanitizeMessage('1 < 2 and 3 > 2')).toBe('1  2');
  });
});

describe('sanitizeAgentId', () => {
  it('lowercases input', () => {
    expect(sanitizeAgentId('MyAgent')).toBe('myagent');
  });

  it('replaces non-alphanumeric with hyphens and collapses', () => {
    // Underscores and dots become hyphens, then collapsed
    expect(sanitizeAgentId('my_agent.v2!')).toBe('my-agent-v2');
  });

  it('collapses multiple hyphens', () => {
    expect(sanitizeAgentId('my---agent')).toBe('my-agent');
  });

  it('trims leading/trailing hyphens', () => {
    expect(sanitizeAgentId('-my-agent-')).toBe('my-agent');
  });

  it('truncates to 50 characters', () => {
    const long = 'a'.repeat(60);
    expect(sanitizeAgentId(long).length).toBe(50);
  });

  it('handles empty string', () => {
    expect(sanitizeAgentId('')).toBe('');
  });

  it('preserves valid agent IDs', () => {
    expect(sanitizeAgentId('my-cool-agent-123')).toBe('my-cool-agent-123');
  });
});

describe('maskApiKey', () => {
  it('masks the middle of a standard key', () => {
    const key = 'moltbotden_sk_58ab6049666c3438df8234c9f117c545';
    const masked = maskApiKey(key);
    expect(masked).toContain('moltbotden_sk_');
    expect(masked).toContain('c545');
    expect(masked).toContain('****');
    expect(masked).not.toContain('58ab6049666c3438');
  });

  it('returns short keys as-is', () => {
    expect(maskApiKey('short')).toBe('short');
  });

  it('handles exactly 18 char key', () => {
    const key = 'moltbotden_sk_1234';
    const masked = maskApiKey(key);
    expect(masked).toBe(key); // 18 chars = 14 prefix + 4 suffix = no middle to mask
  });

  it('handles empty string', () => {
    expect(maskApiKey('')).toBe('');
  });
});
