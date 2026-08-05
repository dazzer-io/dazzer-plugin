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
 * full in two separate hook files, and until now nothing compared those two either.
 */

import { join } from "node:path";
import { REPO_ROOT, readJson, rel, runGate, walk } from "./lib/gate.mjs";

const MANIFEST = join(REPO_ROOT, "tools.manifest.json");

/** Every reminder we speak opens with this, which is what makes one findable in a reply. */
const SPOKEN_MARK = "[Dazzer]";

/** `echo "..."` - the only shape a hook uses to say something to the model. */
const ECHOED = /^echo\s+"([\s\S]*)"$/;

/**
 * Every sentence any hook speaks, with where it was found. Parsed, never pattern-matched
 * against the raw file: a hook is structured, and reading it as text is how the first
 * defect in this repository happened.
 */
function spokenByHooks(findings) {
  const out = [];

  for (const file of walk(join(REPO_ROOT, "plugins"))) {
    if (!file.endsWith("hooks.json")) continue;

    const parsed = readJson(file, findings);
    if (parsed === undefined) continue;

    // Both shapes ship: a bare map of triggers, and one wrapped in `hooks`.
    const triggers = parsed.hooks ?? parsed;
    if (triggers === null || typeof triggers !== "object") continue;

    for (const [trigger, groups] of Object.entries(triggers)) {
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        for (const hook of group?.hooks ?? []) {
          if (typeof hook?.command !== "string") continue;
          const said = ECHOED.exec(hook.command.trim())?.[1];
          if (said === undefined || !said.startsWith(SPOKEN_MARK)) continue;
          out.push({ file: rel(file), trigger, text: said });
        }
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

runGate({
  id: "reminder-parity",
  purpose: "What the reminders say and what we tell readers to expect are one set of sentences.",
  rule: "every sentence a hook speaks is declared, and every declared sentence is spoken",
  assert(findings) {
    const spoken = spokenByHooks(findings);
    const said = declared(findings);

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

    // The two hook files carry the same sentences by hand; a reworded one is a real defect.
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
