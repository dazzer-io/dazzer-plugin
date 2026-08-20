# Dazzer

Makes your AI check what you already know before answering, and save what settles instead of
losing it when the conversation ends.

## Install

Two lines in most tools. The same plugin, the same files — only the command changes.

### Claude Code — Anthropic’s coding tool, separate from the Claude desktop app

```
/plugin marketplace add dazzer-io/dazzer-plugin
/plugin install dazzer@dazzer
```

Typed into Claude itself, not into your shell.

**Using the desktop app?** Install it from a terminal with the same two lines. The app and the
terminal share one set of settings, so it appears in the app on your next conversation. The
install command does not exist inside the app, so this genuinely needs a terminal once — even if
you never otherwise open one.

### Codex — OpenAI’s coding tool

```
codex plugin marketplace add dazzer-io/dazzer-plugin
codex plugin add dazzer@dazzer
```

Codex asks you to approve a plugin's reminders before it will run them. If nothing appears in the
run history described below, that approval is the first thing to check.

### GitHub Copilot — GitHub’s coding tool

```
copilot plugin marketplace add dazzer-io/dazzer-plugin
copilot plugin install dazzer@dazzer
mkdir -p ~/.copilot/instructions && cp ~/.copilot/installed-plugins/dazzer/dazzer/instructions/copilot.md ~/.copilot/instructions/dazzer.instructions.md
```

The third line is not patching a bad install. Copilot gives a reminder no way to speak, so the
check-your-Brain sentence is delivered as a standing instruction instead — Copilot reads it before
every conversation. **Re-run that third line after updating the plugin**, because it is a copy:
Copilot ignores a link.

**The other two reminders still do not arrive on Copilot** — see below for why.

### Antigravity — Google’s coding tool

It has no store to install from, so point it at a downloaded copy:

```
git clone https://github.com/dazzer-io/dazzer-plugin.git
agy plugin install ./dazzer-plugin/plugins/dazzer
agy plugin install ./dazzer-plugin/plugins/dazzer-antigravity
```

Two installs here rather than one, and it is not tidiness — Antigravity cannot read the first
one's reminders file, so the second carries them. See below for why.

**Two of the three reminders arrive** — checking your Brain before answering, and saving what
settled at the end of a reply. Being put back on track after a long conversation forgets itself
never can: that moment does not exist in this tool at all.

### Cursor — a code editor with an AI built into it

Two steps, and the second one happens inside Cursor rather than in a terminal.

```
cursor-agent plugin marketplace add https://github.com/dazzer-io/dazzer-plugin.git
```

Then, in Cursor, type `/add-plugin` and choose **dazzer** from the list.

Two things that cost real time when this was first tried, so they are written down here:

- **If you have installed it before, remove and re-add rather than update.** Cursor's update
  command reports success without actually re-fetching, so you keep whatever version you first
  got. `cursor-agent plugin marketplace remove dazzer` then add it again.
- **If you already have some other Dazzer setup wired into Cursor, take it out first**, or both
  fire on every reply and you get the save prompt twice.

One difference you will see rather than read about: Cursor offers no moment for a plugin to speak
privately to the AI, so the save prompt cannot be moved off your screen the way it has been
everywhere else. It only accepts a message and submits it as though you had typed it, so on Cursor
the save prompt is visible in your conversation. Everything works; it just is not silent.

### Devin — Cognition’s coding agent

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

**Run this whether or not you already have Dazzer.** It used to say the opposite — skip it if
Dazzer already shows as connected — and that one line stranded people. Somebody already installed
skips it, nothing ever asks them to sign in, and they end up with an AI told to check a Brain it
cannot open. Running it again is also how you get the current version.

You will be asked to sign in afterwards. That is the point rather than a cost: installing does not
sign you in on any tool, and the sign-in is the part that was missing.

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

**Cursor** — type `/add-plugin` in Cursor and choose **dazzer-connect**.

**Devin** — in a terminal:

```
devin plugins install dazzer-io/dazzer-plugin#plugins/dazzer-connect
```

### Signing in

**Installing does not sign you in. On any tool.** All six were walked on one afternoon and not one
of them reliably signs you in as part of the install. It happens the next time the tool starts up
and reaches out.

**So close your tool, start it again, and sign in when it asks.** That is the step, and it is the
same step everywhere. Where a tool needs a command as well, it is under its name below.

**Claude Code** — the sign-in appears during the install only on a machine that has never had
Dazzer. On every other machine the install is silent and nothing ever asks. If starting it again
does not prompt you, open the sign-in list yourself with `/mcp` and choose **dazzer**.

