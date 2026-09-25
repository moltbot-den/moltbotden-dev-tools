#!/usr/bin/env node
/**
 * Smoke-test a standalone `mbd` binary (scripts/build-binary.mjs) the way a
 * user without Node would run it. Used by the binaries workflow on every
 * target runner:
 *
 *   node scripts/smoke-binary.mjs release/mbd-linux-x64/mbd
 *
 * Checks the features that break when something is missing from the binary:
 * version injection, the command tree, doctor, `api --jq` (jq-wasm must be
 * embedded) against the live API, `update` (must not reach for npm), and the
 * offline SKILL.md fallback (an embedded SEA asset) via `init` against a local
 * stub API.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const exe = path.resolve(process.argv[2] ?? '');
if (!process.argv[2] || !fs.existsSync(exe)) {
  console.error('usage: node scripts/smoke-binary.mjs <path-to-mbd>');
  process.exit(2);
}
const expectedVersion = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
).version;

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mbd-smoke-'));
// A clean config dir and no inherited credentials, so results do not depend on the runner.
const baseEnv = { ...process.env, MOLTBOTDEN_CONFIG_DIR: path.join(scratch, 'config'), NO_COLOR: '1' };
delete baseEnv.MOLTBOTDEN_API_KEY;
delete baseEnv.MOLTBOTDEN_API_URL;
delete baseEnv.MOLTBOTDEN_SKILL_URL;

/** Run the binary from the scratch dir, so nothing next to the repo (templates/, node_modules/) can be picked up. */
function run(args, { cwd = scratch, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd, env: { ...baseEnv, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), 60_000);
    child.on('error', reject);
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

await check('--version', async () => {
  const res = await run(['--version']);
  assert(res.status === 0, `exit ${res.status}: ${res.stderr}`);
  assert(res.stdout.trim() === expectedVersion, `printed "${res.stdout.trim()}", expected ${expectedVersion}`);
});

await check('--help', async () => {
  const res = await run(['--help']);
  assert(res.status === 0, `exit ${res.status}: ${res.stderr}`);
  assert(/Usage: mbd/.test(res.stdout) && /register/.test(res.stdout), 'help text is missing the command list');
});

await check('doctor --json', async () => {
  // Exit 1 is expected: the credentials check fails with no login.
  const res = await run(['doctor', '--json']);
  assert(res.status === 0 || res.status === 1, `exit ${res.status}: ${res.stderr}`);
  const report = JSON.parse(res.stdout);
  const node = report.checks.find((c) => c.id === 'node');
  assert(node?.status === 'pass', `embedded runtime check: ${JSON.stringify(node)}`);
  const api = report.checks.find((c) => c.id === 'api');
  assert(api?.status === 'pass', `API reachability: ${JSON.stringify(api)}`);
});

await check('api /health --jq .status (live API, embedded jq-wasm)', async () => {
  const res = await run(['api', '/health', '--jq', '.status']);
  assert(res.status === 0, `exit ${res.status}: ${res.stderr}`);
  assert(res.stdout.trim().length > 0 && !res.stdout.includes('{'), `unexpected output "${res.stdout.trim()}"`);
});

// A local stub API: answers /agents/me for `init`, serves a newer "latest"
// for the npm registry lookup, and a non-skill body for the skill URL.
const server = http.createServer((_req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ agent_id: 'smoke-agent', display_name: 'Smoke', status: 'active', version: '99.0.0' }));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const stubUrl = `http://127.0.0.1:${server.address().port}`;

await check('update prints the installer command instead of running npm', async () => {
  const res = await run(['update', '--json'], { env: { MBD_NPM_REGISTRY: stubUrl } });
  assert(res.status === 0, `exit ${res.status}: ${res.stderr}`);
  const out = JSON.parse(res.stdout);
  assert(out.install_method === 'standalone' && out.latest_version === '99.0.0', `update output: ${res.stdout}`);
  assert(/install\.(sh|ps1)|brew upgrade/.test(out.update_command), `update_command: ${out.update_command}`);
});

await check('init offline SKILL.md fallback (embedded asset)', async () => {
  const project = fs.mkdtempSync(path.join(scratch, 'project-'));
  const res = await run(['init', '--json'], {
    cwd: project,
    env: {
      MOLTBOTDEN_API_KEY: 'moltbotden_sk_smoke',
      MOLTBOTDEN_API_URL: stubUrl,
      MOLTBOTDEN_SKILL_URL: `${stubUrl}/not-a-skill-file`,
    },
  });
  assert(res.status === 0, `exit ${res.status}: ${res.stderr}`);
  const out = JSON.parse(res.stdout);
  assert(out.skill_md?.source === 'bundled', `skill_md: ${JSON.stringify(out.skill_md)}`);
  const skill = fs.readFileSync(path.join(project, 'SKILL.md'), 'utf-8');
  assert(/^name:\s*moltbotden\s*$/m.test(skill.replace(/\r\n/g, '\n')), 'SKILL.md is not the bundled skill file');
});

server.close();
fs.rmSync(scratch, { recursive: true, force: true });
if (failures > 0) {
  console.error(`${failures} smoke check(s) failed for ${exe}`);
  process.exit(1);
}
console.log(`All smoke checks passed for ${exe}`);
