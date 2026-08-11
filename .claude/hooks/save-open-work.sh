#!/usr/bin/env bash
# Save open work (Stop hook).
#
# At the end of every agent turn, snapshots whatever is unsaved in the working copy the
# agent is sitting in, so a crash, a context reset, or an abandoned session costs minutes
# instead of an afternoon's work.
#
# WHY THE END OF A TURN AND NOT A TIMER. A timer has to guess when an agent is mid-write
# and can catch a file half-written. The end of a turn is the one moment the agent has
# definitively stopped, so what is on disk is coherent. It is also the only periodic
# moment a shell hook actually gets.
#
# WHY A SNAPSHOT AND NOT A COMMIT. Committing under an agent puts entries in a history it
# is composing, fights whatever rules the project has about commit messages, and changes
# what the agent sees when it looks at its own work. A snapshot is an object attached to
# no line of work: nothing the agent can see changes, nothing needs cleaning up later, and
# the work is still recoverable in full.
#
# The reference copy is skipped deliberately — nothing should ever be unsaved there, and
# snapshotting it would quietly make that failure survivable instead of visible.
#
# Never blocks and never fails the turn: exits 0 whatever happens.

input=$(cat)

cwd=$(printf '%s' "$input" | jq -r '.cwd // ""' 2>/dev/null)
[ -n "$cwd" ] || cwd=$(pwd)
[ -d "$cwd" ] || exit 0

# Resolve the script from the shared git directory, so this works from any working copy
# regardless of which one the agent happens to be in.
common=$(git -C "$cwd" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 0
[ -n "$common" ] || exit 0
script="$(dirname "$common")/scripts/git-health.mjs"
[ -f "$script" ] || exit 0

(cd "$cwd" && node "$script" save >/dev/null 2>&1)

# Retire forgotten work at most once a day. Doing it here rather than on a schedule keeps
# the guarantee true on a laptop that is often asleep: it runs because work is happening,
# not because a clock fired while the machine was shut. Nothing is destroyed — each
# retired line of work is kept and stays restorable.
# The stamp is written FIRST and the sweep only runs if that write succeeded. Written the
# other way round — or with the error swallowed — an unwritable stamp means the destructive
# pass runs on every single turn instead of once a day, with a network call each time.
stamp="$common/last-retirement-sweep"
today=$(date +%Y-%m-%d)
if [ "$(cat "$stamp" 2>/dev/null)" != "$today" ]; then
  if { printf '%s' "$today" > "$stamp"; } 2>/dev/null; then
    (cd "$cwd" && node "$script" sweep --apply >/dev/null 2>&1)
  fi
fi

exit 0
