/**
 * `mbd net serve`: answers asks and tasks through a runtime, continues threads.
 * A fake spawner stands in for the real CLIs.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { NetServe, buildArgs, parseOutput, runServe, truncateBytes, type ServeApi, type SpawnFn } from '../../src/lib/net/serve.js';
import type { PushedMessage } from '../../src/lib/net/push.js';
import { makeTempDir } from '../helpers/temp-dir.js';
import path from 'node:path';

function msg(over: Partial<PushedMessage>): PushedMessage {
  return { id: 'm1', thread_id: 't1', type: 'ask', from: 'bob/s1', framed: '<den-message>how?</den-message>', to_address: 'alice/serve-claude', reply_to: null, ...over };
}

let calls: { fn: string; args: unknown[] }[];
let api: ServeApi;
let spawned: string[][];
let stateFile: string;

const claudeSpawn = (result = 'done', session = 'sess-1'): SpawnFn => async (_c, args) => {
  spawned.push(args);
  return { stdout: JSON.stringify({ result, session_id: session }), stderr: '', code: 0, timedOut: false };
};

beforeEach(() => {
  calls = [];
  spawned = [];
  stateFile = path.join(makeTempDir('net-serve'), 'state.json');
  const rec = (fn: string, ret: unknown = {}) => async (...args: unknown[]) => (calls.push({ fn, args }), ret);
  api = {
    registerSession: rec('register', { session: 'serve-claude', address: 'alice/serve-claude', tier: 'push' }),
    updateSession: rec('update'),
    endSession: rec('end'),
    send: rec('send'),
    ack: rec('ack'),
  } as unknown as ServeApi;
});

const server = (over: Partial<ConstructorParameters<typeof NetServe>[0]> = {}) =>
  new NetServe({ runtime: 'claude', api, executable: '/bin/claude', stateFile, spawn: claudeSpawn(), ...over });

describe('net serve', () => {
  it('runs an ask once, posts the answer with reply_to, acks it read and goes idle', async () => {
    const s = server();
    await s.register();
    await s.handle(msg({}));
    expect(spawned).toHaveLength(1);
    expect(spawned[0].slice(0, 1)).toEqual(['-p']);
    expect(spawned[0][1]).toContain('<den-message>how?</den-message>');
    expect(spawned[0][1]).toContain('not your operator');
    const send = calls.find((c) => c.fn === 'send')!.args[0];
    expect(send).toMatchObject({ to: 'bob/s1', type: 'answer', body: 'done', reply_to: 'm1', session: 'serve-claude' });
    expect(calls.find((c) => c.fn === 'ack')!.args).toEqual([['m1'], 'read']);
    expect(calls.filter((c) => c.fn === 'update').map((c) => (c.args[1] as { status: string }).status)).toEqual(['busy', 'idle']);
    expect(calls[0].args[0]).toMatchObject({ runtime: 'claude-code', name: 'serve-claude', tier: 'push', status: 'idle', accepting: 'open' });
  });

  it('continues the same runtime conversation for a follow-up, also after a restart', async () => {
    await server().handle(msg({}));
    await server().handle(msg({ id: 'm2', type: 'tell', reply_to: 'a1' })); // fresh instance reads the state file
    expect(spawned[1]).toEqual(expect.arrayContaining(['--resume', 'sess-1']));
    expect(spawned[0]).not.toContain('--resume');
  });

  it('ignores a follow-up in a thread it never answered, and a tell opener', async () => {
    const s = server();
    await s.handle(msg({ id: 'm2', thread_id: 'other', reply_to: 'x' }));
    await s.handle(msg({ id: 'm3', type: 'tell' }));
    expect(spawned).toHaveLength(0);
    expect(calls.filter((c) => c.fn === 'send')).toHaveLength(0);
  });

  it('filters by --cap but always takes direct messages', async () => {
    const s = server({ caps: ['review'] });
    await s.handle(msg({ id: 'a', to_address: 'cap:design' }));
    await s.handle(msg({ id: 'b', to_address: 'cap:review' }));
    await s.handle(msg({ id: 'c', to_address: 'alice/serve-claude' }));
    expect(calls.filter((c) => c.fn === 'ack').map((c) => (c.args[0] as string[])[0])).toEqual(['b', 'c']);
  });

  it('replies with a timeout answer when the run times out', async () => {
    const spawn: SpawnFn = async () => ({ stdout: '', stderr: '', code: null, timedOut: true });
    await server({ spawn, timeoutMs: 2000 }).handle(msg({}));
    const send = calls.find((c) => c.fn === 'send')!.args[0] as { body: string; reply_to: string };
    expect(send.body).toContain('timed out after 2s');
    expect(send.reply_to).toBe('m1');
  });

  it('ends the session on shutdown', async () => {
    const ac = new AbortController();
    const stream = async (o: { signal?: AbortSignal }) => {
      ac.abort();
      expect(o.signal?.aborted).toBe(true);
    };
    await runServe({ runtime: 'claude', api, executable: '/bin/claude', stateFile, apiUrl: 'http://x', apiKey: 'k', signal: ac.signal, stream });
    expect(calls.at(-1)).toMatchObject({ fn: 'end', args: ['serve-claude'] });
  });

  it('builds runtime argv and parses codex events and claude json', () => {
    expect(buildArgs('codex', 'p', 'th')).toEqual(['exec', 'resume', '--json', 'th', 'p']);
    const events = [{ type: 'thread.started', thread_id: 'th1' }, { type: 'item.completed', item: { type: 'agent_message', text: 'hi' } }].map((e) => JSON.stringify(e)).join('\n');
    expect(parseOutput('codex', events)).toEqual({ text: 'hi', conv: 'th1' });
    expect(truncateBytes('é'.repeat(40000)).length).toBeLessThan(40000);
  });
});
