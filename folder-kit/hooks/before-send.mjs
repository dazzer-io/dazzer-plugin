/**
 * @purpose Before anything leaves for the person (a reply, a message, a post, an invite), stops it
 * when the thread it answers was never read in this session, when it names a time and no calendar
 * was read in this session, or when it holds a word on the person's own banned list, and says
 * which, so Dazzer puts that right and sends again. Anything else, and any doubt, lets it through.
 *
 * Which tools send, which field names a thread, which tool reads it, what names a time and where
 * the banned list sits are all in kit.defaults.json. The banned list is the person's own file in
 * their folder: Dazzer adds to it, and no update of the kit ever touches it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deny, object, pattern, readLog, sessionFolder, text, trigger } from "./lib.mjs";

/** Every string held under one of the named fields, at any depth of the tool's input. */
function textsUnder(node, fields, out = []) {
  if (Array.isArray(node)) {
    for (const child of node) textsUnder(child, fields, out);
  } else if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === "string" && fields.has(key)) out.push(value);
      else textsUnder(value, fields, out);
    }
  }
  return out;
}

/** The person's banned words, or none when the list is absent, unreadable or not a list of words. */
function bannedWords(path) {
  try {
    const list = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(list)) return [];
    return [...new Set(list.filter((word) => typeof word === "string").map((word) => word.trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

/** Whether the words hold this one, whole and regardless of case: "team" is not found in "teams". */
function holdsWord(said, word) {
  const literal = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${literal}(?![\\p{L}\\p{N}_])`, "iu").test(said);
}

/** Whether the session's log shows a tool matching this pattern that named this id. */
const readIn = (log, reader, id) =>
  reader !== null &&
  log.some((line) => typeof line.tool === "string" && reader.test(line.tool) && Array.isArray(line.ids) && line.ids.includes(id));

trigger(({ input, defaults, words }) => {
  const send = object(defaults, "send");
  const tool = text(input, "tool_name");
  const args = object(input, "tool_input");
  if (send === undefined || tool === undefined || args === undefined) return "";
  if (pattern(send.pattern)?.test(tool) !== true) return "";

  // The two checks that read the session's log need a session; without one they stay quiet.
  const folder = sessionFolder(input);
  const log = folder === null ? null : readLog(folder);
  const said = textsUnder(args, new Set(Array.isArray(send.text_fields) ? send.text_fields : [])).join("\n");
  const reasons = [];

  if (log !== null) {
    for (const entry of Array.isArray(send.tools) ? send.tools : []) {
      if (pattern(entry?.tool)?.test(tool) !== true) continue;
      const thread = args[entry.thread_field];
      if ((typeof thread !== "string" && typeof thread !== "number") || String(thread) === "") continue;
      if (!readIn(log, pattern(entry.read_tool), String(thread))) {
        reasons.push(words.unread_thread);
        break;
      }
    }
    if (said !== "" && pattern(defaults.time_pattern, "i")?.test(said) === true) {
      const calendar = pattern(defaults.calendar_read_pattern);
      if (!log.some((line) => typeof line.tool === "string" && calendar?.test(line.tool) === true)) reasons.push(words.no_calendar);
    }
  }

  const project = process.env.CLAUDE_PROJECT_DIR;
  if (said !== "" && typeof project === "string" && project !== "" && typeof defaults.bans_path === "string") {
    for (const word of bannedWords(join(project, defaults.bans_path))) {
      if (holdsWord(said, word)) reasons.push(`${words.banned_word} ${word}`);
    }
  }

  return reasons.length > 0 ? deny(reasons.join("\n")) : "";
});
