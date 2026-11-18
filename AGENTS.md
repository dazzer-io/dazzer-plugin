# AGENTS.md

The Dazzer plugin: reminders that make an AI check a person's Dazzer Brain before answering, save
what settles, and pick up after a reset, packaged for six AI tools. How it behaves is in
[docs/how-it-works.md](docs/how-it-works.md); why it is shaped this way is in
[docs/decisions/](docs/decisions/). Read the decisions before changing how reminders reach a tool.

This repository is public. Every file, commit message and branch name is public.

## Test

```sh
npm ci --ignore-scripts
node scripts/baseline.mjs
SHELL_UNDER_TEST=bash node scripts/baseline.mjs
```

- Run both baseline lines. The shipped scripts are POSIX shell and run under whatever the person's
  system shell is: bash in POSIX mode on a Mac, dash on Linux. They disagree on comparisons a past
  defect lived on. Never name a shell inside a test; tests take their interpreter from
  `SHELL_UNDER_TEST`.
- The plate pane's tests run through `claude plugin test`, using the Claude Code version that
  `package-lock.json` pins. Install it first with `npm ci --ignore-scripts`, or have `claude` on
  your PATH.
- Any failure fails the run. There is no list of known failures to hide behind.
- Every file in `tests/` runs. Tests live there and never under `plugins/`: everything under
  `plugins/` installs on people's machines, and a check fails if a test or test data appears there.
- The checks are plain Node with no dependencies. `package.json` exists only to pin the Claude Code
  that runs the plate tests; nothing in it installs with a plugin. Keep the checks dependency-free.
  A check that validates structured data parses it; it never pattern-matches it.
- CI runs both baseline lines, `shellcheck -s sh` on the shipped scripts and the shell tests, a
  workflow audit (zizmor), and a Scorecard workflow.

## Generated files

- Every per-tool file is written by `scripts/generate.mjs` from `source/`: the manifests, the hook
  files for each tool, the Copilot instruction, and part of `tools.manifest.json`. The generator
  lists them all.
- Never hand-edit a generated file. Change `source/` and run `node scripts/generate.mjs`, then
  commit both. The `generated` gate (`node scripts/generate.mjs --check`) names any file that
  differs.
- Every sentence the plugin says lives in `source/words.json`. Dazzer's onboarding confirms an
  install by finding a reminder sentence in what the AI could see, so reword one only there, and
  only on purpose.
- Install steps live in `docs/install.md` for people and in `tools.manifest.json` for screens. Change
  both together; the install-parity gate refuses them when they disagree.

## Release

- People install from `main`. An installed copy changes only when the version changes, so any
  change meant to reach people bumps the version.
- The version is written once, in `source/manifest.json`. Change it there and run
  `node scripts/generate.mjs`; the `generated` gate names any file left behind.
- Merging to `main` tags `v<version>` automatically, read from `source/manifest.json`. Nothing else
  publishes.
- Without a version bump, a fix reaches nobody who already installed it.

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
