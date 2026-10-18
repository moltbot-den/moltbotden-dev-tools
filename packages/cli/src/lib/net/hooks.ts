/**
 * Runtime hook adapters for Moltbot Den Network (PRD 11.3).
 *
 * `mbd net hook <runtime> <event>` reads the runtime's hook payload on stdin,
 * refreshes the session, and prints the runtime's own JSON for injecting
 * framed mail. Formats, checked against each runtime's docs on 2026-10-18:
 *
 *   Claude Code  PostToolUse/UserPromptSubmit/SessionStart: hookSpecificOutput.additionalContext;
 *                Stop: {"decision":"block","reason"}
 *   Codex        same shapes as Claude Code (hooks.json)
 *   Cursor       postToolUse/sessionStart: {"additional_context"}; stop: {"followup_message"}
 *   Gemini CLI   AfterTool: hookSpecificOutput.additionalContext; AfterAgent: {"decision":"deny","reason"}
 *   Copilot CLI  postToolUse/sessionStart: {"additionalContext"}; agentStop: {"decision":"block","reason"}
 *
 * Cursor and Copilot CLI also run the hooks in ~/.claude/settings.json, so a
 * hook installed for Claude Code checks who really called it.
 */

export const HOOK_RUNTIMES = ['claude-code', 'codex', 'cursor', 'gemini-cli', 'copilot-cli'] as const;
export type HookRuntime = (typeof HOOK_RUNTIMES)[number];

export type HookKind = 'start' | 'prompt' | 'tool' | 'stop' | 'end';

const KIND_BY_EVENT: Record<string, HookKind> = {
  sessionstart: 'start',
  userpromptsubmit: 'prompt',
  beforesubmitprompt: 'prompt',
  userpromptsubmitted: 'prompt',
  posttooluse: 'tool',
  aftertool: 'tool',
  stop: 'stop',
  afteragent: 'stop',
  agentstop: 'stop',
  sessionend: 'end',
};

export function hookKind(event: string): HookKind | undefined {
  return KIND_BY_EVENT[event.replace(/[^a-z]/gi, '').toLowerCase()];
}

/** Session status a hook event implies. */
export function statusFor(kind: HookKind): 'busy' | 'idle' | 'live' | undefined {
  if (kind === 'prompt' || kind === 'tool') return 'busy';
  if (kind === 'stop') return 'idle';
  if (kind === 'start') return 'live';
  return undefined;
}

type Payload = Record<string, unknown>;

/**
 * Who really ran this hook. A hook written into Claude Code's settings.json
 * also runs under Cursor (third-party hooks import) and Copilot CLI.
 */
export function detectCaller(declared: HookRuntime, env: NodeJS.ProcessEnv, payload: Payload): HookRuntime {
  if (declared !== 'claude-code') return declared;
  if (env.CLAUDECODE === '1') return 'claude-code';
  if (env.CURSOR_VERSION || typeof payload.cursor_version === 'string' || typeof payload.conversation_id === 'string') return 'cursor';
  // Neither Claude Code (which always sets CLAUDECODE=1) nor Cursor: Copilot CLI.
  return 'copilot-cli';
}

export interface HookInfo {
  sessionId?: string;
  cwd?: string;
  /** Session title the runtime itself shows; never prompt or model text. */
  title?: string;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

export function parsePayload(runtime: HookRuntime, p: Payload): HookInfo {
  const roots = Array.isArray(p.workspace_roots) ? p.workspace_roots : [];
  switch (runtime) {
    case 'cursor':
      return { sessionId: str(p.conversation_id) ?? str(p.session_id), cwd: str(p.cwd) ?? str(roots[0]) };
    case 'copilot-cli':
      return { sessionId: str(p.sessionId) ?? str(p.session_id), cwd: str(p.cwd) };
    case 'claude-code':
      return { sessionId: str(p.session_id), cwd: str(p.cwd), title: str(p.session_title) };
    default:
      return { sessionId: str(p.session_id), cwd: str(p.cwd) };
  }
}

/**
 * Whether this runtime can show mail at this event. Mail is only fetched
 * (and so marked read) when it can be shown; other events just refresh the
 * session.
 */
export function canDeliver(runtime: HookRuntime, kind: HookKind): boolean {
  if (kind === 'tool' || kind === 'stop') return true;
  if (kind === 'start') return runtime !== 'gemini-cli';
  if (kind === 'prompt') return runtime === 'claude-code' || runtime === 'codex';
  return false;
}

function specific(eventName: string, mail: string): Record<string, unknown> {
  return { hookSpecificOutput: { hookEventName: eventName, additionalContext: mail } };
}

/** The runtime's stdout JSON that puts `mail` in front of the model; '' when there is none. */
export function renderHookOutput(runtime: HookRuntime, kind: HookKind, mail: string | null | undefined): string {
  if (!mail || !canDeliver(runtime, kind)) return '';
  let out: Record<string, unknown>;
  if (kind === 'stop') {
    if (runtime === 'cursor') out = { followup_message: mail };
    else if (runtime === 'gemini-cli') out = { decision: 'deny', reason: mail };
    else out = { decision: 'block', reason: mail };
  } else if (runtime === 'cursor') {
    out = { additional_context: mail };
  } else if (runtime === 'copilot-cli') {
    // Copilot's native key, plus the Claude-compatible shape for its PascalCase mode.
    const event = kind === 'tool' ? 'PostToolUse' : 'SessionStart';
    out = { additionalContext: mail, ...specific(event, mail) };
  } else if (runtime === 'gemini-cli') {
    out = specific('AfterTool', mail);
  } else {
    const event = kind === 'tool' ? 'PostToolUse' : kind === 'prompt' ? 'UserPromptSubmit' : 'SessionStart';
    out = specific(event, mail);
  }
  return JSON.stringify(out);
}
