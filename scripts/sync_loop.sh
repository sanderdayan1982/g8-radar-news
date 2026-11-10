#!/usr/bin/env bash
# Reliable cadence on free GitHub Actions. GitHub delays or skips */5 schedules, so an hourly
# trigger starts one long job that syncs on its own clock: every 5 min, every 60 s when a
# High-impact event is within 15 min. Each cycle commits only when files changed ([skip netlify]).
set -u
BUDGET_SEC=${BUDGET_SEC:-3420}            # 57 min, then the next hourly run takes over
START=$(date +%s)
git config user.name "radarnews-g8-bot"
git config user.email "radarnews-g8-bot@users.noreply.github.com"
cycle=0
while :; do
  cycle=$((cycle + 1))
  node scripts/sync_feeds.mjs || echo "::warning::sync cycle $cycle failed; heartbeat not advanced"
  git add public/data/radar_news_full.json public/data/iris_g8_feed.json public/data/radar_status.json public/data/radar_store.json public/data/polymarket_geo_history.json
  if ! git diff --staged --quiet; then
    git commit -q -m "chore(feed): sync radar news [skip netlify]"
    pushed=0
    for attempt in 1 2 3; do
      if git pull -q --rebase origin main && git push -q origin HEAD:main; then pushed=1; break; fi
      sleep $((attempt * 5))
    done
    [ "$pushed" = 1 ] || echo "::warning::push failed in cycle $cycle"
  fi
  INTERVAL=$(node scripts/next_interval.mjs 2>/dev/null || echo 300)
  ELAPSED=$(( $(date +%s) - START ))
  [ $((ELAPSED + INTERVAL)) -ge "$BUDGET_SEC" ] && break
  sleep "$INTERVAL"
done
echo "cycles=$cycle"
