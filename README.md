# Dazzer

Makes your AI check what you already know before answering, and save what settles instead of
losing it when the conversation ends.

## Install

Two lines in most tools. The same plugin, the same files — only the command changes.

### Claude Code

```
/plugin marketplace add dazzer-io/dazzer-plugin
/plugin install dazzer@dazzer
```

Typed into Claude itself, not into your shell.

**Using the desktop app?** Install it from a terminal with the same two lines. The app and the
terminal share one set of settings, so it appears in the app on your next conversation. The
install command does not exist inside the app, so this genuinely needs a terminal once — even if
you never otherwise open one.

### Codex — OpenAI's coding tool

```
codex plugin marketplace add dazzer-io/dazzer-plugin
codex plugin add dazzer@dazzer
```

Codex asks you to approve a plugin's reminders before it will run them. If nothing appears in the
run history described below, that approval is the first thing to check.

### GitHub Copilot

```
copilot plugin marketplace add dazzer-io/dazzer-plugin
copilot plugin install dazzer@dazzer
```

**The reminders do not reach Copilot at the moment** — see below for why, and what would undo it. Installing still gives you the skill and, if you add it, the connection.

### Antigravity — Google's coding tool

It has no store to install from, so point it at a downloaded copy:

```
git clone https://github.com/dazzer-io/dazzer-plugin.git
agy plugin install ./dazzer-plugin/plugins/dazzer
```

**The reminders do not reach Antigravity at the moment** — see below for why, and what would
undo it. Being put back on track after a long conversation forgets itself was never possible
here anyway: that moment does not exist in this tool at all.

### Cursor

Two steps, and the second one happens inside Cursor rather than in a terminal.

```
cursor-agent plugin marketplace add https://github.com/dazzer-io/dazzer-plugin.git
```

Then, in Cursor, type `/plugins` and choose **dazzer** from the list.

Two things that cost real time when this was first tried, so they are written down here:

- **If you have installed it before, remove and re-add rather than update.** Cursor's update
  command reports success without actually re-fetching, so you keep whatever version you first
  got. `cursor-agent plugin marketplace remove dazzer` then add it again.
- **If you already have some other Dazzer setup wired into Cursor, take it out first**, or both
  fire on every reply and you get the save prompt twice.

One difference you will see rather than read about: Cursor has no way for a plugin to speak
privately to the AI at the end of a reply. It only accepts a message and submits it as though you
had typed it, so on Cursor the save prompt is visible in your conversation. Everything works; it
just is not silent.

### Devin

```
devin plugins install dazzer-io/dazzer-plugin#plugins/dazzer
```

Two of the three reminders work. The save prompt does not, and cannot: Devin tells a reminder
only which session and which prompt it is, with no way to tell how much conversation has built up
since last time. The prompt has nothing to measure, so it stays quiet rather than firing blindly.

### Reaching your Brain

Everything above adds the **reminders**. They do not reach your Brain by themselves. A tool with
the reminders and no connection has an AI being told to check something it cannot open, which is
worse than having neither: it goes looking, and it finds whatever else it has.

**Skip this if Dazzer already shows as connected.** Installing it again would replace a working
connection with one that needs signing in.

One line per tool, in that tool's own wording.

**Claude Code** — typed into Claude itself:

```
/plugin install dazzer-connect@dazzer
```

**Codex** — in a terminal:

```
codex plugin add dazzer-connect@dazzer
```

**GitHub Copilot** — in a terminal:

```
copilot plugin install dazzer-connect@dazzer
```

**Antigravity** — in a terminal, against the copy you downloaded:

```
agy plugin install ./dazzer-plugin/plugins/dazzer-connect
```

**Cursor** — type `/plugins` in Cursor and choose **dazzer-connect**.

**Devin** — in a terminal:

```
devin plugins install dazzer-io/dazzer-plugin#plugins/dazzer-connect
```

Two of these have been run and watched working: Claude Code, where it registers the connection and
asks to sign in, and Codex, where the connection then appears with a sign-in waiting. The other
four follow each tool's own established shape and have not yet been run. Where that matters is
written down rather than smoothed over — see what has actually been tried, below.

**This section existed in one wording only, Claude's, and every other tool's setup simply ended
after the reminders.** Someone followed the Codex instructions to the letter on a clean machine,
was never asked to sign in because there was nothing to sign in to, and watched his AI go hunting
through an unrelated archive for the memory it had just been told to check. The command it needed
existed and worked the whole time. Nobody had written it down, and no rule asked whether anything
was missing — every rule here compared what we say against what we ship, and both said the same
thing. A rule that asks the missing question now exists.

### Where reminders cannot run at all

Claude's chat apps and the web app have no moment at the end of a reply for anything to run. There
the bundled skill carries the same intent as plain text, and reaching your Brain works exactly the
same.

### Why the reminders live in three files

One file cannot serve every tool, and finding that out cost a release where **Claude Code
loaded none of this at all**. It checks every moment-name against a fixed list and throws out
the whole file over a single name it does not know — and the shared file carried five belonging
to other tools. It reported `failed to load` and registered nothing. Nobody noticed, because the
reminders people saw came from their own settings rather than from here.

Every tool does this. Claude Code says so out loud; the rest just go quiet. So each now reads a
file holding its own moments and nothing else:

| File | Read by |
| --- | --- |
| `hooks/hooks.json` | Claude Code and Codex — the three moments they both answer |
| `hooks/cursor.json` | Cursor, which takes a file its own listing names in preference to the shared one, and refuses one without a whole-number `version` — a key the shared file must not carry, because Codex refuses a file over it |
| `hooks.json` | Devin — at the plugin root, which Claude Code does not read at all |

That last row is load-bearing and was established by experiment: a name Claude Code rejects was
put in the root file, and the plugin still loaded.

