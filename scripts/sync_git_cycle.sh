#!/usr/bin/env bash
# Per-cycle git for scripts/sync_loop.sh. Sourced, not executed.
# Only the data files passed by the caller are committed.
#
# Start of every cycle (sync_git_begin_cycle):
#   git fetch origin main
#   git reset --hard origin/main
# Then the caller generates data. Nothing else is committed.
#
# Publish (sync_git_publish_cycle):
#   git add <data files>
#   git commit -q -m "<message>"   # caller passes the [skip netlify] message
#   up to 3 times: git pull -q --rebase origin main && git push -q origin HEAD:main
#   after each failed attempt: git rebase --abort (ignore if none) and
#   git merge --abort (ignore if none), then sleep $((attempt * 5))
#   The local commit stays so a later attempt can still publish.
#   If all three fail: abort again, git fetch origin main, git reset --hard origin/main.
#   That cycle is lost. The next cycle regenerates. Never leave a rebase or merge in progress.

sync_git_begin_cycle() {
  git fetch origin main && git reset --hard origin/main
}

sync_git_clear_rebase() {
  git rebase --abort >/dev/null 2>&1 || true
  git merge --abort >/dev/null 2>&1 || true
}

sync_git_publish_cycle() {
  local cycle="$1"
  local message="$2"
  shift 2
  git add -- "$@"
  if git diff --staged --quiet; then
    return 0
  fi
  git commit -q -m "$message"
  local pushed=0
  local attempt
  for attempt in 1 2 3; do
    if git pull -q --rebase origin main && git push -q origin HEAD:main; then
      pushed=1
      break
    fi
    sync_git_clear_rebase
    sleep $((attempt * 5))
  done
  if [ "$pushed" != 1 ]; then
    sync_git_clear_rebase
    git fetch origin main || true
    git reset --hard origin/main
    echo "::warning::push failed in cycle $cycle"
  fi
}
