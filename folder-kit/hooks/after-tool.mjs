/**
 * @purpose After each tool that ran, and each skill command the person typed, notes in the
 * session's log which tool it was and the thread, conversation or record identifiers its input
 * names, never what it said, and marks a write to the Brain as a save, so the end of the turn can
 * tell a save that landed from one that was only claimed; after a skill, reminds Dazzer to report
 * the run by the skill's name.
 *
 * Claude Code runs this only after a tool succeeded. An MCP server's prompt is not a skill and is
 * passed over. Which fields hold identifiers and which tools write to the Brain are in
 * kit.defaults.json.
 */

import { appendLog, object, pattern, say, sessionFolder, text, trigger } from "./lib.mjs";

/** The identifiers named under the listed fields, at any depth: short, single words, never sentences. */
function idsUnder(node, rules, out = new Set()) {
  if (out.size >= rules.max) return out;
  if (Array.isArray(node)) {
    for (const child of node) idsUnder(child, rules, out);
  } else if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (rules.fields.has(key) && (typeof value === "string" || typeof value === "number")) {
        const id = String(value);
        if (id !== "" && id.length <= rules.longest && !/\s/.test(id) && out.size < rules.max) out.add(id);
      } else {
        idsUnder(value, rules, out);
      }
    }
  }
  return out;
}

trigger(({ input, defaults, words }) => {
  const event = text(input, "hook_event_name");
  const folder = sessionFolder(input);

  if (event === "UserPromptExpansion") {
    if (text(input, "expansion_type") !== "slash_command") return "";
    if (folder !== null) appendLog(folder, { tool: "UserPromptExpansion", ids: [] });
    return say("UserPromptExpansion", words.run);
  }

  if (event !== "PostToolUse") return "";
  const tool = text(input, "tool_name");
  if (tool === undefined) return "";
  if (folder !== null) {
    const rules = {
      fields: new Set(Array.isArray(defaults.id_fields) ? defaults.id_fields : []),
      longest: defaults.id_max_length,
      max: defaults.ids_max,
    };
    const ids = [...idsUnder(object(input, "tool_input") ?? {}, rules)];
    const save = pattern(defaults.brain_write_pattern)?.test(tool) === true;
    appendLog(folder, save ? { tool, ids, save } : { tool, ids });
  }
  return tool === defaults.skill_tool ? say("PostToolUse", words.run) : "";
});
