---
type: kernel
tier: 0
audience: both
tags: [conventions, plugin, constraints]
---

<!-- @purpose: Canonical orientation for any agent editing this repository; carries the two constraints that exist because something broke in the field, each naming the check that enforces it. -->

# Dazzer plugin

## Purpose

What people install so their AI actually uses their Dazzer memory. It adds three nudges:
check the memory before answering, save what settled once enough has accumulated, and get
re-oriented after a context reset.

**The behaviour plugin never talks to Dazzer.** It has no credentials and no reliable moment
at which a connection is up. All it does is tap the model at the right instant; the model then
acts through the connection it already owns and reads the current rules from the Brain at the
moment it acts. That is why the shipped script is near-static: **change the rules in the
Brain, not here.**

**The plate pane is the one piece that reads from Dazzer**, and it is its own plugin
(`plugins/dazzer-plate`, Claude Code only, optional). Only once the person asks (`/plate`, or the
pane's Refresh), it calls the board's `recall` for the plate view through the connection the
person's Claude Code already has (`$.mcp.call`, the engine's own connection and credentials). It
also re-reads after the AI's own track, except in a session where its own read was refused. It
holds no credentials and no connection of its own, finds the board among the tools already
connected rather than by a name written into it (only a server offering both `recall` and `track`
is ever asked), and never writes: a card's Done ("Mark item <n> done.") and Talk about it ("Tell
me about item <n>.") are sentences carrying the item's number alone, to the person's AI, which does
the writing. Opening a later group reads that group (`recall` with `part`) from the board the plate
came from. Tags come from each row's own fields, never from `plain`; an answer without `part`,
`moved`, `about` or `later_groups` still draws, with later as a count. It keeps the last plate, and
each later group it read until the next Refresh, in the session's own state and nowhere else:
nothing on disk, nothing shared between sessions.

