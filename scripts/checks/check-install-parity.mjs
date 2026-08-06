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

/** The Install section only - later sections carry commands that are not install steps. */
function installSection(text, findings) {
  const start = text.indexOf("\n## Install\n");
  if (start === -1) {
    findings.push({ file: "README.md", message: "has no Install section" });
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
function commandsDeclared(manifest, findings) {
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
    collect(tool?.installReminders?.steps, `tools.${tool?.id ?? "?"}`);
  }
  // The connection is written PER TOOL, because one line in one tool's wording is what left
  // every other tool's setup ending with no way to reach the Brain. Reading only the old
  // single-step shape here would go quiet the moment that was fixed, and this gate would then
  // pass while the README and the manifest disagreed about five of the six tools.
  for (const [id, step] of Object.entries(manifest.installConnection?.byTool ?? {})) {
    if (step === null || step?.none === true) continue;
    collect([step], `installConnection.${id}`);
  }

  return out;
}

runGate({
  id: "install-parity",
  purpose: "The install commands in the README and in the manifest are one set.",
  rule: "every command the README shows is declared, and every declared command is shown",
  assert(findings) {
    const manifest = readJson(MANIFEST, findings);
    if (manifest === undefined) return;

    const section = installSection(read(README), findings);
    if (section === "") return;

    const shown = commandsIn(section);
    const declared = commandsDeclared(manifest, findings);

    if (shown.length === 0) {
      findings.push({ file: "README.md", message: "the Install section shows no commands; either it changed shape or this gate has stopped seeing it" });
      return;
    }

    const declaredSet = new Set(declared.map((d) => d.command));
    const shownSet = new Set(shown);

    for (const command of shownSet) {
      if (!declaredSet.has(command)) {
        findings.push({
          file: "README.md",
          message: `shows "${command}" but no tool declares it. A screen rendering the manifest would leave that step out.`,
        });
      }
    }

    for (const d of declared) {
      if (!shownSet.has(d.command)) {
        findings.push({
          file: rel(MANIFEST),
          message: `${d.where} declares "${d.command}" but the README does not show it. One of the two is telling somebody the wrong thing.`,
        });
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
