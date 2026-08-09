#!/usr/bin/env node
/**
 * @purpose Every tool says what it IS, in words somebody outside this company uses — and the
 * README heading says the same thing, so the page a person reads and the screen a person is
 * walked through cannot describe the same product two ways.
 *
 * WHY THIS EXISTS, and it is the ordinary reason: it broke. Four of the six tools carried no
 * description at all, and the dashboard filled the gap the way anything fills a gap — with one
 * sentence written to cover them all: "runs on your own computer, in a terminal window, not the
 * app and not a browser tab." It reads perfectly for Claude Code and is FALSE for half the list.
 * Two of these tools are editors somebody opens like any other app; one of them does not run on
 * their computer at all. A confident sentence about a product, generated to fill a blank, is
 * worse than a blank: nobody reviews it, because it sounds like it was written on purpose.
 *
 * The fix was to make the dashboard say nothing where nothing is written down. This is the other
 * half — so that "nothing is written down" stops being the normal case, and a tool added
 * tomorrow cannot ship without the line.
 *
 * IT CHECKS THE HEADING TOO, and by content rather than by exact string. The README is what a
 * person reads and the manifest is what a screen renders; the same rule that governs the install
 * steps governs this. Compared loosely on purpose — a heading is prose and will get punctuated,
 * capitalised and rearranged, and a check that refuses that teaches people to route around it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, readJson, rel, runGate } from "./lib/gate.mjs";

const MANIFEST = join(REPO_ROOT, "tools.manifest.json");
const README = join(REPO_ROOT, "README.md");

/** Everything a comparison should not turn on: case, punctuation, spacing. */
const loose = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The `### Name — description` line for a tool, or undefined when it has no section. */
function headingFor(readme, name) {
  const line = readme
    .split("\n")
    .find((l) => l.startsWith("### ") && loose(l.slice(4)).startsWith(loose(name)));
  if (line === undefined) return undefined;
  // Everything after the first dash is the description; a heading with no dash has none.
  const dash = line.search(/[—-]/u);
  return dash === -1 ? "" : line.slice(dash + 1).trim();
}

runGate({
  id: "tool-description",
  purpose: "No screen can name a product without saying what it is.",
  rule: "every tool carries describedAs, and its README heading says the same thing",
  assert(findings) {
    const manifest = readJson(MANIFEST, findings);
    if (manifest === undefined) return;

    const readme = readFileSync(README, "utf8");

    for (const tool of manifest.tools ?? []) {
      const described = tool.describedAs;
      if (typeof described !== "string" || described.trim() === "") {
        findings.push({
          file: rel(MANIFEST),
          message: `"${tool.name}" has no describedAs — a screen naming it has nothing true to say about what it is, and will either stay silent or invent something`,
        });
        continue;
      }

      const heading = headingFor(readme, tool.name);
      if (heading === undefined) {
        // Not every tool needs an install section — one is listed precisely because it cannot
        // carry the reminders — so a missing section is not a failure here.
        continue;
      }
      if (heading === "") {
        findings.push({
          file: rel(README),
          message: `the "${tool.name}" heading says only its name; the manifest says "${described}" — say it in both, so the page and the screen agree`,
        });
        continue;
      }
      if (loose(heading) !== loose(described)) {
        findings.push({
          file: rel(README),
          message: `"${tool.name}" is described two ways — README says "${heading}", manifest says "${described}"`,
        });
      }
    }
  },
});
