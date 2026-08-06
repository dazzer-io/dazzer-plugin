#!/usr/bin/env node
/**
 * @purpose Keeps the commands we print for a human and the commands a screen hands them
 * as one set. The README's Install section was the only authority until a screen needed to
 * render the same steps; the moment it did, the same instructions existed in two places
 * with nothing comparing them.
 *
 * The docs gate already covers the tuning table and the uninstall lines. It does not read
 * the install blocks at all, so a command corrected in one place and not the other passes
 * everything today.
 *
 * Compared by COMMAND rather than by heading, on purpose. A heading is prose and gets
 * reworded; the command is the thing somebody actually runs, and it is what breaks when
 * these two disagree.
 */

import { join } from "node:path";
import { REPO_ROOT, read, readJson, rel, runGate } from "./lib/gate.mjs";

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
  const start = text.indexOf(`\n${heading}\n`);
  if (start === -1) {
    findings.push({ file: "README.md", message: `has no ${heading.replace("## ", "")} section` });
    return "";
  }
  const rest = text.slice(start + 1);
  const end = rest.indexOf("\n## ", 1);
  return end === -1 ? rest : rest.slice(0, end);
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

      const declaredSet = new Set(declared.map((d) => d.command));
      const shownSet = new Set(shown);

      for (const command of shownSet) {
        if (!declaredSet.has(command)) {
          findings.push({
            file: "README.md",
            message: `${section.heading} shows "${command}" but nothing declares it there. A screen rendering the manifest would leave that step out.`,
          });
        }
      }

      for (const d of declared) {
        if (!shownSet.has(d.command)) {
          findings.push({
            file: rel(MANIFEST),
            message: `${d.where} declares "${d.command}" but ${section.heading} does not show it. One of the two is telling somebody the wrong thing.`,
          });
        }
      }
    }

    // A tool that a screen would offer with nothing to do.
    for (const tool of manifest.tools ?? []) {
      if (tool?.status !== "supported") continue;
      const steps = tool?.installReminders?.steps ?? [];
      if (steps.length === 0) {
        findings.push({
          file: rel(MANIFEST),
          message: `"${tool.id}" is offered as supported but has no way to install the reminders. A connection on its own is not a finished setup.`,
        });
      }
    }
  },
});
