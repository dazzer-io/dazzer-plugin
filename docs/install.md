# Install, sign in and update

Every tool needs two pieces:

- **`dazzer`**, the reminders. They tell your AI to check your Brain, save what settles and pick up
  after a reset. They carry no connection, so they never disturb one you already have.
- **`dazzer-connect`**, the connection to your Brain. The reminders cannot reach your Brain by
  themselves: an AI told to check something it cannot open goes looking and finds whatever else it
  has.

**Install the connection even if Dazzer already shows as connected.** Installing it again is also how
you get the current version.

**Installing does not sign you in, on any tool.** Close your tool, start it again, and sign in when
it asks. Where a tool needs a command as well, it is under that tool's name below.

**Whoever you are signed in as in your browser is who it signs in as.** Nothing asks and nothing
warns. If you are trying it with a different account, sign out of Dazzer in your browser first, or
what your AI saves lands under the wrong person.

## Claude

### Claude Code

Typed into Claude itself, not into your shell:

```text
/plugin marketplace add dazzer-io/dazzer-plugin
/plugin install dazzer@dazzer
/plugin install dazzer-connect@dazzer
```

**Sign in.** The sign-in appears during the install only on a machine that has never had Dazzer. On
every other machine the install is silent, so close Claude Code, start it again, and sign in when it
asks. If it does not ask, open the sign-in list yourself with `/mcp` and choose **dazzer**.

**Updates.** Claude Code switches automatic updates off by default for a marketplace like this one,
so you keep the version you first installed until you update. To switch them on, open the plugin
panel with `/plugin`, go to **Marketplaces**, choose **dazzer**, and select **Enable auto-update**.
It keeps itself current after that.

To update by hand, run every line, in this order, in a terminal, then restart Claude Code:

```sh
claude plugin marketplace update dazzer
claude plugin update dazzer@dazzer
claude plugin update dazzer-connect@dazzer
claude plugin update dazzer-plate@dazzer
```

The first line only refreshes the list of what exists. It prints a success message and leaves you
on the version you were already on. The lines after it are what move the version you run, and only a
restart applies them. Drop the third line if you never installed the connection separately, and the
fourth if you never installed the plate pane.

### The plate pane (Claude Code only, optional)

A pane beside the chat that shows your plate from your Brain: what needs you now, what is waiting
on someone else, what is coming up, and what can wait. Install it after the lines above:

```text
/plugin install dazzer-plate@dazzer
```

