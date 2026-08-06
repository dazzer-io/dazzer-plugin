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

/**
 * The variables tools set to this plugin's own folder. Named one by one on purpose: any
 * variable would pass a wildcard, including a made-up one that is never set, and a trigger
 * pointing at an unset variable fails silently on somebody else's machine.
 */
const PLUGIN_ROOT_VARS = ["${CLAUDE_PLUGIN_ROOT}", "${CURSOR_PLUGIN_ROOT}"];

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
  rule: "a trigger that runs a script must address it from a folder variable its tool sets, and the script must exist",
  assert(findings) {
    const triggerFiles = walk(join(REPO_ROOT, "plugins")).filter((f) => /(^|\/)hooks\.json$/.test(f) || /\/hooks\/[^/]+\.json$/.test(f));

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

        // Two acceptable forms, and only two. Most tools hand a plugin a variable holding
        // its own folder. Google's hands it nothing, so the only way its trigger can find
        // the script is to name the folder that tool always installs into - which is a
        // known location, not a developer's own machine.
        const rootVar = PLUGIN_ROOT_VARS.find((v) => command.includes(v));

        if (rootVar === undefined) {
          findings.push({
            file: rel(file),
            message:
              `runs a script from a path that only works on the machine it was written on: ${command.trim()}. ` +
              `Address it from one of ${PLUGIN_ROOT_VARS.join(" / ")}.`,
          });
          continue;
        }

        // Read from whichever variable this command actually used. Spelled as its own pattern
        // over one hard-coded name, the file a second tool reads sat outside this check
        // entirely and a script that does not exist could ship in it; spelled as a pattern
        // over any name, an unset variable would pass - the same wildcard the list above
        // exists to refuse.
        const after = command.slice(command.indexOf(rootVar) + rootVar.length);
        const scriptPath = after.match(/^\/[^\s"']+\.sh/)?.[0];
        if (!scriptPath) continue;

        const pluginDir = join(REPO_ROOT, rel(file).split("/").slice(0, 2).join("/"));
        if (!existsSync(join(pluginDir, scriptPath))) {
          findings.push({ file: rel(file), message: `names ${scriptPath}, which does not exist in ${rel(pluginDir)}` });
        }
      }
    }
  },
});
