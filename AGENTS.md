# AGENTS.md

The Dazzer plugin: reminders that make an AI check a person's Dazzer Brain before answering, save
what settles, and pick up after a reset, packaged for six AI tools. How it behaves is in
[docs/how-it-works.md](docs/how-it-works.md); why it is shaped this way is in
[docs/decisions/](docs/decisions/). Read the decisions before changing how reminders reach a tool.

This repository is public. Every file, commit message and branch name is public.

## Test

```sh
node scripts/baseline.mjs
SHELL_UNDER_TEST=bash node scripts/baseline.mjs
```

- Run both. The shipped scripts are POSIX shell and run under whatever the person's system shell
  is: bash in POSIX mode on a Mac, dash on Linux. They disagree on comparisons a past defect lived
  on. CI runs both lines and `shellcheck -s sh` on the shipped scripts.
- Never name a shell inside the suite. It takes its interpreter from `SHELL_UNDER_TEST`.
- The known-defects ledger is shrink-only in both directions: an unlisted failure fails the run,
  and a listed entry that starts passing also fails it. When you fix one, delete its line.
- Checks are plain Node with no dependencies, and there is no package manifest. Keep it that way. A
  check that validates structured data parses it; it never pattern-matches it.

## Release

- People install from `main`. An installed copy changes only when the version changes, so any
  change meant to reach people bumps the version, in every place it is declared. The version check
  names any place left behind.
- Merging to `main` tags `v<version>` automatically. Nothing else publishes.
- Without a version bump, a fix reaches nobody who already installed it.

## Never edit by hand

- **Generated files.** A file a generator writes is never edited directly: change its source, run
  the generator, and commit both. If a file says it is generated, treat it as generated.
- **Install steps live in two places**: `docs/install.md` for people and `tools.manifest.json` for
  screens. Change both together, or change their shared source if they are generated.
- **Reminder sentences.** Onboarding confirms an install by finding a reminder sentence in what the
  AI could see. Reword one only together with every place that declares it.

## Rules that exist because something broke

1. **`plugins/dazzer` never contains a connection**, at any depth, in any file, not even for
   telemetry. A bundled connection replaced people's signed-in connections with unsigned ones.
2. **A shipped connection points at an address Dazzer owns** (`graph.dazzer.io`), never a hostname
   a hosting provider generated, so moving providers never breaks installed copies.
3. **Shipped files are triggers, never rules.** A file in `plugins/` may say when to reach for the
   Brain and where the rules are served, never what they say. Rules live in the Brain; a copy here
   would survive a deploy and drift.
4. **The save-prompt script fails open.** Doing nothing is the default branch; only a comparison
   that succeeded turns it on. Never restructure it so that staying quiet is the branch someone has
   to remember to take.
5. **Everything a tool hands a script is untrusted input.** Read named fields, check their shape,
   and confine anything that becomes a file name to the folder the plugin owns.
6. **Test data and examples are invented.** Never put a real person's name, work, or ids in a
   fixture, a doc or a commit message.

## Docs

- `README.md` is the landing page: outcome, supported tools, what it does and never does. No
  history and no mechanism there.
- A new design decision gets its own record in `docs/decisions/`, in MADR format, numbered after the
  last one.
