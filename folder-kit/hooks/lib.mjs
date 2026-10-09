/**
 * @purpose The shared part of the folder kit's five triggers: it reads what Claude Code hands a
 * trigger, finds the session's own folder in the machine's temporary folder, keeps the session's
 * short log there, and makes sure no trigger can fail loudly on the person's machine.
 *
 * It holds no rule and no sentence. What the triggers say lives in kit.words.json, every value a
 * person might tune lives in kit.defaults.json, and both sit beside this file: in the repository's
 * folder-kit/hooks/ and in a person's folder's .claude/hooks/ alike.
 *
 * Quiet is the default, by construction. A trigger prints only what its handler returned, and
 * any error anywhere (a missing file, input that is not JSON, a pattern that does not compile, a
 * folder that cannot be written or is not the user's own) ends it with exit 0 and nothing printed.
 * What a handler asks to be written after printing runs after the line is out, each write in its
 * own guard, so a log that cannot be written never swallows a line.
 */

import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The start of the folder, under the machine's temporary folder, that holds one user's sessions. */
const NOTES = "dazzer-kit";
/** The session's log: one line per message, per tool and per stopped send, each holding no content. */
const LOG = "log.jsonl";
/** The note the end of a turn leaves for the next message. */
const NOTE = "note";
/** Owner-only, for the folders and the files in them: a shared machine's temporary folder is never shared. */
const PRIVATE_FOLDER = 0o700;
const PRIVATE_FILE = 0o600;
/** The permission bits that would let anyone but the owner in. */
const OTHERS = 0o077;
/**
 * The only session ids that get a folder: letters, digits, dashes and underscores. The id
 * becomes part of a path, so anything that could climb out of the kit's own folder is refused.
 */
const SESSION_SHAPE = /^[A-Za-z0-9_-]{1,128}$/;

const kitFile = (name) => JSON.parse(readFileSync(join(HERE, name), "utf8"));

/** Reads all of stdin, but keeps none of it once it passes the cap, so an oversized input reads as no input. */
async function readStdin(cap) {
  if (!Number.isInteger(cap) || cap <= 0) return null;
  const parts = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    total += chunk.length;
    if (total <= cap) parts.push(chunk);
  }
  return total > cap ? null : Buffer.concat(parts).toString("utf8");
}

/** The input as an object, or null when it is empty, over the cap, or not an object. */
async function readInput(cap) {
  const raw = await readStdin(cap);
  if (raw === null || raw.trim() === "") return null;
  const parsed = JSON.parse(raw);
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
}

/** A named field of the input, only when it is a string. */
export const text = (input, field) => (typeof input?.[field] === "string" ? input[field] : undefined);

