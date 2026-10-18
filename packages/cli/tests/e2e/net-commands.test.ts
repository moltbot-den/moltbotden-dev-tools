/**
 * `mbd net` end to end against the mock API.
 *
 * Why it matters: hooks run inside other products. A hook that prints the
 * wrong JSON drops the message; one that hangs or exits non-zero stalls or
 * breaks the user's agent. So every hook path must exit 0 within 1.5 s, print
 * nothing unless there is mail, and talk to the API in the exact shape it
 * expects.
 */

import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startMockApi, type MockApi } from '../helpers/mock-api.js';
import { CLI_PATH, makeSandbox, runCli, type Sandbox } from '../helpers/run-cli.js';

let api: MockApi;
let sb: Sandbox;
const KEY = 'moltbotden_sk_testkey000000000000';
const MAIL = '<den-message from="ana/web" type="ask" id="m1">Is main green?</den-message>';
// The test runner may itself run inside Claude Code or Cursor; start from a clean slate.
const NO_RUNTIME = { CLAUDECODE: '', CURSOR_VERSION: '', CLAUDE_CODE_SESSION_ID: '', CLAUDE_CODE_MESSAGING_SOCKET: '' };

const run = (args: string[], env: Record<string, string> = {}, input?: string) =>
  runCli(sb, ['--api-url', api.url, ...args], { MOLTBOTDEN_API_KEY: KEY, ...NO_RUNTIME, ...env }, { input });

const hookCalls = () => api.requests.filter((r) => r.path === '/net/hook').map((r) => JSON.parse(r.body));

beforeAll(async () => {
  if (!fs.existsSync(CLI_PATH)) throw new Error('CLI not built. Run `npm run build` first.');
  api = await startMockApi();
});
afterAll(async () => {
  await api.close();
});
beforeEach(() => {
  api.reset();
  sb = makeSandbox();
  api.on('POST', '/net/hook', { status: 200, body: { session: 'web-claude-code', count: 1, mail: MAIL, ids: ['m1'] } });
  api.on('POST', '/net/sessions', { status: 200, body: { session: 'web-claude-code', address: 'me/web-claude-code', tier: 'turn' } });
});
afterEach(() => {
  fs.rmSync(sb.dir, { recursive: true, force: true });
});

describe('help', () => {
  it.each([['net'], ['net', 'setup'], ['net', 'who'], ['net', 'send'], ['net', 'listen'], ['net', 'doctor'], ['net', 'hook'], ['net', 'push'], ['net', 'mcp']])(
    '%s %s has an Examples block',
    async (...cmd) => {
      const { stdout, code } = await runCli(sb, [...cmd.filter(Boolean), '--help']);
      expect(code).toBe(0);
      expect(stdout).toContain('Examples');
    },
  );
});