Then type `/plate`. Nothing opens by itself. To keep `/plate` from being offered at all, set its
**Plate pane** option to **off** in `/config`. [How it works](how-it-works.md#the-plate-pane) says
what it reads and sends.

### The Claude desktop app

Install from Claude Code in a terminal with the same lines. The app and the terminal share one set
of settings, so it appears in the app on your next conversation. The install command does not exist
inside the app, so this needs a terminal once, even if you never otherwise open one. The plate pane
installs the same way.

### Claude's chat and web apps

No reminder can run there: those apps have no moment at which anything runs. The plugin's skill
carries the same intent as plain text, and reaching your Brain works the same.

## ChatGPT and Codex

These steps are for Codex, in a terminal. The ChatGPT app has no steps in this guide yet.

```sh
codex plugin marketplace add dazzer-io/dazzer-plugin
codex plugin add dazzer@dazzer
codex plugin add dazzer-connect@dazzer
```

Codex asks you to approve a plugin's reminders before it runs them. If nothing appears in the
[run log](#check-it-worked), that approval is the first thing to check.

**Sign in.** Nothing appears on its own. Sign in straight away, rather than waiting for the first
call to your Brain to fail quietly:

```sh
codex mcp login dazzer
```

**Updates.** No update step has been confirmed for Codex yet. See [the fallback](#if-an-update-does-not-arrive).

## GitHub Copilot

In a terminal:

```sh
copilot plugin marketplace add dazzer-io/dazzer-plugin
copilot plugin install dazzer@dazzer
mkdir -p ~/.copilot/instructions && cp ~/.copilot/installed-plugins/dazzer/dazzer/instructions/copilot.md ~/.copilot/instructions/dazzer.instructions.md
copilot plugin install dazzer-connect@dazzer
```

The third line is part of the install, not a repair. Copilot gives a plugin's reminders no way to
speak to the AI, so the check-your-Brain sentence goes in as a standing instruction, which Copilot
reads before every conversation. It is a copy, because Copilot ignores a link, so **run that line
again after every update**.

Saving what settles and picking up after a reset do not arrive on Copilot: both need to speak at a
particular moment.

**Sign in.** The sign-in appears the next time you start Copilot. Nothing appears during the
install.

**Updates.** No update step has been confirmed for Copilot yet. See [the fallback](#if-an-update-does-not-arrive).

## Cursor

Two steps, and the second happens inside Cursor. In a terminal:

```sh
cursor-agent plugin marketplace add https://github.com/dazzer-io/dazzer-plugin.git
```

Then, in Cursor, type `/add-plugin` and choose **dazzer**. Do it once more and choose
**dazzer-connect**.

- **If you have installed it before, remove it and add it again rather than update.** Cursor's
  update reports success without fetching anything new.
- **If some other Dazzer setup is already wired into Cursor, take it out first**, or both run on
  every reply and you see the save prompt twice.

Cursor gives a plugin no private way to speak to the AI, so the save prompt appears in your chat as
though you had typed it. It does its job; it is just not silent.

**Sign in.** Not yet confirmed on Cursor. Restart Cursor, sign in if it asks, and
[check it worked](#check-it-worked).

**Updates.** Remove the marketplace, then add it and install again, as above:

```sh
cursor-agent plugin marketplace remove dazzer
```

## Antigravity

Antigravity has no store to install from, so point it at a downloaded copy. In a terminal:

```sh
git clone https://github.com/dazzer-io/dazzer-plugin.git
agy plugin install ./dazzer-plugin/plugins/dazzer
agy plugin install ./dazzer-plugin/plugins/dazzer-antigravity
agy plugin install ./dazzer-plugin/plugins/dazzer-connect
```

Antigravity cannot read the main plugin's reminders file, so `dazzer-antigravity` carries them in
the one shape it accepts. Checking your Brain and saving what settles both arrive. Picking up after a
reset cannot: that moment does not exist in Antigravity.

**Sign in.** Not yet confirmed on Antigravity. Restart it, sign in if it asks, and
[check it worked](#check-it-worked).

**Updates.** Refresh the downloaded copy, then run the install lines above again:

```sh
git -C dazzer-plugin pull
```

## Devin

In a terminal:

```sh
devin plugins install dazzer-io/dazzer-plugin#plugins/dazzer
devin plugins install dazzer-io/dazzer-plugin#plugins/dazzer-connect
```

Checking your Brain and picking up after a reset both work. The save prompt does not: Devin tells a
plugin nothing about how much conversation has built up, so the prompt has nothing to measure and
stays quiet.

**Sign in.** In testing it signed itself in without asking. If yours asks, this is when.

**Updates.** No update step has been confirmed for Devin yet. See [the fallback](#if-an-update-does-not-arrive).

## Check it worked

Ask your AI what your Brain already knows about you. Real records back means it is signed in.
Anything else, such as a shrug, a file it found or a summary of your own chat, means it is not,
whatever the install said.

The plugin also writes one line to a run log every time it runs: when, what it decided and why,
never any of your conversation. To read it:

```sh
cat "${CLAUDE_PLUGIN_DATA:-$HOME/.dazzer}/capture/receipts.jsonl" | tail
```

An empty file, or no file, means the plugin has never run. That failure is otherwise silent.

## If an update does not arrive

Whatever the tool, removing the source and adding it back always fetches the current version. It
signs you out, so use it last.

## Remove

Remove the reminders:

```text
/plugin uninstall dazzer@dazzer
```

If you also installed the connection and want it gone too:

```text
/plugin uninstall dazzer-connect@dazzer
```

Keep it if Dazzer is still how you reach your Brain: removing it takes the connection with it.

If you installed the plate pane:

```text
/plugin uninstall dazzer-plate@dazzer
```

On Antigravity there is a third piece:

```text
/plugin uninstall dazzer-antigravity@dazzer
```

On Copilot, the check-your-Brain instruction is a file rather than a plugin, so removing the plugin
leaves it behind. Delete it as well:

```sh
rm ~/.copilot/instructions/dazzer.instructions.md
```
