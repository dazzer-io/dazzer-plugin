# How it works

The plugin does one thing: at the right moment, it reminds your AI to use your Dazzer Brain. It
holds no rules and no credentials. Your AI acts through the connection it already has, and reads
the current rules from your Brain at the moment it acts. A change to the rules in your Brain
therefore reaches you at once, with nothing to update.

## The pieces

| Piece | What it is | Who needs it |
| --- | --- | --- |
| `dazzer` | The reminders, the save prompt and a short skill. Carries no connection. | Everyone |
| `dazzer-connect` | The connection to your Brain, at `https://graph.dazzer.io/mcp`, and nothing else. | Everyone |
| `dazzer-antigravity` | The reminders in the one shape Antigravity accepts. | Antigravity only |
| `dazzer-plate` | The plate pane. Reads through the connection you already have and brings none. | Claude Code only, optional |

The reminders and the connection are separate on purpose: a bundled connection carries its own
sign-in, and installing it replaced a working connection with one that was not signed in. The
[decision record](decisions/0001-reminders-apart-from-the-connection.md) has the full story.

## The three reminders

| Reminder | What your AI is told | When it arrives |
| --- | --- | --- |
| Check first | Before answering anything your Brain may already know, recall it, and say so plainly if the Brain cannot be reached. | Once when a chat starts in Claude Code, Codex and Cursor; once per conversation in Copilot; with every message in Antigravity and Devin |
| Save what settles | Something may have settled: save it, by the rule your Brain serves. If nothing was saved, say nothing. | With your next message, once enough new work has built up |
| Pick up after a reset | This chat was compacted: restore your saved place before carrying on. | Right after a long chat is compacted |

Every reminder starts with `[Dazzer]` or `Dazzer checkpoint`, so you can tell it apart from your own
words.

### Saving what settles

The plugin counts how much new conversation has built up since the last save. Past a threshold
(250 entries by default, see [Settings](#settings)), your next message carries the save prompt.
Your AI judges what is worth keeping against your Brain's own rules, saves it, and tells you in one
line what it saved. If nothing settled, it says nothing.

The prompt rides with your next message rather than at the end of a reply. Said at the end of a
reply, tools print it on your screen and the AI owes you another reply about it. Said with your
next message, the same words reach the AI and nothing is drawn.

Two tools differ:

- **Cursor** offers no private moment, so the prompt is submitted as a visible message.
- **Antigravity** never says whether a reply is the one the save prompt asked for, so the prompt
  leaves itself a note that the very next end of reply reads once and clears. A save prompt can
  therefore never answer itself. The cost is that a genuine second reply straight after a save is
  skipped.

Devin gives a plugin no measure of how much conversation has built up, so there the save prompt
stays quiet.

### Picking up after a reset

When a long chat is compacted, nothing reconnects and your AI loses what it was told. The plugin
covers that moment: it tells your AI to restore its saved place before carrying on, and before
asking you to repeat anything.

Each chat gets its own place back. In Claude Code and Codex, the start of a chat, every reset and
the save prompt all name the same label: the id your tool already gives that chat. Your AI saves
under it and restores from it, so a restore never brings back another chat's work.

## Each tool in its own format

Tools read plugin reminders in different formats, and most discard a whole file over one entry they
do not recognise. So each tool reads reminders in its own format, with the same words:

- **Claude Code and Codex** share one reminders file.
- **Cursor** and **Devin** each read a file of their own.
- **Antigravity** looks for the same file name as Devin but wants a different shape inside it, so
  its reminders ship as the separate `dazzer-antigravity` plugin.
- **Copilot** runs a plugin's reminders but gives them no way to speak to the AI. The check-first
  sentence goes in as a standing instruction file instead, which Copilot reads before every
  conversation. It is a copy, so it needs copying again after each update.
- **Claude's chat and web apps** have no moment at which anything can run. The plugin's skill
  carries the same intent as plain text.

The skill says when to reach for your Brain and where the rules are. It never says what they are.

## Where the rules live

In your Brain, served live, under these keys:

- `brain.door.entrance`: the contract every AI starts from
- `brain.capture.protocol`: when something is worth saving, and what to record
- `brain.working.memory.contract`: keeping your place across a reset

This repository holds triggers, not teaching.

## The plate pane

Claude Code only, and optional. Type `/plate` to open it; nothing opens by itself. At the top: the
day and one line of counts. Below: four tabs, **Needs you**, **Waiting**, **Coming up** and
**Later**, each with its count.

Each item is a card with a tag saying why it is there (for example `8 DAYS LATE` or `DUE SAT 10
OCT`, with `(A GUESS)` where Dazzer is unsure), its title, what it is part of, who it is from and
when it last moved. **Later** groups what can wait by what it belongs to: the 30 largest groups, then
how many more. **Refresh** reads your plate again.

A card's **Open** shows two buttons:

- **Done** sends your AI one sentence with the item's number and nothing else, such as
  `Mark item 7240 done.` Your AI marks it done, and the pane updates on the next plate it reads.
- **Talk about it** sends `Tell me about item 7240.`, once per item until the pane reads your plate
  again.

An item's title never goes with either sentence: anyone in your workspace can write a title, and
these sentences go as your own words.

**How it reads.** Through the connection Claude Code already has, and only from a server offering
both of Dazzer's `recall` and `track`, so your words and time zone never go to any other server.
With no such connection, the pane says Dazzer was not found and how to connect it. A read with no
answer after 20 seconds says it could not reach Dazzer.

**In auto mode**, where Claude Code may refuse the pane's own read, `/plate`, Refresh and opening a
later group each put one question to your AI instead, as your own words: `What is on my plate? My
time zone is <your time zone>.`, or `Show my later items in plate group <its number>.` The pane
draws what your AI reads. It asks one question at a time and waits for the answer.

**What it keeps.** The last plate it read, and each later group it opened, for that session only.
Nothing goes to disk, and nothing is shared with another session or account.

## What is stored on your machine

- A run log, one line each time the plugin runs: when, what it decided and why. Never any of your
  conversation. [Install, sign in and update](install.md#check-it-worked) shows how to read it.
- A small marker per chat, so the save prompt never fires twice for the same work. A finished
  chat's marker is tidied away after 30 days.

Both live under `${CLAUDE_PLUGIN_DATA:-$HOME/.dazzer}`.

## Settings

Set any of these in your environment to override the shipped value. A value that is not a whole
number never takes effect and never causes an error: the shipped default is used instead.

| Variable | Default | Effect |
| --- | --- | --- |
| `DAZZER_CAPTURE_THRESHOLD` | `250` | How much new conversation builds up before a save is prompted. Raise it for fewer prompts, lower it to save more eagerly. |
| `DAZZER_CAPTURE_STATE_TTL_DAYS` | `30` | How long a finished chat's marker is kept before it is tidied away. |
| `DAZZER_CAPTURE_RECEIPTS_MAX_BYTES` | `262144` | How large the run log may grow before the old one is set aside. |
| `DAZZER_CAPTURE_MAX_INPUT_BYTES` | `100000` | A guard against an unreasonably large message, not a tuning dial. |
| `DAZZER_TOOL` | works itself out | Which tool this is running inside, recorded in the run log. Set it only where the automatic answer is wrong. |
| `DAZZER_MOMENT` | set by the plugin | Which moment the save prompt is running in. Not set by hand. |
