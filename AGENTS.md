# AGENTS.md

This repository holds the plugins that make an AI check a person's Dazzer Brain before answering
and save to it, for six AI tools. How they behave is in
[docs/how-it-works.md](docs/how-it-works.md); why they are built this way is in
[docs/decisions/](docs/decisions/). Read the decisions before changing how the reminders reach a
tool.

This repository is public. Every file, commit message and branch name is public.

## What is where

| Path | What it is |
| --- | --- |
| `source/` | The one place the per-tool files come from: `manifest.json` (the version, the plugins, what each tool's listing adds) and `words.json` (every sentence the plugins say). |
| `scripts/generate.mjs` | The generator. Writes every per-tool file from `source/`, and lists them. |
| `plugins/` | What installs on people's machines: `dazzer`, `dazzer-connect`, `dazzer-plate` and `dazzer-antigravity`. The listings, hook files, Copilot instruction file, save prompt and connection file are generated. The shell scripts, the skill, the settings defaults and the plate pane are written by hand; the generator names them and refuses any other file there. |
| `.claude-plugin/` | The marketplace listing tools install from. Generated. |
| `tools.manifest.json` | The install facts in a form a screen can render. The generator rewrites four things in it: the connection's address and name, the text of each reminder sentence, and how often the check-before-answering note arrives in each tool. Everything else is written by hand, including the tool list, what reaches each tool, and the install, sign-in, update and run-log commands, which must match `docs/install.md`. |
| `scripts/baseline.mjs`, `scripts/checks/` | The check runner and the checks it runs. Plain Node, no dependencies. |
| `tests/` | Every test. Nothing here installs. |
| `package.json`, `package-lock.json` | For working here only: they pin the Claude Code that runs the plate pane's tests. Nothing in them installs with a plugin. |
| `docs/` | The install guide, how it works, and the decision records. |
| `.github/` | The workflows, and `CODEOWNERS`, which makes the organisation's maintainer the reviewer of every file. |

## Generated files are never edited by hand

Change `source/`, run `node scripts/generate.mjs`, and commit both. `node scripts/generate.mjs
--check` writes nothing and names any file that differs from what the generator would write; the
check runner runs it first. Every sentence the plugins say lives in `source/words.json`. Dazzer's
onboarding confirms an install by finding one of them in what the AI could see, so reword one only
on purpose.

## Run the checks

```sh
npm ci --ignore-scripts
node scripts/baseline.mjs
SHELL_UNDER_TEST=bash node scripts/baseline.mjs --shell-suites
```

- The first line installs the pinned Claude Code the plate pane's tests run with. Without it, the
  check runner falls back to `claude` on your PATH and says so.
- The second line is the check runner: every check and every test, in one command.
- The third runs the shell tests again under bash. The shipped scripts are POSIX shell and run
  under whatever the person's system shell is: bash in POSIX mode on a Mac, dash on Linux, and the
  two disagree on comparisons a past defect lived on. Never name a shell inside a test; tests take
  it from `SHELL_UNDER_TEST`.
- Any failure fails the run. Every file in `tests/` runs, and a check refuses a test or test data
  under `plugins/`, because everything there installs on people's machines.
- Keep the checks free of dependencies. A check that validates structured data parses it.

## All test and example data is invented

Never put a real person's name, work or ids in a test, a fixture, a doc, an example or a commit
message. Everything under `plugins/` ships to every user, and this repository is public.

## How a change ships

1. Open a pull request. CI runs the three lines above, shell lint and a workflow audit.
2. The pull request also carries a required check named **Engineer review**. It stays pending
   until someone allowed to merge has reviewed that exact commit, by commenting `reviewed` or
   approving; a new push starts it pending again.
3. Changes meant to reach people bump the version in `source/manifest.json`, then run the
   generator. An installed copy changes only when the version does, so without a bump a fix
   reaches nobody who already installed it.
4. On merge to `main`, a workflow tags `v<version>`, read from `source/manifest.json`. People
   install from `main`; nothing else publishes.

## Rules that exist because something broke

1. **`plugins/dazzer` never contains a connection**, at any depth, not even for telemetry. A
   bundled connection once replaced people's signed-in connections with signed-out ones.
2. **A shipped connection points at an address Dazzer owns** (`graph.dazzer.io`), never a hostname
   a hosting provider generated, so moving providers never breaks installed copies.
3. **Shipped files say when, never what.** A file in `plugins/` may say when to reach for the Brain
   and where Dazzer's instructions are served, never what they say. A copy here would survive a
   deploy and drift.
4. **The save-prompt script fails open.** Doing nothing is the default; only a comparison that
   succeeded turns it on.
5. **Everything a tool hands a script is untrusted input.** Read named fields, check their shape,
   and confine anything that becomes a file name to the plugin's own folder.

A new design decision gets one short file of its own in `docs/decisions/`, numbered after the last
one, with its context, the options considered and the outcome. `README.md` stays a landing page: no
history and no mechanism there.
