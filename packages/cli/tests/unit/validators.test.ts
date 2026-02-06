import { describe, it, expect } from 'vitest';
import {
  validateAgentId,
  validateInviteCode,
  validateDisplayName,
  validateTagline,
  validateDescription,
} from '../../src/lib/validators.js';

describe('validateAgentId', () => {
  it('should accept valid agent IDs', () => {
    expect(validateAgentId('my-agent')).toBe(true);
    expect(validateAgentId('agent123')).toBe(true);
    expect(validateAgentId('test-agent-2')).toBe(true);
    expect(validateAgentId('a1b2c3')).toBe(true);
  });

  it('should reject agent IDs that are too short', () => {
    expect(validateAgentId('ab')).toContain('at least 3 characters');
  });

  it('should reject agent IDs that are too long', () => {
    const longId = 'a'.repeat(51);
    expect(validateAgentId(longId)).toContain('at most 50 characters');
  });

  it('should reject agent IDs with invalid characters', () => {
    expect(validateAgentId('My-Agent')).toContain('lowercase');
    expect(validateAgentId('my_agent')).toContain('lowercase');
    expect(validateAgentId('my agent')).toContain('lowercase');
    expect(validateAgentId('my@agent')).toContain('lowercase');
  });

  it('should reject agent IDs starting or ending with hyphens', () => {
    expect(validateAgentId('-my-agent')).toContain('start and end');
    expect(validateAgentId('my-agent-')).toContain('start and end');
  });

  it('should reject agent IDs with consecutive hyphens', () => {
    expect(validateAgentId('my--agent')).toContain('consecutive hyphens');
  });

  it('should reject non-string values', () => {
    expect(validateAgentId(123 as any)).toContain('must be a string');
  });
});

describe('validateInviteCode', () => {
  it('should accept valid invite codes', () => {
    expect(validateInviteCode('INV-ABCD-2345')).toBe(true);
    expect(validateInviteCode('INV-XYZ9-8765')).toBe(true);
    expect(validateInviteCode('INV-HJKL-9876')).toBe(true);
  });

  it('should accept empty/optional values', () => {
    expect(validateInviteCode('')).toBe(true);
    expect(validateInviteCode('   ')).toBe(true);
  });

  it('should reject invalid formats', () => {
    expect(validateInviteCode('INV-ABC-1234')).toContain('format');
    expect(validateInviteCode('INVABCD1234')).toContain('format');
    expect(validateInviteCode('inv-abcd-1234')).toContain('format');
  });

  it('should reject codes with excluded characters (I, O, 0, 1)', () => {
    expect(validateInviteCode('INV-IOIO-2345')).toContain('format'); // Contains I and O
    expect(validateInviteCode('INV-ABCD-0123')).toContain('format'); // Contains 0 and 1
    expect(validateInviteCode('INV-ABCD-1234')).toContain('format'); // Contains 1
  });
});

describe('validateDisplayName', () => {
  it('should accept valid display names', () => {
    expect(validateDisplayName('My Agent')).toBe(true);
    expect(validateDisplayName('Agent 123')).toBe(true);
    expect(validateDisplayName('The Amazing Agent')).toBe(true);
  });

  it('should reject names that are too short', () => {
    expect(validateDisplayName('A')).toContain('at least 2 characters');
  });

  it('should reject names that are too long', () => {
    const longName = 'A'.repeat(51);
    expect(validateDisplayName(longName)).toContain('at most 50 characters');
  });

  it('should trim whitespace before validation', () => {
    expect(validateDisplayName('  AB  ')).toBe(true);
  });

  it('should reject non-string values', () => {
    expect(validateDisplayName(123 as any)).toContain('must be a string');
  });
});

describe('validateTagline', () => {
  it('should accept valid taglines', () => {
    expect(validateTagline('A helpful AI assistant')).toBe(true);
    expect(validateTagline('Building the future')).toBe(true);
  });

  it('should accept empty values (optional field)', () => {
    expect(validateTagline('')).toBe(true);
    expect(validateTagline('   ')).toBe(true);
  });

  it('should reject taglines that are too long', () => {
    const longTagline = 'A'.repeat(101);
    expect(validateTagline(longTagline)).toContain('at most 100 characters');
  });
});

describe('validateDescription', () => {
  it('should accept valid descriptions', () => {
    expect(validateDescription('I am an AI agent that helps with...')).toBe(true);
  });

  it('should accept empty values (optional field)', () => {
    expect(validateDescription('')).toBe(true);
  });

  it('should reject descriptions that are too long', () => {
    const longDesc = 'A'.repeat(501);
    expect(validateDescription(longDesc)).toContain('at most 500 characters');
  });
});
