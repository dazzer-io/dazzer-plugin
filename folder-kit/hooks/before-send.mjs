/**
 * @purpose Before anything leaves for the person (a reply, a message, a post, an invite), stops it
 * once when the thread it answers was never read in this session, when it names a time and no
 * calendar was read in this session, or when it holds a word on the person's own banned list, and
 * says which, so Dazzer puts that right before sending again.
 *
 * It never blocks for good. An unread thread or an unchecked calendar is given as a reason at most
 * once a session for the same thread, or once a session for all the sends that answer no thread,
 * however they are worded, since Dazzer may be unable to meet those and must never be stuck
 * rewording. A banned word is different: rewording is how it is met, so it is given once for each
 * exact message, and a new message holding it is stopped again. Every stop is written to the
 * session's log before it is said, and the very same send tried again goes through. Nothing is
 * checked until the log holds a message, so a log that cannot be written stops nothing. A thread
 * counts as read when any tool of the same connector named it, or the read tool listed for that
 * kind of send did. The person is never stuck behind a check Dazzer cannot meet.
 *
 * Which tools send, which field names a thread, which tool reads it, what names a time and where
 * the banned list sits are all in kit.defaults.json. The banned list is the person's own file in
 * their folder: Dazzer adds to it, and no update of the kit ever touches it.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appendLog, deny, logWorks, object, pattern, readLog, sessionFolder, text, trigger } from "./lib.mjs";

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

/** The connector a tool belongs to: everything up to its operation's name, as `mcp__<server>__`. */
function connectorOf(tool) {
  const end = tool.lastIndexOf("__");
  return tool.startsWith("mcp__") && end > "mcp_".length ? tool.slice(0, end + 2) : null;
}

/** Whether the session's log shows the thread read: named by the listed read tool, or by any tool of the same connector. */
function threadRead(log, reader, connector, id) {
  return log.some(
    (line) =>
      typeof line.tool === "string" &&
      Array.isArray(line.ids) &&
      line.ids.includes(id) &&
      ((reader !== null && reader.test(line.tool)) || (connector !== null && line.tool.startsWith(connector))),
  );
}

/** A stop's mark in the log: which reason, for which thread or send, as a digest that holds no content. */
const markOf = (reason, subject) => createHash("sha256").update(`${reason}\u0000${subject}`).digest("hex").slice(0, 32);

trigger(({ input, defaults, words }) => {
  const send = object(defaults, "send");
  const tool = text(input, "tool_name");
  const args = object(input, "tool_input");
  if (send === undefined || tool === undefined || args === undefined) return "";
  if (pattern(send.pattern)?.test(tool) !== true) return "";

  // Nothing is enforced until the session's log is known to be written.
  const folder = sessionFolder(input);
  if (folder === null) return "";
  const log = readLog(folder);
  if (!logWorks(log)) return "";

  const said = textsUnder(args, new Set(Array.isArray(send.text_fields) ? send.text_fields : [])).join("\n");
  const reasons = [];
  let thread;

  for (const entry of Array.isArray(send.tools) ? send.tools : []) {
    if (pattern(entry?.tool)?.test(tool) !== true) continue;
    const named = args[entry.thread_field];
    if ((typeof named !== "string" && typeof named !== "number") || String(named) === "") continue;
    thread ??= String(named);
    if (!threadRead(log, pattern(entry.read_tool), connectorOf(tool), String(named))) {
      reasons.push({ why: "unread_thread", say: words.unread_thread });
      break;
    }
  }

  if (said !== "" && pattern(defaults.time_pattern, "i")?.test(said) === true) {
    const calendar = pattern(defaults.calendar_read_pattern);
    if (!log.some((line) => typeof line.tool === "string" && calendar?.test(line.tool) === true)) {
      reasons.push({ why: "no_calendar", say: words.no_calendar });
    }
  }

  const project = process.env.CLAUDE_PROJECT_DIR;
  if (said !== "" && typeof project === "string" && project !== "" && typeof defaults.bans_path === "string") {
    for (const word of bannedWords(join(project, defaults.bans_path))) {
      if (holdsWord(said, word)) reasons.push({ why: `banned_word\u0000${word.toLowerCase()}`, say: `${words.banned_word} ${word}`, each: true });
    }
  }

  // Once a session for the same thread, or once a session for every send that answers none;
  // a banned word once for each exact message, whether or not it answers a thread.
  const subject = thread !== undefined ? `thread\u0000${thread}` : "no thread";
  const message = `message\u0000${tool}\u0000${JSON.stringify(args)}`;
  const given = new Set(log.flatMap((line) => (Array.isArray(line.denied) ? line.denied : [])));
  const due = reasons
    .map((reason) => ({ ...reason, mark: markOf(reason.why, reason.each === true ? message : subject) }))
    .filter((reason) => !given.has(reason.mark));
  if (due.length === 0) return "";

  // Written before it is said: a stop that cannot be recorded is not made.
  appendLog(folder, { denied: due.map((reason) => reason.mark) });
  return deny(due.map((reason) => reason.say).join("\n"));
});
