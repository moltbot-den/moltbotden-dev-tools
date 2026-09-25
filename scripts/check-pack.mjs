// Fails if the published tarball would be missing required files or would ship
// sources, tests or secrets. Run by scripts/verify.sh (CI and pre-push).
import { execFileSync } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const out = execFileSync(npm, ['pack', '--dry-run', '--json', '-w', 'packages/cli'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
});
const [pkg] = JSON.parse(out);
const files = pkg.files.map((f) => f.path);
const required = ['dist/cli.js', 'package.json', 'README.md', 'LICENSE', 'CHANGELOG.md', 'templates/SKILL.md'];
const missing = required.filter((f) => !files.includes(f));
const leaked = files.filter((f) => /^(src|tests|scripts)\/|openapi\.snapshot\.json|\.env/.test(f));

console.log(`${pkg.name}@${pkg.version}: ${files.length} files, ${pkg.size} bytes packed`);
if (missing.length) {
  console.error('missing from tarball:', missing);
  process.exit(1);
}
if (leaked.length) {
  console.error('should not be in tarball:', leaked);
  process.exit(1);
}
execFileSync(process.execPath, ['packages/cli/dist/cli.js', '--version'], { stdio: 'inherit' });