In auto mode, `/plate`, Refresh and opening a later group put one question and the AI's answer in
the chat: each tries the direct read first and, when the auto mode classifier refuses it, sends the
person's AI, as the person's own words, "What is on my plate? My time zone is <zone>." for the plate
or "Show my later items in plate group <part>." for a group (its number alone: a group's name is
someone else's words, as a title is), then draws what the AI's own
`recall` returns through `tool.call`; a group's read never replaces the plate. One question at a
time, across the plate and its groups; it ends with its own turn, or the first turn to end after it
was taken. Done is marked by the AI, and the pane updates on the next plate it sees. Nothing else
ever posts in the person's name: not the AI's track or reads, a subagent's, a timer, or the
session's start.

## Layout

| Path | What it is |
| --- | --- |
| `plugins/dazzer/` | The behaviour: triggers, the checkpoint script, the skill. **Carries no connection.** |
| `plugins/dazzer-connect/` | The connection, and nothing else, for people who have not already got one. |
| `plugins/dazzer-plate/` | The plate pane: a Claude Code mod (`hooks/plate.tsx`) that draws the person's plate when they ask. Reads through the connection the person already has; **carries none.** Its `hooks/hooks.json` holds only `modules`, which is why it is a plugin of its own: Codex refuses the shared file over that key. |
| `scripts/kept-states.mjs` | Writes the pages a plugin test prints, since `claude plugin test` gives a test no file system; the words check reads them. |
| `.claude-plugin/marketplace.json` | The list people install from. |
| `README.md` | How to install it, written for a person. **The authority for the install steps.** |
| `tools.manifest.json` | The same install steps in a shape a screen can render. **Mirrors the README; never leads it.** |
| `scripts/baseline.mjs` | Runs every check. One command: `node scripts/baseline.mjs`. |

**Everything shipped here is a TRIGGER, never a rule.** A file in `plugins/` may say WHEN to reach for the memory and WHERE the rules are served, and nothing about what they say. A rule written here survives a deploy — correcting it means editing the file, publishing a version, and waiting for every person to update — which is the second copy this repository's own Boundaries already warn about. Gate `rules-not-restated` refuses the shape of teaching: a list defining a verb, a numbered habit list, a boundaries section, or a prompt long enough to be a rule rather than a moment. It sees structure, not prose, so a rule written as one flowing paragraph with no heading walks past it — the shipped files are small enough to read whole in review, and the gate is what stops the shape growing back while nobody is looking.
| `scripts/checks/` | The checks themselves. Plain Node, no dependencies. |
| `scripts/known-defects.txt` | Things broken right now, each with a test proving it. Shrink-only. |

## Key patterns

- **Checks are Node, never shell.** A check that validates a structured message must parse
  it. Writing checks in the same language as the thing they guard is how the first defect
  happened - a shell pattern mistaken for a parse.
- **No package manifest, no dependencies.** Nothing here is built or published to a package
  registry; it is installed by copying files. Keep it that way.
- **Every tunable value is named and lives outside the code.** A number written into the
  script is a number nobody can find or change.
- **Changing an install step means changing it twice.** The README is what a person reads;
  `tools.manifest.json` is what a screen renders. Edit one without the other and
  `install-parity` refuses the run, naming both files. Adding a tool means a README block
  and a manifest entry, together.
- **The reminders' wording is not cosmetic.** Onboarding proves the reminders are installed
  by looking for one of those sentences in what the AI could see — nothing else puts them
  there. Reword one without updating `spokenSentences` and `reminder-parity` refuses. The
  direction that matters is the quiet one: words declared that nothing says would report
  every correctly installed person as not set up.

## Where work happens
The main checkout is **read-only**: file-tool writes into it are refused (`.claude/hooks/reference-copy-guard.sh`) — shell redirection is not intercepted, so the guard is a floor, not a seal. All work happens in a linked worktree under `../dazzer-plugin-worktrees/<what-it-does>`, created by `node scripts/git-health.mjs new <kind>/<what-it-does>` so its folder name matches its branch. `status` reports every worktree, what is unsaved, what is unpushed, what has gone cold, and where two branches touch the same files; open work is snapshotted each turn and untouched branches retire to `archive/<name>` after 14 days (`scripts/git-health.mjs`). Some tools place their own worktrees inside this checkout — those are judged by what they hold, never by where they sit. Proven by gate `git-health`.

## Testing

`node scripts/baseline.mjs` runs everything. It stays green while listed defects fail, and
prints what is still outstanding by name.

The ledger is shrink-only **in both directions**: an unlisted failure fails the run, and a
listed entry that starts passing *also* fails it. That second rule is deliberate — it makes
a fix prove itself to the runner instead of being announced in a commit message. When you
fix something, delete its line.

The suite takes its interpreter from `SHELL_UNDER_TEST`. Never name a shell inside the
suite: the system shell is bash-in-posix-mode on a Mac and dash on a Linux runner, and they
disagree on exactly the comparison one defect lives on.

## Critical rules

Violating either of these means the work is not done. Both exist because something already
broke for real people, and both are machine-enforced, so arguing around them fails the run.

1. **`plugins/dazzer` MUST NOT contain a connection of any kind**, at any depth, in any
   file — not even "just for telemetry". A bundled connection carries its own sign-in, so
   installing the behaviour replaced a working, signed-in connection with an
   unauthenticated one and people's memory went dark until they noticed. Someone who
   already connected must never have to sign in again just to get a few reminders.
   *Enforced by `connection-isolation`. Origin: commit `3c6fe7a`.*

2. **A shipped connection MUST point at an address we own.** The first release shipped the
   hostname the hosting platform generated. Every install would have baked in one provider,
   one project and one region, and any move would have broken every copy in the field with
   no way to reach them.
   *Enforced by `connection-address`. Origin: commit `a33a129`.*

## Boundaries

- The rules the model follows live in the Brain and are served live. This repository holds
  triggers, not teaching. If you find yourself writing the rulebook in here, stop — a
  second copy will silently diverge from the real one.
- The checkpoint script is the only thing with real reach: it runs on every reply on
  someone else's machine and can hold their session open. It fails open **by
  construction** — the decision defaults to staying quiet, and only a comparison that
  actually succeeded can turn it on. Never restructure it so that "do nothing" is the
  branch you have to remember to take.
- Anything the incoming message says is untrusted input. Read named fields, check their
  shape, and confine anything that becomes a filename to the folder this plugin owns.
