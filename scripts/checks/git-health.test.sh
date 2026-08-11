#!/bin/sh
# git-health.test.sh — bench test for the guards that keep this repository clean.
# No network, no touching the real repository: every case builds a throwaway repository in a
# temp directory and asserts what the guards actually did.
#
# WHY THESE CASES AND NOT OTHERS. Each one is a way live work was really written off during
# development of these guards, found by review after the first version looked correct:
#   - work in the tool's own folder reported as disposable because of where the folder sat
#   - work made only of never-committed files, hidden by a setting, treated as nothing to save
#   - a working copy that could not be read treated the same as one with nothing in it
#   - a refusal that named a command the creator itself rejects, so an agent works around it
# A guard is only worth having if it fails loudly, so every assertion here is about the
# direction of failure: uncertainty must keep work, never discard it.
#
# Run: sh scripts/checks/git-health.test.sh

set -u

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SCRIPT="$ROOT/scripts/git-health.mjs"
GUARD="$ROOT/.claude/hooks/reference-copy-guard.sh"
SHELL_UNDER_TEST="${SHELL_UNDER_TEST:-sh}"
PASS=0
FAIL=0
FAILED=""

trap 'rm -rf "${SANDBOX:-}"' EXIT INT TERM
ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
no() { FAIL=$((FAIL + 1)); FAILED="$FAILED\n  - $1"; printf '  FAIL %s  (%s)\n' "$1" "$2"; }

assert_has() { # name haystack needle
  case "$2" in *"$3"*) ok "$1" ;; *) no "$1" "missing: $3" ;; esac
}
assert_lacks() {
  case "$2" in *"$3"*) no "$1" "should not contain: $3" ;; *) ok "$1" ;; esac
}

# Runs the thing under test and keeps BOTH channels. Throwing away the error channel is the
# habit this repository's harness rule exists to stop — it hid three real defects once, and a
# guard that prints a shell error on every turn would otherwise pass every case here.
subject() { # <cwd> <args...>
  sub_cwd=$1
  shift
  (cd "$sub_cwd" && node "$SCRIPT" "$@" >"$SANDBOX/.out" 2>"$SANDBOX/.err")
  if [ -s "$SANDBOX/.err" ]; then
    no "nothing on the error channel from: $*" "$(head -1 "$SANDBOX/.err")"
  else
    PASS=$((PASS + 1))
  fi
}

# A repository shaped like this one: a reference copy with one commit on the main line.
new_repo() {
  SANDBOX=$(mktemp -d "${TMPDIR:-/tmp}/git-health.XXXXXX")
  MAIN="$SANDBOX/repo"
  mkdir -p "$MAIN"
  git init -q -b main "$MAIN"
  git -C "$MAIN" config user.email t@t.t
  git -C "$MAIN" config user.name t
  echo x > "$MAIN/kept.txt"
  # The sandbox carries its OWN copy of the guard and the creator it points at. The guard
  # polices only the repository it is installed in, so pointing this repository's copy at a
  # sandbox would correctly refuse to judge it — and prove nothing.
  mkdir -p "$MAIN/.claude/hooks" "$MAIN/scripts"
  cp "$GUARD" "$MAIN/.claude/hooks/"
  cp "$SCRIPT" "$MAIN/scripts/"
  git -C "$MAIN" add -A
  git -C "$MAIN" commit -q -m root
  SANDBOX_GUARD="$MAIN/.claude/hooks/reference-copy-guard.sh"
}

# -> deny | allow | broken. "broken" matters: a guard that crashed prints nothing, which is
# indistinguishable from a deliberate allow unless the error channel is read. Three cases here
# went green against a dead guard before this told them apart.
decision() {
  : > "$SANDBOX/.guard-err"
  out=$(printf '{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"%s"}}' "$1" \
    | "$SHELL_UNDER_TEST" "$SANDBOX_GUARD" 2>"$SANDBOX/.guard-err")
  [ -s "$SANDBOX/.guard-err" ] && { echo broken; return; }
  [ -z "$out" ] && { echo allow; return; }
  case "$out" in *'"deny"'*) echo deny ;; *) echo allow ;; esac
}

echo "the main checkout is read-only"

new_repo
[ "$(decision "$MAIN/kept.txt")" = deny ] && ok "refuses a write into the reference copy" \
  || no "refuses a write into the reference copy" "allowed"
