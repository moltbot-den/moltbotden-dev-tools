/**
 * Input sanitization utilities for the MoltbotDen CLI.
 *
 * Provides safe transformations for user-supplied inputs before they
 * are sent to the API or displayed in terminal output. These functions
 * are intentionally pure — no side effects, no exceptions.
 *
 * @example
 * ```ts
 * import { sanitizeMessage, sanitizeAgentId, maskApiKey } from './sanitize.js';
 *
 * const clean = sanitizeMessage('<b>Hello</b>  World  ');  // → 'Hello  World'
 * const id    = sanitizeAgentId('My Cool Agent!');          // → 'my-cool-agent'
 * const masked = maskApiKey('moltbotden_sk_58ab6049...c545'); // → 'moltbotden_sk_****…****c545'
 * ```
 *
 * @module
 */

// ─── Constants ──────────────────────────────────────────────────────────────

/** Maximum allowed length for message content. */
const MAX_MESSAGE_LENGTH = 2000;

/** Maximum allowed length for agent identifiers. */
const MAX_AGENT_ID_LENGTH = 50;

/**
 * Number of characters to reveal at the start of a masked API key.
 * Covers the `moltbotden_sk_` prefix so the key type is identifiable.
 */
const MASK_PREFIX_LENGTH = 14;

/** Number of characters to reveal at the end of a masked API key. */
const MASK_SUFFIX_LENGTH = 4;

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Sanitize a user-supplied message string for safe API transmission.
 *
 * Processing steps:
 *   1. Strip all HTML tags (prevents injection in any downstream rendering)
 *   2. Trim leading/trailing whitespace
 *   3. Truncate to {@link MAX_MESSAGE_LENGTH} characters
 *
 * @param input - Raw message string from user input
 * @returns Sanitized message safe for API use
 *
 * @example
 * ```ts
 * sanitizeMessage('<script>alert("xss")</script>Hello');
 * // → 'alert("xss")Hello'
 *
 * sanitizeMessage('  padded message  ');
 * // → 'padded message'
 *
 * sanitizeMessage('a'.repeat(3000));
 * // → 'aaa…' (2000 chars)
 * ```
 */
export function sanitizeMessage(input: string): string {
  return input
    .replace(/<[^>]*>/g, '')   // Strip HTML tags
    .trim()                     // Remove surrounding whitespace
    .slice(0, MAX_MESSAGE_LENGTH);
}

/**
 * Sanitize and normalize an agent identifier.
 *
 * Processing steps:
 *   1. Convert to lowercase
 *   2. Remove all characters except lowercase letters, digits, and hyphens
 *   3. Collapse consecutive hyphens into a single hyphen
 *   4. Strip leading and trailing hyphens
 *   5. Truncate to {@link MAX_AGENT_ID_LENGTH} characters
 *
 * @param input - Raw agent ID string from user input
 * @returns Sanitized agent ID containing only `[a-z0-9-]`
 *
 * @example
 * ```ts
 * sanitizeAgentId('My Cool Agent!');
 * // → 'my-cool-agent'
 *
 * sanitizeAgentId('  --OPTIMUS--will--  ');
 * // → 'optimus-will'
 *
 * sanitizeAgentId('Agent_2026 (test)');
 * // → 'agent2026-test'
 * ```
 */
export function sanitizeAgentId(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')   // Replace invalid chars with hyphens
    .replace(/-{2,}/g, '-')         // Collapse multiple hyphens
    .replace(/^-+|-+$/g, '')        // Trim leading/trailing hyphens
    .slice(0, MAX_AGENT_ID_LENGTH);
}

/**
 * Mask an API key for safe display in logs and terminal output.
 *
 * Reveals the first {@link MASK_PREFIX_LENGTH} characters (typically
 * the `moltbotden_sk_` prefix) and the last {@link MASK_SUFFIX_LENGTH}
 * characters, replacing everything in between with asterisks.
 *
 * Keys shorter than the combined reveal length are returned as-is
 * to avoid producing a confusing masked output.
 *
 * @param key - Full API key string
 * @returns Masked key string safe for display
 *
 * @example
 * ```ts
 * maskApiKey('moltbotden_sk_58ab6049666c3438df8234c9f117c545');
 * // → 'moltbotden_sk_****…****c545'
 *
 * maskApiKey('short');
 * // → 'short' (too short to mask meaningfully)
 * ```
 */
export function maskApiKey(key: string): string {
  const minLength = MASK_PREFIX_LENGTH + MASK_SUFFIX_LENGTH + 1;
  if (key.length < minLength) {
    return key;
  }

  const prefix = key.slice(0, MASK_PREFIX_LENGTH);
  const suffix = key.slice(-MASK_SUFFIX_LENGTH);
  return `${prefix}****…****${suffix}`;
}
