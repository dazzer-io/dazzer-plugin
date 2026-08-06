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

All three reminders work here, quietly, the same way they do in Claude's.

### Antigravity — Google's coding tool

It has no store to install from, so point it at a downloaded copy:

```
git clone https://github.com/dazzer-io/dazzer-plugin.git
agy plugin install ./dazzer-plugin/plugins/dazzer
```

Two of the three reminders work. Being put back on track after a long conversation forgets itself
does not — that moment does not exist in this tool at all, so nothing we add can fix it.

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

Everything above adds the **reminders**. They need your Brain to already be reachable from that
tool. If it is not, each tool has its own one-time sign-in — and in Claude you can get it from the
same place:

```
/plugin install dazzer-connect@dazzer
```

Skip that if Dazzer already shows as connected. Installing it again would replace a working
connection with one that needs signing in.

### Where reminders cannot run at all

Claude's chat apps and the web app have no moment at the end of a reply for anything to run. There
the bundled skill carries the same intent as plain text, and reaching your Brain works exactly the
same.

### What has actually been tried

All six were installed into a real copy of the tool and watched working: Claude Code, Codex,
Copilot, Antigravity, Cursor and Devin. Devin's limit above was found by running a real session
and capturing exactly what it hands a reminder — not by reading its documentation, which describes
a richer message than the one that actually arrives.

**Watching it work was not enough, and it is worth saying exactly how it failed.** Watching
proved a person saw the plugin do something. It did not prove the reminder's words ever reached
the AI. On Codex they never did: one unexpected line made it throw the whole reminders file away,
and it wants a reply in a particular shape, so plain words were discarded and reported as an error
on every single message. On Cursor they never did either, and Cursor said nothing at all about it.

So the bar is now a harder one. A reminder is given a word the AI could not otherwise know, and
the AI is asked that word back. **Claude Code, Codex and Cursor each answered it**, so on those
three the words are proven to arrive. Devin takes the plain wording it already gets.

**Antigravity and Copilot are not settled, and are marked that way on purpose.** Antigravity's
required shape comes from its published reference rather than from a run. Copilot's reference says
it does not read anything a reminder prints at the per-message moment — which would mean its
recall reminder cannot arrive — but that same reference was already caught being wrong about this
tool once, by running it, so nothing here has been changed on its word. Copilot's moments are
still the ones a real session confirmed. Settling those two needs a run, not more reading.

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

## Update

**Installing once does not keep you current.** Each tool keeps the copy it first downloaded
until you tell it otherwise, so a fix published today reaches you only when you ask for it.

### Claude

**These two go in a terminal, unlike the install steps above.** Typing `/plugin update` into
Claude opens a menu and quietly keeps the copy you already had — there is no such command.

```
claude plugin marketplace update dazzer
```
```
claude plugin update dazzer@dazzer
```

### Codex

```
codex plugin marketplace upgrade dazzer
```
```
codex plugin add dazzer@dazzer
```

Adding it again replaces the copy you had, so the reminders never fire twice.

### Cursor

Removing and adding again, **not** updating — Cursor reports a successful update without
fetching anything, so an update leaves you on whatever version you first got.

```
cursor-agent plugin marketplace remove dazzer
```
```
cursor-agent plugin marketplace add https://github.com/dazzer-io/dazzer-plugin.git
```

Then, in Cursor, type `/plugins` and choose **dazzer** — the same last step as installing.
Re-adding makes it available again; it does not switch it back on.

### The connection

Only if you installed `dazzer-connect` as well:

```
claude plugin marketplace update dazzer
```
```
claude plugin update dazzer-connect@dazzer
```

### Copilot, Antigravity and Devin

**Not established.** Nobody has run an update against these three, so nothing is printed
here rather than a guess that fails quietly — and for two of them their own documentation
has already been wrong about this plugin once. Reinstalling with the steps at the top of
this file is the honest fallback.

## Uninstall

Remove the part that changes behaviour.

### Claude

```
/plugin uninstall dazzer@dazzer
```

### Codex

```
codex plugin remove dazzer@dazzer
```

The marketplace has to be named alongside the plugin. Codex refuses the plugin name on its own.

### Cursor

```
cursor-agent plugin marketplace remove dazzer
```

### Copilot, Antigravity and Devin

**Not established**, for the same reason as updating.

### The connection

If you also installed the connection, and you want that gone too:

```
/plugin uninstall dazzer-connect@dazzer
```

Leave that second one in place if Dazzer is still how you reach your Brain — removing it
takes the connection with it.