[ "$(decision "$MAIN/a/b/new.ts")" = deny ] && ok "refuses a new file whose folders do not exist" \
  || no "refuses a new file whose folders do not exist" "allowed"

git -C "$MAIN" worktree add -q -b work/beside "$SANDBOX/beside" >/dev/null 2>&1
[ "$(decision "$SANDBOX/beside/kept.txt")" = allow ] && ok "allows a working copy beside it" \
  || no "allows a working copy beside it" "refused"

# Some tools put their copies INSIDE the checkout. A guard comparing path prefixes refuses
# these and wedges every helper the tool starts.
git -C "$MAIN" worktree add -q -b work/nested "$MAIN/.claude/worktrees/agent-1" >/dev/null 2>&1
[ "$(decision "$MAIN/.claude/worktrees/agent-1/kept.txt")" = allow ] \
  && ok "allows a working copy nested inside the reference copy" \
  || no "allows a working copy nested inside the reference copy" "refused"

# Being a main checkout is true of every clone on the machine; only this one is ours.
git init -q -b main "$SANDBOX/someone-else"
echo x > "$SANDBOX/someone-else/theirs.ts"
[ "$(decision "$SANDBOX/someone-else/theirs.ts")" = allow ] \
  && ok "leaves every other repository alone" || no "leaves every other repository alone" "refused"

# The refusal has to name a remedy the creator accepts, or the agent concludes it is broken
# and goes looking for a way around the guard.
REASON=$(printf '{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"%s"}}' \
  "$MAIN/kept.txt" | "$SHELL_UNDER_TEST" "$SANDBOX_GUARD" 2>"$SANDBOX/.err")
[ -s "$SANDBOX/.err" ] && no "the guard refuses without complaining" "$(head -1 "$SANDBOX/.err")" \
  || ok "the guard refuses without complaining"
assert_has "the refusal says how to get a working copy" "$REASON" "git-health.mjs new "
SUGGESTED=$(printf '%s' "$REASON" | sed -n 's/.*git-health\.mjs new \([^ \\"]*\).*/\1/p' | head -1)
if [ -n "$SUGGESTED" ] && (cd "$MAIN" && node "$MAIN/scripts/git-health.mjs" new "$SUGGESTED" \
  >"$SANDBOX/.out" 2>"$SANDBOX/.err") && [ ! -s "$SANDBOX/.err" ]; then
  ok "the name it suggests is one the creator accepts"
else
  no "the name it suggests is one the creator accepts" "creator rejected: $SUGGESTED"
fi
rm -rf "$SANDBOX"

echo ""
echo "open work is never written off"

new_repo
subject "$MAIN" new fix/work-in-progress
COPY="$SANDBOX/repo-worktrees/work-in-progress"
# A setting can hide files that have never been committed — the only content that exists in
# exactly one place.
git -C "$COPY" config status.showUntrackedFiles no
echo "the only copy of this" > "$COPY/exists-nowhere-else.txt"
[ -z "$(git -C "$COPY" status --porcelain)" ] && ok "the hazard is real: the ordinary check sees nothing" \
  || no "the hazard is real: the ordinary check sees nothing" "it was visible, so the case proves nothing"
subject "$COPY" save
SAVED=$(git -C "$MAIN" for-each-ref --format='%(refname)' refs/saved | head -1)
if [ -n "$SAVED" ]; then
  assert_has "saves work a setting would hide" \
    "$(git -C "$MAIN" show --name-only --format= "$SAVED")" "exists-nowhere-else.txt"
else
  no "saves work a setting would hide" "nothing was saved"
fi
rm -rf "$SANDBOX"

new_repo
subject "$MAIN" new fix/after-a-crash
COPY="$SANDBOX/repo-worktrees/after-a-crash"
echo "the only copy of this" > "$COPY/survives-a-crash.txt"
# A crash mid-write can leave the copy's own record of staged files unreadable. That is when
# open work matters most, and the snapshot does not need that record — it builds its own.
echo "not a real index" > "$(git -C "$COPY" rev-parse --path-format=absolute --git-dir)/index"
subject "$COPY" save
SAVED=$(git -C "$MAIN" for-each-ref --format='%(refname)' refs/saved | head -1)
if [ -n "$SAVED" ]; then
  assert_has "saves work when the copy cannot be read" \
    "$(git -C "$MAIN" show --name-only --format= "$SAVED")" "survives-a-crash.txt"
