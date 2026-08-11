#!/bin/sh
# Reference-copy guard (PreToolUse / Write|Edit|NotebookEdit matcher).
#
# Refuses any file write whose target sits in the repository's MAIN checkout — the
# reference copy. All work belongs in a linked worktree of its own; the main checkout
# stays on the main line, clean, so every agent that arrives has one trustworthy
# starting point and two agents never collide over the same files.
#
# WHY A GUARD AND NOT A DOCUMENTED RULE. Every agent session starts with no memory of
# the last one, so a convention written in a doc is only followed by the agents that
# happened to load that doc. A refusal at the moment of the write is followed by all of
# them. The refusal carries the exact command to get a proper worktree, because a bare
# "no" makes an agent invent a workaround (editing via a shell heredoc, say) while a
# "no, do this instead" makes it self-correct and carry on.
#
# THE NESTING TRAP, which a naive check gets wrong. Some tools create their own linked
# worktrees INSIDE the main checkout (e.g. <main>/.claude/worktrees/agent-<id>). A guard
# that asks "is this path under the main checkout's root?" blocks those too, which would
# wedge every subagent. So we never compare path prefixes. We ask git, from the target's
# own directory, whether that directory's git dir IS the shared one: they are equal only
# in the main checkout, and differ (…/.git/worktrees/<name>) in every linked worktree.
# Nesting therefore resolves correctly at any depth.
#
# NO OVERRIDE. There is deliberately no environment variable or flag that lets a caller
# through. An override an agent can reach is one it will eventually reach for, which
# turns the guard back into a convention. Editing the reference copy is never the right
# move: the fix is always a worktree, and creating one takes a second.
#
# SCOPED TO THIS REPOSITORY ONLY. The "is this the main checkout" test is true of any
# standalone clone, so on its own it would refuse writes into every other repository on the
# machine — several sibling projects here, worked on routinely, each handed a remedy naming
# a helper it does not have. The guard therefore resolves the repository it is itself
# installed in and stays silent about every other one.
#
# Reads the PreToolUse payload (JSON) on stdin, emits a JSON permission decision on
# stdout. Fails OPEN (allow) on internal error so a bug here can never wedge all writes.

input=$(cat)

# The repository this guard belongs to, resolved from the guard's own location rather than
# from the caller's cwd, which may be anywhere. `$0` rather than a bash-only name, so this
# behaves the same under every shell — a guard that silently does nothing under one of them
# is worse than no guard, and the difference only shows up on another machine.
self_dir=$(cd "$(dirname "$0")" && pwd) || exit 0
own_repo=$(git -C "$self_dir" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 0
[ -n "$own_repo" ] || exit 0

target=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // ""' 2>/dev/null)

# No path in the payload (or jq unavailable) -> nothing to judge, stay out of the way.
[ -n "$target" ] || exit 0

# The file may not exist yet (a new file), and neither may its parent, so walk up to the
# nearest directory that does exist and ask git from there. `dirname` is its own fixed point
# at both "/" and ".", so that check alone terminates every case.
probe=$(dirname "$target")
while [ ! -d "$probe" ]; do
  parent=$(dirname "$probe")
  [ "$parent" = "$probe" ] && break
  probe="$parent"
done
[ -d "$probe" ] || exit 0

# Not inside a git repository at all -> not ours to police.
git_dir=$(git -C "$probe" rev-parse --path-format=absolute --git-dir 2>/dev/null) || exit 0
common_dir=$(git -C "$probe" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 0
[ -n "$git_dir" ] && [ -n "$common_dir" ] || exit 0

# A different repository entirely -> silent. Only this one is ours.
[ "$common_dir" = "$own_repo" ] || exit 0

# A linked worktree has its own git dir under the shared one -> this is a proper working
# copy, allow it. Only the main checkout has git-dir == git-common-dir.
[ "$git_dir" = "$common_dir" ] || exit 0

# Derived from the shared git directory rather than asked for as a working-tree root,
# because a write into that directory has no working tree to report — and it must be
# refused too: every linked worktree reads it, so a write there reaches every agent at once.
main_root=$(dirname "$common_dir")

# The example has to be in the exact shape the command accepts. An instruction that gets
# rejected when followed literally is worse than no instruction: the agent concludes the
# remedy is broken and goes looking for a way around the guard instead.
helper="node $main_root/scripts/git-health.mjs new feat/what-this-work-does"

reason=$(printf '%s\n' \
  "BLOCKED — that write lands in the reference copy, which is read-only." \
  "" \
  "  reference copy: $main_root" \
  "  attempted file: $target" \
  "" \
  "The reference copy stays on the main line and clean, so that every agent has one" \
  "trustworthy starting point and two agents never fight over the same files. All work" \
  "happens in a working copy of its own." \
  "" \
  "Get one, named for the work you are doing:" \
  "  $helper" \
  "" \
  "The name must be <kind>/<what-it-does> — kind is one of feat fix docs chore refactor" \
  "test perf ci build, and what-it-does is lower-case words joined by hyphens." \
  "" \
  "It places the copy correctly, puts you on a new line of work branched from the current" \
  "main line, and prints the directory to move into. Then redo this edit there." \
  "" \
  "If you are ALREADY meant to be in a working copy, you are in the wrong directory —" \
  "check with: node $main_root/scripts/git-health.mjs status")

jq -nc --arg r "$reason" \
  '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
exit 0
