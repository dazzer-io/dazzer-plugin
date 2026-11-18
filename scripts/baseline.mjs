#!/usr/bin/env node
/**
 * @purpose Runs every check and every test in one command, so a change that breaks something
 * fails loudly and names what broke. Every gate runs whatever came before it, so one failure
 * never hides the rest.
 *
 *   node scripts/baseline.mjs                    every check and every test
 *   SHELL_UNDER_TEST=bash node scripts/baseline.mjs --shell-suites
 *                                                the shell suites only, under a second shell
 *
 * Tests are found, so a new file in tests/ cannot sit unrun, and the known suites are also named,
 * so deleting one fails rather than leaving everything green:
 *   tests/*.test.sh             a shell suite; it runs the shipped script under SHELL_UNDER_TEST
 *   tests/<mod>/*.test.ts       a mod's tests (a plugin whose hooks/hooks.json lists modules), run
 *                               by `claude plugin test` on a copy of plugins/<mod> with the tests in
 *                               its tests/ folder, because that command runs only tests inside the
 *                               mod's folder and nothing that installs may carry one
 *
 * `claude plugin test` comes from the Claude Code version package-lock.json pins
 * (`npm ci --ignore-scripts`); only when that is not installed does it fall back to `claude` on
 * the PATH, and it says so.
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TESTS = join(ROOT, "tests");
const CHECK = (name) => ({ cmd: "node", args: [`scripts/checks/${name}.mjs`] });
const SHELL_ONLY = process.argv.includes("--shell-suites");
/** Room for a long test log, so an overflow is reported as one rather than as a failed start. */
const MAX_OUTPUT = 64 * 1024 * 1024;