else
  no "saves work when the copy cannot be read" "nothing was saved"
fi
rm -rf "$SANDBOX"

echo ""
echo "the report tells the truth"

new_repo
subject "$MAIN" new feat/being-built
git -C "$MAIN" worktree add -q -b work/nested-real "$MAIN/.claude/worktrees/agent-2" >/dev/null 2>&1
echo "real work" > "$MAIN/.claude/worktrees/agent-2/real.txt"
git -C "$MAIN/.claude/worktrees/agent-2" add -A
git -C "$MAIN/.claude/worktrees/agent-2" commit -q -m "work in a nested copy"
subject "$MAIN" status
OUT=$(cat "$SANDBOX/.out")
# Judged by what it holds, not where the folder sits: calling live work disposable is the
# failure that makes the whole report untrustworthy.
# Asserted against the part of the report BEFORE the disposable section, so it cannot pass
# merely by the name appearing somewhere.
assert_has "counts work in a nested copy as work" "${OUT%%ASSISTANT*}" "work/nested-real"
rm -rf "$SANDBOX"

new_repo
# Retiring is the one destructive step, and it runs unattended. It must refuse on any doubt.
WHEN=$(date -u -v-30d '+%Y-%m-%dT%H:%M:%S' 2>/dev/null || date -u -d '30 days ago' '+%Y-%m-%dT%H:%M:%S')
git -C "$MAIN" checkout -q -b feat/nobody-remembers
echo old > "$MAIN/old.txt"
git -C "$MAIN" add -A
GIT_COMMITTER_DATE="$WHEN" GIT_AUTHOR_DATE="$WHEN" git -C "$MAIN" commit -q -m "old work"
git -C "$MAIN" checkout -q main
# Work from a minute ago, and work someone is sitting in. Neither may be touched.
git -C "$MAIN" checkout -q -b feat/still-being-worked-on
echo new > "$MAIN/new.txt"
git -C "$MAIN" add -A
git -C "$MAIN" commit -q -m "work from a minute ago"
git -C "$MAIN" checkout -q main
git -C "$MAIN" checkout -q -b feat/someone-is-in-this
git -C "$MAIN" checkout -q main
GIT_COMMITTER_DATE="$WHEN" GIT_AUTHOR_DATE="$WHEN" git -C "$MAIN" branch -f feat/someone-is-in-this feat/nobody-remembers
git -C "$MAIN" worktree add -q "$SANDBOX/occupied" feat/someone-is-in-this >/dev/null 2>&1

# Reporting must destroy nothing: the one destructive step is separate and explicit.
subject "$MAIN" sweep
[ -n "$(git -C "$MAIN" branch --list feat/nobody-remembers)" ] && ok "reporting alone deletes nothing" \
  || no "reporting alone deletes nothing" "it was deleted without being asked"

subject "$MAIN" sweep --apply
[ -z "$(git -C "$MAIN" branch --list feat/nobody-remembers)" ] && ok "retires work nobody has touched" \
  || no "retires work nobody has touched" "still there"
[ -n "$(git -C "$MAIN" tag --list 'archive/*')" ] && ok "and keeps it, so it comes back" \
  || no "and keeps it, so it comes back" "nothing archived"
[ -n "$(git -C "$MAIN" branch --list feat/still-being-worked-on)" ] && ok "leaves recent work alone" \
  || no "leaves recent work alone" "it retired work from a minute ago"
[ -n "$(git -C "$MAIN" branch --list feat/someone-is-in-this)" ] && ok "leaves work someone is sitting in" \
  || no "leaves work someone is sitting in" "it retired an occupied line of work"
[ -n "$(git -C "$MAIN" branch --list main)" ] && ok "never retires the main line" \
  || no "never retires the main line" "the main line was retired"
rm -rf "$SANDBOX"

echo ""
if [ "$FAIL" -eq 0 ]; then
  printf 'PASS  %d checks\n' "$PASS"
  exit 0
fi
printf 'FAIL  %d of %d checks failed:' "$FAIL" "$((PASS + FAIL))"
printf '%b\n' "$FAILED"
exit 1
