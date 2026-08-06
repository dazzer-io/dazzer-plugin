#!/usr/bin/env node
/**
 * @purpose Keeps the sentences the reminders speak agreeing with the sentences we tell
 * anyone else to look for. Onboarding proves the reminders are installed by checking that
 * one of these turned up in what the AI could see - nothing else puts them there - so the
 * wording stopped being cosmetic the moment anything outside this repository read it.
 *
 * The failure this exists for runs the wrong way round from the usual one. Reword a
 * reminder and every check here still passes, while onboarding goes on looking for the old
 * wording and reports EVERY correctly installed person as not set up. A guard against half
 * finished setups turns into a machine for rejecting finished ones, and nothing says so.
 *
 * Both directions matter, and the second is the dangerous one:
 *   - a sentence a hook speaks that nothing declares  -> a reader cannot know to expect it
 *   - a declared sentence no hook speaks             -> the reader waits for words nobody says
 *
 * It also closes a duplication that predates any of this: the sentences are written out in
 * full in every hook file, and until now nothing compared them to each other.
 */

import { existsSync } from "node:fs";
import { join, sep } from "node:path";
import { REPO_ROOT, readJson, rel, runGate, walk } from "./lib/gate.mjs";

const MANIFEST = join(REPO_ROOT, "tools.manifest.json");

/** Every reminder we speak opens with this, which is what makes one findable in a reply. */
const SPOKEN_MARK = "[Dazzer]";

/** The script the end-of-reply prompt exists to run. Naming it is the only way to tell a
 * working prompt from one somebody silenced without removing. */
const RUNS_THE_SWEEP = "capture-sweep.sh";

/** A reminder speaks by printing. The end-of-reply script runs a file and is not one. */
const EMITTER = new Set(["printf", "echo"]);

/**
 * Anything that would make a shell do something rather than just hand over words. None of
 * these belong in a reminder, and the presence of one is the difference between a sentence
 * and an instruction.
 */
const MAKES_IT_DO_SOMETHING_EVEN_QUOTED = new Set(["$", "`"]);
const MAKES_IT_DO_SOMETHING = new Set([
  ...MAKES_IT_DO_SOMETHING_EVEN_QUOTED,
  ";", "|", "&", "<", ">", "(", ")", "\n",
]);

/**
 * Characters a shell would try to match against filenames. `[Dazzer]` unquoted is not a
 * word, it is a pattern matching any one of D, a, z, e, r - so in a folder holding a file
 * called `r`, the marker every reader looks for is replaced by that filename before the
 * reminder is ever spoken.
 */
const MATCHED_AGAINST_FILENAMES = new Set(["*", "?", "[", "]", "~"]);

/**
 * Braces. Some shells rewrite `{a,b}` into two words before the command runs and some do
 * not, so an unquoted payload arrives whole on one machine and torn in half on the next,
 * with nothing to say which you got. Every shape here is a JSON object, which makes this
 * the worst character to be relaxed about.
 */
const REWRITTEN_ON_SOME_MACHINES = new Set(["{", "}"]);

/** Inside double quotes a backslash escapes only these; before anything else it is literal. */
const ESCAPABLE_IN_DOUBLE_QUOTES = new Set(['"', "\\", "$", "`"]);

/**
 * The words a shell would hand to the command, worked out rather than obtained by running
 * it.
 *
 * Why not just run it: this file is checked on every proposed change, including changes
 * proposed by strangers, and the commands live in a file those changes can edit. Running
 * them would mean any proposal could make our own checks carry out its instructions. The
 * workflow beside this one promises there is "no supply chain to trust", and executing the
 * thing under test is exactly how that promise would quietly stop being true.
 *
 * Why not read it as text either: the wording sits inside quoting, and one apostrophe in
 * ordinary English - "what's recorded" - ends that quoting early. The sentence still reads
 * perfectly; only the quoting is wrong. A pattern over the raw line cannot see that, which
 * is how a version of this reported the shipped defect as fine.
 *
 * So the quoting is followed properly, the way a shell would: quotes open and close, a
 * backslash escapes the next character, and anything that would start a second command
 * stops the walk. Throws for a caller to turn into a finding.
 */
const CONTINUED =
  "it is split across lines with a backslash, and a shell deletes both that backslash and " +
  "the newline - so the words either side run together into something else";

