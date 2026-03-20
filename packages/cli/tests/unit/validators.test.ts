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
    expect(validateAgentId('my-agent')).toBeUndefined();
    expect(validateAgentId('agent123')).toBeUndefined();
    expect(validateAgentId('test-agent-2')).toBeUndefined();
    expect(validateAgentId('a1b2c3')).toBeUndefined();
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
    expect(validateInviteCode('INV-ABCD-2345')).toBeUndefined();
    expect(validateInviteCode('INV-XYZ9-8765')).toBeUndefined();
    expect(validateInviteCode('INV-HJKL-9876')).toBeUndefined();
  });

  it('should accept empty/optional values', () => {
    expect(validateInviteCode('')).toBeUndefined();
    expect(validateInviteCode('   ')).toBeUndefined();
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
    expect(validateDisplayName('My Agent')).toBeUndefined();
    expect(validateDisplayName('Agent 123')).toBeUndefined();
    expect(validateDisplayName('The Amazing Agent')).toBeUndefined();
  });

  it('should reject names that are too short', () => {
    expect(validateDisplayName('A')).toContain('at least 2 characters');
  });

  it('should reject names that are too long', () => {
    const longName = 'A'.repeat(51);
    expect(validateDisplayName(longName)).toContain('at most 50 characters');
  });

  it('should trim whitespace before validation', () => {
    expect(validateDisplayName('  AB  ')).toBeUndefined();
  });

  it('should reject non-string values', () => {
    expect(validateDisplayName(123 as any)).toContain('must be a string');
  });
});

describe('validateTagline', () => {
  it('should accept valid taglines', () => {
    expect(validateTagline('A helpful AI assistant')).toBeUndefined();
    expect(validateTagline('Building the future')).toBeUndefined();
  });

  it('should accept empty values (optional field)', () => {
    expect(validateTagline('')).toBeUndefined();
    expect(validateTagline('   ')).toBeUndefined();
  });

  it('should reject taglines that are too long', () => {
    const longTagline = 'A'.repeat(101);
    expect(validateTagline(longTagline)).toContain('at most 100 characters');
  });
});

describe('validateDescription', () => {
  it('should accept valid descriptions', () => {
    expect(validateDescription('I am an AI agent that helps with...')).toBeUndefined();
  });

  it('should accept empty values (optional field)', () => {
    expect(validateDescription('')).toBeUndefined();
  });

  it('should reject descriptions that are too long', () => {
    const longDesc = 'A'.repeat(501);
    expect(validateDescription(longDesc)).toContain('at most 500 characters');
  });
});
