# Dazzer for Claude Code

Makes your AI check what you already know before answering, and save what settles instead of
losing it when the conversation ends.

## Install

```
/plugin marketplace add dazzer-io/dazzer-plugin
/plugin install dazzer@dazzer
```

**If Dazzer does not already show as connected**, also run:

```
/plugin install dazzer-connect@dazzer
```

then sign in when a browser window opens.

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

| Variable | Default | Effect |
| --- | --- | --- |
| `DAZZER_CAPTURE_THRESHOLD` | `80` | Lines of conversation growth required between capture sweeps. Raise it for fewer interruptions, lower it to capture more eagerly. |

## Supported clients

The reminders work anywhere that runs Claude Code plugins. In clients where hooks do not run —
Claude Desktop and the web app — the bundled skill carries the same intent as plain text, and the
connection itself works exactly the same.

## Uninstall

```
/plugin uninstall dazzer@dazzer
```
