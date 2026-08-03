#!/usr/bin/env node
/**
 * @purpose Keeps what we tell people matching what the code does. The settings we
 * document, the defaults we ship and the settings the script actually reads are one
 * set with three renderings; when they drift, the instructions quietly become fiction.
 * The uninstall instructions are checked for the same reason - they were left naming
 * one installable piece after a release created a second.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, read, rel, runGate, walk } from "./lib/gate.mjs";

const README = join(REPO_ROOT, "README.md");
const DEFAULTS = join(REPO_ROOT, "plugins", "dazzer", "config", "capture.defaults");

const settingNames = (text) => new Set([...text.matchAll(/\bDAZZER_[A-Z0-9_]+\b/g)].map((m) => m[0]));

runGate({
  id: "docs-truth",
  purpose: "Documented settings, shipped defaults and the code agree; instructions name every piece.",
  rule: "the settings we document, ship defaults for, and read must be one set; uninstall must name every installable piece",
  assert(findings) {
    if (!existsSync(README)) {
      findings.push({ file: "README.md", message: "missing" });
      return;
    }
    const readme = read(README);

    // Settings the shipped scripts actually read.
    const inCode = new Set();
    for (const file of walk(join(REPO_ROOT, "plugins"))) {
      if (!file.endsWith(".sh") || file.endsWith(".test.sh")) continue;
      for (const name of settingNames(read(file))) inCode.add(name);
    }

    // Settings we document, taken from the tuning table only.
    const table = readme.match(/\|\s*Variable[\s\S]*?(?=\n#{1,6}\s|\n*$)/)?.[0] ?? "";
    const documented = settingNames(table);

    for (const name of inCode) {
      if (!documented.has(name)) {
        findings.push({ file: "README.md", message: `${name} changes behaviour but is not documented in the tuning table` });
      }
    }
    for (const name of documented) {
      if (!inCode.has(name)) {
        findings.push({ file: "README.md", message: `${name} is documented but nothing reads it` });
      }
    }

    // Once defaults are shipped, they join the same set.
    if (existsSync(DEFAULTS)) {
      const shipped = settingNames(read(DEFAULTS));
      for (const name of inCode) {
        if (!shipped.has(name)) findings.push({ file: rel(DEFAULTS), message: `${name} has no shipped default` });
      }
      for (const name of shipped) {
        if (!inCode.has(name)) findings.push({ file: rel(DEFAULTS), message: `${name} has a default but nothing reads it` });
      }
    }

    // Uninstall must name every installable piece.
    const uninstall = readme.match(/##\s*Uninstall[\s\S]*$/i)?.[0] ?? "";
    if (!uninstall) {
      findings.push({ file: "README.md", message: "has no uninstall instructions" });
    } else {
      const plugins = readdirSync(join(REPO_ROOT, "plugins"), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
      for (const name of plugins) {
        if (!uninstall.includes(name)) {
          findings.push({
            file: "README.md",
            message: `uninstall never mentions "${name}", so anyone following it removes only part of what they installed`,
          });
        }
      }
    }
  },
});
