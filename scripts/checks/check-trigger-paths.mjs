#!/usr/bin/env node
/**
 * @purpose Keeps every trigger pointing at a script that exists, addressed from the
 * folder the host hands us rather than from wherever the user happened to be standing.
 * A trigger naming a missing or wrongly-addressed script fails silently on somebody
 * else's machine, which is the one place we cannot see it.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, readJson, rel, runGate, walk } from "./lib/gate.mjs";

/** The variable the host sets to this plugin's own folder. */
const PLUGIN_ROOT = "${CLAUDE_PLUGIN_ROOT}";

/** Every command string declared anywhere in a trigger file. */
function commands(node, out = []) {
  if (node === null || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) commands(child, out);
    return out;
  }
  if (typeof node.command === "string") out.push(node.command);
  for (const child of Object.values(node)) commands(child, out);
  return out;
}

runGate({
  id: "trigger-paths",
  purpose: "Every trigger runs a script that is really there.",
  rule: `a trigger that runs a script must address it from ${PLUGIN_ROOT} and the script must exist`,
  assert(findings) {
    const triggerFiles = walk(join(REPO_ROOT, "plugins")).filter((f) => /(^|\/)hooks\.json$/.test(f));

    if (triggerFiles.length === 0) {
      findings.push({ file: "plugins/", message: "no triggers are declared at all" });
      return;
    }

    for (const file of triggerFiles) {
      const parsed = readJson(file, findings);
      if (parsed === undefined) continue;

      for (const command of commands(parsed)) {
        const scriptRef = command.match(/(\$\{?[A-Za-z_][A-Za-z0-9_]*\}?)?[^\s"']*\.sh/);
        if (!scriptRef) continue; // a trigger that just prints text runs no script

        if (!command.includes(PLUGIN_ROOT)) {
          findings.push({
            file: rel(file),
            message:
              `runs a script without addressing it from ${PLUGIN_ROOT}: ${command.trim()}. ` +
              "An absolute or relative path only works on the machine it was written on.",
          });
          continue;
        }

        const scriptPath = command.match(/\$\{CLAUDE_PLUGIN_ROOT\}(\/[^\s"']+\.sh)/)?.[1];
        if (!scriptPath) continue;

        const pluginDir = join(REPO_ROOT, rel(file).split("/").slice(0, 2).join("/"));
        if (!existsSync(join(pluginDir, scriptPath))) {
          findings.push({ file: rel(file), message: `names ${scriptPath}, which does not exist in ${rel(pluginDir)}` });
        }
      }
    }
  },
});
