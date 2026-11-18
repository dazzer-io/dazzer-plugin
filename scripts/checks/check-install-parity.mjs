#!/usr/bin/env node
/**
 * @purpose Keeps the commands we print for a person and the commands a screen hands them
 * as one set. docs/install.md is what a person reads; tools.manifest.json is what a screen
 * renders. The same instructions exist in two places, so this compares them.
 *
 * Compared by COMMAND rather than by heading, on purpose. A heading is prose and gets
 * reworded; the command is the thing somebody actually runs, and it is what breaks when
 * these two disagree. The removal steps are left out: docs-truth holds those.
 */

import { join } from "node:path";
import { REPO_ROOT, exists, read, readJson, rel, runGate } from "./lib/gate.mjs";

const MANIFEST = join(REPO_ROOT, "tools.manifest.json");
const INSTALL_DOC = join(REPO_ROOT, "docs", "install.md");

/** The page without its removal section, which carries commands that are not install steps. */
function installSteps(text) {
  const start = text.search(/^## Remove\s*$/m);
  if (start === -1) return text;
  const rest = text.slice(start + 1);
  const end = rest.search(/^## /m);
  return text.slice(0, start) + (end === -1 ? "" : rest.slice(end));
}

/** Every line inside a fenced block, which is how the page shows something to run. */
function commandsIn(section) {
  const out = [];
  let fenced = false;
  for (const line of section.split("\n")) {
    if (line.trimStart().startsWith("```")) {
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
  // pass while the page and the manifest disagreed about five of the six tools.
  for (const [id, step] of Object.entries(manifest.installConnection?.byTool ?? {})) {
    if (step === null || step?.none === true) continue;
    collect([step], `installConnection.${id}`);
  }
  // The sign-in is printed on the page too, so it is declared here or the two drift apart.
  for (const [id, step] of Object.entries(manifest.installConnection?.signInByTool ?? {})) {
    if (step?.when !== "own-step") continue;
    collect([step], `signIn.${id}`);
  }
  // And so is getting a current version. It is a thing a person RUNS, so it is a thing a screen
  // has to be able to hand them — printing it only in prose would put it back out of reach of
  // anything but the page, which is how it came to be printed nowhere at all for so long that
  // every single person was sitting on whatever version they first installed.
  for (const [id, step] of Object.entries(manifest.keepCurrent?.byTool ?? {})) {
    if (step === null || step?.kind === "none") continue;
    // More than one line, where a tool has more than one thing installed. Read as a single
    // step only, the second line was shown to people and declared to nobody - and the piece
    // it updates is the one that reaches the Brain at all.
    collect(step.steps ?? [step], `keepCurrent.${id}`);
  }

  // The plate pane's install line and the run-log command are on the page as well.
  collect(manifest.panel?.steps, "panel");
  if (typeof manifest.verify?.command === "string") collect([{ kind: "run", command: manifest.verify.command }], "verify");

  return out;
}

runGate({
  id: "install-parity",
  purpose: "The install commands in docs/install.md and in the manifest are one set.",
  rule: "every command docs/install.md shows is declared, and every declared command is shown",
  assert(findings) {
    const manifest = readJson(MANIFEST, findings);
    if (manifest === undefined) return;

    if (!exists(INSTALL_DOC)) {
      findings.push({ file: rel(INSTALL_DOC), message: "missing" });
      return;
    }
    const shown = commandsIn(installSteps(read(INSTALL_DOC)));
    const declared = commandsDeclared(manifest, findings);

    if (shown.length === 0) {
      findings.push({ file: rel(INSTALL_DOC), message: "shows no commands; either it changed shape or this gate has stopped seeing it" });
      return;
    }

    const declaredSet = new Set(declared.map((d) => d.command));
    const shownSet = new Set(shown);

    for (const command of shownSet) {
      if (!declaredSet.has(command)) {
        findings.push({
          file: rel(INSTALL_DOC),
          message: `shows "${command}" but no tool declares it. A screen rendering the manifest would leave that step out.`,
        });
      }
    }

    for (const d of declared) {
      if (!shownSet.has(d.command)) {
        findings.push({
          file: rel(MANIFEST),
          message: `${d.where} declares "${d.command}" but docs/install.md does not show it. One of the two is telling somebody the wrong thing.`,
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
