#!/usr/bin/env node
/**
 * @purpose Keeps the shared leak check inside Gates, the one check main requires, so no change
 * reaches this public repository carrying a private name. A test file once carried a private work
 * list here in public for six weeks, because nothing read the files for private names.
 *
 * The step must call dazzer-io/.github/leak-check pinned to a full commit (so a moved tag cannot
 * change what runs), the checkout before it must fetch every ref, and the job must grant no more
 * than contents: read.
 *
 * Everything this repository takes from the shared dazzer-io/.github sits at one commit, PIN below:
 * the leak check step, the workflow lint Gates runs (that repository's scripts/actionlint.mjs,
 * checked out at the same commit) and the engineer review in engineer-review.yml. A commit of any
 * other history is refused, so a re-pin moves PIN and the three places in the same change.
 * Dependabot must not offer that repository's commits, since a bump of one pin alone fails Gates and
 * holds back the rest of its group: .github/dependabot.yml ignores it.
 */

import { join } from "node:path";
import { REPO_ROOT, exists, lines, read, runGate } from "./lib/gate.mjs";

const WORKFLOW = ".github/workflows/gates.yml";
const REVIEW = ".github/workflows/engineer-review.yml";
const DEPENDABOT = ".github/dependabot.yml";
const SHARED = "dazzer-io/.github";
const ACTION = `${SHARED}/leak-check`;
const REVIEW_CALL = `${SHARED}/.github/workflows/engineer-review.yml`;
/** The shared .github's commit every pin here names. */
const PIN = "e3a419d50cd4dc87adfd75ba6ee823232f4aa8f3";
const MISSING = "no pinned leak check in Gates";
const NO_LINT = "no pinned workflow lint in Gates";
const NO_REVIEW = "no pinned engineer review";
const UNCANCELLED = /^\s*if:\s*\$\{\{\s*!cancelled\(\)\s*\}\}\s*$/;

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
  purpose: "Gates runs the shared leak check and workflow lint, pinned, on every change, and the engineer review is pinned to the same commit.",
  rule: `dependabot.yml ignores ${SHARED}; Gates calls ${ACTION}@${PIN} after a checkout that fetches every ref, granting only contents: read, and runs ${SHARED}'s actionlint at ${PIN}; ${REVIEW} calls ${REVIEW_CALL}@${PIN}`,
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
      } else if (ref !== PIN) {
        findings.push({ file: WORKFLOW, line: step[0].n, message: `${MISSING}: ${ACTION} is pinned at ${ref}, not the shared .github's commit ${PIN}` });
      }
      if (!step.some((l) => UNCANCELLED.test(l.text))) {
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

    // The workflow lint: the shared .github checked out at PIN into a folder of its own, then its
    // scripts/actionlint.mjs run from that folder, both even when an earlier gate failed.
    const value = (step, key) => step.map((l) => l.text.match(new RegExp(`^\\s*(?:- )?${key}:\\s*(\\S+)`))?.[1]).find(Boolean);
    const lintOut = steps.find((s) => uses(s)?.startsWith("actions/checkout@") && value(s, "repository") === SHARED);
    if (!lintOut) {
      findings.push({ file: WORKFLOW, message: `${NO_LINT}: no step checks out ${SHARED} for its actionlint` });
    } else {
      const ref = value(lintOut, "ref") ?? "";
      const dir = value(lintOut, "path") ?? "";
      if (ref !== PIN) {
        findings.push({ file: WORKFLOW, line: lintOut[0].n, message: `${NO_LINT}: ${SHARED} is checked out at "${ref || "its default branch"}", not ${PIN}` });
      }
      if (!dir || !lintOut.some((l) => /^\s*persist-credentials:\s*false\s*$/.test(l.text))) {
        findings.push({ file: WORKFLOW, line: lintOut[0].n, message: `${NO_LINT}: the ${SHARED} checkout needs a path of its own and persist-credentials: false` });
      }
      const runs = steps.filter((s) => dir && s.some((l) => l.text.includes(`node ${dir}/scripts/actionlint.mjs`)));
      if (dir && runs.length === 0) {
        findings.push({ file: WORKFLOW, message: `${NO_LINT}: no step runs node ${dir}/scripts/actionlint.mjs` });
      }
      for (const step of [lintOut, ...runs]) {
        if (!step.some((l) => UNCANCELLED.test(l.text))) {
          findings.push({ file: WORKFLOW, line: step[0].n, message: "a workflow lint step does not run when an earlier gate failed (if: ${{ !cancelled() }})" });
        }
      }
      if (runs.length > 0 && steps.indexOf(runs[0]) < steps.indexOf(lintOut)) {
        findings.push({ file: WORKFLOW, line: runs[0][0].n, message: `${NO_LINT}: actionlint runs before ${SHARED} is checked out` });
      }
    }

    const perm = job.findIndex((l) => /^ {4}permissions:\s*$/.test(l.text));
    const grants = [];
    if (perm >= 0) for (const l of job.slice(perm + 1)) { if (!/^ {6}\S/.test(l.text)) break; grants.push(l.text.trim()); }
    if (grants.join(",") !== "contents: read") {
      findings.push({ file: WORKFLOW, message: `the gates job grants "${grants.join(", ") || "nothing named"}"; the leak check needs contents: read and nothing more` });
    }

    // Dependabot: the shared .github is re-pinned by hand, never offered as an update.
    const botPath = join(REPO_ROOT, DEPENDABOT);
    const ignoredName = (text) => {
      const body = text.trim().replace(/^-\s*/, "");
      if (!body.startsWith("dependency-name:")) return "";
      return body.slice("dependency-name:".length).replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "");
    };
    const ignored = exists(botPath) && lines(read(botPath)).some((l) => ignoredName(l.text) === SHARED);
    if (!ignored) {
      findings.push({ file: DEPENDABOT, message: `Dependabot still offers the shared .github pin: ${DEPENDABOT} has no ignore for ${SHARED}, so its first newer commit fails Gates and holds back the group` });
    }

    // The engineer review: the shared reusable workflow, called at PIN.
    const reviewPath = join(REPO_ROOT, REVIEW);
    if (!exists(reviewPath)) {
      findings.push({ file: REVIEW, message: `${NO_REVIEW}: the workflow is not there` });
    } else {
      const calls = lines(read(reviewPath))
        .map((l) => ({ n: l.n, ref: l.text.match(/^\s*uses:\s*(\S+)/)?.[1] }))
        .filter((c) => c.ref?.startsWith(`${REVIEW_CALL}@`) || c.ref === REVIEW_CALL);
      if (calls.length === 0) {
        findings.push({ file: REVIEW, message: `${NO_REVIEW}: no job calls ${REVIEW_CALL}` });
      }
      for (const c of calls) {
        const ref = c.ref.split("@")[1] ?? "";
        if (ref !== PIN) {
          findings.push({ file: REVIEW, line: c.n, message: `${NO_REVIEW}: ${REVIEW_CALL} is called at "${ref || "no ref"}", not ${PIN}` });
        }
      }
    }
  },
});
