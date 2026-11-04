#!/bin/sh
# own-place.test.sh - bench test for the line naming a chat's own saved place.
# No model, no network: feed it what a host sends, assert everything it did.
#
# Every case asserts the same things the saving reminder's suite does: it exits cleanly, it
# printed nothing to the error channel, and what it printed is nothing or exactly the line.
# The shell comes from outside (SHELL_UNDER_TEST), for the same reason as there.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
SUBJECT="${DAZZER_OWN_PLACE_BIN:-$HERE/own-place.sh}"
SHELL_UNDER_TEST="${SHELL_UNDER_TEST:-sh}"

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

PASS=0
FAIL=0

# case_run <id> <expected-thread|-> <stdin-json>
# "-" means it must stay silent.
case_run() {
  id="$1"
  want="$2"
  printf '%s' "$3" | "$SHELL_UNDER_TEST" "$SUBJECT" > "$ROOT/.out" 2> "$ROOT/.err"
  status=$?
  out="$(cat "$ROOT/.out")"
  err="$(cat "$ROOT/.err")"
  problems=""

  [ "$status" -eq 0 ] || problems="$problems; exited $status, expected 0"
  [ -z "$err" ] || problems="$problems; printed to the error channel: $(printf '%s' "$err" | tr '\n' ' ' | cut -c1-100)"

  if [ "$want" = "-" ]; then
    [ -z "$out" ] || problems="$problems; expected silence, got $(printf '%s' "$out" | cut -c1-60)"
  else
    # Parsed, so a quote that escaped the flattening shows up as broken JSON, not a pass.
    said="$(printf '%s' "$out" | node -e '
      let s = "";
      process.stdin.on("data", (d) => (s += d));
      process.stdin.on("end", () => {
        try {
          const o = JSON.parse(s).hookSpecificOutput;
          if (o.hookEventName !== "SessionStart") process.exit(1);
          process.stdout.write(o.additionalContext);
        } catch { process.exit(1); }
      });' 2>/dev/null)" || problems="$problems; printed something that is not a well-formed start-of-chat line"
    case "$said" in
      "[Dazzer] "*"thread \"$want\""*"checkpoint"*"resume"*) : ;;
      *) problems="$problems; does not name thread $want for both checkpoint and resume: $(printf '%s' "$said" | cut -c1-120)" ;;
    esac
  fi

  if [ -z "$problems" ]; then
    PASS=$((PASS + 1))
    printf 'ok   %s\n' "$id"
  else
    FAIL=$((FAIL + 1))
    printf 'FAIL %s%s\n' "$id" "$problems"
  fi
}

printf 'shell under test: %s\n' "$SHELL_UNDER_TEST"

# --- the label is the chat's own id ------------------------------------------

ID="3f2b8c1e-9a4d-4b7e-8c21-5d6e7f8a9b0c"
case_run "start-names-the-chat" "$ID" "$(printf '{"session_id":"%s","source":"startup","hook_event_name":"SessionStart"}' "$ID")"
case_run "reset-names-the-same-chat" "$ID" "$(printf '{"session_id":"%s","source":"compact","hook_event_name":"SessionStart"}' "$ID")"
case_run "pretty-printed" "$ID" "$(printf '{\n  "session_id": "%s",\n  "source": "compact"\n}' "$ID")"
case_run "camel-case-spelling" "conv-1" '{"conversationId":"conv-1"}'

# A nested field must never become the chat's id: the reset would look for another place.
case_run "reads-the-outer-id-not-a-nested-one" "outer" '{"session_id":"outer","tool_input":{"session_id":"inner"}}'

# --- nothing from the host can break the line --------------------------------
# An id that could close the quoting would let the host's words become ours; one opening
# with "@" names a slot the Brain reserves and refuses to save under.

case_run "a-quote-cannot-escape" 'a___b' '{"session_id":"a\"}\"b"}'
case_run "a-reserved-opening-is-flattened" "_main" '{"session_id":"@main"}'

# --- fail-open: no id, no line -----------------------------------------------

case_run "no-input" "-" ""
case_run "not-json" "-" "hello, this is not json at all"
case_run "no-id" "-" '{"source":"startup"}'
case_run "empty-id" "-" '{"session_id":""}'

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
