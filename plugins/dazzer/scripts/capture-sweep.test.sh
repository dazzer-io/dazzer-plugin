#!/bin/sh
# capture-sweep.test.sh - bench test for the end-of-reply backstop.
# No model, no network: feed it a situation, assert everything it did.
#
# WHY THIS SUITE LOOKS PARANOID. The version before it threw away the error channel and
# only ever looked at what the script printed. Three real defects hid behind that: the
# script could print a shell error on every reply, fire when it should have stayed quiet,
# and write a file outside its own folder - and every one of those runs came back "ok".
#
# So every case asserts FOUR things, not one:
#   1. it exits cleanly            - the fail-open promise is about status, not silence
#   2. it printed nothing to the error channel
#   3. what it printed is either nothing, or well-formed and correctly shaped
#   4. it created nothing outside the folder this plugin owns
#
# THE SHELL COMES FROM OUTSIDE. Naming it in here would mean running this suite under a
# different shell still tests the same one - and the system shell is bash-in-posix-mode on
# a Mac and dash on a Linux runner, which disagree on exactly the numeric comparison one
# of these defects lives on. Set SHELL_UNDER_TEST to choose; the suite reports which it got.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
SUBJECT="${DAZZER_SWEEP_BIN:-$HERE/capture-sweep.sh}"
SHELL_UNDER_TEST="${SHELL_UNDER_TEST:-sh}"

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

PASS=0
FAIL=0

# --- helpers -----------------------------------------------------------------

# transcript <lines> -> path to a JSONL file with that many events
transcript() {
  f="$ROOT/lines-$1.jsonl"
  if [ ! -f "$f" ]; then
    : > "$f"
    i=0
    while [ "$i" -lt "$1" ]; do
      echo '{"event":1}' >> "$f"
      i=$((i + 1))
    done
  fi
  printf '%s' "$f"
}

# Well-formed and shaped like a prompt? Prefers a real parser; falls back to a shape
# check so the suite still runs somewhere without one.
is_valid_tap() {
  if command -v node >/dev/null 2>&1; then
    printf '%s' "$1" | node -e '
      let s = "";
      process.stdin.on("data", (d) => (s += d));
      process.stdin.on("end", () => {
        try {
          const o = JSON.parse(s);
          process.exit(o && o.decision === "block" && typeof o.reason === "string" && o.reason.length > 0 ? 0 : 1);
        } catch { process.exit(1); }
      });'
    return $?
  fi
  case "$1" in *'"decision"'*'"block"'*'"reason"'*) return 0 ;; *) return 1 ;; esac
}

# case_run <id> <fire|silent> <stdin-json> [VAR=value ...]
#
# Each case gets its own state folder inside its own sandbox, so one case can never make
# another pass or fail. The sandbox doubles as a canary: anything appearing in it outside
# the state folder means the script wrote somewhere it does not own.
#
# Set GROUP to run several cases against ONE shared sandbox - needed where the point of
# the test is what carries over between replies. Set EXPECT_STATE to name the file the
# script should have written, for cases where firing is not the thing in question.
GROUP=""
EXPECT_STATE=""
case_run() {
  id="$1"
  want="$2"
  payload="$3"
  shift 3

  sandbox="$ROOT/case-${GROUP:-$id}"
  mkdir -p "$sandbox/data"

  printf '%s' "$payload" | env "$@" CLAUDE_PLUGIN_DATA="$sandbox/data" \
    "$SHELL_UNDER_TEST" "$SUBJECT" > "$ROOT/.out" 2> "$ROOT/.err"
  status=$?

  out="$(cat "$ROOT/.out")"
  err="$(cat "$ROOT/.err")"

  problems=""

  # 1. exits cleanly - a hook that exits non-zero is a hook that can trap a session
  [ "$status" -eq 0 ] || problems="$problems; exited $status, expected 0"

  # 2. said nothing on the error channel
  [ -z "$err" ] || problems="$problems; printed to the error channel: $(printf '%s' "$err" | tr '\n' ' ' | cut -c1-100)"

  # 3. printed the right thing, and printed it well-formed
  if [ "$want" = "fire" ]; then
    if [ -z "$out" ]; then
      problems="$problems; expected a prompt, got silence"
    elif ! is_valid_tap "$out"; then
      problems="$problems; printed something that is not a well-formed prompt"
    fi
  else
    [ -z "$out" ] || problems="$problems; expected silence, got $(printf '%s' "$out" | cut -c1-60)"
  fi

  # 4. wrote nothing outside the folder it owns
  stray="$(find "$sandbox" -type f ! -path "$sandbox/data/*" 2>/dev/null | head -1)"
  [ -z "$stray" ] || problems="$problems; wrote outside its own folder: ${stray#"$sandbox/"}"

  # 5. recorded against the name it was actually given, where that is the point
  if [ -n "$EXPECT_STATE" ] && [ ! -f "$sandbox/data/capture/$EXPECT_STATE" ]; then
    wrote="$(find "$sandbox/data" -type f 2>/dev/null | head -1)"
    problems="$problems; expected to record against $EXPECT_STATE, recorded ${wrote##*/}"
  fi

  if [ -z "$problems" ]; then
    PASS=$((PASS + 1))
    printf 'ok   %s\n' "$id"
  else
    FAIL=$((FAIL + 1))
    printf 'FAIL %s -%s\n' "$id" "$problems"
    printf 'FAILID capture-sweep::%s\n' "$id"
  fi
}

