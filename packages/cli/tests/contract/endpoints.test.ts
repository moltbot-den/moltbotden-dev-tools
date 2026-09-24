/**
 * API contract test: every endpoint the CLI calls must exist in the committed
 * OpenAPI snapshot (openapi.snapshot.json). Nothing checked this before, which
 * is how several hosting commands shipped calling routes that do not exist.
 *
 * Refresh the snapshot with `npm run check:endpoints -- --update`.
 * Known broken endpoints are listed in known-mismatches.json; fixing one must
 * remove its entry (a stale entry fails this test too).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import {
  checkEndpoints,
  evaluate,
  extractEndpoints,
  loadAllowlist,
  normalizePath,
  SNAPSHOT_PATH,
} from '../../scripts/check-endpoints.mjs';

const spec = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf-8')) as { paths: Record<string, unknown> };

describe('CLI ↔ OpenAPI contract', () => {
  const endpoints = extractEndpoints();
  const results = checkEndpoints(endpoints, spec);
  const { unexpected, stale } = evaluate(results, loadAllowlist());

  it('extracts the client endpoints (guards against the scanner silently finding nothing)', () => {
    expect(endpoints.length).toBeGreaterThan(50);
    expect(results.some((r: { key: string }) => r.key === 'GET /agents/me')).toBe(true);
  });

  it('has no endpoint mismatches beyond the known list', () => {
    expect(unexpected.map((r: { key: string }) => r.key)).toEqual([]);
  });

  it('has no stale entries in known-mismatches.json', () => {
    expect(stale).toEqual([]);
  });
});

describe('check-endpoints internals', () => {
  it('normalizes template params and drops query strings', () => {
    expect(normalizePath('/dens/${slug}/messages?limit=${limit}')).toBe('/dens/{param}/messages');
    expect(normalizePath('/v1/hosting/compute/vms${q}')).toBe('/v1/hosting/compute/vms');
    expect(normalizePath("/marketplace/categories/${slug}${qs ? '?' + qs : ''}")).toBe('/marketplace/categories/{param}');
  });

  it('does not let a literal segment match a spec parameter', () => {
    // "/openclaw/instances" would route to "/openclaw/{instance_id}" and 404.
    const fake = { paths: { '/v1/hosting/openclaw/{instance_id}': { get: {} } } };
    const [r] = checkEndpoints([{ method: 'GET', path: '/v1/hosting/openclaw/instances', file: 'x', line: 1 }], fake);
    expect(r.status).toBe('missing-path');
  });

  it('flags a path that exists with a different method', () => {
    const fake = { paths: { '/heartbeat': { post: {} } } };
    const [r] = checkEndpoints([{ method: 'GET', path: '/heartbeat', file: 'x', line: 1 }], fake);
    expect(r).toMatchObject({ status: 'missing-method', allowedMethods: ['POST'] });
  });
});
