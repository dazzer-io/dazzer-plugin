# How it works

The plugins add short notes to what your AI reads at set points in a chat: when it starts, when you
send a message, at the end of a reply, or after the chat is compacted. The notes say when to check
your Dazzer Brain and when to save to it. Everything else happens through the connection your tool
holds: your AI reads from your Brain and saves to it there.

## Words used in these docs

| Word | Meaning |
| --- | --- |
| Dazzer Brain | Your shared record, kept by Dazzer, of what you and your team know and decide. |
| Connection | How your tool reaches your Brain, signed in as you. `dazzer-connect` adds one. |
| Hook | A small command your tool runs at a set point in a chat. The plugins' hooks add the notes. |
| Reminders | The notes the hooks add: check before answering, prompt to save, note after compaction. |
| Prompt to save | The note asking your AI to save what was decided. It starts `Dazzer checkpoint`. |
| Compaction | When your tool shortens a long chat to make room. Your AI can lose what it was told earlier. |
| Saved progress | Where the work in a chat stands, which your AI saves to your Brain and restores after compaction. |
| Plate | Your open items in your Brain: what needs you, what waits on others, what is coming up, what can wait. |
| Skill | A short instruction file your tool loads when a request matches its description. `dazzer` ships one. |
| Marketplace | The list of plugins in this repository that your tool installs from. Its name in your tool is `dazzer`. |

## The pieces

| Piece | What it is | Who needs it |
| --- | --- | --- |
| `dazzer` | The reminders, the prompt to save and a skill. Carries no connection. | Everyone |
| `dazzer-connect` | The connection to your Brain, at `https://graph.dazzer.io/mcp`, and nothing else. | Everyone: the reminders need it to reach your Brain |
| `dazzer-antigravity` | The same reminders in Antigravity's format. | Antigravity only |
| `dazzer-plate` | The plate pane. Reads through the connection you already have. | Claude Code only, optional |

The reminders and the connection are separate on purpose, so installing the reminders never touches
a connection. Installing `dazzer-connect` beside a Dazzer connection you set up another way has not
been tested. The [decision record](decisions/0001-reminders-apart-from-the-connection.md) explains
why.

## What reaches your AI

| Note | What your AI is told |
| --- | --- |
| Check before answering | Look in your Brain before answering anything it may already know, and say so plainly if the Brain cannot be reached. |
| Prompt to save | Save what was decided; say nothing if nothing was. |
| After compaction | Restore your saved progress before carrying on, and before asking you to repeat anything. |

When each note arrives, by tool:

| Tool | Check before answering | Prompt to save | After compaction |
| --- | --- | --- | --- |
| Claude Code, Codex | Start of each chat | With your next message | Yes, with this chat's label |
| Copilot | Start of each conversation, from the instruction file | Does not arrive | Does not arrive |
| Cursor | Start of each chat | End of a reply, as a message in your chat | None |
| Antigravity | Every message | End of a reply | None |
| Devin | Every message | Does not run | Yes, without a label |

Every note a hook adds starts with `[Dazzer]` or `Dazzer checkpoint`, so it cannot be mistaken for
your own words. In Copilot the same sentence sits in the instruction file. The notes go to your AI
model as part of the chat, like anything else in it.

The skill is a short file that tells your AI when to reach for your Brain and that Dazzer's
instructions for using it, such as what is worth saving and how to record it, are read from the
Brain itself. Neither the notes nor the skill carry those instructions: your AI reads the current
ones from your Brain when it needs them, so Dazzer can change them without a plugin update.

### The prompt to save

The prompt is a backstop for when your AI has not saved on its own. Each time it could run, the
plugin counts the lines in the record your tool keeps of the chat (in Claude Code, each message,
tool call and tool result adds lines). Once 250 new lines have built up since the last prompt, the
prompt goes out. In a busy chat that is roughly every six of your messages; in a quiet one, about
every twenty. Your AI judges what is worth keeping, saves it, and tells you in one line what it
saved. If nothing was decided, it says nothing.

In Claude Code and Codex the prompt rides with your next message, so nothing appears on screen.
Cursor and Antigravity offer no such point, so there it goes at the end of a reply. In Cursor it
appears in your chat as a message, as though you had typed it. To keep a prompt from answering
itself in these two tools, the plugin leaves a one-time note on disk that the very next reply reads
and deletes; the cost is that a genuine second reply straight after a prompt gets none. Devin tells
a plugin nothing about how long the chat has grown, so there the prompt never runs.

### After compaction

Your AI saves its progress in a chat as it goes. After compaction it is told to restore that
progress before carrying on. In Claude Code and Codex, the note at the start of the chat, the prompt
to save and the note after compaction all carry the same label for the chat, made from the id your
tool already gives it, so your AI saves under it and restores from it, never another chat's work.
In Devin the note carries no label, so if several chats have saved progress your AI may be shown a
list to choose from.

## Each tool in its own format

Tools read hooks in different formats, and most ignore a whole file over one entry they do not
recognise. So each tool reads its own file, with the same words:

- **Claude Code and Codex** share one file.
- **Cursor** and **Devin** each read a file of their own.
- **Antigravity** looks for the same file name as Devin but needs a different format inside it, so
  its hooks ship as the separate `dazzer-antigravity` plugin.
- **Copilot** runs a plugin's hooks but does not pass what they say to the AI. The check before
  answering goes in as an instruction file instead, which you copy in during the install.