/** A named field of the input, only when it is a plain object. */
export function object(input, field) {
  const value = input?.[field];
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

/** A pattern from the defaults, or null when it is missing or does not compile, so it matches nothing. */
export function pattern(source, flags = "") {
  if (typeof source !== "string") return null;
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

/** Whatever the attempt throws reads as the fallback, so one failed step never stops the next. */
export function guarded(attempt, fallback) {
  try {
    return attempt();
  } catch {
    return fallback;
  }
}

/** Whether any of a list of patterns from the defaults matches. */
export const matchesAny = (sources, value, flags = "") =>
  Array.isArray(sources) && sources.some((source) => pattern(source, flags)?.test(value) === true);

/** Who this is on this machine: the numeric user where there is one, else a cleaned user name. */
function whoAmI() {
  if (typeof process.getuid === "function") return { uid: process.getuid(), name: String(process.getuid()) };
  const name = userInfo().username.replace(/[^A-Za-z0-9_-]/g, "_");
  return name === "" ? null : { uid: undefined, name };
}

/** Whether a folder is really a folder, belongs to this user, and lets nobody else in. */
function isOwnPrivateFolder(path, who) {
  const s = lstatSync(path);
  if (!s.isDirectory() || s.isSymbolicLink()) return false;
  if (who.uid === undefined) return true; // no numeric owner or permission bits to check here
  return s.uid === who.uid && (s.mode & OTHERS) === 0;
}

/**
 * The session's own folder, inside this user's own folder in the machine's temporary folder, or
 * null when the input names no session shaped like one, or the user's folder is missing (and not
 * to be made), is not a folder, is someone else's, or lets anyone else in. With `make`, the
 * user's folder is created owner-only when it is not there yet; the session's folder is created
 * only when something is written to it.
 */
export function sessionFolder(input, make = false) {
  const id = text(input, "session_id");
  if (id === undefined || !SESSION_SHAPE.test(id)) return null;
  const who = whoAmI();
  if (who === null) return null;
  const root = join(tmpdir(), `${NOTES}-${who.name}`);
  if (!existsSync(root)) {
    if (!make) return null;
    mkdirSync(root, { mode: PRIVATE_FOLDER });
  }
  return isOwnPrivateFolder(root, who) ? join(root, id) : null;
}

/** Makes the session's folder, owner-only, if it is not there yet. */
const own = (folder) => mkdirSync(folder, { recursive: true, mode: PRIVATE_FOLDER });

/** Adds one line to the session's log, stamped with when. */
export function appendLog(folder, entry) {
  own(folder);
  appendFileSync(join(folder, LOG), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, { mode: PRIVATE_FILE });
}

/** The session's log, oldest first; a line that does not read is skipped. */
export function readLog(folder) {
  let raw;
  try {
    raw = readFileSync(join(folder, LOG), "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const entry = JSON.parse(line);
      if (entry !== null && typeof entry === "object" && !Array.isArray(entry)) out.push(entry);
    } catch {
      // A torn line is skipped; the rest of the log still counts.
    }
  }
  return out;
}

/** Whether the log holds a message line, which shows the log is being written at all. */
export const logWorks = (log) => log.some((line) => typeof line.caught === "boolean");

/** Leaves the note for the next message. It holds only when it was left; the words are the kit's own. */
export function leaveNote(folder) {
  own(folder);
  writeFileSync(join(folder, NOTE), `${JSON.stringify({ at: new Date().toISOString() })}\n`, { mode: PRIVATE_FILE });
}

/** Removes the note, if there is one. */
export const clearNote = (folder) => rmSync(join(folder, NOTE), { force: true });

/** Takes the note: true when there was one, which is then gone, so it is carried once. */
export function takeNote(folder) {
  const path = join(folder, NOTE);
  if (!existsSync(path)) return false;
  rmSync(path, { force: true });
  return true;
}

/** A line added to what Dazzer sees at this moment. */
export const say = (event, line) => JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: line } });

/** A send stopped, with the reason Dazzer is shown. The shape reference-copy-guard.sh uses. */
export const deny = (reason) =>
  JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } });

/**
 * Runs one trigger. The handler gets the input, the defaults and the words, and returns what to
 * print, or `{ out, after }` where `after` lists writes to make once the line is out. Whatever goes
 * wrong before printing, the trigger exits 0 having printed nothing at all; whatever goes wrong in
 * one write after printing loses that write alone.
 */
export async function trigger(handler) {
  process.exitCode = 0;
  process.stdout.on("error", () => {});
  let after = [];
  try {
    const defaults = kitFile("kit.defaults.json");
    const words = kitFile("kit.words.json");
    const input = await readInput(defaults.input_max_bytes);
    if (input === null) return;
    const result = handler({ input, defaults, words });
    const out = typeof result === "string" ? result : result?.out;
    if (Array.isArray(result?.after)) after = result.after;
    if (typeof out === "string" && out.length > 0) process.stdout.write(out);
  } catch {
    // Fails open: the person's session carries on exactly as if no trigger had run.
    return;
  }
  for (const write of after) {
    try {
      write();
    } catch {
      // This one write is lost; the line already went out, and the next write still runs.
    }
  }
}