### Antigravity and Copilot get no reminders for now

Their moments can only live in the file Claude Code also reads, and Claude Code refuses that
whole file over any name it does not recognise. There is no third place to put them: a separate
file for Antigravity was tried once and its own importer overwrote it, and Copilot follows the
same layout Claude Code does.

So rather than ship something that is either dead or takes every other tool down with it,
**nothing is declared for those two**. Both installed and were watched working before; neither
has been shown to receive a reminder under a test that would have caught this. Give either of
them a run that proves it reads a file of its own and this is a few lines to undo.

### What has actually been tried

Devin's limit above was found by running a real session and capturing exactly what it hands a
reminder — not by reading its documentation, which describes a richer message than the one that
actually arrives.

**Watching it work was not enough, and it is worth saying exactly how it failed.** Watching
proved a person saw the plugin do something. It did not prove the reminder's words ever reached
the AI. On Codex they never did: one unexpected line made it throw the whole reminders file away,
and it wants a reply in a particular shape, so plain words were discarded and reported as an error
on every single message. On Cursor they never did either, and Cursor said nothing at all about it.
On Claude Code the whole plugin never loaded.

**Then the bar was raised again, twice, because each version proved too little.** Showing the
right words reach the AI from a hand-written file says nothing about whether the shipped file
loads — that gap is exactly how the Claude Code failure hid behind a passing test. And a tool
reporting its own reminders as registered proves nothing either: it says so while delivering
nothing at all. What counts is two things and no others — install the real thing, then ask the
AI for a word only the reminder could have carried.

Against that bar: **Claude Code passes** — installed from a listing, it answered back a word
only the reminder carried.
**Codex** runs every reminder from an installed copy with no warning and no error. **Cursor** answers it too, from an
installed plugin reading the file of its own it moved to. Devin takes the plain wording it already gets.

Cursor was the last, and it is worth saying why it took two attempts. This repository briefly
shipped a Cursor-specific listing of what it contains; Cursor preferred that file over the one it
had been reading happily, could not make sense of it, and silently stopped finding the plugin at
all. Nothing reported an error — the install simply handed out a months-old version instead. The
file has been removed. Reading a tool's documentation was not enough here, and it was not enough
for two of the others either.

## Two pieces, on purpose

**`dazzer`** is the part that changes behaviour: the reminders, the capture sweep, and the skill.
It adds no connection of its own, so installing it can never disturb one you already have.

**`dazzer-connect`** is the connection, for people who have not already got one.

They are separate because bundling them broke the first minute for anyone already connected: a
bundled connection carries its own sign-in, so installing replaced a working connection with an
unauthenticated one and the Brain went dark until the sign-in was noticed. Someone who already
connected through the app should never have to re-authenticate to get a few reminders.

The trade is honest and worth stating: without `dazzer-connect`, we cannot tell your traffic
apart from a hand-configured connection. A plugin that disconnects someone is the worse outcome.

## What it does

**Tells the AI to check before answering.** Every prompt carries a short reminder to look in your
Brain first rather than answering from assumption.

**Tells it to save what settled.** At the end of a reply, when enough real work has accumulated,
it prompts a capture sweep. What actually gets saved is the model's judgment against your Brain's
own rules — this plugin never decides that and never writes anything itself.

**Restores your place after a context reset.** When a long session compacts, nothing reconnects
and the AI is never re-oriented. This is the one moment your Brain cannot reach on its own, so
the plugin covers it.

## What it never does

It never talks to Dazzer directly, never holds credentials, and never decides what is worth
saving. It only taps the model at the right moment; the model acts through the connection it
already owns and reads the current rules from your Brain at the moment it acts.

That is deliberate: it means the rules can change in your Brain and take effect immediately,
without you updating anything.

## Where the rules live

In your Brain, served live — `brain.door.entrance`, `brain.capture.protocol`, and
`brain.working.memory.contract`. This repository holds triggers, not teaching.

## Tuning

Set any of these in your environment to override the shipped value. The shipped values live
in `plugins/dazzer/config/capture.defaults`, which is read as plain data and never run.

| Variable | Default | Effect |
| --- | --- | --- |
| `DAZZER_CAPTURE_THRESHOLD` | `80` | How much new conversation accumulates before a save is prompted. Raise it for fewer interruptions, lower it to capture more eagerly. |
| `DAZZER_CAPTURE_STATE_TTL_DAYS` | `30` | How long a finished session's marker is kept before being tidied away. |
| `DAZZER_CAPTURE_RECEIPTS_MAX_BYTES` | `262144` | How large the record of what this did may grow before the old one is rolled aside. |
| `DAZZER_CAPTURE_MAX_INPUT_BYTES` | `100000` | A guard against an unreasonably large message, not a tuning dial. There is no reason to change it. |
| `DAZZER_TOOL` | works itself out | Which tool this is running inside, recorded in the run history. Only set it somewhere the automatic answer is wrong. |

A bad value never takes effect and never causes an error: anything that is not a whole
number falls back to the shipped default, silently and on purpose.

## Checking it is actually working

The plugin writes one line every time it runs, recording when, what it decided and why —
never any of your conversation. To see it:

```
cat "${CLAUDE_PLUGIN_DATA:-$HOME/.dazzer}/capture/receipts.jsonl" | tail
```

An empty file, or no file at all, means the plugin has never run — which is worth knowing,
because that failure is otherwise completely silent.

## Uninstall

Remove the part that changes behaviour:

```
/plugin uninstall dazzer@dazzer
```

If you also installed the connection, and you want that gone too:

```
/plugin uninstall dazzer-connect@dazzer
```

Leave that second one in place if Dazzer is still how you reach your Brain — removing it
takes the connection with it.
