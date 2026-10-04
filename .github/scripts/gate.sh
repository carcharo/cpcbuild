#!/usr/bin/env bash
# CI gate: decide whether the test jobs run.
#   push / pull_request / workflow_dispatch -> always run=true
#   schedule -> run=true only if carcharo/zxbasic cpc-arch has a commit newer than
#               WINDOW_HOURS (default 25) ago.
# Env: EVENT_NAME (required), GH_TOKEN (for gh api), WINDOW_HOURS, GITHUB_OUTPUT,
#      and for tests: ZX_COMMIT_DATE (ISO-8601, skips the API call), NOW_EPOCH.
set -euo pipefail

event="${EVENT_NAME:?EVENT_NAME required}"
window="${WINDOW_HOURS:-25}"

emit() {
  echo "run=$1"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "run=$1" >> "$GITHUB_OUTPUT"; fi
}

if [ "$event" != "schedule" ]; then
  echo "event $event: always run"
  emit true
  exit 0
fi

date_iso="${ZX_COMMIT_DATE:-$(gh api repos/carcharo/zxbasic/commits/cpc-arch --jq .commit.committer.date)}"
# GNU date (runners) or BSD date (macOS, local testing)
if epoch=$(date -u -d "$date_iso" +%s 2>/dev/null); then :; else
  epoch=$(date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$date_iso" +%s)
fi
now="${NOW_EPOCH:-$(date -u +%s)}"
age_h=$(( (now - epoch) / 3600 ))
echo "zxbasic cpc-arch last commit $date_iso (${age_h}h ago, window ${window}h)"
if [ "$age_h" -lt "$window" ]; then
  echo "recent zxbasic commit: run"
  emit true
else
  echo "no recent zxbasic commit: skip"
  emit false
fi