function wordsOf(command) {
  const words = [];
  let word = "";
  let started = false;
  let quote = "";

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    if (quote === "'") {
      // Nothing is special inside single quotes, which is what makes '\'' work: it closes,
      // hands over one escaped apostrophe, and opens again.
      if (ch === "'") quote = "";
      else { word += ch; started = true; }
      continue;
    }

    if (quote === '"') {
      // A backslash here escapes only a few characters. Before anything else the shell
      // keeps BOTH, so dropping it would have this gate vouch for one sentence while the
      // person receives another.
      if (ch === "\\" && command[i + 1] === "\n") throw new Error(CONTINUED);
      if (ch === "\\" && ESCAPABLE_IN_DOUBLE_QUOTES.has(command[i + 1])) {
        word += command[++i];
        continue;
      }
      if (ch === '"') { quote = ""; continue; }
      if (MAKES_IT_DO_SOMETHING_EVEN_QUOTED.has(ch)) {
        throw new Error(`"${ch}" would make a shell do something, even inside quotes`);
      }
      word += ch;
      continue;
    }

    if (ch === "'" || ch === '"') { quote = ch; started = true; continue; }
    if (ch === "\\" && command[i + 1] === "\n") throw new Error(CONTINUED);
    if (ch === "\\" && i + 1 < command.length) { word += command[++i]; started = true; continue; }
    if (ch === " " || ch === "\t") {
      if (started) { words.push(word); word = ""; started = false; }
      continue;
    }
    if (ch === "#" && !started) throw new Error("a comment starts here, so the rest is never said");
    if (MAKES_IT_DO_SOMETHING.has(ch)) {
      throw new Error(`"${ch}" would make a shell do something beyond saying words`);
    }
    if (MATCHED_AGAINST_FILENAMES.has(ch)) {
      throw new Error(`"${ch}" is matched against filenames unless it is quoted`);
    }
    if (REWRITTEN_ON_SOME_MACHINES.has(ch)) {
      throw new Error(`"${ch}" is rewritten by some shells and not others unless it is quoted`);
    }
    word += ch;
    started = true;
  }

  if (command.endsWith("\\")) throw new Error("it ends on a backslash, which the shell swallows");
  if (quote !== "") throw new Error("the quoting never closes - an apostrophe in the wording is the usual cause");
  if (started) words.push(word);
  return words;
}

/**
 * What a hook says, or undefined if it says nothing this gate can vouch for. A reason it
 * cannot is reported rather than skipped, because a silent skip is how a gate stops
 * watching a file without anyone noticing.
 */
function saidBy(command, trigger, file, findings, required) {
  const cmd = command.trim();

  // Is this a reminder at all? Only the first word decides, and it is never quoted. The
  // end-of-reply script runs a file and legitimately needs the things a reminder may not
  // contain, so it must be set aside before any of them are objected to.
  if (!EMITTER.has(cmd.split(/\s/, 1)[0])) {
    if (required) {
      findings.push({
        file,
        message:
          `the ${trigger} reminder does not say anything - it runs something instead. The host ` +
          "that answers this trigger has no other way to hear from us.",
      });
    }
    return undefined;
  }

  let words;
  try {
    words = wordsOf(cmd);
  } catch (e) {
    findings.push({
      file,
      message:
        `the ${trigger} reminder would not reach a shell intact: ${e.message}. Write each ` +
        "lone ' as '\\'' inside the quoted part, and keep everything else out.",
    });
    return undefined;
  }

  // `printf %s WORDS`, or `echo WORDS`. Any other spelling of "print this" is fine as long
  // as it reduces to the words themselves.
  const [name, ...rest] = words;
  const isPrintf = name === "printf";
  const args = isPrintf ? (rest[0] === "%s" ? rest.slice(1) : undefined) : rest;
  // `printf %s a b` reuses the format for each argument and prints "ab"; `echo a b` puts a
  // space between them. Joining both the same way would misreport one of them.
  const spoken = (args ?? []).join(isPrintf ? "" : " ").trim();
  if (!isPrintf && spoken.includes("\\")) {
    findings.push({
      file,
      message:
        `the ${trigger} reminder hands a backslash to echo, and shells disagree about what ` +
        "echo does with one - some print it, some turn it into something else entirely. " +
        "Print it with printf instead, where the words are handed over untouched.",
    });
    return undefined;
  }
  if (spoken === "") {
    findings.push({
      file,
      message: `the ${trigger} reminder prints nothing anyone can read back.`,
    });
    return undefined;
  }

  // The words as printed, plus whatever they parse as. Which of the two a host reads is
  // decided by the trigger, not here.
  let doc;
  try {
    doc = JSON.parse(spoken);
  } catch {
    doc = undefined;
  }
  return { spoken, doc };
}

