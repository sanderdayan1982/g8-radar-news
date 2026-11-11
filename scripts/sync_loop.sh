#!/usr/bin/env bash
# Reliable cadence on free GitHub Actions. GitHub delays or skips */5 schedules, so an hourly
# trigger starts one long job that syncs on its own clock: every 5 min, every 60 s when a
# High-impact event is within 15 min. Each cycle commits only when files changed ([skip netlify]).
# Each cycle starts from origin/main (scripts/sync_git_cycle.sh), never from the commit that
# triggered the job. A failed rebase or push is aborted and that cycle is discarded.
set -u
BUDGET_SEC=${BUDGET_SEC:-3420}            # 57 min, then the next hourly run takes over
START=$(date +%s)
git config user.name "radarnews-g8-bot"
git config user.email "radarnews-g8-bot@users.noreply.github.com"
# shellcheck disable=SC1091
source "$(dirname "$0")/sync_git_cycle.sh"
cycle=0
while :; do
  cycle=$((cycle + 1))
  if ! sync_git_begin_cycle; then
    echo "::warning::sync cycle $cycle failed; heartbeat not advanced"
  else
    node scripts/sync_feeds.mjs || echo "::warning::sync cycle $cycle failed; heartbeat not advanced"
    sync_git_publish_cycle "$cycle" "chore(feed): sync radar news [skip netlify]" \
      public/data/radar_news_full.json \
      public/data/iris_g8_feed.json \
      public/data/radar_status.json \
      public/data/radar_store.json \
      public/data/polymarket_geo_history.json
  fi
  INTERVAL=$(node scripts/next_interval.mjs 2>/dev/null || echo 300)
  ELAPSED=$(( $(date +%s) - START ))
  [ $((ELAPSED + INTERVAL)) -ge "$BUDGET_SEC" ] && break
  sleep "$INTERVAL"
done
echo "cycles=$cycle"
