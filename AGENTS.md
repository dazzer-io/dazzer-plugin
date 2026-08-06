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
check the memory before answering, save what settled when a reply ends, and get
re-oriented after a context reset.

**It never talks to Dazzer.** It has no credentials and no reliable moment at which a
connection is up. All it does is tap the model at the right instant; the model then acts
through the connection it already owns and reads the current rules from the Brain at the
moment it acts. That is why the shipped script is near-static: **change the rules in the
Brain, not here.**

## Layout

| Path | What it is |
| --- | --- |
| `plugins/dazzer/` | The behaviour: triggers, the end-of-reply script, the skill. **Carries no connection.** |
| `plugins/dazzer-connect/` | The connection, and nothing else, for people who have not already got one. |
| `.claude-plugin/marketplace.json` | The list people install from. |
| `README.md` | How to install it, written for a person. **The authority for the install steps.** |
| `tools.manifest.json` | The same steps — install, update, remove — in a shape a screen can render. **Mirrors the README; never leads it.** |
| `scripts/baseline.mjs` | Runs every check. One command: `node scripts/baseline.mjs`. |
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
  `install-parity` refuses the run, naming both files — for updating and removing as well as
  installing. Adding a tool means a README block and a manifest entry together, **and** an
  answer to how somebody updates and removes it, or `lifecycle-coverage` refuses the run.
  Saying plainly that nobody has established one counts; leaving it out does not.
- **The reminders' wording is not cosmetic.** Onboarding proves the reminders are installed
  by looking for one of those sentences in what the AI could see — nothing else puts them
  there. Reword one without updating `spokenSentences` and `reminder-parity` refuses. The
  direction that matters is the quiet one: words declared that nothing says would report
  every correctly installed person as not set up.

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

**Run it before you push, once per clone:**

```
git config core.hooksPath .githooks
```

That runs the suite on every push and refuses one that would take a stale instruction with
it. Two honest limits. It runs the suite **once**, under your system shell — on a Mac that
is bash, so it never exercises the dash path the paragraph above warns about, which the
workflow does run. And the setting lives in your clone: there is no install step here to
attach it to on your behalf, so a fresh clone is unprotected until someone runs that line.

**The enforcement is the workflow**, which runs the suite under both shells on every
proposed change and cannot be skipped. The hook only saves you the round trip.

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
- The end-of-reply script is the only thing with real reach: it runs on every reply on
  someone else's machine and can hold their session open. It fails open **by
  construction** — the decision defaults to staying quiet, and only a comparison that
  actually succeeded can turn it on. Never restructure it so that "do nothing" is the
  branch you have to remember to take.
- Anything the incoming message says is untrusted input. Read named fields, check their
  shape, and confine anything that becomes a filename to the folder this plugin owns.
