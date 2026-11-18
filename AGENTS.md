# AGENTS.md

This repository holds the plugins that make an AI check a person's Dazzer Brain before answering
and save to it, for six AI tools. How they behave is in [docs/how-it-works.md](docs/how-it-works.md);
why they are built this way is in [docs/decisions/](docs/decisions/). Read the decisions before
changing how the reminders reach a tool.

This repository is public. Every file, commit message and branch name is public.

## What is where

| Path | What it is |
| --- | --- |
| `source/` | The one place the per-tool files come from: `manifest.json` (the version, the plugins, what each tool's listing adds) and `words.json` (every sentence the plugins say). |
| `scripts/generate.mjs` | Writes every per-tool file from `source/`, and lists them. |
| `plugins/` | What installs on people's machines: `dazzer`, `dazzer-connect`, `dazzer-plate` and `dazzer-antigravity`. The listings, hook files, Copilot instruction file, save prompt and connection file are generated; the shell scripts, the skill, the settings defaults and the plate pane are written by hand. |
| `.claude-plugin/` | The marketplace listing tools install from. Generated. |
| `tools.manifest.json` | The install steps in a form a screen can render. Partly generated; the install steps are written by hand and must match `docs/install.md`. |
| `scripts/baseline.mjs`, `scripts/checks/` | Every check, run by one command. Plain Node, no dependencies. |
| `tests/` | Every test. Nothing here installs. |
| `package.json`, `package-lock.json` | For working here only: they pin the Claude Code that runs the plate pane's tests. Nothing in them installs with a plugin. |
| `docs/` | The install guide, how it works, and the decision records. |
| `.github/` | The workflows, and `CODEOWNERS`, which names who reviews changes to what runs on users' machines and in CI. |

## Generated files are never edited by hand

Change `source/`, run `node scripts/generate.mjs`, and commit both. The `generated` gate runs the
generator with `--check` and names any file that differs from what it would write. Every sentence
the plugins say lives in `source/words.json`; Dazzer's onboarding confirms an install by finding
one of them in what the AI could see, so reword one only on purpose.

## Run the checks

```sh
npm ci --ignore-scripts
node scripts/baseline.mjs
SHELL_UNDER_TEST=bash node scripts/baseline.mjs
```

- The first line installs the pinned Claude Code the plate pane's tests run with. With `claude`
  already on your PATH you can skip it.
- Run both baseline lines. The shipped scripts are POSIX shell and run under whatever the person's
  system shell is: bash in POSIX mode on a Mac, dash on Linux, and the two disagree on comparisons a
  past defect lived on. Never name a shell inside a test; tests take it from `SHELL_UNDER_TEST`.
- Any failure fails the run. Every file in `tests/` runs, and a check fails if a test or test data
  appears under `plugins/`, because everything there installs on people's machines.
- Keep the checks free of dependencies. A check that validates structured data parses it.

## All test and example data is invented

Never put a real person's name, work or ids in a test, a fixture, a doc, an example or a commit
message. Everything under `plugins/` ships to every user, and this repository is public.

## How a change ships

1. Open a pull request. CI runs the gates under both shells, shell lint and a workflow audit, and
   the engineer review reads the change.
2. Changes meant to reach people bump the version in `source/manifest.json`, then run the
   generator. An installed copy changes only when the version does, so without a bump a fix
   reaches nobody who already installed it.
3. On merge to `main`, a workflow tags `v<version>`, read from `source/manifest.json`. People install
   from `main`; nothing else publishes.

## Rules that exist because something broke

1. **`plugins/dazzer` never contains a connection**, at any depth, not even for telemetry. A
   bundled connection once replaced people's signed-in connections with signed-out ones.
2. **A shipped connection points at an address Dazzer owns** (`graph.dazzer.io`), never a hostname a
   hosting provider generated, so moving providers never breaks installed copies.
3. **Shipped files say when, never what.** A file in `plugins/` may say when to reach for the Brain
   and where Dazzer's instructions are served, never what they say. A copy here would survive a
   deploy and drift.
4. **The save-prompt script fails open.** Doing nothing is the default; only a comparison that
   succeeded turns it on.
5. **Everything a tool hands a script is untrusted input.** Read named fields, check their shape,
   and confine anything that becomes a file name to the plugin's own folder.

New design decisions get a record in `docs/decisions/`, in MADR format, numbered after the last one.
`README.md` stays a landing page: no history and no mechanism there.
