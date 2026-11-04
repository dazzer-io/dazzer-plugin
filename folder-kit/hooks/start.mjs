/**
 * @purpose At the start of every session, tells the AI it is Dazzer, working for the person whose
 * Brain it is connected to, and points it at its rulebook in that Brain; after a compact, says the
 * plugin's own resume line word for word, so the AI restores its place before carrying on. Both
 * times it adds the plugin's own line naming the session's own saved place, so a restore brings
 * back this session's work rather than a list of every saved place or another session's.
 *
 * It holds no rule: the rulebook lives in the Brain and is read there. The words are in
 * kit.words.json.
 */

import { say, text, trigger } from "./lib.mjs";

/** Every way a session begins that is not a compact. */
const BEGINNINGS = new Set(["startup", "resume", "clear", "fork"]);

/**
 * The session's own place: the id Claude Code gives the session, which stays the same through a
 * compact, flattened exactly as the plugin flattens it so both name the same thread. Nothing that
 * could close the quoting survives, and the "@" the Brain reserves cannot open it. Undefined when
 * the input names no session, and then the line is left out.
 */
function threadOf(input) {
  const id = text(input, "session_id");
  const thread = id?.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64);
  return thread === "" ? undefined : thread;
}

trigger(({ input, words }) => {
  const source = text(input, "source");
  const line = source === "compact" ? words.resume : BEGINNINGS.has(source) ? words.start : undefined;
  if (line === undefined) return "";
  const thread = threadOf(input);
  return say("SessionStart", thread === undefined ? line : `${line}\n${words.place.replace("{thread}", thread)}`);
});
