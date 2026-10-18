/**
 * Runtime hook adapters for Moltbot Den Network.
 *
 * Why it matters: each runtime only reads its own JSON shape. A wrong key
 * means the peer's message is silently dropped (or, for a stop hook, the
 * agent stops instead of reading its mail). And Cursor and Copilot CLI also
 * run Claude Code's hooks file, so a hook written for Claude Code must answer
 * in the format of whoever really called it.
 */

import { describe, expect, it } from 'vitest';
import { canDeliver, detectCaller, hookKind, parsePayload, renderHookOutput, statusFor } from '../../src/lib/net/hooks.js';

const MAIL = '<den-message from="ana/web" type="ask">hi</den-message>';

describe('renderHookOutput', () => {
  it.each([
    ['claude-code', 'PostToolUse', { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: MAIL } }],
    ['claude-code', 'UserPromptSubmit', { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: MAIL } }],
    ['claude-code', 'SessionStart', { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: MAIL } }],
    ['claude-code', 'Stop', { decision: 'block', reason: MAIL }],
    ['codex', 'PostToolUse', { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: MAIL } }],
    ['codex', 'Stop', { decision: 'block', reason: MAIL }],
    ['cursor', 'postToolUse', { additional_context: MAIL }],
    ['cursor', 'sessionStart', { additional_context: MAIL }],
    ['cursor', 'stop', { followup_message: MAIL }],
    ['gemini-cli', 'AfterTool', { hookSpecificOutput: { hookEventName: 'AfterTool', additionalContext: MAIL } }],
    ['gemini-cli', 'AfterAgent', { decision: 'deny', reason: MAIL }],
    ['copilot-cli', 'postToolUse', { additionalContext: MAIL, hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: MAIL } }],
    ['copilot-cli', 'agentStop', { decision: 'block', reason: MAIL }],
  ] as const)('%s %s', (runtime, event, expected) => {
    const kind = hookKind(event)!;
    expect(JSON.parse(renderHookOutput(runtime, kind, MAIL))).toEqual(expected);
  });

  it('prints nothing when there is no mail, so the runtime carries on unchanged', () => {
    expect(renderHookOutput('claude-code', 'tool', null)).toBe('');
    expect(renderHookOutput('cursor', 'stop', '')).toBe('');
  });

  it('never renders at events the runtime cannot show, since fetching would mark mail read', () => {
    expect(canDeliver('gemini-cli', 'start')).toBe(false);
    expect(canDeliver('cursor', 'prompt')).toBe(false);
    expect(canDeliver('copilot-cli', 'prompt')).toBe(false);
    expect(canDeliver('claude-code', 'end')).toBe(false);
    expect(renderHookOutput('gemini-cli', 'start', MAIL)).toBe('');
  });
});

describe('hookKind and status', () => {
  it.each([
    ['SessionStart', 'start'], ['sessionStart', 'start'], ['UserPromptSubmit', 'prompt'], ['beforeSubmitPrompt', 'prompt'],
    ['PostToolUse', 'tool'], ['postToolUse', 'tool'], ['AfterTool', 'tool'], ['Stop', 'stop'], ['stop', 'stop'],
    ['AfterAgent', 'stop'], ['agentStop', 'stop'], ['SessionEnd', 'end'], ['session_end', 'end'],
  ])('%s is %s', (event, kind) => {
    expect(hookKind(event)).toBe(kind);
  });

  it('marks a session busy while it works and idle when it stops, so senders know when it will answer', () => {
    expect(statusFor('tool')).toBe('busy');
    expect(statusFor('stop')).toBe('idle');
  });
});

describe('detectCaller', () => {
  it('trusts Claude Code when it identifies itself', () => {
    expect(detectCaller('claude-code', { CLAUDECODE: '1' }, { session_id: 's' })).toBe('claude-code');
  });

  it('answers Cursor in Cursor format when Cursor runs the Claude Code hooks file', () => {
    expect(detectCaller('claude-code', { CURSOR_VERSION: '2.1' }, {})).toBe('cursor');
    expect(detectCaller('claude-code', {}, { cursor_version: '2.1', conversation_id: 'c1' })).toBe('cursor');
  });

  it('answers Copilot CLI when neither Claude Code nor Cursor markers are present', () => {
    expect(detectCaller('claude-code', {}, { session_id: 's', hook_event_name: 'PostToolUse' })).toBe('copilot-cli');
  });

  it('leaves hooks installed for other runtimes alone', () => {
    expect(detectCaller('codex', { CURSOR_VERSION: '2' }, {})).toBe('codex');
  });
});

describe('parsePayload', () => {
  it('reads each runtime\'s session id and working directory', () => {
    expect(parsePayload('claude-code', { session_id: 'a', cwd: '/w', session_title: 'Fix auth' })).toEqual({ sessionId: 'a', cwd: '/w', title: 'Fix auth' });
    expect(parsePayload('cursor', { conversation_id: 'c', workspace_roots: ['/r'] })).toEqual({ sessionId: 'c', cwd: '/r' });
    expect(parsePayload('copilot-cli', { sessionId: 'p', cwd: '/x' })).toEqual({ sessionId: 'p', cwd: '/x' });
    expect(parsePayload('codex', { session_id: 'x', cwd: '/c', last_assistant_message: 'secret plan' })).toEqual({ sessionId: 'x', cwd: '/c' });
  });

  it('never takes the doing line from prompt or model text, which can hold private content', () => {
    const info = parsePayload('claude-code', { session_id: 'a', prompt: 'my password is x', last_assistant_message: 'y' });
    expect(info.title).toBeUndefined();
  });
});
