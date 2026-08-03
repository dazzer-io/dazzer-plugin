#!/usr/bin/env node
/**
 * @purpose Keeps the one version people see agreeing with itself everywhere it appears.
 * It is written in three separate files by hand, and a past release already left one of
 * them behind while editing the line directly above it. A version that disagrees with
 * itself means nobody can tell which build somebody is actually running.
 */

import { join } from "node:path";
import { REPO_ROOT, readJson, rel, runGate, walk } from "./lib/gate.mjs";

/** Semantic version, optionally with a short pre-release tag. */
const VERSION_SHAPE = /^\d{1,4}\.\d{1,4}\.\d{1,4}(-[A-Za-z0-9.]{1,16})?$/;

/** Where a version is declared, and how to pull it out. */
function declarations(findings) {
  const out = [];

  for (const file of walk(join(REPO_ROOT, "plugins"))) {
    if (!file.endsWith(".json")) continue;
    const parsed = readJson(file, findings);
    if (parsed === undefined) continue;

    if (file.endsWith("plugin.json") && typeof parsed.version === "string") {
      out.push({ file: rel(file), field: "version", value: parsed.version });
    }
    if (file.endsWith(".mcp.json")) {
      for (const [name, server] of Object.entries(parsed.mcpServers ?? {})) {
        const header = server?.headers?.["X-Dazzer-Plugin-Version"];
        if (typeof header === "string") {
          out.push({ file: rel(file), field: `${name} version header`, value: header });
        }
      }
    }
  }
  return out;
}

runGate({
  id: "version-parity",
  purpose: "One version, declared identically in every place that declares one.",
  rule: "every declared version must be the same and well-formed",
  assert(findings) {
    const found = declarations(findings);

    if (found.length === 0) {
      findings.push({ file: "plugins/", message: "no version is declared anywhere" });
      return;
    }

    for (const d of found) {
      if (!VERSION_SHAPE.test(d.value)) {
        findings.push({
          file: d.file,
          message: `${d.field} is "${d.value}", which is not a version. The service discards a version it cannot read.`,
        });
      }
    }

    const distinct = [...new Set(found.map((d) => d.value))];
    if (distinct.length > 1) {
      for (const d of found) {
        findings.push({ file: d.file, message: `${d.field} says ${d.value}` });
      }
      findings.push({
        file: "plugins/",
        message: `these disagree (${distinct.join(" vs ")}). Bump them together, or nobody can tell which build is in the field.`,
      });
    }
  },
});
