#!/usr/bin/env node
/**
 * @purpose Keeps every trigger pointing at a script that exists, addressed from the
 * folder the host hands us rather than from wherever the user happened to be standing.
 * A trigger naming a missing or wrongly-addressed script fails silently on somebody
 * else's machine, which is the one place we cannot see it.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, readJson, rel, runGate, walk } from "./lib/gate.mjs";

/**
 * The variables tools set to this plugin's own folder. Named one by one on purpose: any
 * variable would pass a wildcard, including a made-up one that is never set, and a trigger
 * pointing at an unset variable fails silently on somebody else's machine.
 */
const PLUGIN_ROOT_VARS = ["${CLAUDE_PLUGIN_ROOT}", "${CURSOR_PLUGIN_ROOT}"];

/**
 * The folder kit is not a plugin and has no folder variable of its own. The creator copies its
 * triggers into a person's folder, under `.claude/hooks/`, and registers them in that folder's
 * settings, where the host hands the folder over as CLAUDE_PROJECT_DIR. So that variable, and only
 * for the kit, addresses a script, and `.claude/hooks/<name>` there is `folder-kit/hooks/<name>`
 * here. A plugin's own trigger may not use it: a plugin runs what it ships, never whatever sits in
 * the project somebody happens to have open.
 */
const PROJECT_VAR = "CLAUDE_PROJECT_DIR";
const KIT = join(REPO_ROOT, "folder-kit");
const KIT_SETTINGS = join(KIT, "settings.hooks.json");
const KIT_HOOKS = join(KIT, "hooks");
/** Either spelling a shell reads, `$VAR` or `${VAR}`, and the path it addresses after it. */
const FROM_PROJECT = new RegExp(`\\$(?:\\{${PROJECT_VAR}\\}|${PROJECT_VAR}(?![A-Za-z0-9_]))(/[^\\s"']*)`);
/** Where a kit script sits in a person's folder. Node scripts of every kind and shell scripts all count. */
const IN_FOLDER = /^\/\.claude\/hooks\/([A-Za-z0-9._-]+\.(?:mjs|cjs|js|sh))$/;
/** A command that runs a script at all, rather than only printing words. */
const RUNS_SCRIPT = /\.(?:mjs|cjs|js|sh)\b/;

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

/**
 * The folder kit's triggers, read from the one file the creator merges into a person's settings.
 * The kit must be here: a release without it would leave every folder the creator makes from it
 * with nothing to copy, and a kit with no registrations would ship five scripts that never run.
 */
function checkKit(findings) {
  let entries;
  try {
    entries = readdirSync(KIT);
  } catch {
    findings.push({ file: rel(KIT), message: "the folder kit is missing, so no person's folder could receive its triggers" });
    return;
  }
  if (!entries.includes("settings.hooks.json")) {
    findings.push({ file: rel(KIT_SETTINGS), message: "the folder kit registers no triggers: its settings file is missing" });
    return;
  }
  const parsed = readJson(KIT_SETTINGS, findings);
  if (parsed === undefined) return;
  const declared = commands(parsed);
  if (declared.length === 0) {
    findings.push({ file: rel(KIT_SETTINGS), message: "the folder kit registers no triggers at all" });
    return;
  }
  for (const command of declared) {
    if (!RUNS_SCRIPT.test(command)) continue; // a trigger that just prints text runs no script
    const path = command.match(FROM_PROJECT)?.[1];
    if (path === undefined) {
      findings.push({
        file: rel(KIT_SETTINGS),
        message:
          `runs a script from somewhere other than the person's folder: ${command.trim()}. ` +
          `Address it as "$${PROJECT_VAR}/.claude/hooks/<name>", where the creator puts it.`,
      });
      continue;
    }
    const script = path.match(IN_FOLDER)?.[1];
    if (script === undefined) {
      findings.push({ file: rel(KIT_SETTINGS), message: `names ${path}, which is not a script in the folder's .claude/hooks/` });
      continue;
    }
    if (!existsSync(join(KIT_HOOKS, script))) {
      findings.push({ file: rel(KIT_SETTINGS), message: `names .claude/hooks/${script}, which the kit does not carry: ${rel(join(KIT_HOOKS, script))} does not exist` });
    }
  }
}

runGate({
  id: "trigger-paths",
  purpose: "Every trigger runs a script that is really there.",
  rule:
    "a trigger that runs a script must address it from a folder variable its tool sets, and the script must exist: " +
    "a plugin's from its own folder, the folder kit's from the person's",
  assert(findings) {
    checkKit(findings);

    const triggerFiles = walk(join(REPO_ROOT, "plugins")).filter((f) => /(^|\/)hooks\.json$/.test(f) || /\/hooks\/[^/]+\.json$/.test(f));

    if (triggerFiles.length === 0) {
      findings.push({ file: "plugins/", message: "no triggers are declared at all" });
      return;
    }

    for (const file of triggerFiles) {
      const parsed = readJson(file, findings);
      if (parsed === undefined) continue;

      for (const command of commands(parsed)) {
        if (command.includes(PROJECT_VAR)) {
          findings.push({
            file: rel(file),
            message:
              `addresses the person's project folder: ${command.trim()}. Only the folder kit may; ` +
              `a plugin's trigger runs what the plugin ships, from ${PLUGIN_ROOT_VARS.join(" / ")}.`,
          });
          continue;
        }
        if (!command.includes(".sh")) continue; // a trigger that just prints text runs no script

        // A command must address its script from a variable holding the plugin's own
        // folder. It may carry a default for a tool that hands over no variable at all -
        // without one, that tool prints a shell error on every single reply instead of
        // quietly doing nothing. The default is read THROUGH rather than treated as a
        // reason to skip: bailing out on it is what left this check blind to the one
        // command in the file it most needed to see.
        // Matched without its closing brace, so `${VAR}` and `${VAR:-default}` both count.
        // Sliced rather than string-replaced: a replace only touches the first brace it
        // finds, which reads as sanitisation and is not what is meant here.
        const opensWith = (v) => v.slice(0, -1);
        const rootVar = PLUGIN_ROOT_VARS.find((v) => command.includes(opensWith(v)));

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
        const opensAt = command.indexOf(opensWith(rootVar));
        const after = command.slice(command.indexOf("}", opensAt) + 1);
        const scriptPath = after.match(/^\/[^\s"']+\.sh/)?.[0];
        if (!scriptPath) continue;

        // Normally a trigger's script sits in its own plugin. One does not, and cannot: a
        // tool that needs its reminders in a plugin of their own still shares the one
        // end-of-reply script rather than carrying a second copy of it. Where the default
        // spells out a sibling plugin by name, that is the folder to look in - taken from
        // the command itself rather than from a list here, so a command claiming a folder
        // that does not exist is still refused.
        const ownDir = join(REPO_ROOT, rel(file).split("/").slice(0, 2).join("/"));
        const named = command.slice(opensAt).match(/plugins\/([A-Za-z0-9._-]+)/)?.[1];
        const namedDir = named === undefined ? undefined : join(REPO_ROOT, "plugins", named);
        const lookedIn = [ownDir, ...(namedDir === undefined ? [] : [namedDir])];

        if (!lookedIn.some((dir) => existsSync(join(dir, scriptPath)))) {
          findings.push({
            file: rel(file),
            message: `names ${scriptPath}, which does not exist in ${lookedIn.map(rel).join(" or ")}`,
          });
        }
      }
    }
  },
});
