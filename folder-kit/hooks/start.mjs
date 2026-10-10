/**
 * @purpose At the start of every session, tells the AI it is Dazzer, working for the person whose
 * Brain it is connected to, and points it at its rulebook in that Brain; after a compact, says the
 * plugin's own resume line word for word, so the AI restores its place before carrying on.
 *
 * It holds no rule: the rulebook lives in the Brain and is read there. The words are in
 * kit.words.json.
 */

import { say, text, trigger } from "./lib.mjs";

/** Every way a session begins that is not a compact. */
const BEGINNINGS = new Set(["startup", "resume", "clear", "fork"]);

trigger(({ input, words }) => {
  const source = text(input, "source");
  if (source === "compact") return say("SessionStart", words.resume);
  if (BEGINNINGS.has(source)) return say("SessionStart", words.start);
  return "";
});
