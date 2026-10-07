#!/usr/bin/env node
/**
 * @purpose Turns the kept states a plugin test prints into the pages the words check reads.
 *
 *   claude plugin test plugins/dazzer-plate 2>&1 | node scripts/kept-states.mjs tmp/plate-pane-states
 *
 * WHY IT EXISTS: `claude plugin test` runs a test with no file system at all (no `$.fs`, no
 * Node, no Bun; a plugin's own `$.fs.write` there answers "no implementation"). The one way out
 * of a test is its console, so each kept state is printed as one line,
 *
 *   kept-state <name> <the page, encodeURIComponent'd>
 *
 * and this writes `<folder>/<name>.html` for each. Everything it reads is passed through to its
 * own output unchanged, so a failing test still says why, and `set -o pipefail` in the proof keeps
 * the test's exit code.
 *
 * Refuses, by name: a state name outside [a-z0-9-] (a name is a file name, so it is confined to
 * the folder), a state printed twice (one of the two would silently win), a page that does not
 * decode, and a run that kept no state at all (the words check would then read nothing).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const MARK = "kept-state ";
const NAME = /^[a-z0-9-]{1,80}$/;

const folder = process.argv[2];
if (!folder || process.argv.length !== 3) {
  console.error("usage: <a test run> 2>&1 | node scripts/kept-states.mjs <folder>");
  process.exit(2);
}

let text = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  text += chunk;
  process.stdout.write(chunk);
});
process.stdin.on("end", () => {
  const refusals = [];
  const pages = new Map();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith(MARK)) continue;
    const [name, encoded, ...extra] = line.slice(MARK.length).split(" ");
    if (!NAME.test(name ?? "") || !encoded || extra.length > 0) {
      refusals.push(`a kept state line is not "kept-state <name> <page>" with a name of a-z, 0-9 and -: ${JSON.stringify(line.slice(0, 80))}`);
      continue;
    }
    if (pages.has(name)) {
      refusals.push(`the state "${name}" was kept twice, so one of the two pages would silently win`);
      continue;
    }
    try {
      pages.set(name, decodeURIComponent(encoded));
    } catch {
      refusals.push(`the page for "${name}" does not decode`);
    }
  }
  if (pages.size === 0 && refusals.length === 0) {
    refusals.push("no state was kept, so the words check would read nothing");
  }
  if (refusals.length > 0) {
    console.error(`\nkept-states: refused ${refusals.length}:`);
    for (const line of refusals) console.error(`  - ${line}`);
    process.exit(1);
  }
  const into = resolve(folder);
  mkdirSync(into, { recursive: true });
  for (const [name, page] of pages) writeFileSync(join(into, `${name}.html`), page);
  console.log(`kept-states: ${pages.size} page(s) written to ${folder}`);
});
