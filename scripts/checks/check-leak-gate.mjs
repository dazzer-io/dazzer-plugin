#!/usr/bin/env node
/**
 * @purpose Keeps the shared leak check inside Gates, the one check main requires, so no change
 * reaches this public repository carrying a private name. A test file once carried a private work
 * list here in public for six weeks, because nothing read the files for private names.
 *
 * The step must call dazzer-io/.github/leak-check pinned to a full commit (so a moved tag cannot
 * change what runs, and Dependabot still offers its updates), the checkout before it must fetch
 * every ref, and the job must grant no more than contents: read.
 */

import { join } from "node:path";
import { REPO_ROOT, exists, lines, read, runGate } from "./lib/gate.mjs";

const WORKFLOW = ".github/workflows/gates.yml";
const ACTION = "dazzer-io/.github/leak-check";
const MISSING = "no pinned leak check in Gates";

/** The lines of one top-level key's block under `jobs:`, found by indentation. */
function jobBlock(all, job) {
  const start = all.findIndex((l) => l.text === `  ${job}:`);
  if (start < 0) return [];
  const end = all.findIndex((l, i) => i > start && /^ {0,2}\S/.test(l.text));
  return all.slice(start + 1, end < 0 ? all.length : end);
}

/** The steps of a job, each as its lines, split on the `- ` that opens each one. */
function stepsOf(block) {
  const at = block.findIndex((l) => /^ {4}steps:\s*$/.test(l.text));
  if (at < 0) return [];
  const steps = [];
  for (const l of block.slice(at + 1)) {
    if (/^ {4}\S/.test(l.text)) break;
    if (/^ {6}- /.test(l.text)) steps.push([]);
    if (steps.length > 0 && !l.text.trimStart().startsWith("#")) steps.at(-1).push(l);
  }
  return steps;
}

runGate({
  id: "leak-gate",
  purpose: "Gates runs the shared leak check, pinned, on every change.",
  rule: `Gates calls ${ACTION} pinned to a full commit, after a checkout that fetches every ref, granting only contents: read`,
  assert(findings) {
    const path = join(REPO_ROOT, WORKFLOW);
    if (!exists(path)) {
      findings.push({ file: WORKFLOW, message: `${MISSING}: the workflow is not there` });
      return;
    }
    const all = lines(read(path));
    const job = jobBlock(all, "gates");
    const steps = stepsOf(job);

    const uses = (step) => step.map((l) => l.text.match(/^\s*(?:- )?uses:\s*(\S+)/)?.[1]).find(Boolean);
    const leak = steps.filter((s) => uses(s)?.startsWith(`${ACTION}@`) || uses(s) === ACTION);
    if (leak.length === 0) {
      findings.push({ file: WORKFLOW, message: `${MISSING}: no step of the gates job uses ${ACTION}` });
    }
    for (const step of leak) {
      const ref = uses(step).split("@")[1] ?? "";
      if (!/^[0-9a-f]{40}$/.test(ref)) {
        findings.push({ file: WORKFLOW, line: step[0].n, message: `${MISSING}: ${ACTION} is used at "${ref || "no ref"}", not a full 40-character commit` });
      }
      if (!step.some((l) => /^\s*if:\s*\$\{\{\s*!cancelled\(\)\s*\}\}\s*$/.test(l.text))) {
        findings.push({ file: WORKFLOW, line: step[0].n, message: "the leak check step does not run when an earlier gate failed (if: ${{ !cancelled() }}), so one red gate would hide a leak" });
      }
    }

    const checkout = steps.find((s) => uses(s)?.startsWith("actions/checkout@"));
    if (!checkout) {
      findings.push({ file: WORKFLOW, message: "the gates job checks nothing out, so the leak check has no files to read" });
    } else if (!checkout.some((l) => /^\s*fetch-depth:\s*0\s*$/.test(l.text))) {
      findings.push({ file: WORKFLOW, line: checkout[0].n, message: "the checkout does not fetch every ref (fetch-depth: 0), so the leak check reads one commit" });
    }
    if (checkout && leak.length > 0 && steps.indexOf(leak[0]) < steps.indexOf(checkout)) {
      findings.push({ file: WORKFLOW, line: leak[0][0].n, message: "the leak check runs before the checkout, so it reads an empty workspace" });
    }

    const perm = job.findIndex((l) => /^ {4}permissions:\s*$/.test(l.text));
    const grants = [];
    if (perm >= 0) for (const l of job.slice(perm + 1)) { if (!/^ {6}\S/.test(l.text)) break; grants.push(l.text.trim()); }
    if (grants.join(",") !== "contents: read") {
      findings.push({ file: WORKFLOW, message: `the gates job grants "${grants.join(", ") || "nothing named"}"; the leak check needs contents: read and nothing more` });
    }
  },
});
