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
#   1. Never fire inside its own continuation (stop_hook_active), or it loops forever.
#   2. Never fire twice for the same work (a per-session watermark on transcript growth).
# Without both, every user gets duplicate writes and doubled cost on their own machine.
#
# FAIL-OPEN BY CONSTRUCTION: any missing field, parse failure or unreadable transcript exits 0
# with no output. A bug here can only fail to prompt a sweep. It can never trap a session.
#
# Tune cadence with DAZZER_CAPTURE_THRESHOLD (transcript lines of growth between sweeps).
set +eu

THRESHOLD="${DAZZER_CAPTURE_THRESHOLD:-80}"
STATE_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.dazzer}/capture"

INPUT="$(cat 2>/dev/null | head -c 100000)"
[ -z "$INPUT" ] && exit 0

# Guard 1: already inside a sweep continuation - let the session stop.
case "$INPUT" in
  *'"stop_hook_active"'*true*) exit 0 ;;
esac

read_field() {
  printf '%s' "$INPUT" | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -1
}

SID="$(read_field session_id)"
TRANSCRIPT="$(read_field transcript_path)"
[ -z "$SID" ] && exit 0
[ -f "$TRANSCRIPT" ] || exit 0

CURRENT="$(wc -l < "$TRANSCRIPT" 2>/dev/null | tr -d ' ')"
case "$CURRENT" in ''|*[!0-9]*) exit 0 ;; esac

mkdir -p "$STATE_DIR" 2>/dev/null || exit 0
MARK="$STATE_DIR/$SID.last"
LAST=0
if [ -f "$MARK" ]; then
  LAST="$(tr -cd '0-9' < "$MARK" 2>/dev/null)"
  [ -z "$LAST" ] && LAST=0
fi

# Guard 2: not enough new material since the last sweep - stay silent.
[ "$((CURRENT - LAST))" -lt "$THRESHOLD" ] && exit 0

# Advance the watermark BEFORE prompting, so the post-sweep Stop sees no growth and cannot re-fire.
printf '%s' "$CURRENT" > "$MARK" 2>/dev/null

# The tap. Deliberately points at the rules rather than restating them.
printf '%s' '{"decision":"block","reason":"Dazzer capture checkpoint. Silently review this conversation since your last capture and apply the Brain rule for what is worth saving: record ONLY what actually SETTLED - a decision, a fact, a correction, a preference. If something was merely floated or explored, or you are not certain it settled, SKIP it. For each item that qualifies, remember it in plain words with a source quote from the conversation, and pass replaces when it updates an earlier answer instead of duplicating it. If a save comes back asking you a question, answer it by calling remember again with the blanks filled. If the Brain served you well and you relied on a specific record, confirm it. If nothing settled, do nothing and say nothing. Never save speculation or thinking out loud, and do not narrate this checkpoint to the user. Then stop."}'
exit 0