/**
 * The shape Claude Code and Codex read a reply in. Written once per event because the event
 * name is inside the reply, and a reminder filed under the wrong one reaches nobody.
 */
const claudeShaped = (event) => ({
  read: (doc) =>
    doc?.hookSpecificOutput?.hookEventName === event ? doc.hookSpecificOutput.additionalContext : undefined,
  looks: `{"hookSpecificOutput":{"hookEventName":"${event}","additionalContext":"..."}}`,
});

/**
 * The three files reminders live in, and everything that is true of each one.
 *
 * Three files, because no single file can serve every host. Claude Code checks every
 * moment-name in the shared file against a closed list and refuses the WHOLE file over one it
 * does not know - it reported "failed to load", registered nothing, and nobody noticed
 * because the reminders people saw were coming from their own settings instead - so only the
 * names it shares with Codex may live there. Cursor takes the file its own listing names, in
 * preference to the shared one. Everyone else's live at the plugin root, which Claude Code
 * does not read at all, proven by putting a name it rejects there and watching it load.
 *
 * One row per file, and every rule below reads its row. Held as separate tables instead -
 * which moments a file may carry, which it must carry, which shape each is read in, which
 * keys may sit at the top, where each host is pointed - the halves drift: a moment was
 * allowed in a file while nothing required it to be there, which is exactly how the
 * end-of-reply prompt came to be deletable from every file at once in silence. In a row the
 * moments a file may carry and the moments it owes are one list, so that gap has nowhere to
 * live.
 *
 * `at` is the path from the plugin folder down, and is matched by identity rather than by
 * what a file contains: keyed on content, deleting one wrapper line would switch every rule
 * here off at once and leave the run green - the exact edit these rules exist to refuse.
 *
 * Antigravity and Copilot have no row on purpose, and are NOT covered by somebody else's.
 * Neither can be handed a file of its own that has been run and watched working, so each is
 * given nothing rather than something silently dead.
 */
const HOMES = [
  {
    at: ["hooks", "hooks.json"],
    hosts: "Claude Code and Codex",
    // Codex refuses the ENTIRE file over any other key - "unknown field `version`" silently
    // cost us every reminder in it - so an extra name here is never cosmetic.
    topLevel: new Set(["description", "hooks"]),
    requires: [],
    ifMissing:
      "and it is the only file Claude Code and Codex read, so losing it leaves both with no " +
      "reminders at all.",
    listing: { dir: ".claude-plugin", host: "Claude Code", pointsHere: false },
    moments: new Map([
      [
        "UserPromptSubmit",
        {
          who: "Claude Code and Codex, on every message",
          says: "recall",
          shape: claudeShaped("UserPromptSubmit"),
        },
      ],
      [
        "SessionStart",
        {
          who: "Claude Code and Codex, after a reset",
          says: "resume",
          shape: claudeShaped("SessionStart"),
        },
      ],
      ["Stop", { who: "Claude Code and Codex", runs: true }],
    ]),
  },
  {
    at: ["hooks", "cursor.json"],
    hosts: "Cursor",
    // The opposite case, and getting it backwards left Cursor with nothing: it validates this
    // file as written rather than converting it first, and refuses one without a whole-number
    // `version` - the very key Codex refuses the shared file over. So it cannot be one rule.
    topLevel: new Set(["version", "hooks", "description"]),
    requires: ["version"],
    ifMissing:
      "and Cursor reads this file INSTEAD of the shared one rather than as well as it - so " +
      "losing it leaves Cursor with no reminders and nothing else objecting.",
    listing: { dir: ".cursor-plugin", host: "Cursor", pointsHere: true },
    moments: new Map([
      [
        "sessionStart",
        {
          who: "Cursor",
          says: "recall",
          shape: { read: (doc) => doc?.additional_context, looks: '{"additional_context":"..."}' },
        },
      ],
      ["stop", { who: "Cursor", runs: true }],
    ]),
  },
  {
    // No wrapper and no shapes: the one host here reads the words themselves, so every
    // top-level name is a moment and every moment is plain English.
    at: ["hooks.json"],
    hosts: "Devin",
    topLevel: undefined,
    requires: [],
    ifMissing: "and it is the only file Devin reads, so losing it leaves Devin with nothing.",
    listing: { dir: ".devin-plugin", host: "Devin", pointsHere: false },
    moments: new Map([
      ["UserPromptSubmit", { who: "Devin, on every message", says: "recall" }],
      ["SessionStart", { who: "Devin, after a reset", says: "resume" }],
    ]),
  },
];

