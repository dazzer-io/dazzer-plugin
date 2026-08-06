#!/usr/bin/env node
/**
 * @purpose Keeps the commands we print for a human and the commands a screen hands them
 * as one set. The README's Install section was the only authority until a screen needed to
 * render the same steps; the moment it did, the same instructions existed in two places
 * with nothing comparing them.
 *
 * It reads all three sections a person acts on. Which tools owe an answer at all is a
 * different question and belongs to lifecycle-coverage; this gate only asks whether the two
 * copies of an answer say the same thing.
 *
 * Compared by COMMAND rather than by heading, on purpose. A heading is prose and gets
 * reworded; the command is the thing somebody actually runs, and it is what breaks when
 * these two disagree.
 */

import { join } from "node:path";
import { REPO_ROOT, read, readJson, rel, runGate, section } from "./lib/gate.mjs";

const MANIFEST = join(REPO_ROOT, "tools.manifest.json");
const README = join(REPO_ROOT, "README.md");

/**
 * The three sections a person acts on, and the manifest fields that must match each. Kept
 * apart on purpose: a command is only in the right place if it is under the heading that
 * asks for it. Matched against the whole page instead, a step could vanish from Update and
 * still pass because the same line appears under Install - and somebody following Update
 * would remove the plugin and never put it back.
 */
const SECTIONS = [
  { heading: "## Install", field: "installReminders", connection: "installConnection" },
  { heading: "## Update", field: "updateReminders", connection: "updateConnection" },
  { heading: "## Uninstall", field: "removeReminders", connection: "removeConnection" },
];

/** One section of the README, heading to the next heading. */
function sectionOf(text, heading, findings) {
  const found = section(text, heading);
  if (found === "") {
    findings.push({ file: "README.md", message: `has no ${heading.replace("## ", "")} section` });
  }
  return found;
}

/** Every line inside a fenced block, which is how the README shows something to run. */
function commandsIn(section) {
  const out = [];
  let fenced = false;
  for (const line of section.split("\n")) {
    if (line.trimEnd() === "```") {
      fenced = !fenced;
      continue;
    }
    if (!fenced) continue;
    const command = line.trim();
    if (command.length > 0) out.push(command);
  }
  return out;
}

/** The steps somebody clicks rather than runs, for one section. */
function clickedSteps(manifest, { field, connection }) {
  const out = [];
  for (const owner of [...(manifest.tools ?? []), manifest]) {
    const key = owner === manifest ? connection : field;
    for (const step of owner?.[key]?.steps ?? []) {
      if (step?.kind === "choose") out.push(step);
    }
  }
  return out;
}

/** Every command the manifest hands a screen for one section, tools and connection alike. */
function commandsDeclared(manifest, { field, connection }, findings) {
  const out = [];

  const collect = (steps, where) => {
    for (const step of steps ?? []) {
      // A step that is neither something to run nor something to click is a typo nobody
      // would see: it would simply drop out of both this list and the page.
      if (step?.kind !== "run") {
        if (step?.kind !== "choose") {
          findings.push({ file: rel(MANIFEST), message: `${where} has a step of an unknown kind "${step?.kind}"` });
        }
        continue;
      }
      if (typeof step.command !== "string" || step.command.length === 0) {
        findings.push({ file: rel(MANIFEST), message: `${where} has a run step with no command` });
        continue;
      }
      out.push({ command: step.command, where });
    }
  };

  for (const tool of manifest.tools ?? []) {
    collect(tool?.[field]?.steps, `tools.${tool?.id ?? "?"}.${field}`);
  }
  collect(manifest[connection]?.steps, connection);

  return out;
}

runGate({
  id: "install-parity",
  purpose: "The commands in the README and in the manifest are one set, section by section.",
  rule: "getting it, updating it and removing it each read the same in both places",
  assert(findings) {
    const manifest = readJson(MANIFEST, findings);
    if (manifest === undefined) return;
    const page = read(README);

    for (const section of SECTIONS) {
      const text = sectionOf(page, section.heading, findings);
      if (text === "") continue;

      const shown = commandsIn(text);
      const declared = commandsDeclared(manifest, section, findings);

      if (shown.length === 0 && declared.length === 0) {
        findings.push({
          file: "README.md",
          message: `the ${section.heading.replace("## ", "")} section shows no commands and nothing declares any; either it changed shape or this gate has stopped seeing it`,
        });
        continue;
      }

      // Counted, not pooled. Two answers in one section can name the same command - the
      // connection's update repeats the refresh step the tool's does - and a set comparison
      // lets one of the two copies be deleted while the other goes on satisfying it. The
      // person following the shortened one then runs a step that quietly does nothing.
      const tally = (commands) => {
        const seen = new Map();
        for (const c of commands) seen.set(c, (seen.get(c) ?? 0) + 1);
        return seen;
      };
      const declaredCount = tally(declared.map((d) => d.command));
      const shownCount = tally(shown);

      for (const [command, times] of shownCount) {
        const owed = declaredCount.get(command) ?? 0;
        if (owed === 0) {
          findings.push({
            file: "README.md",
            message: `${section.heading} shows "${command}" but nothing declares it there. A screen rendering the manifest would leave that step out.`,
          });
        } else if (times !== owed) {
          findings.push({
            file: "README.md",
            message: `${section.heading} shows "${command}" ${times} time(s) while ${owed} answer(s) there declare it. One of the two has gained or lost the step, and pooling them would hide it.`,
          });
        }
      }

      for (const [command, owed] of declaredCount) {
        const times = shownCount.get(command) ?? 0;
        if (times === 0) {
          const who = declared.find((d) => d.command === command)?.where ?? "something";
          findings.push({
            file: rel(MANIFEST),
            message: `${who} declares "${command}" but ${section.heading} does not show it. One of the two is telling somebody the wrong thing.`,
          });
        }
      }

      // A step somebody clicks rather than runs still has to be on the page, or the answer
      // stops halfway. Cursor's update ends by picking the plugin from a menu; without it a
      // person re-adds the plugin and never turns it back on.
      for (const step of clickedSteps(manifest, section)) {
        const { from, label } = step;
        if (typeof from !== "string" || typeof label !== "string") continue;
        // Both parts, on ONE line. Looked for separately, an unrelated command containing
        // "/plugins" was enough to satisfy the check while the sentence telling somebody to
        // pick anything had been deleted.
        const told = text.split("\n").some((line) => line.includes(from) && line.includes(label));
        if (!told) {
          findings.push({
            file: "README.md",
            message: `${section.heading} never tells anybody to pick "${label}" from "${from}", which an answer there requires. That answer stops halfway on the page.`,
          });
        }
      }
    }

  },
});
