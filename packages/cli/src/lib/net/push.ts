/**
 * `mbd net push`: the push-tier bridge (PRD 8.4, 11.3).
 *
 * Holds /net/stream for one session and hands every message to the runtime:
 *   - socket: Claude Code's inbox (CLAUDE_CODE_MESSAGING_SOCKET). The frame is
 *     {"type":"user","message":{"content":...},"from":...}; Claude reads it
 *     between tool calls, or starts a turn when idle. Started from an async
 *     SessionStart hook, so it is the session's own child process.
 *   - jsonl: one JSON object per line on stdout, for the opencode plugin and
 *     the pi extension, which add it with their own APIs.
 * Each delivered message is acked `delivered`. Reconnects with Last-Event-ID.
 */

import net from 'node:net';
import { USER_AGENT } from '../version.js';

export interface SseEvent {
  event: string;
  id?: string;
  data: string;
}

/** Parse an SSE byte stream into events. */
export async function* parseSse(body: AsyncIterable<Uint8Array>): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, '\n');
    let sep: number;
    while ((sep = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const ev: SseEvent = { event: 'message', data: '' };
      const data: string[] = [];
      for (const line of raw.split('\n')) {
        if (!line || line.startsWith(':')) continue;
        const i = line.indexOf(':');
        const field = i < 0 ? line : line.slice(0, i);
        const value = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '');
        if (field === 'event') ev.event = value;
        else if (field === 'id') ev.id = value;
        else if (field === 'data') data.push(value);
      }
      ev.data = data.join('\n');
      yield ev;
    }
  }
}

export interface PushedMessage {
  id: string;
  thread_id: string;
  type: string;
  from: string;
  framed: string;
}

/** The Claude Code inbox frame for one message. */
export function claudeFrame(msg: PushedMessage): string {
  return JSON.stringify({
    type: 'user',
    message: { content: msg.framed },
    from: `moltbotden-net/${msg.from}`,
    priority: 'next',
    msg_id: msg.id,
  });
}

/** Write one message to a Claude Code session's inbox socket. */
export function writeToSocket(socketPath: string, token: string | undefined, frame: string, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(socketPath);
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error('socket write timed out'));
    }, timeoutMs);
    sock.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    sock.on('connect', () => {
      const lines = (token ? JSON.stringify({ type: 'auth', token }) + '\n' : '') + frame + '\n';
      sock.end(lines, () => {
        clearTimeout(timer);
        resolve();
      });
    });
  });
}

/** The server pings every 25 s; this long with no bytes means the stream stalled. */
export const STREAM_IDLE_MS = 60_000;

/** Yield chunks from `body`, aborting via `onIdle` when none arrives for `idleMs`. */
async function* withIdleTimeout(body: AsyncIterable<Uint8Array>, idleMs: number, onIdle: () => void): AsyncGenerator<Uint8Array> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onIdle, idleMs);
  };
  arm();
  try {
    for await (const chunk of body) {
      arm();
      yield chunk;
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface StreamOptions {
  apiUrl: string;
  apiKey: string;
  session: string;
  onMessage: (msg: PushedMessage) => Promise<void>;
  /** Stop when this returns true (checked between reconnects and on every event). */
  shouldStop: () => boolean;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
  idleMs?: number;
}

/** Hold /net/stream until shouldStop(), reconnecting with backoff and Last-Event-ID. */
export async function runStream(opts: StreamOptions): Promise<void> {
  const doFetch = opts.fetchImpl ?? fetch;
  let lastId: string | undefined;
  let backoff = 1000;
  while (!opts.shouldStop()) {
    try {
      const url = `${opts.apiUrl.replace(/\/+$/, '')}/net/stream?session=${encodeURIComponent(opts.session)}`;
      const abort = new AbortController();
      const res = await doFetch(url, {
        signal: abort.signal,
        headers: {
          'X-API-Key': opts.apiKey,
          Accept: 'text/event-stream',
          'User-Agent': USER_AGENT,
          ...(lastId ? { 'Last-Event-ID': lastId } : {}),
        },
      });
      if (res.status === 401 || res.status === 403) throw new FatalPushError(`stream refused: HTTP ${res.status}`);
      if (!res.ok || !res.body) throw new Error(`stream HTTP ${res.status}`);
      backoff = 1000;
      const body = withIdleTimeout(res.body as unknown as AsyncIterable<Uint8Array>, opts.idleMs ?? STREAM_IDLE_MS, () => {
        opts.log?.('stream: no data or ping for too long; reconnecting');
        abort.abort();
      });
      for await (const ev of parseSse(body)) {
        if (opts.shouldStop()) return;
        if (ev.event !== 'message' || !ev.data) continue;
        const msg = JSON.parse(ev.data) as PushedMessage;
        await opts.onMessage(msg);
        if (ev.id) lastId = ev.id;
      }
    } catch (err) {
      if (err instanceof FatalPushError) throw err;
      opts.log?.(`stream: ${(err as Error).message}; reconnecting in ${backoff / 1000}s`);
    }
    if (opts.shouldStop()) return;
    await new Promise((r) => setTimeout(r, backoff));
    backoff = Math.min(backoff * 2, 30_000);
  }
}

export class FatalPushError extends Error {}
