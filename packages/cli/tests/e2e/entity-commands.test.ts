/**
 * `mbd entity adopt|bind` and `mbd heartbeat --sovereign` against the mock API.
 *
 * The Presentation the server receives is verified here with the Open Entity SDK, exactly as the platform
 * verifies it: the signer must be the agent's own key and the challenge must come back signed for the
 * platform's audience. A wrong shape is a silent production failure (the lease never extends).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { generateKeyPair, verifyPresentation } from '@openentity/sdk';
import { startMockApi, type MockApi } from '../helpers/mock-api.js';
import { CLI_PATH, makeSandbox, runCli, type Sandbox } from '../helpers/run-cli.js';

let api: MockApi;
let sb: Sandbox;
const KEY = 'moltbotden_sk_testkey000000000000';
const AUDIENCE = 'did:web:moltbotden.com';
const NONCE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

const run = (args: string[], env: Record<string, string> = {}) =>
  runCli(sb, ['--api-url', api.url, ...args], { MOLTBOTDEN_API_KEY: KEY, ...env });

async function writeLocalKey(): Promise<{ did: string; home: string }> {
  const kp = await generateKeyPair();
  const home = path.join(sb.dir, 'oe');
  fs.mkdirSync(path.join(home, kp.did), { recursive: true });
  fs.writeFileSync(path.join(home, kp.did, 'key'), JSON.stringify(kp.privateJwk));
  return { did: kp.did, home };
}

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
afterEach(() => {
  fs.rmSync(sb.dir, { recursive: true, force: true });
});

describe('mbd heartbeat --sovereign', () => {
  it('answers the challenge with a Presentation signed by the local key and reports the lease', async () => {
    const { did, home } = await writeLocalKey();
    api.on('POST', '/heartbeat/challenge', { status: 200, body: { nonce: NONCE, audience: AUDIENCE, expires_at: 'x' } });
    api.on('POST', '/heartbeat/sovereign', {
      status: 200,
      body: { success: true, eid: did, liveness_method: 'presentation', last_heartbeat: 'x', sovereign_lease_until: '2026-11-04T00:00:00Z', lease_days: 7, lease_zeroed_reason: null, falls_back_to: null },
    });

    const res = await run(['heartbeat', '--sovereign', '--json'], { OPENENTITY_HOME: home });

    expect(res.code).toBe(0);
    expect(JSON.parse(res.stdout).lease_days).toBe(7);
    const sent = api.requests.find((r) => r.path === '/heartbeat/sovereign');
    expect(sent?.headers['x-api-key']).toBe(KEY);
    const check = await verifyPresentation(JSON.parse(sent?.body ?? '{}'), { audience: AUDIENCE, nonce: NONCE });
    expect(check.errors).toEqual([]);
    expect(check.eid).toBe(did);
  });

  it('says how to get a key when none exists, and sends nothing', async () => {
    api.on('POST', '/heartbeat/challenge', { status: 200, body: { nonce: NONCE, audience: AUDIENCE, expires_at: 'x' } });
    const res = await run(['heartbeat', '--sovereign'], { OPENENTITY_HOME: path.join(sb.dir, 'none') });
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('openentity adopt');
    expect(api.requests.some((r) => r.path === '/heartbeat/sovereign')).toBe(false);
  });

  it('without --sovereign the plain heartbeat is unchanged', async () => {
    api.on('POST', '/heartbeat', { status: 200, body: { timestamp: new Date().toISOString(), unread_messages: 0, pending_connections: 0 } });
    const res = await run(['heartbeat', '--json']);
    expect(res.code).toBe(0);
    expect(api.requests.map((r) => r.path)).toEqual(['/heartbeat']);
  });
});

describe('mbd entity', () => {
  it('adopt posts the framework so the agent is listed as cap:framework-<name>', async () => {
    api.on('POST', '/entity/openentity/adopt', {
      status: 200,
      body: { adopted: true, already_adopted: false, eid: 'did:pkh:eip155:8453:0xabc', level: 'L1', registry_url: 'r', profile_url: 'p' },
    });
    const res = await run(['entity', 'adopt', '--framework', 'adk', '--json']);
    expect(res.code).toBe(0);
    const sent = api.requests.find((r) => r.path.startsWith('/entity/openentity/adopt'));
    expect(sent?.path).toBe('/entity/openentity/adopt?framework=adk');
    expect(JSON.parse(res.stdout).eid).toBe('did:pkh:eip155:8453:0xabc');
  });

  it('adopt refuses an unknown framework before calling the API', async () => {
    const res = await run(['entity', 'adopt', '--framework', 'crewai']);
    expect(res.code).toBe(2);
    expect(api.requests).toHaveLength(0);
  });

  it('bind signs the bind challenge with the local key', async () => {
    const { did, home } = await writeLocalKey();
    api.on('POST', '/entity/openentity/bind/challenge', { status: 200, body: { nonce: NONCE, audience: AUDIENCE, expires_at: 'x' } });
    api.on('POST', '/entity/openentity/bind/verify', { status: 200, body: { success: true, eid: did } });
    const res = await run(['entity', 'bind', '--framework', 'goose', '--json'], { OPENENTITY_HOME: home });
    expect(res.code).toBe(0);
    const sent = api.requests.find((r) => r.path.startsWith('/entity/openentity/bind/verify'));
    expect(sent?.path).toBe('/entity/openentity/bind/verify?framework=goose');
    expect((await verifyPresentation(JSON.parse(sent?.body ?? '{}'), { audience: AUDIENCE, nonce: NONCE })).ok).toBe(true);
  });
});
