/**
 * @purpose Gives every gate one shape - collect findings, print them, exit 1 - so a
 * failing check always names the file, the line and the rule, and never stops at the
 * first problem. Shared so a new gate is a list of assertions, not a program.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/** Repo root, overridable so a gate can be pointed at a fixture tree in its own tests. */
export const REPO_ROOT = resolve(process.env.DAZZER_REPO_ROOT ?? process.cwd());

export const rel = (p) => relative(REPO_ROOT, p) || ".";

/** Directories that never contain shipped product or gate source. */
const SKIP_DIRS = new Set([".git", "node_modules", ".github/cache"]);

/** Every file under `dir`, recursively, as absolute paths. */
export function walk(dir = REPO_ROOT, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

export const read = (p) => readFileSync(p, "utf8");

export const exists = (p) => {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
};

/**
 * Parses JSON and turns a syntax error into a finding rather than a stack trace.
 * Returns undefined on failure so the caller decides whether that is fatal.
 */
export function readJson(p, findings) {
  try {
    return JSON.parse(read(p));
  } catch (err) {
    findings?.push({ file: rel(p), message: `not valid JSON: ${err.message}` });
    return undefined;
  }
}

/** Every line of `text` as {n, text}, 1-indexed, so findings can cite a line. */
export const lines = (text) => text.split("\n").map((t, i) => ({ n: i + 1, text: t }));

/**
 * Runs a gate: collects findings from `assert`, prints them all, exits 1 if any.
 * `--help` prints the contract and exits 0 so a human can learn what a gate means
 * without reading it.
 */
export function runGate({ id, purpose, rule, assert }) {
  if (process.argv.includes("--help")) {
    process.stdout.write(
      `${id}\n\n${purpose}\n\nRule: ${rule}\n\n` +
        `Exit 0 = no violations. Exit 1 = violations, listed one per line.\n` +
        `Env: DAZZER_REPO_ROOT overrides the tree being checked (used by fixture tests).\n`,
    );
    process.exit(0);
  }

  const findings = [];
  assert(findings);

  if (findings.length === 0) {
    process.stdout.write(`ok   ${id}\n`);
    process.exit(0);
  }

  process.stdout.write(`FAIL ${id} - ${rule}\n`);
  for (const f of findings) {
    const where = f.line ? `${f.file}:${f.line}` : f.file;
    process.stdout.write(`  ${where}  ${f.message}\n`);
  }
  process.exit(1);
}
