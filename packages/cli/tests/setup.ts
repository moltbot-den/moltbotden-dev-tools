/**
 * Global test isolation. Every test file runs with:
 *   - its own empty config dir, so no test can read or overwrite the
 *     developer's real ~/.moltbotden credentials;
 *   - no credential/URL env vars leaking in from the developer's shell;
 *   - update checks disabled, so nothing calls the npm registry;
 *   - every temp dir from makeTempDir() removed when the file finishes.
 */
import { afterAll } from 'vitest';
import { makeTempDir, removeTempDirs } from './helpers/temp-dir.js';

const dir = makeTempDir('test-config');
process.env.MOLTBOTDEN_CONFIG_DIR = dir;
process.env.MBD_NO_UPDATE_CHECK = '1';
delete process.env.MOLTBOTDEN_API_KEY;
delete process.env.MOLTBOTDEN_API_URL;
delete process.env.MOLTBOTDEN_TIMEOUT_MS;
delete process.env.MBD_TELEMETRY_DISABLED;

// Delete every temp dir the file made (tests/helpers/temp-dir.ts), including the config dir above.
afterAll(removeTempDirs);
