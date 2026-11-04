#!/bin/sh
# own-place.sh - tells the model which saved place is this chat's own.
#
# WHY IT EXISTS. A checkpoint with no thread lands in one slot that every chat shares, so the
# next chat to save overwrites it and a restore can bring back another chat's work. A resume
# with no thread hands back a list of every saved place once there is more than one, and the
# Brain held about 150. Measured over a week of chats on one machine, 10 resets got the list
# and none of the 45 that restored could be sure the place was their own.
#
# WHAT IT SAYS. One fact: the label this chat's place is kept under. The host hands every
# trigger the same id for a chat, and it stays the same through a reset - checked across every
# chat that had one - so it is a label both ends can know without anything being stored here.
# The saving reminder names the same label, read from the same field.
#
# WHAT IT DOES NOT SAY. The fixed sentences beside it are spoken word for word, because
# onboarding looks for exactly those words; this line is added next to them rather than
# woven in, so they never change. It holds no rule: how and when to save is served live.
#
# FAIL-OPEN. No id, no line. The sentences beside it still say what they always said, so the
# worst case is the behaviour from before this file existed.
set +eu

INPUT="$(head -c 100000 2>/dev/null)"
[ -z "$INPUT" ] && exit 0

# The first value for this key, by name, honouring backslash escapes - the same reading the
# saving reminder does, so a nested field can never become the chat's id.
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

SESSION="$(read_string session_id)"
[ -z "$SESSION" ] && SESSION="$(read_string conversationId)"

# Flattened exactly as the saving reminder flattens it, so both name the same thread. Nothing
# that could close the quoting survives, and the "@" the Brain reserves cannot open it.
THREAD="$(printf '%s' "$SESSION" | tr -c 'A-Za-z0-9._-' '_' | cut -c1-64)"
[ -z "$THREAD" ] && exit 0

printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"[Dazzer] This chat keeps its own place under thread \\"%s\\": pass that thread to every checkpoint, and to resume after a reset."}}' "$THREAD"
exit 0
