#!/bin/sh
# Bench test for capture-sweep.sh. No model, no network - feed it a situation, assert what it prints.
# The cases that matter are the two that keep a user's machine safe: it must not re-enter its own
# continuation, and it must not fire twice for the same work.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
SWEEP="$HERE/capture-sweep.sh"
TMP="$(mktemp -d)"
export CLAUDE_PLUGIN_DATA="$TMP/data"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0

fires() {  # name, stdin-json
  out="$(printf '%s' "$2" | sh "$SWEEP" 2>/dev/null)"
  case "$out" in
    *'"decision":"block"'*) PASS=$((PASS+1)); printf 'ok   %s\n' "$1" ;;
    *) FAIL=$((FAIL+1)); printf 'FAIL %s - expected a tap, got: %s\n' "$1" "$out" ;;
  esac
}

silent() {  # name, stdin-json
  out="$(printf '%s' "$2" | sh "$SWEEP" 2>/dev/null)"
  if [ -z "$out" ]; then
    PASS=$((PASS+1)); printf 'ok   %s\n' "$1"
  else
    FAIL=$((FAIL+1)); printf 'FAIL %s - expected silence, got: %s\n' "$1" "$out"
  fi
}

transcript() {  # lines -> path
  f="$TMP/t$1.jsonl"
  : > "$f"
  i=0
  while [ "$i" -lt "$1" ]; do echo '{"line":1}' >> "$f"; i=$((i+1)); done
  printf '%s' "$f"
}

BIG="$(transcript 200)"
SMALL="$(transcript 10)"

payload() { printf '{"session_id":"%s","transcript_path":"%s","hook_event_name":"Stop"}' "$1" "$2"; }

# --- the two guards, which are the whole point ---
silent "own continuation is never re-entered" \
  "$(printf '{"session_id":"s1","transcript_path":"%s","stop_hook_active":true}' "$BIG")"

fires  "real accumulated work taps once" "$(payload s-once "$BIG")"
silent "the same work never taps twice"  "$(payload s-once "$BIG")"

# --- cadence ---
silent "a short exchange stays quiet" "$(payload s-small "$SMALL")"

# --- fail-open: every one of these must exit clean and silent ---
silent "empty input"            ""
silent "not json at all"        "hello, this is not json"
silent "no session id"          "$(printf '{"transcript_path":"%s"}' "$BIG")"
silent "transcript missing"     '{"session_id":"s2","transcript_path":"/no/such/file.jsonl"}'
silent "transcript path empty"  '{"session_id":"s3","transcript_path":""}'

# --- the watermark advances rather than resetting ---
MORE="$(transcript 400)"
fires "further work after a tap taps again" "$(payload s-once "$MORE")"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
