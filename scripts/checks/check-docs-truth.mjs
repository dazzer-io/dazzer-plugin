#!/usr/bin/env node
/**
 * @purpose Keeps what we tell people matching what the code does. The settings we
 * document, the defaults we ship and the settings the script actually reads are one
 * set with three renderings; when they drift, the instructions quietly become fiction.
 * The removal instructions are checked for the same reason - they were left naming
 * one installable piece after a release created a second.
 *
 * The settings table lives in docs/how-it-works.md and the removal steps in docs/install.md.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, read, rel, runGate, walk } from "./lib/gate.mjs";

const SETTINGS_DOC = join(REPO_ROOT, "docs", "how-it-works.md");
const INSTALL_DOC = join(REPO_ROOT, "docs", "install.md");
const DEFAULTS = join(REPO_ROOT, "plugins", "dazzer", "config", "capture.defaults");

const settingNames = (text) => new Set([...text.matchAll(/\bDAZZER_[A-Z0-9_]+\b/g)].map((m) => m[0]));

/** One `## Heading` section of a page, up to the next heading of that level. */
function section(text, heading) {
  const start = text.search(new RegExp(`^## ${heading}\\s*$`, "m"));
  if (start === -1) return "";
  const rest = text.slice(start);
  const end = rest.slice(1).search(/^## /m);
  return end === -1 ? rest : rest.slice(0, end + 1);
}

runGate({
  id: "docs-truth",
  purpose: "Documented settings, shipped defaults and the code agree; removal names every piece.",
  rule: "the settings we document, ship defaults for, and read must be one set; removal must name every installable piece",
  assert(findings) {
    for (const doc of [SETTINGS_DOC, INSTALL_DOC]) {
      if (!existsSync(doc)) findings.push({ file: rel(doc), message: "missing" });
    }
    if (findings.length > 0) return;

    // Settings the shipped scripts actually read.
    const inCode = new Set();
    for (const file of walk(join(REPO_ROOT, "plugins"))) {
      if (!file.endsWith(".sh")) continue;
      for (const name of settingNames(read(file))) inCode.add(name);
    }

    // Settings we document, taken from the settings table only.
    const table = read(SETTINGS_DOC).match(/\|\s*Variable[\s\S]*?(?=\n#{1,6}\s|\n*$)/)?.[0] ?? "";
    const documented = settingNames(table);
    const where = rel(SETTINGS_DOC);

    for (const name of inCode) {
      if (!documented.has(name)) {
        findings.push({ file: where, message: `${name} changes behaviour but is not documented in the settings table` });
      }
    }
    for (const name of documented) {
      if (!inCode.has(name)) {
        findings.push({ file: where, message: `${name} is documented but nothing reads it` });
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

    // Removal must name every installable piece.
    const removal = section(read(INSTALL_DOC), "Remove");
    if (!removal) {
      findings.push({ file: rel(INSTALL_DOC), message: 'has no "## Remove" section' });
    } else {
      const plugins = readdirSync(join(REPO_ROOT, "plugins"), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
      for (const name of plugins) {
        if (!removal.includes(`${name}@`)) {
          findings.push({
            file: rel(INSTALL_DOC),
            message: `removal never mentions "${name}", so anyone following it removes only part of what they installed`,
          });
        }
      }
    }
  },
});
