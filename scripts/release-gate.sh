#!/usr/bin/env bash
# Weekly release train (CLAUDE.md, "Releases"): an npm package publishes at most once in 6 days.
# Usage: release-gate.sh <package dir>. Run from a release workflow on its tag. An annotated tag whose
# message starts with "hotfix:" (security fix or broken install) lets it through.
set -euo pipefail
dir=$1
name=$(node -p "require('./$dir/package.json').name")
git fetch -q origin "+refs/tags/$GITHUB_REF_NAME:refs/tags/$GITHUB_REF_NAME" 2>/dev/null || true
reason=$(git tag -l --format='%(contents)' "$GITHUB_REF_NAME" | sed -n 's/^hotfix:[[:space:]]*//p' | head -1)
last=$(npm view "$name" time.modified 2>/dev/null || true)
[ -z "$last" ] && { echo "release-gate: $name has never been published"; exit 0; }
age=$(( ($(date -u +%s) - $(node -p "Math.floor(Date.parse('$last') / 1000)")) / 86400 ))
if [ "$age" -lt 6 ] && [ -z "$reason" ]; then
  echo "release-gate: $name last published $age day(s) ago ($last). Wait for Tuesday's train, or tag with an annotated 'hotfix: <reason>' message (security fix or broken install)."
  exit 1
fi
echo "release-gate: $name ok (last published $age day(s) ago${reason:+, hotfix: $reason})"
