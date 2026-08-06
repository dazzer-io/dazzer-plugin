#!/usr/bin/env node
/**
 * @purpose Stop a tool shipping with no way to update or remove it. Every supported tool
 * has to answer all three questions - how do I get this, how do I get the fixed version,
 * how do I get rid of it - before it can be offered as supported.
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
 *   - A tool nobody has run the commands against is not silently skipped: it must say so
 *     in as many words. An unanswered question stays visible instead of looking answered.
 *
 * This gate asks only whether an answer EXISTS. Whether the two copies of that answer agree
 * is install-parity's job, section by section and in both directions; splitting it the
 * other way had both gates half-doing both jobs with two different readers of one page.
 *
 * Fails closed. Discovering no tools at all is a broken read, not a clean run, and is
 * refused - a coverage gate that checks nothing is the exact trap it exists to prevent.
 */

import { join } from "node:path";
import { REPO_ROOT, readJson, rel, runGate } from "./lib/gate.mjs";

const MANIFEST = join(REPO_ROOT, "tools.manifest.json");

/** The three questions every supported tool owes an answer to. */
const ANSWERS = [
  { field: "installReminders", asks: "how do I get this" },
  { field: "updateReminders", asks: "how do I get the fixed version" },
  { field: "removeReminders", asks: "how do I get rid of it" },
];

runGate({
  id: "lifecycle-coverage",
  purpose: "No tool ships without saying how to get it, update it, and remove it.",
  rule: "every supported tool answers all three, or says plainly that nobody has established one",
  assert(findings) {
    const manifest = readJson(MANIFEST, findings);
    if (manifest === undefined) return;

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
        const unestablished =
          typeof answer.notEstablished === "string" && answer.notEstablished.trim() !== "";
        const steps = answer.steps ?? [];

        if (unestablished && steps.length > 0) {
          findings.push({
            file: rel(MANIFEST),
            message:
              `${name} both answers "${asks}" and says nobody has established it. Whoever ` +
              "finally worked it out left the old line behind, and the two audiences now " +
              "get different stories - delete whichever is no longer true.",
          });
          continue;
        }
        if (unestablished) continue;
        if (steps.length === 0) {
          findings.push({
            file: rel(MANIFEST),
            message:
              `${name} has an empty answer to "${asks}". Say what to run, or say in as many ` +
              "words that nobody has established it - an empty answer reads as no problem.",
          });
          continue;
        }

        // Not every step is a command. One tool has no way to install from a terminal at
        // all and finishes by picking the plugin from a menu.
        if (!steps.some((step) => step?.kind === "run" || step?.kind === "choose")) {
          findings.push({
            file: rel(MANIFEST),
            message: `${name} answers "${asks}" with nothing anybody could actually do.`,
          });
        }
      }
    }
  },
});
