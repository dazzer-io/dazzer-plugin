# Install, sign in and update

## Before you start

You need a Dazzer account, which gives you a Dazzer Brain (see [dazzer.io](https://dazzer.io)), and
one of the tools below.

Every tool needs two pieces:

- **`dazzer`, the reminders.** Short notes that hooks add to what your AI reads at set points in a
  chat. A hook is a small command your tool runs at a set point, such as the start of a chat.
- **`dazzer-connect`, the connection.** Signs your tool in to your Dazzer Brain. Without it, your
  AI is told to check a Brain it cannot open.

The plugins install from a marketplace: the list of plugins in this repository that your tool reads.
Its name in your tool is `dazzer`.

**Install the connection even if Dazzer already shows as connected, then sign in.** A connection
can show as present and still be signed out. Installing the reminders never touches a connection,
but installing `dazzer-connect` beside a Dazzer connection you set up another way has not been
tested: if your AI stops reaching your Brain afterwards, sign in again.

**Signing in is a separate step.** In most tools nothing asks during the install: restart the tool
and sign in when it asks. Each tool's section says what happens there. The sign-in opens Dazzer's
sign-in page in your browser and uses the Dazzer account your browser is signed in to, without
asking which. To use a different account, sign out of Dazzer in your browser first, or what your AI
saves lands in the wrong Brain.

## Claude Code

Works the same in a terminal and in the Claude desktop app. Type these into Claude Code's own
prompt, not into your shell:

```text
/plugin marketplace add dazzer-io/dazzer-plugin
/plugin install dazzer@dazzer
/plugin install dazzer-connect@dazzer
```

The install command does not exist inside the Claude desktop app. Open Claude Code in a terminal
once, by typing `claude`, and type the lines there. The app and the terminal share one set of
settings, so the plugins appear in the app's next Claude Code chat.

Whether Claude Code asks you to approve the reminders before they run is not yet confirmed. The
checks under [Check it worked](#check-it-worked) show whether they ran.

**Sign in.** On a machine that has never had Dazzer, Claude Code may ask during the install. If it
does not, restart Claude Code and sign in when it asks. If nothing asks, type `/mcp`, choose
`plugin:dazzer-connect:dazzer`, and sign in there.

**Updates.** Claude Code turns automatic updates off by default for a marketplace like this one,
so you keep the version you installed until you update. To turn them on, type `/plugin`, go to
**Marketplaces**, choose **dazzer**, and select **Enable auto-update**. Claude Code then keeps the
plugins current.

To update by hand instead, type these lines into a terminal, not into Claude Code, in this order,
then restart Claude Code:

```sh
claude plugin marketplace update dazzer
claude plugin update dazzer@dazzer
claude plugin update dazzer-connect@dazzer
claude plugin update dazzer-plate@dazzer
```

The first line only refreshes the list of plugins. It prints a success message and changes nothing
you run. The lines after it update the plugins, and only a restart applies them. Skip the third
line if you did not install `dazzer-connect`, and the fourth if you did not install the plate pane.

**Removal.** See [Remove](#remove).

### The plate pane (optional)

A pane beside the chat that lists your open items from your Brain, in four tabs: **Needs you**,
**Waiting**, **Coming up** and **Later**. Claude Code only. Install it after the lines above, typed
into Claude Code's prompt:

```text
/plugin install dazzer-plate@dazzer
```

Then type `/plate`. Nothing opens or reads anything until you do. To remove `/plate` from the list
of commands, set the **Plate pane** option to **off** in `/config`.
[How it works](how-it-works.md#the-plate-pane) says what it reads and sends.

## Claude chat apps

Ordinary Claude chats, in the desktop, web or mobile app outside Claude Code, cannot run the
reminders, and this guide has no steps for connecting them.

## Codex

In a terminal:

```sh
codex plugin marketplace add dazzer-io/dazzer-plugin
codex plugin add dazzer@dazzer
codex plugin add dazzer-connect@dazzer
```

Codex asks you to approve a plugin's reminders before it runs them. Approve them, or nothing runs;
if [the run log](#check-it-worked) stays empty, check this first.

**Sign in.** Nothing asks on its own. Sign in straight away:

```sh
codex mcp login dazzer
```

**Updates.** No update step has been confirmed for Codex yet.

**Removal.** Not yet confirmed for Codex.

## ChatGPT app

This guide has no steps for the ChatGPT app. The steps above are for Codex.

## GitHub Copilot

In a terminal:

```sh
copilot plugin marketplace add dazzer-io/dazzer-plugin
copilot plugin install dazzer@dazzer
mkdir -p ~/.copilot/instructions && cp ~/.copilot/installed-plugins/dazzer/dazzer/instructions/copilot.md ~/.copilot/instructions/dazzer.instructions.md
copilot plugin install dazzer-connect@dazzer
```

The third line is part of the install. Copilot runs a plugin's hooks but does not pass what they
say to the AI. So the check-before-answering note goes in as an instruction file in
`~/.copilot/instructions/`, which Copilot reads at the start of every conversation. It is a copy,
because Copilot ignores a link, so **run that line again after every update**.

The prompt to save and the note after compaction do not reach the AI in Copilot.

**Sign in.** Nothing asks during the install. The sign-in appears the next time you start Copilot.

**Updates.** No update step has been confirmed for Copilot yet.

**Removal.** Removing the plugins is not yet confirmed for Copilot. The instruction file stays until
you delete it; see [Remove](#remove).

## Cursor

In a terminal:

```sh
cursor-agent plugin marketplace add https://github.com/dazzer-io/dazzer-plugin.git
```

Then, in Cursor, type `/add-plugin` and choose **dazzer**. Do it once more and choose
**dazzer-connect**.

- **If some other Dazzer setup is already wired into Cursor, take it out first**, or both run on
  every reply and you see the prompt to save twice.
- Cursor gives a plugin no hidden way to add a note at the end of a reply, so the prompt to save
  appears in your chat as a message, as though you had typed it.
- No note reaches the AI after compaction in Cursor.

**Sign in.** Not yet confirmed in Cursor. Restart Cursor, sign in if it asks, and
[check it worked](#check-it-worked).

**Updates.** Cursor's update command reports success without fetching anything new. Remove the
marketplace, then add it again and choose the plugins again, as above:

```sh
cursor-agent plugin marketplace remove dazzer
```

**Removal.** Removing the plugins themselves is not yet confirmed for Cursor.

## Antigravity

Antigravity installs from a downloaded copy of this repository. In a terminal:

```sh
git clone https://github.com/dazzer-io/dazzer-plugin.git
agy plugin install ./dazzer-plugin/plugins/dazzer
agy plugin install ./dazzer-plugin/plugins/dazzer-antigravity
agy plugin install ./dazzer-plugin/plugins/dazzer-connect
```

The first line creates a `dazzer-plugin` folder where you run it. Antigravity cannot read the main
reminders file, so `dazzer-antigravity` carries the same notes in Antigravity's format. The
check-before-answering note arrives with every message, and the prompt to save at the end of a
reply. Antigravity has no point after compaction at which a note could be added.

**Sign in.** Not yet confirmed in Antigravity. In one test it never reached the Brain at all.
Restart it, sign in if it asks, and [check it worked](#check-it-worked).

**Updates.** Not yet confirmed. The intended step is to refresh the downloaded copy, from the
folder you ran the first line in, then run the three `agy` lines above again:

```sh
git -C dazzer-plugin pull
```

**Removal.** Not yet confirmed for Antigravity.

## Devin

In a terminal:

```sh
devin plugins install dazzer-io/dazzer-plugin#plugins/dazzer
devin plugins install dazzer-io/dazzer-plugin#plugins/dazzer-connect
```

The check-before-answering note arrives with every message, and a note after compaction. That note
carries no label for the chat, so if you have saved progress from several chats, your AI may be
shown a list to choose from. The prompt to save does not work in Devin: Devin tells a plugin nothing
about how long the chat has grown, so the plugin cannot tell when to prompt.

**Sign in.** In testing, Devin signed in without asking. If yours asks, sign in then.

**Updates.** No update step has been confirmed for Devin yet.

**Removal.** Not yet confirmed for Devin.

## Check it worked

1. **The connection.** In a new chat, ask your AI `What does my Dazzer Brain know about me?` If it
   reached your Brain, it answers from it. An empty Brain answers that nothing is recorded yet,
   which still means you are connected. In Claude Code, the call to your Brain shows in the chat.
   If your AI says it cannot reach your Brain, or answers from files or the chat itself, it is not
   signed in.
2. **A save and a read.** Tell it `Remember that our project is called Lumen.` Then, in another new
   chat, ask `What is our project called?` An answer of Lumen came from your Brain.
3. **The reminders.** Ask your AI `Quote the note starting [Dazzer] that you were given in this
   chat.` If it quotes one, the reminders reached it.
4. **The run log.** The prompt to save writes one line to a run log each time it runs: when, which
   tool, which version, and what it decided and why, never what was said. The check-before-answering
   note writes nothing.

   In Claude Code the log is `~/.claude/plugins/data/dazzer-dazzer/capture/receipts.jsonl`, the
   folder Claude Code gives the plugin. In tools that give the plugin no folder of its own, it is
   `~/.dazzer/capture/receipts.jsonl`, which this command reads from a terminal:

   ```sh
   cat "${CLAUDE_PLUGIN_DATA:-$HOME/.dazzer}/capture/receipts.jsonl" | tail
   ```

   Which folder each tool other than Claude Code uses is not yet confirmed. A log with lines means
   the prompt to save ran; a missing log in the right folder means it never has.

## Remove

In Claude Code, typed into its prompt. Remove the reminders:

```text
/plugin uninstall dazzer@dazzer
```

The connection, if you want it gone too. Keep it if Dazzer is still how you reach your Brain:

```text
/plugin uninstall dazzer-connect@dazzer
```

The plate pane, if you installed it:

```text
/plugin uninstall dazzer-plate@dazzer
```

The Antigravity piece, if you installed it in Claude Code from the same marketplace:

```text
/plugin uninstall dazzer-antigravity@dazzer
```

In Copilot, the instruction file is a copy, so removing the plugins leaves it behind. Delete it in a
terminal:

```sh
rm ~/.copilot/instructions/dazzer.instructions.md
```

In Codex, Cursor, Antigravity and Devin, removal steps are not yet confirmed.