const GATES = [
  // Every per-tool file is written from source/ by scripts/generate.mjs, and each of its checks is
  // seen refusing a planted fault on every run.
  { id: "generated", name: "every per-tool file matches the generator", cmd: "node", args: ["scripts/generate.mjs", "--check"] },
  { id: "generated-selftest", name: "every generator check refuses its planted fault", cmd: "node", args: ["scripts/generate.mjs", "--selftest"] },

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

/** The suites that must be there: found tests that vanish would otherwise just stop running. */
const REQUIRED = ["capture-sweep", "own-place", "dazzer-plate"];

/** The cases the sweep suite keeps, each the kind that once hid a defect. */
const SWEEP_CASES = {
  "shrink:": "a conversation that gets shorter, then grows again, as a context reset makes it",
  "escape:": "a session name trying to write outside the folder the plugin owns",
  "setting:": "a mistyped setting, which must fall back rather than misbehave",
};

/**
 * What a shell suite needs to see a failure at all: it runs its subject under the shell it was
 * handed, or the second-shell run tests the first shell again, and it keeps what the subject
 * prints to the error channel, the habit whose absence once hid three defects.
 */
function suiteContract(entry) {
  const text = readFileSync(join(TESTS, entry), "utf8");
  const runs = text.split("\n").filter((line) => line.includes('"$SUBJECT"') && !line.trimStart().startsWith("#"));
  const out = [];
  if (!runs.some((line) => line.includes('"$SHELL_UNDER_TEST" "$SUBJECT"'))) {
    out.push('never runs "$SUBJECT" under "$SHELL_UNDER_TEST", so a run under a second shell tests the first one again');
  }
  if (!runs.some((line) => /2>\s*"\$/.test(line)) || runs.some((line) => /2>\s*(\/dev\/null|&1)/.test(line))) {
    out.push("does not keep what its subject prints to the error channel in a file of its own, so it cannot assert that channel is empty");
  }
  if (entry === "capture-sweep.test.sh") {
    for (const [tag, why] of Object.entries(SWEEP_CASES)) if (!text.includes(`"${tag}`)) out.push(`has no case tagged "${tag}": ${why}`);
  }
  return out;
}

/** A plugin whose hooks file lists modules is a mod, and only a mod's tests run as a folder. */
function isMod(plugin) {
  try {
    return Array.isArray(JSON.parse(readFileSync(join(ROOT, "plugins", plugin, "hooks", "hooks.json"), "utf8")).modules);
  } catch {
    return false;
  }
}

/** The Claude Code that runs a mod's tests: the pinned one when installed, else the one on the PATH. */
function claudeCode() {
  const pinned = join(ROOT, "node_modules", "@anthropic-ai", "claude-code", "cli-wrapper.cjs");
  if (existsSync(pinned)) return { cmd: "node", args: [pinned] };
  process.stdout.write("note: the pinned Claude Code is not installed (npm ci --ignore-scripts), so the plate tests run on the claude on the PATH, whatever version that is\n");
  return { cmd: "claude", args: [] };
}

/** Every test file, each as a gate. A file in tests/ that nothing here can run fails the run. */
function testGates() {
  const gates = [];
  for (const entry of existsSync(TESTS) ? readdirSync(TESTS).sort() : []) {
    const path = join(TESTS, entry);
    if (statSync(path).isFile() && entry.endsWith(".test.sh")) {
      gates.push({ id: entry.replace(/\.test\.sh$/, ""), name: `tests/${entry}`, cmd: "sh", args: [`tests/${entry}`], broken: suiteContract(entry) });
    } else if (SHELL_ONLY) {
      continue;
    } else if (statSync(path).isDirectory() && isMod(entry)) {
      gates.push({ id: entry, name: `tests/${entry}/, on a copy of plugins/${entry}`, mod: entry });
    } else {
      gates.push({ id: entry, name: `tests/${entry}`, unrunnable: true });
    }
  }
  for (const id of REQUIRED) {
    if (SHELL_ONLY && id === "dazzer-plate") continue;
    if (!gates.some((gate) => gate.id === id)) gates.push({ id, name: `tests/${id}`, missing: true });
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
    // The runner is a whole Claude Code: kept from updating itself or reporting home mid-test.
    const env = { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", DISABLE_AUTOUPDATER: "1" };
    const run = spawnSync(cmd, [...args, "plugin", "test", copy], { cwd: ROOT, encoding: "utf8", env, maxBuffer: MAX_OUTPUT });
    // A run that passes having run nothing proves nothing.
    const passed = Number(`${run.stdout ?? ""}${run.stderr ?? ""}`.match(/^\s*(\d+) pass\s*$/m)?.[1] ?? 0);
    if (run.status === 0 && !(passed > 0)) return { ...run, status: 1, stderr: [run.stderr, "reported no passing test, so nothing shows it ran any"].filter(Boolean).join("\n") };
    return run;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const failed = [];
for (const gate of [...(SHELL_ONLY ? [] : GATES), ...testGates()]) {
  let run;
  if (gate.missing) {
    run = { status: 1, stdout: "", stderr: "is missing: it is one of the suites this run requires, so deleting it fails rather than going quiet" };
  } else if (gate.unrunnable) {
    run = { status: 1, stdout: "", stderr: "nothing runs this: a shell suite is named tests/<name>.test.sh, and a folder runs only as the tests of a mod named in plugins/ (today, dazzer-plate)" };
  } else if (gate.broken?.length > 0) {
    run = { status: 1, stdout: "", stderr: gate.broken.join("\n") };
  } else if (gate.mod) {
    run = runMod(gate.mod);
  } else {
    run = spawnSync(gate.cmd, gate.args, { cwd: ROOT, encoding: "utf8", env: { ...process.env, DAZZER_REPO_ROOT: ROOT }, maxBuffer: MAX_OUTPUT });
  }
  if (run.error?.code === "ENOBUFS") {
    run = { status: 1, stdout: "", stderr: `printed more than ${MAX_OUTPUT / 1024 / 1024} MB, so its output was cut off there` };
  } else if (run.error) {
    run = { status: 1, stdout: "", stderr: `could not start ${gate.mod ? "claude plugin test" : gate.cmd}: ${run.error.message}` };
  }

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
process.stdout.write(`\nall ${SHELL_ONLY ? "shell suites" : "gates"} green\n`);