- **Claude chats outside Claude Code** cannot run hooks.

## The plate pane

Claude Code only, and optional. Type `/plate` to open it; nothing opens or reads anything until you
do. At the top: the day and one line of counts. Below: four tabs, **Needs you**, **Waiting**,
**Coming up** and **Later**, each with its count.

Each item is a card. Its tag says why it is there, for example `8 DAYS LATE` or `DUE SAT 10 OCT`,
with `(A GUESS)` when Dazzer read it from the item's own words and is not sure. Then
its title, what it is part of, who it is from, and when it last moved. **Later** groups what can
wait by what it belongs to: the 30 largest groups, then how many more. **Refresh** reads your plate
again.

**What it sends to Dazzer.** Through the connection Claude Code already has, and only to a server
offering both of Dazzer's tools for reading your Brain (`recall`) and tracking work (`track`): the
words `what is on my plate`, your computer's time zone, the label `plate-pane`, and a group's number
when you open one in **Later**. Once open, it reads again when you press **Refresh** and after your
AI changes an item. A read with no answer after 20 seconds says it could not reach Dazzer.

**What it sends to your AI, as you.** Only when you press a button. A card's **Open** shows two:

- **Done** sends one sentence with the item's number, such as `Mark item 7240 done.` Your AI marks
  it done, and the pane updates on the next plate it reads.
- **Talk about it** sends `Tell me about item 7240.`, once per item until the pane reads your plate
  again.

An item's title never goes with either sentence: other people who share your Brain can write
titles, and these sentences go as your own words.

**In auto mode**, where Claude Code decides which actions to allow without asking you, it may
refuse the pane's own read. Then `/plate`, **Refresh** and opening a group in **Later** each send
your AI one question as your message instead: `What is on my plate? My time zone is <your time
zone>.`, or `Show my later items in plate group <the group's number>.` The pane draws what your AI
reads, one question at a time.

**What it keeps.** The last plate it read, and each group it opened, for that session only. Nothing
goes to disk, and nothing is shared with another session or account.

## What leaves your machine

- **The reminders and the prompt to save send nothing over the network.** They run on your
  machine and only add notes to the chat.
- **The connection** is how your tool talks to your Brain at `https://graph.dazzer.io/mcp`, signed
  in as you. Each request carries two headers naming the plugin and its version,
  `X-Dazzer-Distribution: plugin` and `X-Dazzer-Plugin-Version`. What your AI looks up and saves
  travels this way.
- **The plate pane** sends what is listed above, through the same connection.
- **The notes themselves** reach your AI model's provider as part of the chat, like everything else
  you send.

## What is stored on your machine

The prompt to save keeps its files in a `capture` folder, inside the folder your tool gives the
plugin, or in `~/.dazzer/capture/` where the tool gives it none:

| Tool | Folder |
| --- | --- |
| Claude Code | `~/.claude/plugins/data/dazzer-dazzer/capture/` |
| Codex | `~/.codex/plugins/data/dazzer-dazzer/capture/` |
| GitHub Copilot | `~/.copilot/plugin-data/dazzer/dazzer/capture/` |
| Cursor and Antigravity | `~/.dazzer/capture/` |
| Devin | None: the prompt to save does not run in Devin. |

In it:

- **`receipts.jsonl`**, the run log: one line each time the prompt to save runs, with the time, the
  tool, the plugin version, and what it decided and why. Never any of the chat. When it passes
  262,144 bytes (256 KiB) it is renamed `receipts.jsonl.1`, replacing the previous one, and a new
  log starts.
- **One counter file per chat**, named after the chat's id, holding the line count at the last
  prompt. Files untouched for 30 days are deleted the next time a prompt goes out.
- **A one-time note per chat** in Cursor and Antigravity, deleted by the next reply.

Elsewhere:

- **The plugins themselves**, in your tool's own plugin folder, like any plugin.
- **In Copilot**, the instruction file you copy in, at
  `~/.copilot/instructions/dazzer.instructions.md`. It stays after you remove the plugins, until you
  delete it.
- **In Antigravity**, the `dazzer-plugin` folder you downloaded.

The sign-in to your Brain is held by your tool, not by the plugins.

## Settings

Set any of these in your environment to override the shipped value. A value that is not a whole
number never takes effect and never causes an error: the shipped default is used instead.

| Variable | Default | Effect |
| --- | --- | --- |
| `DAZZER_CAPTURE_THRESHOLD` | `250` | How many new lines of the chat record build up before the prompt to save. Raise it for fewer prompts, lower it to save more eagerly. |
| `DAZZER_CAPTURE_STATE_TTL_DAYS` | `30` | How many days an untouched counter file is kept before it is deleted. |
| `DAZZER_CAPTURE_RECEIPTS_MAX_BYTES` | `262144` | How large the run log may grow, in bytes, before it is renamed and a new one started. |
| `DAZZER_CAPTURE_MAX_INPUT_BYTES` | `100000` | The most the plugin reads of what your tool hands it at once. A guard, not a tuning dial. |
| `DAZZER_TOOL` | works itself out | Which tool this is running inside, recorded in the run log. Set it only where the automatic answer is wrong. |
| `DAZZER_MOMENT` | set by the hook | Whether the prompt to save is running with your next message or at the end of a reply. The plugin's own hook sets it; leave it unset. |
