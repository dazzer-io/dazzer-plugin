#!/usr/bin/env node
/**
 * @purpose Keeps the list people install from agreeing with what is actually here. A
 * plugin missing from the list is invisible however good it is; a list entry pointing
 * at nothing fails at install time on a stranger's machine rather than here.
 */

import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { REPO_ROOT, readJson, rel, runGate } from "./lib/gate.mjs";

const INDEX = join(REPO_ROOT, ".claude-plugin", "marketplace.json");
const PLUGINS_DIR = join(REPO_ROOT, "plugins");

/** A listing entry's source may be a plain path or an object carrying one. */
const sourcePath = (source) =>
  typeof source === "string" ? source : typeof source?.path === "string" ? source.path : undefined;

runGate({
  id: "manifest-parity",
  purpose: "Everything present is listed, and everything listed is present.",
  rule: "each plugin directory appears exactly once in the install list, under its own name, and resolves",
  assert(findings) {
    if (!existsSync(INDEX)) {
      findings.push({ file: rel(INDEX), message: "the install list is missing" });
      return;
    }

    const index = readJson(INDEX, findings);
    if (index === undefined) return;

    const listed = Array.isArray(index.plugins) ? index.plugins : [];
    const onDisk = readdirSync(PLUGINS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);

    for (const entry of listed) {
      const path = sourcePath(entry.source);
      if (path === undefined) {
        findings.push({ file: rel(INDEX), message: `"${entry.name}" has no usable source` });
        continue;
      }
      if (!existsSync(resolve(REPO_ROOT, path))) {
        findings.push({ file: rel(INDEX), message: `"${entry.name}" points at ${path}, which does not exist` });
      }

      const manifest = join(REPO_ROOT, path, ".claude-plugin", "plugin.json");
      if (!existsSync(manifest)) {
        findings.push({ file: rel(INDEX), message: `"${entry.name}" has no manifest at ${rel(manifest)}` });
        continue;
      }
      const parsed = readJson(manifest, findings);
      if (parsed && parsed.name !== entry.name) {
        findings.push({
          file: rel(manifest),
          message: `calls itself "${parsed.name}" but the install list calls it "${entry.name}"`,
        });
      }
      if (parsed && parsed.license === "MIT" && !existsSync(join(REPO_ROOT, "LICENSE"))) {
        findings.push({
          file: rel(manifest),
          message: "declares the MIT licence, but the repository grants no licence at all. Add a LICENSE file.",
        });
      }
    }

    const listedNames = new Set(listed.map((e) => sourcePath(e.source)?.replace(/^\.\/plugins\//, "")));
    for (const dir of onDisk) {
      if (!listedNames.has(dir)) {
        findings.push({ file: `plugins/${dir}`, message: "exists but is not in the install list, so nobody can install it" });
      }
    }
  },
});
