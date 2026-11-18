---
status: accepted
date: 2026-11-18
---

# Reminders ship apart from the connection, in each tool's own format

## Context and Problem Statement

The plugins have to make an AI check a person's Dazzer Brain before answering, prompt it to save
what was decided, and tell it to restore its saved progress after the tool compacts a long chat.
They do this with hooks: small commands an AI tool runs at set points in a chat, such as its start,
which add short notes to what the AI reads. Six AI tools load hooks differently. Most people install
the plugins alongside a connection to their Brain that may already be signed in.

The first versions bundled the connection with the reminders and used one hooks file for every
tool. Both choices failed in use:

- **The bundled connection displaced working ones.** A bundled connection carries its own sign-in,
  so installing the plugin replaced a working, signed-in connection with one that was not signed in.
  People who were already connected lost access to their Brain until they noticed and signed in.
- **The shared hooks file loaded nowhere it mattered.** Each hook is filed under the name of the
  point it runs at, and each tool has its own names. Claude Code checks every name in the file
  against its own list and rejects the whole file over a single name it does not know. The shared
  file carried names belonging to other tools, so Claude Code loaded none of the reminders and
  reported `failed to load`. Other tools did the same without saying so. Codex rejected the file
  over one unexpected line, and accepted a hook's answer only in a format of its own. Cursor
  preferred a plugin listing written for Cursor over the shared one and, unable to read it, stopped
  finding the plugin without saying so.
- **The prompt to save at the end of a reply was printed on screen.** Tools show anything a hook
  says at that point in the chat, in full, under a label of their own; one showed it in red as an
  error. It also made the AI owe another reply, which it filled with a line about the save.
- **Seeing the plugin work was not proof.** A tool listing its hooks as registered, or a person
  seeing the plugin do something, did not show that the words reached the AI. At first, in Claude
  Code, Codex and Cursor, they did not.

How should the reminders reach each tool, so that every supported tool really delivers them and no
install ever disturbs an existing connection?

## Decision Drivers

- Installing the reminders must never disturb a connection someone already has.
- In every tool called supported, the words must reach the AI, shown by running the real install
  rather than by reading the tool's documentation.
- The same words in every tool.
- Nothing on the person's screen that they did not need to see.

## Considered Options

1. One plugin carrying the connection and a single hooks file for every tool.
2. Reminders without a connection, still in a single shared hooks file.
3. Reminders without a connection, one hooks file per tool format, the connection as a plugin of
   its own.

## Decision Outcome

Chosen option: 3, because it is the only one in which installing the reminders never touches an
existing connection and every tool loads a file it can read.

- `dazzer` carries the reminders, the prompt to save and a skill (a short instruction file the tool
  loads when a request matches it), and no connection at any depth.
- `dazzer-connect` carries the connection and nothing else.
- Each tool reads hooks in its own format, with the same words. Claude Code and Codex share one
  file; Cursor and Devin each read their own. Antigravity looks for the same file name as Devin but
  needs a different format inside it, so its hooks ship as the separate `dazzer-antigravity`
  plugin. Copilot runs a plugin's hooks but does not pass what they say to the AI, so its
  check-before-answering note is an instruction file the person copies in.
- The prompt to save rides with the person's next message wherever a tool allows it, so nothing
  appears on screen.
- A tool counts as supported only when an installed copy passes this test: asked for a word that
  appears only in the reminder, the AI gives it back. Nothing else could have told it.

### Consequences

- Good, because installing the reminders cannot sign anyone out or replace a connection.
- Good, because each tool loads a file in a format it accepts, and a broken file for one tool does
  not stop another.
- Good, because the prompt to save is silent in every tool that allows it to ride with the next
  message.
- Bad, because people install two pieces in every tool, and three in Antigravity.
- Bad, because the reminders alone cannot tell whether a connection that shows as present is
  signed in. So the install guide asks everyone to install `dazzer-connect` and sign in, even where
  a Dazzer connection already shows; how it behaves beside a connection set up another way is not
  yet tested.
- Bad, because the same words live in several files and must be kept identical. They are now
  written from one set of files by a generator.
- Bad, because some tools get less than others: Copilot only the check-before-answering note, Devin
  no prompt to save, Antigravity and Cursor no note after compaction, and in Cursor the prompt to
  save is visible.
- Bad, because the Copilot instruction file is a copy, so it must be copied again after each update.
- Bad, because only a connection installed with `dazzer-connect` tells Dazzer's server that it comes
  from the plugin, and which version; a connection set up another way does not.

### Confirmation

The repository's checks refuse any connection inside `dazzer`. Support for each tool is confirmed
with the word check above, on a real install.

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

- **Copilot's instruction file must instruct, not explain.** A first version opened by explaining
  to a human reader why hooks cannot reach the AI in Copilot. The model reads that file as its own
  instruction, explanation and all. Asked the same question six times, with a Brain that could
  answer it, the explaining version made the model consult the Brain none of the six times; a plain
  instruction naming what to call and when made it consult the Brain all six. Anything in that file
  is read by the model, so commentary belongs in the docs.
- **A wording change is measured over several runs, never one.** One successful attempt cannot tell
  an instruction that is followed from one that is followed sometimes.
- **Copilot's other route was tried.** What a connection announces when it opens does reach the
  model in Copilot, but only for a fixed list of services GitHub owns, which a third party cannot
  join.
- [How it works](../how-it-works.md) describes the current behaviour in each tool.