**Codex** — nothing appears on its own. Do it up front rather than waiting for the first thing that
reaches your Brain to fail quietly:

```
codex mcp login dazzer
```

**GitHub Copilot** — the sign-in appeared the next time the tool was started. Nothing during the
install.

**Devin** — it signed itself in without asking and worked. If yours does ask, this is when.

**Antigravity** — not established. It has been watched failing to reach the Brain at all, which is
the case to check for: ask it what your Brain knows about you, and if the answer is anything other
than real records, it is not signed in.

**Cursor** — not established.

**Whoever you are already signed in as is who it signs in as.** Nothing asks and nothing warns. If you are testing with a different account, sign out of Dazzer in your browser first, or the memories land under the wrong person and the dashboard you are watching never shows them.

**How to tell it worked, on any tool:** ask your AI what your Brain already knows about you. Real
records back means it is signed in. Anything else — a shrug, a file it found, a summary of your own
conversation — means it is not, whatever the install said.

Four of the six above are now watched rather than read about: Claude Code, Codex, Copilot and
Devin. Antigravity and Cursor are not, and say so where a person can see it.

**This section existed in one wording only, Claude's, and every other tool's setup simply ended
after the reminders.** Someone followed the Codex instructions to the letter on a clean machine,
was never asked to sign in because there was nothing to sign in to, and watched his AI go hunting
through an unrelated archive for the memory it had just been told to check. The command it needed
existed and worked the whole time. Nobody had written it down, and no rule asked whether anything
was missing — every rule here compared what we say against what we ship, and both said the same
thing. A rule that asks the missing question now exists.

### Staying current

**Nothing updates on its own.** Sources like this one have automatic updating switched off by
default — that is the tool makers' own default, not a choice of ours — so whatever version you
first installed is the version you keep, indefinitely. A machine was found sitting several versions
behind while reporting itself perfectly healthy.

**Claude Code** — turn it on once and forget it. Open the plugin panel with `/plugin`, go to
**Marketplaces**, choose **dazzer**, and select **Enable auto-update**. It keeps itself current
after that.

**Antigravity** — it runs from a copy you downloaded, so refresh the copy and install again:

```
git -C dazzer-plugin pull
```

Then re-run the three install lines above against it.

**Cursor** — its update command reports success without actually re-fetching, so removing and
adding again is the only thing that gets you a newer version:

```
cursor-agent plugin marketplace remove dazzer
```

Then add it again and install, as above.

**Codex, GitHub Copilot and Devin** — not established. Nothing here has been run on those three, so
there is no step to give you rather than a guess dressed up as one.

**Whatever the tool, removing the source and adding it back is the fallback that always re-fetches**
— at the cost of signing you out, so it is the last resort rather than the first.

### Where reminders cannot run at all

Claude's chat apps and the web app have no moment at which anything can run. There the bundled
skill carries the same intent as plain text, and reaching your Brain works exactly the same.

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

### Copilot: a reminder there can watch and block, but never speak

The reason recorded here before — that Copilot's moments had to share the file Claude Code reads —
was wrong, and it was wrong in a way worth keeping on the record, because it stood unchallenged
while it made a supported tool look unsupported. Copilot takes a file of its own without complaint.
Its moments even have different names from Claude Code's, so sharing was never going to work.

What is true was found by running it, not by reading about it. **A reminder runs on Copilot and has
no way to say anything to the model.** Both moments fired and left their mark on disk; five
different shapes of reply were tried in one go, including the exact shapes Cursor and Claude Code
use, and the model reported receiving nothing every time.

Two other routes were tried and one of them works:

- **What the connection announces when it opens** does reach the model, and the model acts on it —
  but only for three services GitHub owns, on a list baked into the program. Nothing we ship can
  join it. It only worked under test because a command-line override was passed, which nobody
  running Copilot normally would type.
- **A standing instruction file works, with nothing special passed.** Copilot reads
  `~/.copilot/instructions/*.instructions.md` before every conversation. With our one sentence
  there, asking a question the Brain could answer made the model go and ask it, unprompted. That is
  the third install line above.

So Copilot gets the check-your-Brain reminder, delivered a different way. It does not get the other
two, and cannot: saving what settled, and getting back on track after a reset, each need to speak at
a particular moment, and speaking is the half Copilot withholds.

**It is a copy, not a link** — a link was tried and Copilot ignored it. So an update to the plugin
does not reach the instruction until that line is run again.

