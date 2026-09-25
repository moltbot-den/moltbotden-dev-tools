/**
 * Temp directories for tests. Every directory made here is deleted after the
 * test file finishes (tests/setup.ts registers the afterAll), so runs never
 * leave mbd-* folders piling up in the OS temp dir.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const created: string[] = [];

/** mkdtemp under os.tmpdir() with an `mbd-<prefix>-` name, removed after the file's tests. */
export function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mbd-${prefix}-`));
  created.push(dir);
  return dir;
}

export function removeTempDirs(): void {
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}