/** Where a home sits, both as a path and as the tail `walk` finds it by. */
const pathOf = (home) => join(REPO_ROOT, "plugins", "dazzer", ...home.at);
const tailOf = (home) => join("dazzer", ...home.at);

/**
 * Every sentence any hook speaks, with where it was found. Parsed, never pattern-matched
 * against the raw file: a hook is structured, and reading it as text is how the first
 * defect in this repository happened.
 */
function spokenByHooks(findings, declaredById) {
  const out = [];

  for (const file of walk(join(REPO_ROOT, "plugins"))) {
    // Every file that declares reminders, not only the ones called hooks.json. A host that
    // reads a file of its own name would otherwise sit outside every rule here, which is
    // how the one file this gate was not looking at could say anything at all.
    const inHooksDir = file.includes(`${sep}hooks${sep}`) && file.endsWith(".json");
    if (!inHooksDir && !file.endsWith(`${sep}hooks.json`)) continue;

    const where = rel(file);
    const parsed = readJson(file, findings);
    if (parsed === undefined) continue;

    // Which of the three files this is, by identity. Keyed on any trailing "hooks/hooks.json"
    // instead, a second plugin growing a hooks folder would be told it owes every host a
    // reminder it was never meant to carry.
    const home = HOMES.find((h) => file.endsWith(tailOf(h)));
    if (home === undefined) {
      findings.push({
        file: where,
        message:
          "declares reminders but is not one of the three files any host reads. It is held to " +
          "no shape and owes no tool anything, so whatever it says reaches nobody while looking " +
          "like part of the plugin.",
      });
      continue;
    }

    // Every key in the file, whichever shape it takes, must be something its hosts expect.
    // Both kinds of host throw away an entire file over one entry they do not recognise -
    // the strict one names the key in a warning, the other simply goes quiet - so a stray
    // key is never cosmetic. A wrapped file allows only the names in its row beside the
    // hooks; in the bare shape every key is a moment, and a moment holds a list.
    for (const [key, value] of Object.entries(parsed)) {
      const fine = home.topLevel === undefined ? Array.isArray(value) : home.topLevel.has(key);
      if (fine) continue;
      findings.push({
        file: where,
        message:
          `carries "${key}", which is not something a host reading this file expects. One ` +
          "unrecognised entry costs the whole file: every reminder in it reaches nobody, and " +
          "the person gets a warning or silence instead.",
      });
    }

    for (const required of home.requires) {
      if (parsed[required] !== undefined) continue;
      findings.push({
        file: where,
        message:
          `is missing "${required}", which the host reading this file requires. It checks this ` +
          "file as written rather than converting it first, and refuses the whole thing " +
          "without that key - so every reminder in it reaches nobody.",
      });
    }

    // Read whichever form the file is written in. Taken from the path instead, removing one
    // wrapper line left nothing to read and the whole file went unchecked.
    const triggers = parsed.hooks ?? parsed;
    if (triggers === null || typeof triggers !== "object") continue;

    const spoke = new Map();

    for (const [trigger, groups] of Object.entries(triggers)) {
      const moment = home.moments.get(trigger);
      if (moment === undefined) {
        findings.push({
          file: where,
          message:
            `"${trigger}" is not one of the moments this file is for. Every host that reads one ` +
            "of these files discards the WHOLE file over a single name it does not recognise - " +
            "Claude Code says so out loud, the others just go quiet. Another tool's moment " +
            "here costs every reminder in the file, for every tool that reads it.",
        });
      }
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        // Two shapes for the same thing: a group holding a list of hooks, and - the shape
        // one host uses - the hook written straight into the group. Reading only the first
        // is how this gate never once looked at that host's reminders.
        const hooks = Array.isArray(group?.hooks) ? group.hooks : [group];
        for (const hook of hooks) {
          if (typeof hook?.command !== "string") continue;

          // Devin's file is the plain-words one and wants exactly that, so a shape is named
          // only on the moments a host is known to read structure at.
          const shape = moment?.shape;
          const said = saidBy(hook.command, trigger, where, findings, shape !== undefined);

          if (shape === undefined) {
            // No host here reads structure, so the words themselves are the reminder. A
            // hook that says nothing is simply not one, and is left alone.
            if (said !== undefined && said.spoken.startsWith(SPOKEN_MARK)) {
              spoke.set(trigger, said.spoken);
              out.push({ file: where, trigger, text: said.spoken });
            }
            continue;
          }

          if (said === undefined) continue; // already reported, in detail, by saidBy

          const text = said.doc === undefined ? undefined : shape.read(said.doc);
          if (typeof text !== "string") {
            findings.push({
              file: where,
              message:
                `the ${trigger} reminder is not in the shape ${home.hosts} read, so it reaches ` +
                `nobody there. It has to print ${shape.looks}`,
            });
            continue;
          }
          if (!text.startsWith(SPOKEN_MARK)) {
            findings.push({
              file: where,
              message:
                `the ${trigger} reminder says "${text.slice(0, 40)}", which is not one of ours. ` +
                "Nothing downstream can tell the reminders arrived.",
            });
            continue;
          }
          spoke.set(trigger, text);
          out.push({ file: where, trigger, text });
        }
      }
    }

    // Every moment the row names has to be here, and the wording rules below cannot see this.
    // They pool the sentences from all three files and ask whether each is spoken SOMEWHERE,
    // so one tool's reminder can be deleted outright and the run stays green as long as
    // another tool still says the same words. Not a hypothetical: a reminder was removed from
    // one of these files on the strength of a tool's documentation, and nothing objected.
    for (const [trigger, { who, says, runs }] of home.moments) {
      // The end-of-reply prompt runs a file rather than saying one of our sentences, so
      // "did anyone speak here" cannot see it go. Every wording rule was blind to it, and
      // it could be deleted from every file at once with nothing objecting.
      if (runs) {
        // Named, not merely present. `: # disabled for now` is a command, and it would
        // satisfy a non-empty test while the end-of-reply prompt quietly stopped running -
        // a likelier edit than deleting the entry outright. Also guards the shape: a
        // trigger written one level too shallow used to throw and discard every finding
        // already collected, hiding real faults in other files behind a stack trace.
        const groups = triggers[trigger];
        const present =
          Array.isArray(groups) &&
          groups.some((group) =>
            (Array.isArray(group?.hooks) ? group.hooks : [group]).some(
              (hook) => typeof hook?.command === "string" && hook.command.includes(RUNS_THE_SWEEP),
            ),
          );
        if (!present) {
          findings.push({
            file: where,
            message:
              `nothing runs ${RUNS_THE_SWEEP} at the end of a reply for ${who}. That is where ` +
              "settled work gets saved, and it says none of our sentences - so no rule about " +
              "wording can notice it has gone, whether deleted or quietly replaced.",
          });
        }
        continue;
      }

      const said = spoke.get(trigger);
      if (said === undefined) {
        findings.push({
          file: where,
          message:
            `nothing here speaks to ${who}. The ${trigger} reminder is missing or silent, and ` +
            "because the other rules only ask whether a sentence is said somewhere, losing a " +
            "whole tool this way is invisible to them.",
        });
        continue;
      }
      // WHICH words, not merely some words. Both declared sentences are always said
      // somewhere, so one standing in for the other satisfies every rule that only pools
      // them - and the words onboarding looks for are the ones that went missing.
      const owed = declaredById.get(says);
      if (owed !== undefined && said !== owed) {
        findings.push({
          file: where,
          message:
            `${who} is given the wrong reminder: this is where the "${says}" words belong, ` +
            "and it says different ones. Anything looking for them here finds nothing.",
        });
      }
    }
  }
  return out;
}

