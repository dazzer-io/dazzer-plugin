#!/usr/bin/env node
/**
 * @purpose Stop a tool shipping with no way to update or remove it. Every supported tool
 * has to answer all three questions - how do I get this, how do I get the fixed version,
 * how do I get rid of it - and the answers have to reach a person, not only a screen.
 *
 * The blind spot this closes. install-parity compares the install steps in the two places
 * they are written, so a command corrected in one and not the other fails. Nothing looked
 * for a whole missing ANSWER. Install was documented for six tools; updating was documented
 * for none of them, and removing for one. That held while a fix shipped that every existing
 * person needed and no instruction anywhere told them how to get it - the reminders were
 * corrected, and the correction reached only people installing for the first time.
 *
 * Unbiased by construction, the same way the components gate is:
 *   - The TOOL set is read from what the repo actually claims to support, not from a list
 *     kept here. Add a seventh tool and it is covered with no edit to this file.
 *   - "Documented" means a command a person can run, in BOTH places. A step that exists
 *     only in the machine-readable copy is invisible to whoever reads the page.
 *   - A tool nobody has run the commands against is not silently skipped: it must say so
 *     in as many words. An unanswered question stays visible instead of looking answered.
 *
 * Fails closed. Discovering no tools at all is a broken read, not a clean run, and is
 * refused - a coverage gate that checks nothing is the exact trap it exists to prevent.
 */

import { join } from "node:path";
import { REPO_ROOT, read, readJson, rel, runGate } from "./lib/gate.mjs";

const MANIFEST = join(REPO_ROOT, "tools.manifest.json");
const README = join(REPO_ROOT, "README.md");

/** The three questions every supported tool owes an answer to. */
const ANSWERS = [
  { field: "installReminders", asks: "how do I get this" },
  { field: "updateReminders", asks: "how do I get the fixed version" },
  { field: "removeReminders", asks: "how do I get rid of it" },
];

/** Every line inside a fenced block, which is how the page shows something to run. */
function shownToAPerson(text) {
  const lines = [];
  let fenced = false;
  for (const line of text.split("\n")) {
    if (line.trimEnd().startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced && line.trim() !== "") lines.push(line.trim());
  }
  return new Set(lines);
}

runGate({
  id: "lifecycle-coverage",
  purpose: "No tool ships without saying how to get it, update it, and remove it.",
  rule: "every supported tool answers all three, in the page as well as the manifest",
  assert(findings) {
    const manifest = readJson(MANIFEST, findings);
    const page = read(README, findings);
    if (manifest === undefined || page === undefined) return;

    const supported = (manifest.tools ?? []).filter((t) => t?.status === "supported");
    if (supported.length === 0) {
      findings.push({
        file: rel(MANIFEST),
        message:
          "no supported tool was found at all. Either every tool has been dropped, or this " +
          "gate has stopped reading what it thinks it reads - and a coverage check that " +
          "covers nothing passes forever.",
      });
      return;
    }

    const runnable = shownToAPerson(page);

    for (const tool of supported) {
      const name = tool.id ?? "(unnamed tool)";
      for (const { field, asks } of ANSWERS) {
        const answer = tool[field];

        if (answer === undefined || answer === null) {
          findings.push({
            file: rel(MANIFEST),
            message: `${name} never answers "${asks}". Someone who installed it has nowhere to look.`,
          });
          continue;
        }

        // Saying plainly that nobody has established it is a real answer. Guessing is not,
        // and silence is how a person ends up running a command that quietly does nothing.
        if (typeof answer.notEstablished === "string" && answer.notEstablished.trim() !== "") {
          continue;
        }

        const steps = answer.steps ?? [];
        if (steps.length === 0) {
          findings.push({
            file: rel(MANIFEST),
            message:
              `${name} has an empty answer to "${asks}". Say what to run, or say in as many ` +
              "words that nobody has established it - an empty answer reads as no problem.",
          });
          continue;
        }

        for (const step of steps) {
          // Not every step is a command. One tool has no way to install from a terminal at
          // all and finishes by picking the plugin from a menu; that step is followed by
          // clicking, so there is nothing for the page to show in a block.
          if (step?.kind !== "run") continue;

          const command = step?.command;
          if (typeof command !== "string" || command.trim() === "") {
            findings.push({
              file: rel(MANIFEST),
              message: `${name} has a step for "${asks}" with nothing to run in it.`,
            });
            continue;
          }
          if (!runnable.has(command.trim())) {
            findings.push({
              file: rel(README),
              message:
                `${name} answers "${asks}" with \`${command.trim()}\`, which the page never ` +
                "shows. A step only a screen can see is one a reader cannot follow.",
            });
          }
        }
      }
    }
  },
});
