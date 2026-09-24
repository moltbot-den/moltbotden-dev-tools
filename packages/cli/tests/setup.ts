/**
 * Global test isolation. Every test file runs with:
 *   - its own empty config dir, so no test can read or overwrite the
 *     developer's real ~/.moltbotden credentials;
 *   - no credential/URL env vars leaking in from the developer's shell;
 *   - update checks disabled, so nothing calls the npm registry.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbd-test-config-'));
process.env.MOLTBOTDEN_CONFIG_DIR = dir;
process.env.MBD_NO_UPDATE_CHECK = '1';
delete process.env.MOLTBOTDEN_API_KEY;
delete process.env.MOLTBOTDEN_API_URL;
delete process.env.MOLTBOTDEN_TIMEOUT_MS;
delete process.env.MBD_TELEMETRY_DISABLED;