/** Every sentence the manifest declares, so a reader knows what to expect. */
function declared(findings) {
  const parsed = readJson(MANIFEST, findings);
  if (parsed === undefined) return [];

  const rows = parsed.spokenSentences;
  if (!Array.isArray(rows)) {
    findings.push({ file: rel(MANIFEST), message: "spokenSentences is missing; nothing declares what the reminders say" });
    return [];
  }

  const out = [];
  for (const [i, row] of rows.entries()) {
    if (typeof row?.text !== "string" || row.text.length === 0) {
      findings.push({ file: rel(MANIFEST), message: `spokenSentences[${i}] has no text` });
      continue;
    }
    out.push({ id: row.id ?? `spokenSentences[${i}]`, text: row.text });
  }
  return out;
}

/**
 * The wiring every home depends on, which nothing else looks at. Each of these was silent
 * when it broke: a missing file, a pointer aimed at nothing, or one extra line in a host's
 * own listing that puts a file it cannot read back in front of it.
 */
function homesAreWired(findings) {
  for (const home of HOMES) {
    const file = pathOf(home);
    if (!existsSync(file)) {
      findings.push({ file: rel(file), message: `is missing, ${home.ifMissing}` });
    }

    const { dir, host, pointsHere } = home.listing;
    const listing = join(REPO_ROOT, "plugins", "dazzer", dir, "plugin.json");
    const declared = readJson(listing, findings)?.hooks;
    const wanted = pointsHere ? `./${home.at.join("/")}` : undefined;
    if (declared === wanted) continue;

    findings.push({
      file: rel(listing),
      message: pointsHere
        ? `points ${host} at "${declared}". Without the pointer it falls back to the shared ` +
          "file, which holds none of its moment-names; aimed at a file that is not there it " +
          "reads nothing at all. Either way it goes quiet with no error."
        : // A listing that names another place to read reminders from sends its host to a file
          // shaped for somebody else. Claude Code reads such a path AS WELL AS the shared one,
          // so a single line brings back the failure this layout exists to prevent; Devin
          // discards a whole file over one moment it does not know, which is how it broke here.
          `names "${declared}" as another place for ${host} to read reminders from. That sends ` +
          "it to a file holding moments meant for someone else, and every host here throws out " +
          "a whole file over one name it does not recognise.",
    });
  }
}

