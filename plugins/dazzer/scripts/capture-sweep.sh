#!/bin/sh
# capture-sweep.sh - the backstop that keeps settled knowledge reaching the Brain.
#
# WHAT IT DOES NOT DO. It never decides what is worth saving and it never calls Dazzer.
# It cannot: a hook has no credentials and no reliable moment at which the connection is up.
# Its only job is to TAP the model at the end of a reply. The model then acts through the
# connection it already owns, reading the current rules from the Brain at the moment it acts.
# That is why this file is near-static: change the rules in the Brain, not here.
#
# TWO GUARDS, both mechanical, neither a judgment about knowledge:
#   1. Never fire inside its own continuation, or it loops forever.
#   2. Never fire twice for the same work (a per-session mark on transcript growth).
# Without both, every user gets duplicate writes and doubled cost on their own machine.
#
# FAIL-OPEN BY CONSTRUCTION, AND THIS TIME IT IS TRUE. The decision starts at "stay quiet"
# and only a comparison that actually succeeded can turn it on. The previous version made
# the tap the fall-through branch, so a mistyped setting produced the exact opposite of the
# promise: it fired on every single reply and printed a shell error each time.
#
# EVERYTHING FROM THE HOST IS UNTRUSTED INPUT. Fields are read by name and by value, never
# by scanning the message for a word - a folder or a prompt containing "true" used to
# silence saving for a whole session. Anything that becomes a filename is flattened first,
# because a session name containing "../" used to write outside the folder we own.
#
# Tuning lives in config/capture.defaults, documented in the README. Environment wins.
set +eu

# --- settings ----------------------------------------------------------------

HERE="${CLAUDE_PLUGIN_ROOT:-$(dirname "$0")/..}"
DEFAULTS="$HERE/config/capture.defaults"

# Read a packaged default. The file is parsed, never executed - it is data, not code.
default_for() { sed -n "s/^$1=//p" "$DEFAULTS" 2>/dev/null | head -1; }

# A whole number, or the fallback. This is what makes the fail-open promise true: a
# malformed value can never reach a numeric comparison.
whole_number() {
  case "$1" in
    '' | *[!0-9]*) printf '%s' "$2" ;;
    *) printf '%s' "$1" ;;
  esac
}

# Environment first, then the packaged default, then a last resort in case the packaged
# file is missing or unreadable on this machine. Read explicitly rather than by name, so
# every setting is greppable and nothing is resolved at run time.
setting() { # supplied, packaged, last-resort
  whole_number "$1" "$(whole_number "$2" "$3")"
}

THRESHOLD="$(setting "${DAZZER_CAPTURE_THRESHOLD:-}" "$(default_for DAZZER_CAPTURE_THRESHOLD)" 80)"
MAX_INPUT_BYTES="$(setting "${DAZZER_CAPTURE_MAX_INPUT_BYTES:-}" "$(default_for DAZZER_CAPTURE_MAX_INPUT_BYTES)" 100000)"
STATE_TTL_DAYS="$(setting "${DAZZER_CAPTURE_STATE_TTL_DAYS:-}" "$(default_for DAZZER_CAPTURE_STATE_TTL_DAYS)" 30)"
RECEIPTS_MAX_BYTES="$(setting "${DAZZER_CAPTURE_RECEIPTS_MAX_BYTES:-}" "$(default_for DAZZER_CAPTURE_RECEIPTS_MAX_BYTES)" 262144)"

STATE_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.dazzer}/capture"
RECEIPTS="$STATE_DIR/receipts.jsonl"