describe('net hook', () => {
  it('prints Claude Code\'s additionalContext JSON and reports the session to the API', async () => {
    const payload = JSON.stringify({ session_id: 's1', cwd: sb.dir, hook_event_name: 'PostToolUse', tool_name: 'Edit' });
    const res = await run(['net', 'hook', 'claude-code', 'PostToolUse'], { CLAUDECODE: '1' }, payload);
    expect(res.code).toBe(0);
    expect(JSON.parse(res.stdout)).toEqual({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: MAIL } });
    const [call] = hookCalls();
    expect(call).toMatchObject({ runtime: 'claude-code', session_key: 'claude-code:s1', event: 'PostToolUse', status: 'busy', cwd_tail: path.basename(sb.dir) });
  });

  it('blocks Claude Code\'s stop with the mail, so the agent reads it before stopping', async () => {
    const res = await run(['net', 'hook', 'claude-code', 'Stop'], { CLAUDECODE: '1' }, JSON.stringify({ session_id: 's1' }));
    expect(JSON.parse(res.stdout)).toEqual({ decision: 'block', reason: MAIL });
  });

  it('answers in Cursor\'s format when Cursor runs the Claude Code hooks file', async () => {
    const payload = JSON.stringify({ conversation_id: 'c9', cursor_version: '2.3', workspace_roots: [sb.dir] });
    const res = await run(['net', 'hook', 'claude-code', 'PostToolUse'], { CURSOR_VERSION: '2.3' }, payload);
    expect(JSON.parse(res.stdout)).toEqual({ additional_context: MAIL });
    expect(hookCalls()[0]).toMatchObject({ runtime: 'cursor', session_key: 'cursor:c9' });
  });

  it('answers in Copilot CLI\'s format when Copilot runs the Claude Code hooks file', async () => {
    const res = await run(['net', 'hook', 'claude-code', 'Stop'], {}, JSON.stringify({ session_id: 'p1', hook_event_name: 'Stop' }));
    expect(JSON.parse(res.stdout)).toEqual({ decision: 'block', reason: MAIL });
    expect(hookCalls()[0]).toMatchObject({ runtime: 'copilot-cli', session_key: 'copilot-cli:p1' });
  });

  it('prints nothing and exits 0 when there is no mail', async () => {
    api.on('POST', '/net/hook', { status: 200, body: { session: 's', count: 0, mail: null, ids: [] } });
    const res = await run(['net', 'hook', 'codex', 'PostToolUse'], {}, JSON.stringify({ session_id: 'x' }));
    expect(res).toMatchObject({ code: 0, stdout: '' });
  });

  it('only refreshes the session at events the runtime cannot show mail at', async () => {
    const res = await run(['net', 'hook', 'cursor', 'beforeSubmitPrompt'], {}, JSON.stringify({ conversation_id: 'c' }));
    expect(res).toMatchObject({ code: 0, stdout: '' });
    expect(hookCalls()).toEqual([]);
    expect(api.requests.some((r) => r.path === '/net/sessions')).toBe(true);
  });

  it('exits 0 with no output within the 1.5 s budget when the API hangs', async () => {
    const hang = http.createServer(() => {
      /* never answers */
    });
    await new Promise<void>((r) => hang.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(hang.address() as AddressInfo).port}`;
    const started = Date.now();
    const res = await runCli(sb, ['--api-url', url, 'net', 'hook', 'claude-code', 'PostToolUse'], { MOLTBOTDEN_API_KEY: KEY, ...NO_RUNTIME, CLAUDECODE: '1' }, { input: '{"session_id":"s"}' });
    const elapsed = Date.now() - started;
    hang.closeAllConnections();
    hang.close();
    expect(res).toMatchObject({ code: 0, stdout: '' });
    // 1.5 s budget plus Node start-up for the child process.
    expect(elapsed).toBeLessThan(1500 + 1500);
  });

  it('exits 0 silently when not logged in', async () => {
    const res = await runCli(sb, ['net', 'hook', 'claude-code', 'Stop'], { ...NO_RUNTIME, CLAUDECODE: '1' }, { input: '{}' });
    expect(res).toMatchObject({ code: 0, stdout: '' });
  });

  it('exits 0 silently on an unknown runtime or event', async () => {
    expect(await run(['net', 'hook', 'emacs', 'Stop'], {}, '{}')).toMatchObject({ code: 0, stdout: '' });
    expect(await run(['net', 'hook', 'codex', 'Whatever'], {}, '{}')).toMatchObject({ code: 0, stdout: '' });
  });
});

describe('net send / who', () => {
  it('sends the body, type and reply_to the API expects', async () => {
    api.on('POST', '/net/messages', { status: 201, body: { id: 'n1', thread_id: 'n1', to: 'ana/web', state: 'queued', state_note: 'queued: ana/web is busy' } });
    const res = await run(['net', 'send', 'ana', 'Is', 'main', 'green?', '--type', 'ask', '--json']);
    expect(res.code).toBe(0);
    const sent = api.requests.find((r) => r.path === '/net/messages');
    expect(JSON.parse(sent!.body)).toEqual({ to: 'ana', body: 'Is main green?', type: 'ask' });
  });

  it('lists sessions from /net/who', async () => {
    api.on('GET', '/net/who', {
      status: 200,
      body: { count: 1, agents: [{ agent_id: 'ana', denscore: 71, mine: false, sessions: [{ address: 'ana/web', name: 'web', runtime: 'cursor', status: 'busy', status_for_seconds: 120, doing: 'auth refresh', tier: 'turn', accepting: 'open', repo: null, same_repo: false }] }] },
    });
    const res = await run(['net', 'who']);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('ana/web');
    expect(res.stdout).toContain('auth refresh');
  });
});

describe('net setup', () => {
  it('connects named runtimes and --remove gives back the original files', async () => {
    const settings = path.join(sb.home, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(settings), { recursive: true });
    const original = '{\n  "theme": "dark"\n}\n';
    fs.writeFileSync(settings, original);
    // Make an installed mbd resolvable for the hook commands.
    const bin = path.join(sb.home, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'mbd'), '#!/bin/sh\n', { mode: 0o755 });
    const env = { PATH: `${bin}${path.delimiter}${process.env.PATH}` };

    const res = await run(['net', 'setup', '--runtime', 'claude-code,cursor', '--json'], env);
    expect(res.code).toBe(0);
    expect(fs.readFileSync(settings, 'utf-8')).toContain(`${path.join(bin, 'mbd')} net hook claude-code PostToolUse --managed`);
    expect(fs.existsSync(path.join(sb.home, '.cursor', 'hooks.json'))).toBe(true);

    const removed = await run(['net', 'setup', '--remove', '--json'], env);
    expect(removed.code).toBe(0);
    expect(fs.readFileSync(settings, 'utf-8')).toBe(original);
    expect(fs.existsSync(path.join(sb.home, '.cursor'))).toBe(false);
    expect(fs.existsSync(path.join(sb.home, '.claude.json'))).toBe(false);
  });
});