runGate({
  id: "reminder-parity",
  purpose: "What the reminders say and what we tell readers to expect are one set of sentences.",
  rule: "every tool gets a reminder, in the shape it reads, saying the words we declare",
  assert(findings) {
    homesAreWired(findings);
    const said = declared(findings);
    const spoken = spokenByHooks(findings, new Map(said.map((d) => [d.id, d.text])));

    if (spoken.length === 0) {
      findings.push({ file: "plugins/", message: "no hook speaks anything; either the reminders are gone or this gate has stopped seeing them" });
      return;
    }

    const declaredText = new Set(said.map((d) => d.text));
    const spokenText = new Set(spoken.map((s) => s.text));

    // A sentence a hook speaks that nothing declares.
    for (const s of spoken) {
      if (!declaredText.has(s.text)) {
        findings.push({
          file: s.file,
          message: `the ${s.trigger} reminder says something no one declares. Add it to spokenSentences in tools.manifest.json, or a reader has no way to know to expect it.`,
        });
      }
    }

    // A declared sentence no hook speaks - the one that rejects correct installs.
    for (const d of said) {
      if (!spokenText.has(d.text)) {
        findings.push({
          file: rel(MANIFEST),
          message: `"${d.id}" is declared but no hook says it. Anything waiting for these words waits forever, and reports every correctly installed person as not set up.`,
        });
      }
    }

    // The three hook files carry the same sentences by hand; a reworded one is a real defect.
    const byText = new Map();
    for (const s of spoken) {
      if (!byText.has(s.trigger)) byText.set(s.trigger, new Map());
      const forTrigger = byText.get(s.trigger);
      if (!forTrigger.has(s.text)) forTrigger.set(s.text, []);
      forTrigger.get(s.text).push(s.file);
    }
    for (const [trigger, texts] of byText) {
      if (texts.size > 1) {
        for (const [text, files] of texts) {
          findings.push({ file: files.join(", "), message: `${trigger} says "${text.slice(0, 60)}..."` });
        }
        findings.push({
          file: "plugins/",
          message: `the ${trigger} reminder is worded differently in different files. Whichever a tool loads decides what it says, so this is silently per-tool.`,
        });
      }
    }
  },
});
