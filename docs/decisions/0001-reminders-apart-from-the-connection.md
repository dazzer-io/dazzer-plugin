---
status: accepted
date: 2026-11-18
---

# Reminders ship apart from the connection, in each tool's own format

## Context and Problem Statement

The plugin has to make an AI check a person's Dazzer Brain before answering, save what settles, and
pick up after a reset, in six AI tools that each load plugins differently. Most people install it
alongside a connection to their Brain that may already be signed in.

The first versions bundled the connection with the reminders and used one reminders file for every
tool. Both choices failed in use:

- **The bundled connection displaced working ones.** A bundled connection carries its own sign-in,
  so installing the plugin replaced a working, signed-in connection with one that was not signed in.
  The Brain went dark for people who were already connected, until they noticed.
- **The shared reminders file loaded nowhere it mattered.** Claude Code checks every event name in a
  reminders file against a fixed list and rejects the whole file over a single name it does not
  know. The shared file carried names belonging to other tools, so Claude Code loaded none of the
  reminders and reported `failed to load`. The other tools did the same without saying so. Codex
  discarded the file over one unexpected line, and accepted only replies in a shape of its own.
  Cursor preferred a tool-specific listing over the shared one and, unable to read it, silently
  stopped finding the plugin.
- **The save prompt at the end of a reply was printed on screen.** Tools show anything said at that
  moment in the chat, in full, under a label of their own; one showed it in red as a hook error. It
  also made the AI owe another reply, which it filled with a line about the save.
- **Seeing the plugin work was not proof.** A tool listing its reminders as registered, or a person
  seeing the plugin do something, did not show that the reminder's words reached the AI. At first,
  in Claude Code, Codex and Cursor, they did not.

How should the reminders reach each tool, so that every supported tool really delivers them and no
install ever disturbs an existing connection?

## Decision Drivers

- Installing the reminders must never disturb a connection someone already has.
- In every tool called supported, the reminder's words must reach the AI, shown by running the real
  install rather than by reading the tool's documentation.
- The same words in every tool.
- Nothing on the person's screen that they did not need to see.

## Considered Options

1. One plugin carrying the connection and a single reminders file for every tool.
2. Reminders without a connection, still in a single shared file.
3. Reminders without a connection, one reminders file per tool format, the connection as a plugin of
   its own.

## Decision Outcome

Chosen option: 3, because it is the only one in which installing never touches an existing
connection and every tool loads a file it can read.

- `dazzer` carries the reminders, the save prompt and a short skill, and no connection at any depth.
- `dazzer-connect` carries the connection and nothing else.
- Each tool reads reminders in its own format, with the same words. Claude Code and Codex share one
  file; Cursor and Devin each read their own. Antigravity looks for the same file name as Devin but
  needs a different shape inside it, so its reminders ship as the separate `dazzer-antigravity`
  plugin. Copilot runs a plugin's reminders but gives them no way to speak to the AI, so its
  check-first reminder is a standing instruction file instead.
- The save prompt rides with the person's next message wherever a tool offers that moment, so
  nothing is drawn on screen.
- A tool counts as supported only when an installed copy, asked for a word that only the reminder
  carried, gives it back.

### Consequences

- Good, because installing the reminders cannot sign anyone out or replace a connection.
- Good, because each tool loads a file in a format it accepts, and a broken file for one tool does
  not stop another.
- Good, because the save prompt is silent in every tool that offers a private moment.
- Bad, because people install two pieces in every tool, and three in Antigravity.
- Bad, because the same words live in several files and must be kept identical, which needs a check
  or a generator.
- Bad, because some tools get less than others: Copilot only the check-first reminder, Devin no save
  prompt, Antigravity nothing after a reset, and in Cursor the save prompt is visible.
- Bad, because the Copilot instruction is a copy, so it must be copied again after each update.
- Bad, because without `dazzer-connect`, plugin traffic cannot be told apart from a connection set up
  by hand.

### Confirmation

The repository's checks refuse any connection inside `dazzer`. Support for each tool is confirmed
by installing the real plugin and asking the AI for a word only the reminder carried.

## Pros and Cons of the Options

### One plugin with the connection and a single file

- Good, because it is one install everywhere.
- Bad, because it replaced working connections with ones that were not signed in.
- Bad, because tools reject the whole file over entries meant for other tools.

### Reminders without a connection, in a single shared file

- Good, because it never disturbs a connection.
- Bad, because tools still reject the whole file, so in Claude Code nothing loaded at all.

### Reminders without a connection, one file per tool format

- Good, because it meets every decision driver.
- Bad, because it means more files and more installs, as listed under Consequences.

## More Information

- **Copilot's instruction must instruct, not explain.** A first version opened by explaining to a
  human reader why reminders cannot work in Copilot. The model reads that file as its own standing
  instruction, explanation and all. Asked the same question six times, with a Brain that could
  answer it, the explaining version made the model consult the Brain none of the six times; a plain
  instruction naming what to call and when made it consult the Brain all six. Anything in that file
  is read by the model, so commentary belongs in the docs.
- **A wording change is measured over several runs, never one.** One successful attempt cannot tell
  a rule that is obeyed from one that is obeyed sometimes.
- **Copilot's other route was tried.** What a connection announces when it opens does reach the
  model in Copilot, but only for a fixed list of services GitHub owns, which a third party cannot
  join.
- [How it works](../how-it-works.md) describes the current behaviour in each tool.