# Which tool are we running inside? The same plugin installs in more than one, and two
# things depend on the answer: the record of what happened is worthless if it names the
# wrong tool, and - more importantly - the word for "keep going" is not the same everywhere.
#
# Anthropic's tool and OpenAI's both hand us a folder variable; Google's hands us nothing,
# so being run without one and finding ourselves under its plugins folder is the tell.
# DAZZER_TOOL overrides, for anywhere those guesses are wrong.
# ORDER MATTERS HERE. Several tools set the same folder variables as each other for
# compatibility - Microsoft's sets all three of them - so the only reliable tell is each
# tool's OWN variable, checked before the shared ones. Reordering these silently
# mislabels whole tools.
if [ -n "${DAZZER_TOOL:-}" ]; then
  TOOL="$DAZZER_TOOL"
elif [ -n "${COPILOT_PLUGIN_ROOT:-}" ]; then
  TOOL="copilot"
elif [ -n "${CURSOR_PLUGIN_ROOT:-}" ]; then
  TOOL="cursor"
elif [ -n "${PLUGIN_ROOT:-}" ]; then
  TOOL="codex"
elif [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
  TOOL="claude-code"
else
  case "$HERE" in
    *"/.gemini/"*) TOOL="antigravity" ;;
    *) TOOL="claude-code" ;;
  esac
fi
VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$HERE/.claude-plugin/plugin.json" 2>/dev/null | head -1)"

# --- reading the message -------------------------------------------------------
#
# By name and by value. awk is used rather than a pattern over the whole message because a
# pattern takes the LAST match, so a nested field quietly became the session id.

INPUT="$(cat 2>/dev/null | head -c "$MAX_INPUT_BYTES")"
[ -z "$INPUT" ] && exit 0

# The first value for this key, honouring backslash escapes.
read_string() {
  printf '%s' "$INPUT" | awk -v key="\"$1\"" '
    {
      i = index($0, key)
      if (i == 0) next
      rest = substr($0, i + length(key))
      sub(/^[ \t]*:[ \t]*/, "", rest)
      if (substr(rest, 1, 1) != "\"") next
      rest = substr(rest, 2)
      out = ""
      n = length(rest)
      for (p = 1; p <= n; p++) {
        c = substr(rest, p, 1)
        if (c == "\\") { p++; out = out substr(rest, p, 1); continue }
        if (c == "\"") { print out; exit }
        out = out c
      }
    }' 2>/dev/null
}

# The flag's own value - never a search for the word anywhere in the message.
read_flag() {
  printf '%s' "$INPUT" | awk -v key="\"$1\"" '
    {
      i = index($0, key)
      if (i == 0) next
      rest = substr($0, i + length(key))
      sub(/^[ \t]*:[ \t]*/, "", rest)
      if (rest ~ /^true/) { print "true"; exit }
      if (rest ~ /^false/) { print "false"; exit }
    }' 2>/dev/null
}

# --- keeping writes where they belong -----------------------------------------

# Flattens anything that came from the message into a plain filename. A separator or a
# parent-directory step cannot survive this, so the write cannot leave our folder.
fence_name() {
  printf '%s' "$1" | tr -c 'A-Za-z0-9._-' '_' | cut -c1-64
}

