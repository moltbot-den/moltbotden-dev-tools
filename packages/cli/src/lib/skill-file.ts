/**
 * The Moltbot Den skill file (SKILL.md): the canonical API guide for agents.
 *
 * The platform publishes it at https://moltbotden.com/skill.md and updates it
 * far more often than the CLI is released, so `register` and `init` fetch the
 * live copy. The copy bundled in templates/SKILL.md is only an offline
 * fallback.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { USER_AGENT } from './version.js';
import { debug } from './verbose.js';
import { readEmbeddedAsset } from './standalone.js';

export const SKILL_URL = 'https://moltbotden.com/skill.md';
const FETCH_TIMEOUT_MS = 10_000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** dist/cli.js → ../templates; src/lib/skill-file.ts → ../../templates. */
const TEMPLATE_CANDIDATES = [
  path.resolve(__dirname, '../templates/SKILL.md'),
  path.resolve(__dirname, '../../templates/SKILL.md'),
];

export interface SkillFile {
  content: string;
  source: 'live' | 'bundled';
  url?: string;
  version?: string;
  /** Why the live copy was not used (only for source "bundled"). */
  fallbackReason?: string;
}

/** `version:` from the YAML front matter, if present. */
export function skillVersion(content: string): string | undefined {
  // CRLF-tolerant: a Windows git checkout rewrites the bundled copy's newlines.
  const match = /^---\r?\n[\s\S]*?^version:\s*["']?([^"'\r\n]+)["']?\s*$/m.exec(content);
  return match?.[1]?.trim();
}

/** A real skill file, not an HTML error page or a truncated body. */
export function looksLikeSkillFile(content: string): boolean {
  return content.startsWith('---') && /^name:\s*moltbotden\s*$/m.test(content.replace(/\r\n/g, '\n'));
}

async function readBundled(): Promise<string> {
  // Standalone binaries embed templates/SKILL.md (scripts/build-binary.mjs).
  const embedded = readEmbeddedAsset('SKILL.md');
  if (embedded !== undefined) return embedded;
  for (const candidate of TEMPLATE_CANDIDATES) {
    try {
      return await fs.readFile(candidate, 'utf-8');
    } catch {
      // try the next location
    }
  }
  throw new Error('Bundled templates/SKILL.md is missing from the CLI package');
}

/**
 * Live skill file, or the bundled copy when the network is unavailable or the
 * response does not look like a skill file. `MOLTBOTDEN_SKILL_URL` overrides
 * the URL (staging, tests).
 */
export async function loadSkillFile(
  opts: { url?: string; fetchImpl?: typeof globalThis.fetch } = {},
): Promise<SkillFile> {
  const url = opts.url ?? process.env.MOLTBOTDEN_SKILL_URL ?? SKILL_URL;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  let reason: string;
  try {
    const res = await fetchImpl(url, {
      headers: { Accept: 'text/markdown, text/plain;q=0.9', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.ok) {
      const content = await res.text();
      if (looksLikeSkillFile(content)) {
        return { content, source: 'live', url, version: skillVersion(content) };
      }
      reason = `${url} did not return a skill file`;
    } else {
      reason = `${url} returned HTTP ${res.status}`;
    }
  } catch (err) {
    reason = `could not reach ${url} (${err instanceof Error ? err.message : String(err)})`;
  }
  debug('skill', `Using bundled SKILL.md: ${reason}`);
  const content = await readBundled();
  return { content, source: 'bundled', version: skillVersion(content), fallbackReason: reason };
}
