#!/usr/bin/env node
/**
 * @purpose Runs every check and every test in one command, so a change that breaks something
 * fails loudly and names what broke. Every gate runs whatever came before it, so one failure
 * never hides the rest.
 *
 *   node scripts/baseline.mjs
 *   SHELL_UNDER_TEST=bash node scripts/baseline.mjs
 *
 * Tests are found, not listed: every file in tests/ runs, so a test cannot sit unrun.
 *   tests/*.test.sh             a shell suite; it runs the shipped script under SHELL_UNDER_TEST
 *   tests/<plugin>/*.test.ts    a mod's tests, run by `claude plugin test` on a copy of
 *                               plugins/<plugin> with the tests in its tests/ folder, because that
 *                               command runs only tests inside the mod's folder and nothing that
 *                               installs may carry one
 *
 * `claude plugin test` comes from the Claude Code version package-lock.json pins
 * (`npm ci --ignore-scripts`), or from `claude` on the PATH when that is not installed.
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TESTS = join(ROOT, "tests");
const CHECK = (name) => ({ cmd: "node", args: [`scripts/checks/${name}.mjs`] });

const GATES = [
  // Every per-tool file is written from source/ by scripts/generate.mjs.
  { id: "generated", name: "every per-tool file matches the generator", cmd: "node", args: ["scripts/generate.mjs", "--check"] },

  // The two constraints that exist because something broke in the field.
  { id: "connection-isolation", name: "behaviour plugin ships no connection", ...CHECK("check-connection-isolation") },
  { id: "connection-address", name: "connection address is product-owned", ...CHECK("check-connection-address") },

  // What installs on a person's machine.
  { id: "installed-files", name: "nothing that installs is a test", ...CHECK("check-installed-files") },
  { id: "trigger-paths", name: "every trigger resolves to a real script", ...CHECK("check-trigger-paths") },
  { id: "shell-contract", name: "shipped shell obeys the defect-class rules", ...CHECK("check-shell-contract") },
  { id: "rules-not-restated", name: "everything shipped is a trigger, never a rule", ...CHECK("check-rules-not-restated") },

  // What people are told, against what ships.
  { id: "docs-truth", name: "settings and removal steps match the code", ...CHECK("check-docs-truth") },
  { id: "install-parity", name: "printed and rendered install steps agree", ...CHECK("check-install-parity") },
  { id: "connection-coverage", name: "every tool has a way to reach the Brain", ...CHECK("check-connection-coverage") },
];

/** The Claude Code that runs a mod's tests: the pinned one when installed, else the one on the PATH. */
function claudeCode() {
  const pinned = join(ROOT, "node_modules", "@anthropic-ai", "claude-code", "cli-wrapper.cjs");
  return existsSync(pinned) ? { cmd: "node", args: [pinned] } : { cmd: "claude", args: [] };
}

/** Every test file, each as a gate. A file in tests/ that nothing here can run fails the run. */
function testGates() {
  const gates = [];
  if (!existsSync(TESTS)) return gates;
  for (const entry of readdirSync(TESTS).sort()) {
    const path = join(TESTS, entry);
    if (statSync(path).isFile() && entry.endsWith(".test.sh")) {
      gates.push({ id: entry.replace(/\.test\.sh$/, ""), name: `tests/${entry}`, cmd: "sh", args: [`tests/${entry}`] });
    } else if (statSync(path).isDirectory() && existsSync(join(ROOT, "plugins", entry))) {
      gates.push({ id: entry, name: `tests/${entry}/, on a copy of plugins/${entry}`, mod: entry });
    } else {
      gates.push({ id: entry, name: `tests/${entry}`, unrunnable: true });
    }
  }
  return gates;
}

/** Runs a mod's tests on a copy of its plugin folder, with the tests in the copy's tests/ folder. */
function runMod(plugin) {
  const scratch = mkdtempSync(join(tmpdir(), "dazzer-mod-"));
  try {
    const copy = join(scratch, plugin);
    cpSync(join(ROOT, "plugins", plugin), copy, { recursive: true });
    cpSync(join(TESTS, plugin), join(copy, "tests"), { recursive: true });
    const { cmd, args } = claudeCode();
    return spawnSync(cmd, [...args, "plugin", "test", copy], { cwd: ROOT, encoding: "utf8" });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const failed = [];
for (const gate of [...GATES, ...testGates()]) {
  let run;
  if (gate.unrunnable) {
    run = { status: 1, stdout: "", stderr: "nothing runs this: name a shell suite *.test.sh, or a folder named after the plugin its tests are for" };
  } else if (gate.mod) {
    run = runMod(gate.mod);
  } else {
    run = spawnSync(gate.cmd, gate.args, { cwd: ROOT, encoding: "utf8", env: { ...process.env, DAZZER_REPO_ROOT: ROOT } });
  }
  if (run.error) run = { status: 1, stdout: "", stderr: `could not start ${gate.mod ? "claude plugin test" : gate.cmd}: ${run.error.message}` };

  if (run.status === 0) {
    process.stdout.write(`ok   ${gate.id.padEnd(20)} ${gate.name}\n`);
    continue;
  }
  failed.push(gate.id);
  process.stdout.write(`FAIL ${gate.id.padEnd(20)} ${gate.name}\n`);
  const body = `${run.stdout ?? ""}${run.stderr ?? ""}`.trimEnd();
  if (body) process.stdout.write(`${body.replace(/^/gm, "     ")}\n`);
}

if (failed.length > 0) {
  process.stdout.write(`\n${failed.length} failed: ${failed.join(", ")}\n`);
  process.exit(1);
}
process.stdout.write("\nall gates green\n");