**The file has to instruct, not remind, and this was nearly missed.** The first version shipped
opened by explaining to a human reader why reminders cannot work on this tool. The model reads that
file as its own standing instruction, explanation and all — so it was being told, in effect, that
Dazzer's prompting does not work here, and then asked to act on Dazzer's prompt.

The difference is not subtle and is not a matter of taste. Asked the same question six times, with
the connection attached and a Brain that could answer it, the explaining version made the model go
and ask **none of those six times**. Rewritten as a plain instruction that names what to call and
when, it asked **all six**.

Two things follow, and the second is the general one. **Anything put in that file is read by the
model**, so commentary belongs here in the README and never there. And **a wording change like this
must be measured over several runs, never one** — the first version was called working on the
strength of a single successful attempt, and a single attempt cannot tell a rule that is obeyed
from one that is obeyed sometimes.

### Antigravity gets no reminders for now

The reason recorded here before — that a separate file was tried and Antigravity's own importer
overwrote it — was wrong, and it kept a working capability shut off. Antigravity has a documented
way to carry reminders, its own moments fire, and **what a reminder says there does reach the
model**: asked to quote the sentence back, it did, word for word.

**What is actually in the way is a name collision with Devin.** Both look for a file called
`hooks.json` at the plugin root, and they want different shapes inside it. Antigravity discards the
whole file over one entry it does not recognise — the same behaviour as Claude Code. Proven by
putting both shapes in one file and watching every reminder vanish.

So Antigravity's reminders ship as **a second small plugin of their own**, `plugins/dazzer-antigravity`,
which is the extra install line above. Two further things were proven rather than assumed: given its
own file it works, and **a broken neighbour sitting beside it does not drag it down** — the failing
mixed file was left in place deliberately while the good one was tested.

**Saving what settled arrives too, and it needed one thing built.** Antigravity never says whether a
reply is the one our own save prompt asked for — every other tool says so outright. Leaning on the
amount of new work instead was tried and measured wrong: with the prompt made deliberately eager it
fired five times in a single reply and the answer repeated five times.

So where the host will not say it, the prompt now says it to itself: it leaves a note, and the very
next end-of-reply in that conversation reads the note, clears it, and stays quiet. One note,
consumed once, so a prompt can never answer its own prompt. The cost is that a genuine second reply
straight after a save is skipped — the safe direction, since the backstop fires a little less often
rather than twice. Three tests hold that note's whole life: left, read once, and gone.

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

**Tells it to save what settled.** Once enough real work has accumulated, your next message
quietly carries a prompt to save it, and the AI tells you in one line what it saved. What
actually gets saved is the model's judgment against your Brain's own rules — this plugin never
decides that and never writes anything itself.

That prompt used to go out at the end of a reply instead, and that was a mistake worth naming:
tools print anything said at that moment straight into your conversation, in full, under a word
of their own choosing — Claude Code painted it red as `Stop hook error`, which is what a
checkpoint doing exactly its job looked like to everyone who saw one. It also told the AI not to
finish, so it owed you another reply and usually filled it with a line about the checkpoint.
Carried with your next message, the same words reach the AI and nothing is drawn on your screen.
The one thing you will still see is the save itself, which is the part you should see.

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
| `DAZZER_CAPTURE_THRESHOLD` | `250` | How much new conversation accumulates before a save is prompted. Raise it for fewer checkpoints, lower it to capture more eagerly. |
| `DAZZER_CAPTURE_STATE_TTL_DAYS` | `30` | How long a finished session's marker is kept before being tidied away. |
| `DAZZER_CAPTURE_RECEIPTS_MAX_BYTES` | `262144` | How large the record of what this did may grow before the old one is rolled aside. |
| `DAZZER_CAPTURE_MAX_INPUT_BYTES` | `100000` | A guard against an unreasonably large message, not a tuning dial. There is no reason to change it. |
| `DAZZER_TOOL` | works itself out | Which tool this is running inside, recorded in the run history. Only set it somewhere the automatic answer is wrong. |
| `DAZZER_MOMENT` | set by the trigger | Which moment the save prompt is running in. Set by the plugin's own trigger, not by hand. |

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

On Antigravity there is a third piece, because its reminders could not travel in the same file as
everyone else's:

```
/plugin uninstall dazzer-antigravity@dazzer
```

On Copilot, the check-your-Brain instruction is a file rather than a plugin, so removing the plugin
leaves it behind. Delete it as well:

```
rm ~/.copilot/instructions/dazzer.instructions.md
```
