#!/usr/bin/env bash
# The one definition of "this commit is good". CI (.github/workflows/ci.yml)
# and the local pre-push hook both run exactly this script, so a push that
# passes locally cannot fail in CI for a reason the hook didn't check.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

step() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }

step "typecheck";  npm run typecheck --silent
step "build";      npm run build --silent
step "test";       npm test --silent
step "audit (runtime deps)"; npm audit --omit=dev --audit-level=high
step "endpoint contract";    npm run check:endpoints --silent -w packages/cli
step "package contents";     node scripts/check-pack.mjs

printf '\n\033[32m✓ verify passed\033[0m\n'
