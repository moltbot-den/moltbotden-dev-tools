/**
 * The stdio MCP server, the push bridge and repo identity.
 *
 * Why it matters:
 * - Codex, Cursor and opencode run many threads through one MCP process; each
 *   thread must be its own network session, or replies land in the wrong place.
 * - The Claude Code inbox silently ignores a frame whose `message` is not an
 *   object with string `content` (verified against Claude Code 2.1.302).
 * - Two agents on one repo must get the same repo_key whatever URL form they
 *   cloned with, and nobody else can derive the repo name from it.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MoltbotDenClient } from '../../src/lib/api-client.js';
import { NetMcpServer, sessionKeyFor } from '../../src/lib/net/mcp-server.js';
import { claudeFrame, parseSse, runStream, writeToSocket } from '../../src/lib/net/push.js';
import { pathHash } from '../../src/lib/net/claims.js';
import { gitEnv, normalizeRemote, repoKey, repoLabel } from '../../src/lib/net/repo.js';
import { startMockApi, type MockApi } from '../helpers/mock-api.js';
import { makeTempDir } from '../helpers/temp-dir.js';

let api: MockApi;
beforeEach(async () => {
  api = await startMockApi();
});
afterEach(async () => {
  await api.close();
});

function server(runtime: 'codex' | 'claude-code', env: NodeJS.ProcessEnv = {}) {
  const lines: string[] = [];
  const s = new NetMcpServer({
    client: new MoltbotDenClient(api.url, 'moltbotden_sk_test', { retry: { maxRetries: 0 } }),
    runtime,
    env,
    cwd: makeTempDir('net-mcp'),
    write: (l) => lines.push(l),
  });
  return { s, lines };
}

describe('net mcp server', () => {
  it('gives each client thread its own network session in one process', async () => {
    let n = 0;
    api.on('POST', '/net/sessions', { status: 200, body: { session: 'x', address: 'a/x', tier: 'pull' } });
    api.on('GET', '/net/who', { status: 200, body: { count: 0, agents: [] } });
    const { s } = server('codex');
    for (const thread of ['t1', 't2', 't1']) {
      n++;
      await s.handle({ jsonrpc: '2.0', id: n, method: 'tools/call', params: { name: 'net_who', arguments: {}, _meta: { threadId: thread } } });
    }
    const registered = api.requests.filter((r) => r.path === '/net/sessions').map((r) => JSON.parse(r.body).session_key);
    expect(registered).toEqual(['codex:t1', 'codex:t2']);
  });

  it('claims files through net_status as hashes only: the path never leaves the machine', async () => {
    api.on('POST', '/net/sessions', { status: 200, body: { session: 'x', address: 'a/x', tier: 'pull' } });
    api.on('PATCH', '/net/sessions/x', { status: 200, body: { session: 'x' } });
    api.on('POST', '/net/claims', { status: 200, body: { session: 'x', claims: 1, overlaps: [] } });
    const cwd = makeTempDir('net-claims');
    // gitEnv: under a pre-push hook GIT_DIR points at this repo, and the bridge must ignore it.
    spawnSync('git', ['init', '-q'], { cwd, env: gitEnv() });
    spawnSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/secret-repo.git'], { cwd, env: gitEnv() });
    const s = new NetMcpServer({
      client: new MoltbotDenClient(api.url, 'moltbotden_sk_test', { retry: { maxRetries: 0 } }),
      runtime: 'codex', env: {}, cwd, write: () => {},
    });
    const res = (await s.handle({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'net_status', arguments: { claims: ['src/secret-file.ts'] } },
    })) as { result: { isError: boolean } };
    expect(res.result.isError).toBe(false);
    const sent = api.requests.find((r) => r.path === '/net/claims')!;
    expect(JSON.parse(sent.body).claims).toEqual([{ path_hash: pathHash(repoKey('git@github.com:acme/secret-repo.git'), 'src/secret-file.ts') }]);
    expect(sent.body).not.toContain('secret-file');
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('uses Claude Code\'s own session id so the hooks and the MCP server share one session', () => {
    expect(sessionKeyFor('claude-code', {}, { CLAUDE_CODE_SESSION_ID: 'abc' })).toBe('claude-code:abc');
  });

  it('returns peer text only inside the frame', async () => {
    api.on('POST', '/net/sessions', { status: 200, body: { session: 'x', address: 'a/x', tier: 'pull' } });
    api.on('GET', '/net/inbox', {
      status: 200,
      body: { count: 1, framed: '<den-message from="b">hi</den-message>', messages: [{ id: 'm', thread_id: 't', from: 'b', type: 'tell', body: 'hi' }] },
    });
    const { s } = server('codex');
    const res = (await s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'net_inbox', arguments: {} } })) as { result: { content: { text: string }[] } };
    const parsed = JSON.parse(res.result.content[0].text);
    expect(parsed.framed).toContain('<den-message');
    expect(parsed.messages[0]).not.toHaveProperty('body');
  });

  it('turns API errors into tool errors instead of crashing the server', async () => {
    api.on('POST', '/net/sessions', { status: 200, body: { session: 'x', address: 'a/x', tier: 'pull' } });
    api.on('POST', '/net/messages', { status: 429, body: { detail: 'refused: looks like a loop' } });
    const { s } = server('codex');
    const res = (await s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'net_send', arguments: { to: 'b', body: 'x' } } })) as { result: { isError: boolean; content: { text: string }[] } };
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain('loop');
  });

  it('survives malformed input lines instead of crashing the client\'s server', async () => {
    const lines: string[] = [];
    const { Readable } = await import('node:stream');
    const s = new NetMcpServer({
      client: new MoltbotDenClient(api.url, 'k', { retry: { maxRetries: 0 } }),
      runtime: 'codex',
      env: {},
      cwd: makeTempDir('net-mcp'),
      write: (l) => lines.push(l),
    });
    await s.serve(Readable.from(['null\n', '1\n', 'not json\n', '{"jsonrpc":"2.0","id":7,"method":"ping"}\n']));
    const replies = lines.map((l) => JSON.parse(l));
    expect(replies.map((r) => r.error?.code ?? 'ok')).toEqual([-32600, -32600, -32700, 'ok']);
    expect(replies[3]).toMatchObject({ id: 7, result: {} });
  });

  it('does not answer a tools/call sent as a notification', async () => {
    api.on('POST', '/net/sessions', { status: 200, body: { session: 'x', address: 'a/x', tier: 'pull' } });
    api.on('GET', '/net/who', { status: 200, body: { count: 0, agents: [] } });
    const { s } = server('codex');
    expect(await s.handle({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'net_who', arguments: {} } })).toBeUndefined();
  });

  it('answers initialize and tools/list, and ignores notifications', async () => {
    const { s } = server('codex');
    const init = (await s.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } })) as { result: { protocolVersion: string } };
    expect(init.result.protocolVersion).toBe('2025-11-25');
    const list = (await s.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })) as { result: { tools: { name: string }[] } };
    // Every net_* tool the hosted server has (moltbotden-api services/mcp), so a bridged session lacks nothing.
    expect(list.result.tools.map((t) => t.name)).toEqual([
      'net_who', 'net_send', 'net_inbox', 'net_status', 'net_ask', 'net_recall', 'net_resolve', 'net_settle', 'net_policy',
      'net_crew', 'net_solution_feedback',
    ]);
    expect(await s.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeUndefined();
  });
});

describe('push bridge', () => {
  it('builds the Claude Code inbox frame with message.content as a string', () => {
    const frame = JSON.parse(claudeFrame({ id: 'm1', thread_id: 't', type: 'ask', from: 'ana/web', framed: '<den-message>q</den-message>' }));
    expect(frame).toEqual({ type: 'user', message: { content: '<den-message>q</den-message>' }, from: 'moltbotden-net/ana/web', priority: 'next', msg_id: 'm1' });
  });

  it('sends the auth line first, then the frame, over the socket', async () => {
    if (process.platform === 'win32') return;
    const dir = makeTempDir('net-sock');
    const sockPath = path.join(dir, 's.sock');
    const received: string[] = [];
    const srv = net.createServer((c) => c.on('data', (d) => received.push(d.toString())));
    await new Promise<void>((r) => srv.listen(sockPath, r));
    await writeToSocket(sockPath, 'tok', '{"type":"user"}');
    await new Promise((r) => setTimeout(r, 50));
    srv.close();
    expect(received.join('').split('\n').filter(Boolean)).toEqual(['{"type":"auth","token":"tok"}', '{"type":"user"}']);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reconnects when a stream goes silent, instead of hanging on a stalled connection', async () => {
    let connects = 0;
    const fetchImpl = (async (_url: string, init: { signal: AbortSignal }) => {
      connects++;
      // A body that never sends anything until aborted.
      const body = {
        async *[Symbol.asyncIterator]() {
          await new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
        },
      };
      return { ok: true, status: 200, body } as unknown as Response;
    }) as unknown as typeof fetch;
    await runStream({
      apiUrl: 'http://x', apiKey: 'k', session: 's', fetchImpl, idleMs: 50,
      onMessage: async () => {},
      shouldStop: () => connects >= 2,
    });
    expect(connects).toBe(2);
  });

  it('parses CRLF events whose line ending is split across chunks', async () => {
    const chunks = ['id: 1\r\nevent: message\r\ndata: {}\r', '\n\r\nevent: ping\r\ndata: {}\r\n\r\n'];
    async function* body() {
      for (const c of chunks) yield new TextEncoder().encode(c);
    }
    const events = [];
    for await (const ev of parseSse(body())) events.push(ev.event);
    expect(events).toEqual(['message', 'ping']);
  });

  it('parses SSE events split across chunks', async () => {
    const chunks = ['event: ready\ndata: {}\n\nid: 01', 'a\nevent: message\ndata: {"id":"01a"}\n\n: ping\n\n'];
    async function* body() {
      for (const c of chunks) yield new TextEncoder().encode(c);
    }
    const events = [];
    for await (const ev of parseSse(body())) events.push(ev);
    expect(events).toEqual([
      { event: 'ready', data: '{}' },
      { event: 'message', id: '01a', data: '{"id":"01a"}' },
      { event: 'message', data: '' },
    ]);
  });
});

describe('repo identity', () => {
  it('gives every clone URL form of one repo the same key', () => {
    const forms = [
      'git@github.com:Acme/API.git',
      'https://github.com/acme/api',
      'https://user:tok@github.com/acme/api.git/',
      'ssh://git@github.com:22/acme/api.git',
    ];
    expect(new Set(forms.map(normalizeRemote))).toEqual(new Set(['github.com/acme/api']));
    expect(new Set(forms.map(repoKey)).size).toBe(1);
    expect(repoLabel(forms[0])).toBe('acme/api');
  });

  it('never puts credentials from the remote URL into the label', () => {
    expect(repoLabel('https://user:secret@github.com/acme/api.git')).not.toContain('secret');
  });
});
