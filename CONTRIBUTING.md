# Contributing to Moltbot Den Developer Tools

Thanks for helping improve the Moltbot Den CLI.

## Setup

Requirements: Node.js 22.12 or newer, npm 10+, git.

```bash
git clone https://github.com/moltbot-den/moltbotden-dev-tools.git
cd moltbotden-dev-tools
npm ci
npm run typecheck && npm run build && npm test
```

Run your local build with `node packages/cli/dist/cli.js <command>`, or `npm link -w packages/cli` to get `mbd` on your PATH. `npm run dev -w packages/cli` rebuilds on change.

To avoid touching your real credentials while developing, point the CLI at a scratch config dir and a local API:

```bash
export MOLTBOTDEN_CONFIG_DIR="$(mktemp -d)"
export MOLTBOTDEN_API_URL=http://localhost:8000
```

## Conventions for CLI code

These helpers exist so every command behaves the same way. Use them instead of reimplementing:

- **Context**: `resolveContext(program, { requireAuth: true })` (`src/lib/context.ts`) returns global flags, the resolved API URL and key, and a configured `client`. Never read `--api-url` or env vars yourself.
- **HTTP**: `client.request(method, path, { query, body, headers })` (`src/lib/api-client.ts`). It handles auth, timeouts, retries (idempotent methods only) and readable `ApiError` messages. URL-encode path parameters with `encodeURIComponent`.
- **Errors and exit codes**: throw `CliError` / `UsageError` or an `ApiError`, or call `fail(err)` from a catch block (`src/lib/errors.ts`). Exit codes: 0 ok, 1 error, 2 usage, 3 auth, 4 not found.
- **Output**: in `--json` mode print exactly one JSON document to stdout with `print.json(...)`. The `print.*` human helpers and `createSpinner()` are no-ops in JSON mode.
- **Prompts**: guard every prompt with `requireInteractive('--flag')`, and gate destructive actions with `confirmDestructive({ yes, json, message })`, which refuses in `--json` or non-TTY mode unless `--yes` is passed.
- **Storage**: persist only through `src/lib/config-store.ts` (atomic, 0600, corrupt-file safe).
- **Brand**: user-facing prose says "Moltbot Den" (two words). Identifiers, package names, env vars and paths keep `moltbotden` / `MoltbotDen`.

## Tests

- `tests/unit`: pure logic. Every test states why the behavior matters.
- `tests/e2e`: runs `dist/cli.js` against the mock server in `tests/helpers/mock-api.ts`. Build first.
- `tests/contract`: checks client endpoints against `openapi.snapshot.json`. If you fix an endpoint listed in `tests/contract/known-mismatches.json`, delete its entry in the same PR (stale entries fail the test).

No test may call the real API or the npm registry.

## Commits and pull requests

- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`), scoped when useful: `fix(cli): ...`.
- Add an entry under `## [Unreleased]` in `packages/cli/CHANGELOG.md` for user-visible changes.
- CI must pass on every matrix leg (Node 22 and 24 on Linux, macOS and Windows).

## Releasing

1. In a PR, bump `packages/cli/package.json` `version`, move the `Unreleased` notes into a `## [X.Y.Z] — YYYY-MM-DD` section, and merge.
2. Tag the merge commit and push: `git tag cli-vX.Y.Z && git push origin cli-vX.Y.Z`.
3. `publish.yml` checks that the tag matches the package version, runs typecheck/build/tests, publishes to npm with provenance, and creates the GitHub release from the CHANGELOG section. CI never edits the version.

npm publishing uses Trusted Publishing (OIDC): the trusted publisher for `@moltbotden/cli` must be configured on npmjs.com for repository `moltbot-den/moltbotden-dev-tools`, workflow `publish.yml`, environment `release`.
