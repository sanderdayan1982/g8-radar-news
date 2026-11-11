import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MSG = 'chore(feed): sync radar news [skip netlify]';
const DATA = [
  'public/data/radar_news_full.json',
  'public/data/iris_g8_feed.json',
  'public/data/radar_status.json',
  'public/data/radar_store.json',
  'public/data/polymarket_geo_history.json',
];

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }).trim();
}

function configure(cwd) {
  git(cwd, ['config', 'user.name', 'radarnews-g8-bot']);
  git(cwd, ['config', 'user.email', 'radarnews-g8-bot@users.noreply.github.com']);
}

function seed() {
  const dir = mkdtempSync(join(tmpdir(), 'sync-git-'));
  const origin = join(dir, 'origin.git');
  const cloneA = join(dir, 'A');
  const cloneB = join(dir, 'B');
  git(dir, ['init', '--bare', '-b', 'main', origin]);
  git(dir, ['clone', '-q', origin, cloneA]);
  configure(cloneA);
  mkdirSync(join(cloneA, 'public/data'), { recursive: true });
  for (const rel of DATA) writeFileSync(join(cloneA, rel), '{"v":0}\n');
  git(cloneA, ['add', '--', ...DATA]);
  git(cloneA, ['commit', '-q', '-m', 'seed']);
  git(cloneA, ['push', '-q', 'origin', 'HEAD:main']);
  git(dir, ['clone', '-q', origin, cloneB]);
  configure(cloneB);
  return { dir, origin, cloneA, cloneB };
}

function runCycle(script) {
  return execFileSync('bash', ['-s'], {
    input: script,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ROOT, MSG },
  });
}

const FILES = DATA.map((rel) => `'${rel}'`).join(' ');

test('el checkout es main y la puerta incluye el ciclo git', () => {
  const wf = readFileSync(new URL('../.github/workflows/update_radar_news.yml', import.meta.url), 'utf8');
  const loop = readFileSync(new URL('../scripts/sync_loop.sh', import.meta.url), 'utf8');
  const cycle = readFileSync(new URL('../scripts/sync_git_cycle.sh', import.meta.url), 'utf8');
  assert.match(wf, /uses: actions\/checkout@v4\n        with:\n          ref: main\n/);
  assert.match(wf, /test\/sync_git_cycle\.test\.js/);
  assert.match(loop, /sync_git_cycle\.sh/);
  assert.match(loop, /BUDGET_SEC:-3420/);
  assert.match(loop, /chore\(feed\): sync radar news \[skip netlify\]/);
  assert.match(loop, /public\/data\/radar_store\.json/);
  assert.match(cycle, /git fetch origin main/);
  assert.match(cycle, /git reset --hard origin\/main/);
  assert.match(cycle, /git rebase --abort/);
  assert.match(cycle, /git pull -q --rebase origin main && git push -q origin HEAD:main/);
  assert.match(cycle, /::warning::push failed in cycle/);
});

test('B parte de un commit viejo, A publica en medio, y B queda encima de A sin rebase', () => {
  const repo = seed();
  try {
    assert.doesNotMatch(git(repo.cloneB, ['remote', 'get-url', 'origin']), /github\.com|https?:/i);
    writeFileSync(join(repo.cloneA, 'public/data/radar_store.json'), '{"v":"a"}\n');
    git(repo.cloneA, ['add', '--', 'public/data/radar_store.json']);
    git(repo.cloneA, ['commit', '-q', '-m', 'a data']);
    git(repo.cloneA, ['push', '-q', 'origin', 'HEAD:main']);
    const aSha = git(repo.cloneA, ['rev-parse', 'HEAD']);
    assert.notEqual(git(repo.cloneB, ['rev-parse', 'HEAD']), aSha);

    const out = runCycle(`
      set -euo pipefail
      source "$ROOT/scripts/sync_git_cycle.sh"
      cd $B
      sync_git_begin_cycle
      printf '%s\\n' '{"v":"b"}' > public/data/radar_status.json
      sleep() { :; }
      sync_git_publish_cycle 1 "$MSG" ${FILES}
    `.replaceAll('$B', JSON.stringify(repo.cloneB)));
    assert.doesNotMatch(out, /::warning::push failed/);
    assert.equal(existsSync(join(repo.cloneB, '.git/rebase-merge')), false);
    assert.equal(existsSync(join(repo.cloneB, '.git/rebase-apply')), false);
    assert.equal(existsSync(join(repo.cloneB, '.git/MERGE_HEAD')), false);
    assert.equal(git(repo.cloneB, ['status', '--porcelain']), '');
    assert.equal(git(repo.cloneB, ['rev-parse', 'HEAD^']), aSha);
    assert.equal(git(repo.cloneB, ['rev-parse', 'HEAD']), git(repo.origin, ['rev-parse', 'main']));
    assert.equal(git(repo.cloneB, ['log', '-1', '--format=%s']), MSG);
    assert.match(readFileSync(join(repo.cloneB, 'public/data/radar_store.json'), 'utf8'), /"a"/);
    assert.match(readFileSync(join(repo.cloneB, 'public/data/radar_status.json'), 'utf8'), /"b"/);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('un conflicto forzado deja el repo limpio en origin/main', () => {
  const repo = seed();
  try {
    const out = runCycle(`
      set -euo pipefail
      source "$ROOT/scripts/sync_git_cycle.sh"
      cd $B
      sync_git_begin_cycle
      printf '%s\\n' '{"v":"b"}' > public/data/radar_store.json
      sleep() { :; }
      git() {
        if [ "$1" = "pull" ] && [ "\${INJECTED:-0}" != "1" ]; then
          INJECTED=1
          if ! (
            cd $A
            command git fetch origin main
            command git reset --hard origin/main
            printf '%s\\n' '{"v":"a"}' > public/data/radar_store.json
            command git add -- public/data/radar_store.json
            command git commit -q -m "a conflict"
            command git push -q origin HEAD:main
          ); then
            echo "inject failed" >&2
            return 1
          fi
        fi
        command git "$@"
      }
      sync_git_publish_cycle 4 "$MSG" ${FILES}
    `.replaceAll('$B', JSON.stringify(repo.cloneB)).replaceAll('$A', JSON.stringify(repo.cloneA)));
    assert.match(out, /::warning::push failed in cycle 4/);
    assert.equal(existsSync(join(repo.cloneB, '.git/rebase-merge')), false);
    assert.equal(existsSync(join(repo.cloneB, '.git/rebase-apply')), false);
    assert.equal(existsSync(join(repo.cloneB, '.git/MERGE_HEAD')), false);
    assert.equal(git(repo.cloneB, ['status', '--porcelain']), '');
    const originMain = git(repo.origin, ['rev-parse', 'main']);
    assert.equal(git(repo.cloneB, ['rev-parse', 'HEAD']), originMain);
    assert.equal(git(repo.cloneB, ['rev-parse', 'origin/main']), originMain);
    assert.equal(git(repo.cloneA, ['rev-parse', 'HEAD']), originMain);
    assert.equal(git(repo.cloneB, ['log', '-1', '--format=%s']), 'a conflict');
    assert.equal(readFileSync(join(repo.cloneB, 'public/data/radar_store.json'), 'utf8'), '{"v":"a"}\n');
    assert.doesNotMatch(git(repo.cloneB, ['log', '--format=%s', 'origin/main']), /\[skip netlify\]/);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});
