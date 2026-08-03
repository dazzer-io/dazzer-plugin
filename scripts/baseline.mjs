#!/usr/bin/env node
/**
 * @purpose Runs every gate in one command and holds the line on known defects, so a
 * change that breaks something new fails loudly while the defects we have already
 * written down stay visible and countable instead of silently normal.
 *
 * The ledger is SHRINK-ONLY. A failure that is not in it fails the run. A ledger entry
 * that starts passing ALSO fails the run - that is how a fix proves itself rather than
 * being claimed. The only way the run goes quiet is an empty ledger and no failures.
 *
 * Gates are plain shell commands, so a shell test suite is a first-class gate.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LEDGER = join(ROOT, "scripts", "known-defects.txt");
const CHECK = (name) => `node scripts/checks/${name}.mjs`;

/**
 * The registry. Adding a gate is one row here plus the script. Order is display order
 * only - every gate runs regardless of what came before, so one failure never hides
 * the rest.
 */
const GATES = [
  // The two constraints that exist because something broke in the field.
  { id: "connection-isolation", name: "behaviour plugin ships no connection", cmd: CHECK("check-connection-isolation") },
  { id: "connection-address", name: "connection address is product-owned", cmd: CHECK("check-connection-address") },

  // Packaging truth.
  { id: "version-parity", name: "one version, agreed everywhere", cmd: CHECK("check-version-parity") },
  { id: "manifest-parity", name: "manifests and the install index agree", cmd: CHECK("check-manifest-parity") },
  { id: "trigger-paths", name: "every trigger resolves to a real script", cmd: CHECK("check-trigger-paths") },

  // The defect classes, asserted against the shipped script.
  { id: "shell-contract", name: "shipped shell obeys the defect-class rules", cmd: CHECK("check-shell-contract") },
  { id: "harness-contract", name: "the test harness can actually see failures", cmd: CHECK("check-harness-contract") },

  // Documentation that would otherwise drift away from the code.
  { id: "docs-truth", name: "knobs and instructions match the code", cmd: CHECK("check-docs-truth") },

  // CI guarding itself.
  { id: "workflow-sha-pin", name: "every action is pinned to a commit", cmd: CHECK("check-workflow-sha-pin") },

  // The product's own behaviour.
  { id: "capture-sweep", name: "capture sweep behaves", cmd: "sh plugins/dazzer/scripts/capture-sweep.test.sh" },
];

function loadLedger() {
  if (!existsSync(LEDGER)) return new Map();
  const out = new Map();
  for (const raw of readFileSync(LEDGER, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [id, ...why] = line.split(/\s+/);
    out.set(id, why.join(" ") || "(no note)");
  }
  return out;
}

/** Failure ids a step declared for itself, else the step id. */
function failureIds(gate, stdout) {
  const declared = [...stdout.matchAll(/^FAILID\s+(\S+)$/gm)].map((m) => m[1]);
  return declared.length > 0 ? declared : [gate.id];
}

const ledger = loadLedger();
const failing = new Map();
let sawOutput = false;

for (const gate of GATES) {
  const run = spawnSync("sh", ["-c", gate.cmd], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, DAZZER_REPO_ROOT: ROOT },
  });
  const stdout = run.stdout ?? "";
  const stderr = run.stderr ?? "";
  const ok = run.status === 0;

  if (ok) {
    process.stdout.write(`ok   ${gate.id.padEnd(20)} ${gate.name}\n`);
    continue;
  }

  sawOutput = true;
  process.stdout.write(`FAIL ${gate.id.padEnd(20)} ${gate.name}\n`);
  const body = (stdout + stderr).trimEnd();
  if (body) process.stdout.write(`${body.replace(/^/gm, "     ")}\n`);
  for (const id of failureIds(gate, stdout)) failing.set(id, gate.id);
}

// Shrink-only reconciliation.
const unexpected = [...failing.keys()].filter((id) => !ledger.has(id));
const fixed = [...ledger.keys()].filter((id) => !failing.has(id));
const outstanding = [...failing.keys()].filter((id) => ledger.has(id));

process.stdout.write("\n");

if (outstanding.length > 0) {
  process.stdout.write(`${outstanding.length} known defect(s) outstanding - expected, recorded in known-defects.txt:\n`);
  for (const id of outstanding) process.stdout.write(`  - ${id}  ${ledger.get(id)}\n`);
}

if (unexpected.length > 0) {
  process.stdout.write(`\n${unexpected.length} NEW failure(s) - not in the ledger, so this is a regression:\n`);
  for (const id of unexpected) process.stdout.write(`  - ${id}\n`);
}

if (fixed.length > 0) {
  process.stdout.write(
    `\n${fixed.length} ledger entr(y/ies) now PASS. Good - but the ledger is shrink-only,\n` +
      `so remove them from known-defects.txt to bank the fix:\n`,
  );
  for (const id of fixed) process.stdout.write(`  - ${id}  ${ledger.get(id)}\n`);
}

if (unexpected.length === 0 && fixed.length === 0) {
  const summary = outstanding.length === 0 ? "all gates green, ledger empty" : "no regressions";
  process.stdout.write(`${sawOutput ? "" : "\n"}${summary}\n`);
  process.exit(0);
}

process.exit(1);