# A transcript we are willing to read: an existing regular file, named absolutely.
fence_path() {
  case "$1" in
    /*) [ -f "$1" ] && printf '%s' "$1" ;;
    *) : ;;
  esac
}

# --- proof that this ran -------------------------------------------------------
#
# Content-free by construction: timing, outcome and version only, never conversation.
# A version of this that was wired up but never actually invoked sat silently dead for two
# weeks on a real machine, and nothing reported it. A line here is the only way an install
# that never fires can say so.
receipt() { # status, reason
  [ -d "$STATE_DIR" ] || return 0
  if [ -f "$RECEIPTS" ]; then
    size="$(wc -c < "$RECEIPTS" 2>/dev/null | tr -d ' ')"
    size="$(whole_number "$size" 0)"
    [ "$size" -gt "$RECEIPTS_MAX_BYTES" ] && mv -f "$RECEIPTS" "$RECEIPTS.1" 2>/dev/null
  fi
  printf '{"at":"%s","mechanism":"capture","tool":"%s","version":"%s","status":"%s","reason":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)" "$TOOL" "$VERSION" "$1" "$2" >> "$RECEIPTS" 2>/dev/null
  return 0
}

# --- guard 1: never fire inside our own continuation --------------------------

[ "$(read_flag stop_hook_active)" = "true" ] && exit 0

SESSION="$(read_string session_id)"
[ -z "$SESSION" ] && exit 0

TRANSCRIPT="$(fence_path "$(read_string transcript_path)")"
[ -z "$TRANSCRIPT" ] && exit 0

CURRENT="$(whole_number "$(wc -l < "$TRANSCRIPT" 2>/dev/null | tr -d ' ')" '')"
[ -z "$CURRENT" ] && exit 0

mkdir -p "$STATE_DIR" 2>/dev/null || exit 0
MARK="$STATE_DIR/$(fence_name "$SESSION").last"

LAST=0
if [ -f "$MARK" ]; then
  LAST="$(whole_number "$(tr -cd '0-9' < "$MARK" 2>/dev/null)" 0)"
fi

# A conversation that got SHORTER is a context reset: the same session, a fresh history.
# Carrying the old mark forward stranded it above the new length and went quiet for the
# rest of the session - at the exact moment this backstop exists to serve.
[ "$CURRENT" -lt "$LAST" ] && LAST=0

# --- guard 2: only fire when enough new work has accumulated -------------------
#
# The decision starts closed. Nothing below can fall through into a tap.

FIRE=0
[ "$((CURRENT - LAST))" -ge "$THRESHOLD" ] && FIRE=1

if [ "$FIRE" -eq 0 ]; then
  receipt quiet "below-threshold"
  exit 0
fi

# Record BEFORE prompting, so the reply this prompt produces cannot re-fire. If we cannot
# record, stay quiet: prompting without a record means prompting again on every reply.
# The check comes first because a failing redirect is the shell's own, and no redirection
# on our part can silence it.
TMP="$MARK.$$"
if ! ( : > "$TMP" ) 2>/dev/null; then
  receipt quiet "cannot-record"
  exit 0
fi
printf '%s' "$CURRENT" > "$TMP" 2>/dev/null
mv -f "$TMP" "$MARK" 2>/dev/null

# Prove the record actually landed before prompting. A move can "succeed" without doing
# what we meant - moving a file at a name already taken by a folder puts it INSIDE the
# folder - so a zero status is not evidence. Read it back or stay quiet.
if [ ! -f "$MARK" ] || [ "$(cat "$MARK" 2>/dev/null)" != "$CURRENT" ]; then
  rm -f "$TMP" 2>/dev/null
  receipt quiet "cannot-record"
  exit 0
fi

# Old marks from sessions long finished. Ours only, never a recursive delete.
find "$STATE_DIR" -maxdepth 1 -name '*.last' -mtime "+$STATE_TTL_DAYS" -exec rm -f {} + 2>/dev/null

receipt fired "threshold-reached"

# The tap. The message is one file shared by every tool; only the envelope around it
# differs, and each tool's envelope is genuinely its own:
#
#   Anthropic's and OpenAI's  say "block"    to mean "act on this before you stop"
#   Google's                  says "continue" for the same thing, and reads any other
#                             word as permission to stop - so the wrong one is silence
#   Cursor                    has no such word at all. It takes a message and submits it
#                             as the next thing the person said, which is why theirs is a
#                             different field rather than a different value.
MESSAGE="$(tr -d '\n' < "$HERE/prompts/capture-tap.txt" 2>/dev/null)"
[ -z "$MESSAGE" ] && exit 0

case "$TOOL" in
  cursor) printf '{"followup_message":"%s"}' "$MESSAGE" ;;
  antigravity) printf '{"decision":"continue","reason":"%s"}' "$MESSAGE" ;;
  *) printf '{"decision":"block","reason":"%s"}' "$MESSAGE" ;;
esac
exit 0
