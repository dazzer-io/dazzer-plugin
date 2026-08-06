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
 * The three sections a person acts on, and the manifest field behind each. Kept apart on
 * purpose: a command is only in the right place if it sits under the heading that asks for
 * it. Matched against the whole page instead, a step could vanish from Update and still pass
 * because the same line appears under Install - and somebody following Update would remove
 * the plugin and never put it back.
 */
const SECTIONS = [
  { name: "Install", field: "installReminders" },
  { name: "Update", field: "updateReminders" },
  { name: "Uninstall", field: "removeReminders" },
];

/** One section of the page, its heading to the next heading. */
function sectionOf(text, name, findings) {
  const start = text.indexOf(`\n## ${name}\n`);
  if (start === -1) {
    findings.push({ file: "README.md", message: `has no ${name} section` });
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

/** Every command the manifest hands a screen, from any tool and from the connection. */
function commandsDeclared(manifest, field, findings) {
  const out = [];

  const collect = (steps, where) => {
    for (const step of steps ?? []) {
      if (step?.kind !== "run") continue;
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
  // The connection is written PER TOOL, because one line in one tool's wording is what left
  // every other tool's setup ending with no way to reach the Brain. Reading only the old
  // single-step shape here would go quiet the moment that was fixed, and this gate would then
  // pass while the README and the manifest disagreed about five of the six tools.
  if (field === "installReminders") {
    for (const [id, step] of Object.entries(manifest.installConnection?.byTool ?? {})) {
      if (step === null || step?.none === true) continue;
      collect([step], `installConnection.${id}`);
    }
  }
  // The connection is installed and removed alongside the reminders, so it belongs to the
  // same two sections - otherwise the page can offer a way out that nothing declares.
  if (field === "removeReminders") collect(manifest.removeConnection?.steps, "removeConnection");

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

    for (const { name, field } of SECTIONS) {
      const section = sectionOf(page, name, findings);
      if (section === "") continue;

      const shown = commandsIn(section);
      const declared = commandsDeclared(manifest, field, findings);

      if (shown.length === 0 && declared.length === 0) {
        findings.push({
          file: "README.md",
          message: `the ${name} section shows no commands and nothing declares any; either it changed shape or this gate has stopped seeing it`,
        });
        continue;
      }

      // Counted, not pooled. Two answers in one section can name the same command, and a set
      // comparison lets one of the two copies be deleted while the other goes on satisfying
      // it - the person following the shortened one then runs a step that does nothing.
      const tally = (list) => {
        const seen = new Map();
        for (const c of list) seen.set(c, (seen.get(c) ?? 0) + 1);
        return seen;
      };
      const declaredCount = tally(declared.map((d) => d.command));
      const shownCount = tally(shown);

      for (const [command, times] of shownCount) {
        const owed = declaredCount.get(command) ?? 0;
        if (owed === 0) {
          findings.push({
            file: "README.md",
            message: `the ${name} section shows "${command}" but nothing declares it there. A screen rendering the manifest would leave that step out.`,
          });
        } else if (times !== owed) {
          findings.push({
            file: "README.md",
            message: `the ${name} section shows "${command}" ${times} time(s) while ${owed} answer(s) there declare it. One of the two has gained or lost the step.`,
          });
        }
      }

      for (const [command, owed] of declaredCount) {
        if ((shownCount.get(command) ?? 0) > 0) continue;
        const who = declared.find((d) => d.command === command)?.where ?? "something";
        findings.push({
          file: rel(MANIFEST),
          message: `${who} declares "${command}" but the ${name} section does not show it. One of the two is telling somebody the wrong thing.`,
        });
      }
    }
  },
});
