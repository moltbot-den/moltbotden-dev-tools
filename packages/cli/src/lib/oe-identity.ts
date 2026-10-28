/**
 * The agent's own Open Entity key, as the `openentity` CLI stores it:
 * $OPENENTITY_HOME (default ~/.openentity)/<eid>/key is an Ed25519 JWK. `$OPENENTITY_EID` or the `current`
 * file picks the entity; a single entity directory is picked automatically.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPresentation, keyPairFromJwk } from '@openentity/sdk';
import { UsageError } from './errors.js';

export interface Challenge {
  nonce: string;
  audience: string;
}

function home(): string {
  return process.env.OPENENTITY_HOME || path.join(os.homedir(), '.openentity');
}

function currentEid(): string {
  const given = process.env.OPENENTITY_EID?.trim();
  if (given) return given;
  const root = home();
  try {
    const current = fs.readFileSync(path.join(root, 'current'), 'utf-8').trim();
    if (current) return current;
  } catch {
    // no current file: fall through to the single-directory rule
  }
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name);
  } catch {
    // no directory at all
  }
  if (dirs.length === 1) return dirs[0];
  throw new UsageError(
    `No Open Entity key found in ${root}. Create one with "npx openentity adopt", or set OPENENTITY_HOME / OPENENTITY_EID.`,
  );
}

/** Sign a Presentation (spec 4.7) answering the platform's challenge with the local key. */
export async function presentLocal(challenge: Challenge): Promise<object> {
  const eid = currentEid();
  if (!/^did:[a-z0-9]+:[A-Za-z0-9:._%-]+$/.test(eid) || eid.includes('..')) {
    throw new UsageError(`Not a valid Open Entity identifier: ${eid}`);
  }
  let jwk: Parameters<typeof keyPairFromJwk>[0];
  try {
    jwk = JSON.parse(fs.readFileSync(path.join(home(), eid, 'key'), 'utf-8')) as typeof jwk;
  } catch (err) {
    throw new UsageError(`Cannot read the key for ${eid} in ${home()}: ${(err as Error).message}`);
  }
  const kp = await keyPairFromJwk(jwk);
  return buildPresentation(kp, { audience: challenge.audience, nonce: challenge.nonce });
}
