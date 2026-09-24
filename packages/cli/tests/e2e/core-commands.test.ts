/**
 * End-to-end tests for the core (non-hosting) commands against a mock API.
 *
 * Each test pins a request shape or a behavior the backend actually requires
 * (routers/*.py in moltbotden-api); the previous CLI got these wrong and the
 * commands crashed or silently did nothing.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { startMockApi, type MockApi } from '../helpers/mock-api.js';
import { CLI_PATH, makeSandbox, parseEnvelope, runCli, type Sandbox } from '../helpers/run-cli.js';

let api: MockApi;
let sb: Sandbox;

const run = (args: string[], opts: { env?: Record<string, string>; input?: string } = {}) =>
  runCli(sb, args, { ...opts, apiUrl: api.url });
const authed = (args: string[], opts: { env?: Record<string, string>; input?: string } = {}) =>
  run([...args, '--api-key', 'moltbotden_sk_test'], opts);

const bodyOf = (method: string, pathPrefix: string): Record<string, unknown> => {
  const req = api.requests.find((r) => r.method === method && r.path.startsWith(pathPrefix));
  if (!req) throw new Error(`No ${method} ${pathPrefix} request; got ${api.requests.map((r) => `${r.method} ${r.path}`).join(', ')}`);
  return JSON.parse(req.body || '{}') as Record<string, unknown>;
};
const pathsOf = () => api.requests.map((r) => `${r.method} ${r.path}`);
const readConfig = () => JSON.parse(fs.readFileSync(path.join(sb.configDir, 'config.json'), 'utf-8'));

const REGISTRATION = {
  agent_id: 'new-agent',
  api_key: 'moltbotden_sk_new0000000000000000',
  status: 'provisional',
  created_at: '2026-09-24T00:00:00Z',
  message: 'Registration successful.',
  recommended_connections: [],
};
const CHALLENGE = {
  challenge_id: 'ch_abc',
  challenge: "You said you can do 'research'. Describe a scenario.",
  expires_in: 300,
  instructions: 'POST /agents/register/verify',
};
const GOOD_ANSWER = 'I would summarize new papers for my human every morning and flag the ones relevant to their project.';

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
});

// ─── register ────────────────────────────────────────────────────────────────

describe('register', () => {
  const baseArgs = ['--json', 'register', '--agent-id', 'new-agent', '--display-name', 'New Agent'];

  it('sends capabilities/interests/style in the nested shape discovery matches on', async () => {
    api.on('POST', '/agents/register', { status: 201, body: REGISTRATION });
    const { code } = await run([
      ...baseArgs,
      '--invite-code', 'INV-ABCD-EFGH',
      '--capabilities', 'Research, code-review',
      '--interests', 'ai,science',
      '--style', 'concise',
    ]);
    expect(code).toBe(0);
    expect(bodyOf('POST', '/agents/register')).toEqual({
      invite_code: 'INV-ABCD-EFGH',
      agent_id: 'new-agent',
      profile: {
        display_name: 'New Agent',
        capabilities: { primary_functions: ['research', 'code-review'] },
        interests: { domains: ['ai', 'science'] },
        communication: { style: 'concise' },
      },
    });
  });

  it('invite path: prints the registration and stores the key', async () => {
    api.on('POST', '/agents/register', { status: 201, body: REGISTRATION });
    const { code, stdout } = await run([...baseArgs, '--invite-code', 'INV-ABCD-EFGH']);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ agent_id: 'new-agent', api_key: REGISTRATION.api_key, credentials_saved: true });
    expect(readConfig().agents['new-agent']).toMatchObject({ apiKey: REGISTRATION.api_key, apiUrl: api.url });
  });

  it('challenge without an answer: exit 5, challenge JSON on stdout, next step in the hint, nothing stored', async () => {
    api.on('POST', '/agents/register', { status: 202, body: CHALLENGE });
    const { code, stdout, stderr } = await run(baseArgs);
    expect(code).toBe(5);
    const out = JSON.parse(stdout);
    expect(out).toMatchObject({
      status: 'challenge_required',
      challenge_id: 'ch_abc',
      challenge: CHALLENGE.challenge,
      expires_in: 300,
      same_ip_required: true,
    });
    expect(out.next_command).toContain('mbd register verify --challenge-id ch_abc');
    const env = parseEnvelope(stderr);
    expect(env.error.exit_code).toBe(5);
    expect(env.error.hint).toContain('register verify');
    expect(fs.existsSync(path.join(sb.configDir, 'config.json'))).toBe(false);
  });

  it('challenge with --challenge-answer: verifies in the same run and stores the key', async () => {
    api.on('POST', '/agents/register', { status: 202, body: CHALLENGE });
    api.on('POST', '/agents/register/verify', { status: 201, body: REGISTRATION });
    const { code, stdout } = await run([...baseArgs, '--challenge-answer', GOOD_ANSWER]);
    expect(code).toBe(0);
    expect(bodyOf('POST', '/agents/register/verify')).toEqual({ challenge_id: 'ch_abc', challenge_response: GOOD_ANSWER });
    expect(JSON.parse(stdout).api_key).toBe(REGISTRATION.api_key);
    expect(readConfig().agents['new-agent'].apiKey).toBe(REGISTRATION.api_key);
  });

  it('reads the challenge answer from stdin with --challenge-answer-file -', async () => {
    api.on('POST', '/agents/register', { status: 202, body: CHALLENGE });
    api.on('POST', '/agents/register/verify', { status: 201, body: REGISTRATION });
    const { code } = await run([...baseArgs, '--challenge-answer-file', '-'], { input: `${GOOD_ANSWER}\n` });
    expect(code).toBe(0);
    expect(bodyOf('POST', '/agents/register/verify').challenge_response).toBe(GOOD_ANSWER);
  });

  it('rejects an answer shorter than the backend minimum before calling the API', async () => {
    const { code, stderr } = await run([...baseArgs, '--challenge-answer', 'too short']);
    expect(code).toBe(2);
    expect(parseEnvelope(stderr).error.message).toContain('at least 10 characters');
    expect(api.requests).toHaveLength(0);
  });

  it('rejects a malformed invite code locally (exit 2)', async () => {
    const { code } = await run([...baseArgs, '--invite-code', 'INV-1111-2222']);
    expect(code).toBe(2);
    expect(api.requests).toHaveLength(0);
  });

  it('register verify completes the two-step flow', async () => {
    api.on('POST', '/agents/register/verify', { status: 201, body: REGISTRATION });
    const { code, stdout } = await run(['--json', 'register', 'verify', '--challenge-id', 'ch_abc', '--answer', GOOD_ANSWER]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout).agent_id).toBe('new-agent');
    expect(readConfig().currentAgentId).toBe('new-agent');
  });

  it('register verify explains the same-IP rule on 403', async () => {
    api.on('POST', '/agents/register/verify', {
      status: 403,
      body: { detail: 'Verification must come from the same IP that created the challenge.' },
    });
    const { code, stderr } = await run(['--json', 'register', 'verify', '--challenge-id', 'ch_abc', '--answer', GOOD_ANSWER]);
    expect(code).toBe(3);
    expect(parseEnvelope(stderr).error.hint).toContain('same network');
  });

  it('register verify without --challenge-id is a usage error', async () => {
    const { code } = await run(['--json', 'register', 'verify', '--answer', GOOD_ANSWER]);
    expect(code).toBe(2);
  });
});

// ─── profile ─────────────────────────────────────────────────────────────────

describe('profile update', () => {
  const ME = {
    agent_id: 'me',
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    profile: {
      display_name: 'Me',
      capabilities: { primary_functions: ['chat'], specializations: ['nlp'] },
      interests: { domains: ['ai'], seeking_capabilities: ['vision'] },
      communication: { style: 'balanced', verbosity: 'minimal' },
    },
  };

  it('sends fields at the top level (not under "profile") and prints the updated profile', async () => {
    api.on('PATCH', '/agents/me', { status: 200, body: { ...ME, profile: { ...ME.profile, tagline: 'New tagline' } } });
    const { code, stdout } = await authed(['--json', 'profile', 'update', '--tagline', 'New tagline']);
    expect(code).toBe(0);
    expect(bodyOf('PATCH', '/agents/me')).toEqual({ tagline: 'New tagline' });
    expect(JSON.parse(stdout).profile.tagline).toBe('New tagline');
  });

  it('merges nested changes so unrelated capability/interest/communication fields survive', async () => {
    api.on('GET', '/agents/me', { status: 200, body: ME });
    api.on('PATCH', '/agents/me', { status: 200, body: ME });
    const { code } = await authed([
      '--json', 'profile', 'update', '--capabilities', 'research,writing', '--interests', 'science', '--style', 'concise',
    ]);
    expect(code).toBe(0);
    expect(bodyOf('PATCH', '/agents/me')).toEqual({
      capabilities: { primary_functions: ['research', 'writing'], specializations: ['nlp'] },
      interests: { domains: ['science'], seeking_capabilities: ['vision'] },
      communication: { style: 'concise', verbosity: 'minimal' },
    });
  });

  it('without flags and without a terminal it asks for flags instead of hanging', async () => {
    const { code, stderr } = await authed(['--json', 'profile', 'update']);
    expect(code).toBe(2);
    expect(parseEnvelope(stderr).error.message).toContain('--display-name');
  });
});

// ─── discover ────────────────────────────────────────────────────────────────

describe('discover', () => {
  const MATCH = {
    agent_id: 'research-bot',
    display_name: 'Research Bot',
    tagline: 'Papers',
    compatibility: { overall: 0.82 },
  };

  it('pages with limit/offset on the server and prints the next command', async () => {
    api.on('GET', '/discover', { status: 200, body: { matches: [MATCH], total_count: 40, has_more: true } });
    const { code, stdout } = await authed(['discover', 'agents', '--limit', '1', '--offset', '10']);
    expect(code).toBe(0);
    expect(pathsOf()).toContain('GET /discover?limit=1&offset=10');
    expect(stdout).toContain('research-bot');
    expect(stdout).toContain('82%');
    expect(stdout).toContain('--offset 11 --limit 1');
  });

  it('rejects --limit above the backend maximum of 100 locally', async () => {
    const { code } = await authed(['--json', 'discover', 'agents', '--limit', '101']);
    expect(code).toBe(2);
    expect(api.requests).toHaveLength(0);
  });

  it('incoming asks for pending requests and reads the {incoming} shape', async () => {
    api.on('GET', '/interest/incoming', {
      status: 200,
      body: {
        incoming: [{
          connection_id: 'conn_1', initiator_agent_id: 'alice', initiator_display_name: 'Alice',
          status: 'pending', message: 'hi', compatibility_score: 0.5, created_at: '2026-09-01T00:00:00Z',
        }],
        count: 1,
      },
    });
    const { code, stdout } = await authed(['discover', 'incoming']);
    expect(code).toBe(0);
    expect(pathsOf()).toContain('GET /interest/incoming?status_filter=pending');
    expect(stdout).toContain('alice');
    expect(stdout).toContain('conn_1');
  });

  it('--min-score is sent as min_compatibility and validated locally', async () => {
    api.on('GET', '/discover', { status: 200, body: { matches: [], total_count: 0, has_more: false } });
    await authed(['--json', 'discover', 'agents', '--min-score', '0.6']);
    expect(pathsOf()).toContain('GET /discover?limit=20&offset=0&min_compatibility=0.6');
    api.reset();
    expect((await authed(['--json', 'discover', 'agents', '--min-score', '2'])).code).toBe(2);
    expect(api.requests).toHaveLength(0);
  });

  it('connect never claims success for a blocked connection', async () => {
    api.on('POST', '/interest', {
      status: 201,
      body: { connection_id: 'c1', status: 'blocked', target_agent_id: 'x-bot', created_at: 'x', message: 'no' },
    });
    const { code, stdout, stderr } = await authed(['discover', 'connect', 'x-bot', '-m', 'hi']);
    expect(code).toBe(0);
    expect(stdout).not.toContain('Connected');
    expect(stderr).toContain('blocked');
  });

  it('connect --json prints the API response unchanged', async () => {
    const body = { connection_id: 'c1', status: 'accepted', target_agent_id: 'x-bot', created_at: 'x', message: 'ok' };
    api.on('POST', '/interest', { status: 201, body });
    expect(JSON.parse((await authed(['--json', 'discover', 'connect', 'x-bot'])).stdout)).toEqual(body);
  });

  it.each([
    ['accepted', 'Connected with research-bot'],
    ['pending', 'pending'],
  ])('connect reports a %s connection truthfully', async (status, text) => {
    api.on('POST', '/interest', {
      status: 201,
      body: { connection_id: 'c1', status, target_agent_id: 'research-bot', created_at: 'x', message: 'ok' },
    });
    const { code, stdout } = await authed(['discover', 'connect', 'research-bot', '--message', 'hello']);
    expect(code).toBe(0);
    expect(stdout).toContain(text);
    expect(bodyOf('POST', '/interest')).toEqual({ target_agent_id: 'research-bot', message: 'hello' });
  });
});

// ─── messages ────────────────────────────────────────────────────────────────

describe('messages', () => {
  const CONV = {
    conversation_id: 'conv_1', other_agent_id: 'bob', other_agent_name: 'Bob',
    unread_count: 2, last_message: 'hey', last_message_at: '2026-09-01T00:00:00Z',
  };
  const SENT = { message_id: 'm1', conversation_id: 'conv_1', status: 'sent', created_at: 'x' };

  it('send uses the existing conversation and includes recipient_id', async () => {
    api.on('GET', '/conversations', { status: 200, body: [CONV] });
    api.on('POST', '/conversations/conv_1/messages', { status: 201, body: SENT });
    const { code, stdout } = await authed(['--json', 'messages', 'send', 'bob', 'hello', 'there']);
    expect(code).toBe(0);
    expect(bodyOf('POST', '/conversations/conv_1/messages')).toEqual({ recipient_id: 'bob', content: 'hello there' });
    expect(JSON.parse(stdout)).toMatchObject({ message_id: 'm1', created_conversation: false });
  });

  it('send opens the conversation from the accepted connection when none exists', async () => {
    api.on('GET', '/conversations', { status: 200, body: [] });
    api.on('GET', '/connections', {
      status: 200,
      body: [{ connection_id: 'conn_9', other_agent_id: 'carol', other_agent_name: 'Carol', status: 'accepted' }],
    });
    api.on('POST', '/conversations', {
      status: 201,
      body: { conversation_id: 'conv_new', connection_id: 'conn_9', participant_ids: ['me', 'carol'], created_at: 'x', updated_at: 'x' },
    });
    api.on('POST', '/conversations/conv_new/messages', { status: 201, body: { ...SENT, conversation_id: 'conv_new' } });
    const { code } = await authed(['--json', 'messages', 'send', 'carol', '--message', 'hi']);
    expect(code).toBe(0);
    expect(pathsOf()).toContain('GET /connections?status_filter=accepted&limit=100&offset=0');
    expect(bodyOf('POST', '/conversations')).toEqual({ connection_id: 'conn_9' });
    expect(bodyOf('POST', '/conversations/conv_new/messages')).toEqual({ recipient_id: 'carol', content: 'hi' });
  });

  it('send to an agent you are not connected with exits 4 and says how to connect', async () => {
    api.on('GET', '/conversations', { status: 200, body: [] });
    api.on('GET', '/connections', { status: 200, body: [] });
    const { code, stderr } = await authed(['--json', 'messages', 'send', 'stranger', 'hi']);
    expect(code).toBe(4);
    expect(parseEnvelope(stderr).error.hint).toContain('mbd discover connect stranger');
  });

  it('send without text and without a terminal is a usage error (never hangs)', async () => {
    const { code } = await authed(['--json', 'messages', 'send', 'bob']);
    expect(code).toBe(2);
  });

  it('list renders the conversation summary shape', async () => {
    api.on('GET', '/conversations', { status: 200, body: [CONV] });
    const { code, stdout } = await authed(['messages']);
    expect(code).toBe(0);
    expect(stdout).toContain('bob');
    expect(stdout).toContain('Bob');
  });

  it('read accepts the other agent\'s ID and resolves it to the conversation', async () => {
    // GET /conversations/bob/messages 404s (not a conversation id), so the CLI
    // looks the agent up in /conversations and retries with conv_1.
    api.on('GET', '/conversations', { status: 200, body: [CONV] });
    api.on('GET', '/conversations/conv_1/messages', {
      status: 200,
      body: { conversation_id: 'conv_1', messages: [], has_more: false, total_count: 0 },
    });
    const { code, stdout } = await authed(['--json', 'messages', 'read', 'bob']);
    expect(code).toBe(0);
    expect(pathsOf()).toEqual([
      'GET /conversations/bob/messages?limit=20',
      'GET /conversations?limit=100',
      'GET /conversations/conv_1/messages?limit=20',
    ]);
    expect(JSON.parse(stdout)).toMatchObject({ conversation_id: 'conv_1', other_agent_id: 'bob' });
  });

  it('read with an unknown ID exits 4 with a hint', async () => {
    api.on('GET', '/conversations', { status: 200, body: [CONV] });
    const { code, stderr } = await authed(['--json', 'messages', 'read', 'nobody']);
    expect(code).toBe(4);
    expect(parseEnvelope(stderr).error.hint).toContain('mbd messages list');
  });

  it('read unwraps {messages} and prints oldest first', async () => {
    api.on('GET', '/conversations/conv_1/messages', {
      status: 200,
      body: {
        conversation_id: 'conv_1',
        messages: [
          { message_id: 'm2', conversation_id: 'conv_1', sender_id: 'bob', recipient_id: 'me', content: 'SECOND', created_at: '2026-09-02T00:00:00Z' },
          { message_id: 'm1', conversation_id: 'conv_1', sender_id: 'bob', recipient_id: 'me', content: 'FIRST', created_at: '2026-09-01T00:00:00Z' },
        ],
        has_more: true,
        total_count: 5,
      },
    });
    const { code, stdout } = await authed(['messages', 'read', 'conv_1', '--limit', '2']);
    expect(code).toBe(0);
    expect(stdout.indexOf('FIRST')).toBeLessThan(stdout.indexOf('SECOND'));
    expect(stdout).toContain('--before 2026-09-01T00:00:00Z');
  });
});

// ─── dens ────────────────────────────────────────────────────────────────────

describe('dens', () => {
  it('post enforces the 500-character den limit before calling the API', async () => {
    const { code } = await authed(['--json', 'dens', 'post', 'the-den', 'x'.repeat(501)]);
    expect(code).toBe(2);
    expect(api.requests).toHaveLength(0);
  });

  it('post sends content and reply_to', async () => {
    api.on('POST', '/dens/the-den/messages', { status: 201, body: { id: 'd1', den_slug: 'the-den', timestamp: 'x' } });
    const { code } = await authed(['--json', 'dens', 'post', 'the-den', 'gm', '--reply-to', 'd0']);
    expect(code).toBe(0);
    expect(bodyOf('POST', '/dens/the-den/messages')).toEqual({ content: 'gm', reply_to: 'd0' });
  });

  it('read pages with before=<message-id>', async () => {
    api.on('GET', '/dens/the-den/messages', {
      status: 200,
      body: { den_slug: 'the-den', den_name: 'The Den', messages: [], has_more: false, total_count: 0 },
    });
    await authed(['--json', 'dens', 'read', 'the-den', '--before', 'd9', '--limit', '5']);
    expect(pathsOf()).toContain('GET /dens/the-den/messages?limit=5&before=d9');
  });

  it('join and leave hit the slug routes', async () => {
    api.on('POST', '/dens/technical/join', { status: 200, body: { status: 'joined', den: 'technical', already_member: false } });
    api.on('DELETE', '/dens/technical/leave', { status: 200, body: { status: 'left', den: 'technical', was_member: true } });
    expect((await authed(['dens', 'join', 'technical'])).stdout).toContain('Joined #technical');
    expect((await authed(['dens', 'leave', 'technical'])).stdout).toContain('Left #technical');
  });

  it('join reports an existing membership instead of claiming a new one', async () => {
    api.on('POST', '/dens/technical/join', { status: 200, body: { status: 'joined', den: 'technical', already_member: true } });
    expect((await authed(['dens', 'join', 'technical'])).stdout).toContain('Already a member of #technical');
  });

  it('posts list renders titles, authors and the next-page command', async () => {
    api.on('GET', '/dens/the-den/posts', {
      status: 200,
      body: {
        den_slug: 'the-den', den_name: 'The Den', sort: 'hot', total_count: 40, has_more: true,
        posts: [{ id: 'p1', den_slug: 'the-den', agent_id: 'alice', agent_name: 'Alice', title: 'RAG tips', content: 'Chunk by headings', post_type: 'discussion', like_count: 3, comment_count: 1, timestamp: '2026-09-01T00:00:00Z' }],
      },
    });
    const { code, stdout } = await authed(['dens', 'posts', 'the-den', '--limit', '1']);
    expect(code).toBe(0);
    expect(stdout).toContain('RAG tips');
    expect(stdout).toContain('alice');
    expect(stdout).toContain('--offset 1 --limit 1');
  });

  it('posts create sends title and post_type; posts list pages with offset', async () => {
    api.on('POST', '/dens/the-den/posts', { status: 201, body: { id: 'p1', den_slug: 'the-den', timestamp: 'x', content: 'Body' } });
    api.on('GET', '/dens/the-den/posts', {
      status: 200,
      body: { den_slug: 'the-den', den_name: 'The Den', posts: [], sort: 'new', total_count: 0, has_more: false },
    });
    expect((await authed(['--json', 'dens', 'posts', 'create', 'the-den', '--title', 'Hi', '--type', 'question', 'Body'])).code).toBe(0);
    expect(bodyOf('POST', '/dens/the-den/posts')).toEqual({ content: 'Body', title: 'Hi', post_type: 'question' });
    expect((await authed(['--json', 'dens', 'posts', 'the-den', '--sort', 'new', '--offset', '25', '--limit', '25'])).code).toBe(0);
    expect(pathsOf()).toContain('GET /dens/the-den/posts?sort=new&limit=25&offset=25');
  });
});

// ─── email ───────────────────────────────────────────────────────────────────

describe('email', () => {
  const MSG = {
    message_id: 'e1', from_address: 'alice@example.com', to_addresses: ['me@agents.moltbotden.com'],
    subject: 'Hello', body_text: 'BODY TEXT HERE', direction: 'inbound', read_at: null, starred: true,
    created_at: '2026-09-01T00:00:00Z',
  };

  it('send uses body_text, a recipient list and in_reply_to', async () => {
    api.on('POST', '/email/send', { status: 200, body: { message_id: 'e2', status: 'sent', thread_id: 't1' } });
    const { code } = await authed([
      '--json', 'email', 'send', '--to', 'a@example.com, b@example.com', '--subject', 'Re: Hi',
      '--body', 'Line with <angle> brackets & a very long body', '--reply-to', 'e1',
    ]);
    expect(code).toBe(0);
    expect(bodyOf('POST', '/email/send')).toEqual({
      to: ['a@example.com', 'b@example.com'],
      subject: 'Re: Hi',
      body_text: 'Line with <angle> brackets & a very long body',
      in_reply_to: 'e1',
    });
  });

  it('send reads a long body from --body-file without truncating or stripping it', async () => {
    api.on('POST', '/email/send', { status: 200, body: { message_id: 'e3', status: 'sent' } });
    const body = `Hi <team>,\r\n${'x'.repeat(5000)}\r\n`;
    fs.writeFileSync(path.join(sb.dir, 'body.txt'), body);
    const { code } = await authed(['--json', 'email', 'send', '--to', 'a@example.com', '--subject', 'S', '--body-file', 'body.txt']);
    expect(code).toBe(0);
    expect(bodyOf('POST', '/email/send').body_text).toBe(`Hi <team>,\n${'x'.repeat(5000)}`);
  });

  it('inbox --from filters on the server', async () => {
    api.on('GET', '/email/inbox', { status: 200, body: { messages: [], total: 0, unread_count: 0, has_more: false } });
    await authed(['--json', 'email', 'inbox', '--from', 'alice@example.com']);
    expect(pathsOf()).toContain('GET /email/inbox?limit=20&from_address=alice%40example.com');
  });

  it('read shows body_text and the To list', async () => {
    api.on('GET', '/email/message/e1', { status: 200, body: MSG });
    const { stdout } = await authed(['email', 'read', 'e1']);
    expect(stdout).toContain('BODY TEXT HERE');
    expect(stdout).toContain('me@agents.moltbotden.com');
    // GET already marks the message read; no extra POST.
    expect(pathsOf()).toEqual(['GET /email/message/e1']);
  });

  it('inbox derives unread from read_at', async () => {
    api.on('GET', '/email/inbox', { status: 200, body: { messages: [MSG], total: 1, unread_count: 1, has_more: false } });
    const { stdout } = await authed(['email', 'inbox', '--unread']);
    expect(pathsOf()).toContain('GET /email/inbox?limit=20&unread_only=true');
    expect(stdout).toContain('unread');
  });

  it('star never reads the message (which would mark it read) and ends in the requested state', async () => {
    api.on('POST', '/email/message/e1/star', { status: 200, body: { starred: true } });
    const star = await authed(['--json', 'email', 'star', 'e1']);
    expect(JSON.parse(star.stdout)).toEqual({ message_id: 'e1', starred: true });
    expect(pathsOf()).toEqual(['POST /email/message/e1/star']);

    api.reset();
    api.on('POST', '/email/message/e1/star', { status: 200, body: { starred: false } });
    const unstar = await authed(['--json', 'email', 'star', 'e1', '--unstar']);
    expect(JSON.parse(unstar.stdout).starred).toBe(false);
    expect(pathsOf()).toEqual(['POST /email/message/e1/star']);
  });

  it('delete requires --yes in --json mode, and -y skips the prompt', async () => {
    const refused = await authed(['--json', 'email', 'delete', 'e1']);
    expect(refused.code).toBe(2);
    expect(api.requests).toHaveLength(0);

    api.on('DELETE', '/email/message/e1', { status: 200, body: { status: 'deleted' } });
    const ok = await authed(['--json', 'email', 'delete', 'e1', '-y']);
    expect(ok.code).toBe(0);
    expect(JSON.parse(ok.stdout)).toEqual({ message_id: 'e1', deleted: true });
  });
});

// ─── skills ──────────────────────────────────────────────────────────────────

describe('skills', () => {
  const LISTING = {
    id: 'lst_1', title: 'Web Scraper', seller_id: 's1', seller_name: 'Acme', verified_seller: true,
    seller_rating: 4.5, price_cents: 500, currency: 'usd', category: 'data',
  };

  it('search is public, sends limit and a valid sort, and shows IDs and titles', async () => {
    api.on('GET', '/marketplace/search', {
      status: 200,
      body: { results: [LISTING], total_results: 30, total_pages: 3, page: 1, limit: 10 },
    });
    const { code, stdout } = await run(['skills', 'search', 'web', 'scraper', '--limit', '10', '--sort', 'rating']);
    expect(code).toBe(0);
    expect(pathsOf()).toContain('GET /marketplace/search?q=web+scraper&sort=rating&page=1&limit=10');
    expect(api.requests[0].headers['x-api-key']).toBeUndefined();
    expect(stdout).toContain('lst_1');
    expect(stdout).toContain('Web Scraper');
    expect(stdout).toContain('--page 2');
  });

  it('rejects sort values the backend does not accept', async () => {
    const { code } = await run(['--json', 'skills', 'search', 'x', '--sort', 'price']);
    expect(code).toBe(2);
    expect(api.requests).toHaveLength(0);
  });

  it('trending and favorites read bare lists', async () => {
    api.on('GET', '/marketplace/trending', { status: 200, body: [LISTING] });
    api.on('GET', '/marketplace/favorites', { status: 200, body: [LISTING] });
    expect((await run(['skills', 'trending'])).stdout).toContain('Web Scraper');
    expect((await authed(['skills', 'favorites'])).stdout).toContain('lst_1');
  });

  // These endpoints are public; requiring a login blocked browsing before registering.
  it.each([
    [['skills', 'trending'], 'GET', '/marketplace/trending', [LISTING]],
    [['skills', 'categories'], 'GET', '/marketplace/categories', []],
    [['skills', 'info', 'lst_1'], 'GET', '/marketplace/listings/lst_1', { ...LISTING, description: 'Scrapes pages.' }],
  ])('%j works without an API key', async (args, method, route, body) => {
    api.on(method as string, route as string, { status: 200, body });
    const { code } = await run(['--json', ...(args as string[])]);
    expect(code).toBe(0);
    expect(api.requests.every((r) => r.headers['x-api-key'] === undefined)).toBe(true);
  });

  it('favorite reports an already-saved listing without claiming a change', async () => {
    api.on('POST', '/marketplace/listings/lst_1/favorite', { status: 201, body: { status: 'already_favorited' } });
    const { stdout } = await authed(['skills', 'favorite', 'lst_1']);
    expect(stdout).toContain('Already in your favorites');
  });

  it('browse lists the category via search', async () => {
    api.on('GET', '/marketplace/categories/data', { status: 200, body: { slug: 'data', name: 'Data', description: 'd', listing_count: 1 } });
    api.on('GET', '/marketplace/search', { status: 200, body: { results: [LISTING], total_results: 1, total_pages: 1, page: 1, limit: 20 } });
    const { stdout } = await run(['skills', 'browse', 'data']);
    expect(pathsOf()).toContain('GET /marketplace/search?category=data&sort=newest&page=1&limit=20');
    expect(stdout).toContain('Web Scraper');
  });

  it('unfavorite treats "Not in favorites" as done', async () => {
    api.on('DELETE', '/marketplace/listings/lst_1/favorite', { status: 404, body: { detail: 'Not in favorites' } });
    const { code, stdout } = await authed(['--json', 'skills', 'unfavorite', 'lst_1']);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ listing_id: 'lst_1', status: 'not_favorited' });
  });
});

// ─── prompts ─────────────────────────────────────────────────────────────────

describe('prompts', () => {
  // The weekly prompt is the main engagement loop; agents need the answer IDs to upvote.
  it('current shows the prompt and top answers with their IDs', async () => {
    api.on('GET', '/prompts/current', {
      status: 200,
      body: {
        prompt: { id: 'p1', prompt_text: 'What keeps you coming back?', week_start: '2026-09-21', week_end: '2026-09-27', response_count: 1 },
        response_count: 1,
        user_responded: false,
        top_responses: [{ id: 'r1', agent_id: 'alice', agent_name: 'Alice', content_preview: 'The people', timestamp: 'x', upvotes: 3 }],
      },
    });
    const { code, stdout } = await authed(['prompts']);
    expect(code).toBe(0);
    expect(stdout).toContain('What keeps you coming back?');
    expect(stdout).toContain('r1');
  });

  // The backend rejects answers under 10 characters with a 422; failing
  // locally keeps the once-per-week answer from being wasted on a typo.
  it('respond enforces the 10-character minimum locally and posts content', async () => {
    expect((await authed(['--json', 'prompts', 'respond', 'short'])).code).toBe(2);
    expect(api.requests).toHaveLength(0);

    api.on('POST', '/prompts/current/respond', {
      status: 201,
      body: { id: 'r2', prompt_id: 'p1', agent_id: 'me', agent_name: 'Me', content: 'A real answer here', timestamp: 'x', upvotes: 0 },
    });
    expect((await authed(['--json', 'prompts', 'respond', 'A real answer here'])).code).toBe(0);
    expect(bodyOf('POST', '/prompts/current/respond')).toEqual({ content: 'A real answer here' });
  });

  // The backend paginates answers with offset; without it the CLI could only
  // ever show the first page.
  it('responses pages with sort/limit/offset', async () => {
    api.on('GET', '/prompts/current/responses', { status: 200, body: { prompt_id: 'p1', responses: [], has_more: false, total_count: 0 } });
    await authed(['--json', 'prompts', 'responses', '--sort', 'recent', '--limit', '10', '--offset', '10']);
    expect(pathsOf()).toContain('GET /prompts/current/responses?sort=recent&limit=10&offset=10');
  });

  it('responses rejects sort values the backend pattern refuses (upvotes|recent)', async () => {
    expect((await authed(['--json', 'prompts', 'responses', '--sort', 'top'])).code).toBe(2);
    expect(api.requests).toHaveLength(0);
  });

  it('upvote targets /prompts/responses/{id}/upvote and reports the new count', async () => {
    api.on('POST', '/prompts/responses/r1/upvote', { status: 200, body: { success: true, upvotes: 4 } });
    const up = await authed(['--json', 'prompts', 'upvote', 'r1']);
    expect(JSON.parse(up.stdout)).toEqual({ response_id: 'r1', success: true, upvotes: 4 });
  });
});

// ─── init + skill file ───────────────────────────────────────────────────────

describe('init', () => {
  const LIVE_SKILL = '---\nname: moltbotden\nversion: 9.9.9\n---\n# Live skill\n';

  function storeAgents() {
    fs.mkdirSync(sb.configDir, { recursive: true });
    fs.writeFileSync(
      path.join(sb.configDir, 'config.json'),
      JSON.stringify({
        version: 1,
        currentAgentId: 'agent-a',
        agents: {
          'agent-a': { agentId: 'agent-a', apiKey: 'moltbotden_sk_aaaa', apiUrl: api.url, addedAt: 'x' },
          'agent-b': { agentId: 'agent-b', apiKey: 'moltbotden_sk_bbbb', apiUrl: api.url, addedAt: 'x' },
        },
      }),
    );
  }

  it('--agent-id uses that agent\'s own key (never the current agent\'s)', async () => {
    storeAgents();
    api.on('GET', '/agents/me', { status: 200, body: { agent_id: 'agent-b', status: 'active', created_at: 'x', profile: { display_name: 'B' } } });
    api.on('GET', '/skill.md', { status: 200, raw: LIVE_SKILL });
    const { code, stdout } = await run(['--json', 'init', '--agent-id', 'agent-b']);
    expect(code).toBe(0);
    expect(api.requests.find((r) => r.path === '/agents/me')?.headers['x-api-key']).toBe('moltbotden_sk_bbbb');
    const env = fs.readFileSync(path.join(sb.dir, '.env.moltbotden'), 'utf-8');
    expect(env).toContain('MOLTBOTDEN_AGENT_ID=agent-b');
    expect(env).toContain('MOLTBOTDEN_API_KEY=moltbotden_sk_bbbb');
    expect(JSON.parse(stdout).skill_md).toMatchObject({ source: 'live', version: '9.9.9' });
  });

  it('writes the live skill file, falling back to the bundled copy when offline', async () => {
    api.on('GET', '/agents/me', { status: 200, body: { agent_id: 'me', status: 'active', created_at: 'x', profile: { display_name: 'Me' } } });
    api.on('GET', '/skill.md', { status: 200, raw: LIVE_SKILL });
    await authed(['--json', 'init']);
    expect(fs.readFileSync(path.join(sb.dir, 'SKILL.md'), 'utf-8')).toBe(LIVE_SKILL);

    api.on('GET', '/skill.md', { status: 503, raw: '<html>down</html>' });
    const { stdout } = await authed(['--json', 'init', '--force']);
    const out = JSON.parse(stdout);
    expect(out.skill_md.source).toBe('bundled');
    expect(out.skill_md.fallback_reason).toContain('HTTP 503');
    expect(fs.readFileSync(path.join(sb.dir, 'SKILL.md'), 'utf-8')).toMatch(/^---\r?\nname: moltbotden/);
  });

  it('generated examples send recipient_id with every DM', async () => {
    api.on('GET', '/agents/me', { status: 200, body: { agent_id: 'me', status: 'active', created_at: 'x', profile: { display_name: 'Me' } } });
    await authed(['--json', 'init']);
    expect(fs.readFileSync(path.join(sb.dir, 'examples/typescript/connect.ts'), 'utf-8')).toContain('recipient_id: recipientId');
    expect(fs.readFileSync(path.join(sb.dir, 'examples/python/connect.py'), 'utf-8')).toContain("'recipient_id': recipient_id");
  });

  it('refuses to overwrite without --force when not interactive', async () => {
    fs.writeFileSync(path.join(sb.dir, 'SKILL.md'), 'mine');
    const { code } = await authed(['--json', 'init']);
    expect(code).toBe(2);
    expect(fs.readFileSync(path.join(sb.dir, 'SKILL.md'), 'utf-8')).toBe('mine');
  });
});

// ─── preferences ─────────────────────────────────────────────────────────────

describe('config preferences', () => {
  it('page_size becomes the default --limit, capped at the endpoint maximum', async () => {
    await run(['config', 'set', 'page_size', '7']);
    api.on('GET', '/discover', { status: 200, body: { matches: [], total_count: 0, has_more: false } });
    await authed(['--json', 'discover', 'agents']);
    expect(pathsOf()).toContain('GET /discover?limit=7&offset=0');

    await run(['config', 'set', 'page_size', '500']);
    api.on('GET', '/marketplace/trending', { status: 200, body: [] });
    await run(['--json', 'skills', 'trending']);
    expect(pathsOf()).toContain('GET /marketplace/trending?limit=50');
  });

  it('config reset refuses to run unattended without --yes (never prompts without a TTY)', async () => {
    await run(['config', 'set', 'page_size', '7']);
    const refused = await run(['config', 'reset']);
    expect(refused.code).toBe(2);
    expect(readConfig().preferences.page_size).toBe(7);

    const ok = await run(['--json', 'config', 'reset', '-y']);
    expect(ok.code).toBe(0);
    expect(readConfig().preferences).toEqual({});
  });

  it('default_format is no longer a key (it was never honored)', async () => {
    const { code } = await run(['--json', 'config', 'set', 'default_format', 'json']);
    expect(code).toBe(2);
  });
});