payload() { printf '{"session_id":"%s","transcript_path":"%s","hook_event_name":"Stop","stop_hook_active":false}' "$1" "$2"; }

BIG="$(transcript 300)"
SMALL="$(transcript 20)"
MID="$(transcript 150)"

printf 'shell under test: %s\n' "$SHELL_UNDER_TEST"
printf 'subject: %s\n\n' "$SUBJECT"

# --- the anti-loop guard -----------------------------------------------------

case_run "reentry-blocked" silent \
  "$(printf '{"session_id":"r1","transcript_path":"%s","stop_hook_active":true}' "$BIG")"

# The guard must read the flag's own value, not scan the message for a word. A folder or
# a prompt that merely contains "true" disabled saving entirely for anyone unlucky enough
# to have one.
#
# BOTH ORDERINGS ARE TESTED ON PURPOSE. Scanning the message only goes wrong when the word
# lands on one side of the flag, so a single ordering can pass while the defect is fully
# present - and nothing promises which order the fields arrive in.
case_run "reentry-word-before-flag" fire \
  "$(printf '{"session_id":"r2","transcript_path":"%s","cwd":"/Users/x/truelayer","stop_hook_active":false}' "$BIG")"

case_run "reentry-word-after-flag" fire \
  "$(printf '{"session_id":"r3","transcript_path":"%s","stop_hook_active":false,"cwd":"/Users/x/truelayer"}' "$BIG")"

case_run "reentry-word-in-prompt-after-flag" fire \
  "$(printf '{"session_id":"r4","transcript_path":"%s","stop_hook_active":false,"prompt":"is that true?"}' "$BIG")"

# The flag genuinely set must still stop the loop, whatever follows it.
case_run "reentry-blocked-with-trailing-fields" silent \
  "$(printf '{"session_id":"r5","transcript_path":"%s","stop_hook_active":true,"cwd":"/Users/x/plain"}' "$BIG")"

# --- cadence -----------------------------------------------------------------

case_run "quiet-when-little-happened" silent "$(payload c1 "$SMALL")"

GROUP="one-session-doing-steady-work"
case_run "fires-once-on-real-work" fire "$(payload c2 "$BIG")"
case_run "never-twice-for-the-same-work" silent "$(payload c2 "$BIG")"
GROUP=""

# --- shrink: a conversation that gets shorter, then grows again ---------------
# This is what a context reset looks like from here, and it is the exact moment the
# backstop exists to serve. The mark must follow the conversation down rather than
# stranding itself above it and going quiet for the rest of the session.

GROUP="one-session-across-a-reset"
case_run "shrink:fires-before-the-reset" fire "$(payload s1 "$BIG")"
case_run "shrink:quiet-right-after-the-reset" silent "$(payload s1 "$SMALL")"
case_run "shrink:fires-again-once-work-resumes" fire "$(payload s1 "$MID")"
GROUP=""

# --- setting: a mistyped knob must fall back, never misbehave ----------------

case_run "setting:nonsense-falls-back-quietly" silent "$(payload t1 "$SMALL")" DAZZER_CAPTURE_THRESHOLD=high
case_run "setting:nonsense-still-fires-on-real-work" fire "$(payload t2 "$BIG")" DAZZER_CAPTURE_THRESHOLD=high
case_run "setting:a-real-value-is-honoured" fire "$(payload t3 "$SMALL")" DAZZER_CAPTURE_THRESHOLD=10

# --- escape: a session name must never steer the write out of our folder -----

case_run "escape:parent-directory" fire \
  "$(printf '{"session_id":"../../escaped","transcript_path":"%s","stop_hook_active":false}' "$BIG")"

case_run "escape:absolute-path" fire \
  "$(printf '{"session_id":"/dazzer-escape-probe","transcript_path":"%s","stop_hook_active":false}' "$BIG")"

# --- reading the message correctly -------------------------------------------
# Firing is not the question here - which session it recorded against is. Reading the last
# match instead of the outer one means a nested field silently becomes the session, and the
# next reply measures against the wrong history.

EXPECT_STATE="outer.last"
case_run "reads-the-outer-session-not-a-nested-one" fire \
  "$(printf '{"session_id":"outer","transcript_path":"%s","tool_input":{"session_id":"inner"},"stop_hook_active":false}' "$BIG")"
EXPECT_STATE=""

# --- fail-open: none of these may print, fail, or trap anything --------------

case_run "no-input" silent ""
case_run "not-json" silent "hello, this is not json at all"
case_run "no-session-name" silent "$(printf '{"transcript_path":"%s"}' "$BIG")"
case_run "transcript-missing" silent '{"session_id":"f1","transcript_path":"/no/such/file.jsonl"}'
case_run "transcript-path-empty" silent '{"session_id":"f2","transcript_path":""}'
case_run "pretty-printed-message" fire \
  "$(printf '{\n  "session_id": "f3",\n  "transcript_path": "%s",\n  "stop_hook_active": false\n}' "$BIG")"

# --- a state folder it cannot write to must stay silent, not shout -----------
# The redirection is the shell's, so a suppressed command still lets the error through;
# the script has to notice it cannot record before it decides to prompt.

mkdir -p "$ROOT/case-cannot-record/data/capture/b1.last"
case_run "cannot-record" silent "$(payload b1 "$BIG")"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
