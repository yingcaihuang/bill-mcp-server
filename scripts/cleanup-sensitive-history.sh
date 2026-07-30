#!/usr/bin/env bash
set -euo pipefail

# Clean sensitive files from git history.
# Default targets:
#   - nginx/certs/server.key
#   - mcp.json
#
# This script rewrites history locally and does NOT push.
# You must force-push manually after verification.

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

TARGETS=(
  "nginx/certs/server.key"
  "mcp.json"
)

if ! command -v git >/dev/null 2>&1; then
  echo "Error: git is not installed."
  exit 1
fi

if ! command -v git-filter-repo >/dev/null 2>&1; then
  echo "Error: git-filter-repo is not installed."
  echo "Install on macOS: brew install git-filter-repo"
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree is not clean. Commit or stash changes first."
  git status --short
  exit 1
fi

current_branch="$(git rev-parse --abbrev-ref HEAD)"
default_branch="main"

backup_tag="backup/pre-secret-cleanup-$(date +%Y%m%d-%H%M%S)"

echo "Repository: $REPO_ROOT"
echo "Current branch: $current_branch"
echo "Backup tag: $backup_tag"
echo "Targets to remove from all history:"
for t in "${TARGETS[@]}"; do
  echo "  - $t"
done

echo ""
echo "This operation rewrites git history."
echo "To continue, set CONFIRM=YES and re-run this script."

if [[ "${CONFIRM:-}" != "YES" ]]; then
  exit 1
fi

git tag "$backup_tag"
echo "Created backup tag: $backup_tag"

args=(--force --invert-paths)
for t in "${TARGETS[@]}"; do
  args+=(--path "$t")
done

git filter-repo "${args[@]}"

echo "Running post-cleanup garbage collection..."
git reflog expire --expire=now --all
git gc --prune=now --aggressive

echo ""
echo "Verification:"
for t in "${TARGETS[@]}"; do
  count="$(git rev-list --all -- "$t" | wc -l | tr -d ' ')"
  echo "  $t -> commits found after rewrite: $count"
done

echo ""
echo "Next steps:"
echo "1) Verify your app still runs and tests pass."
echo "2) Force-push rewritten history (all branches and tags as needed)."
echo "   Example: git push --force-with-lease origin $current_branch"
echo "3) Rotate any exposed credentials and TLS keys immediately."
