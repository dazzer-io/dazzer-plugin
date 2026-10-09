/**
 * @purpose On each message, adds one fixed line when the message may correct, complain about or
 * steer Dazzer's work, so Dazzer deals with it in the same reply; and carries, once, the note the
 * end of the last turn left when a correction went unsaved.
 *
 * The person's words are read only to decide whether to add that line. They are never repeated,
 * never stored, and never shape what is printed: the log keeps only when and whether, so the most
 * a hostile message can do is make the fixed line appear. The phrases that catch are broad on
 * purpose and live in kit.defaults.json; a false alarm costs one line.
 */

import { appendLog, matchesAny, say, sessionFolder, takeNote, text, trigger } from "./lib.mjs";

trigger(({ input, defaults, words }) => {
  const message = text(input, "prompt");
  if (message === undefined) return "";
  const caught = matchesAny(defaults.catch_phrases, message, "i");
  const folder = sessionFolder(input);
  let noted = false;
  if (folder !== null) {
    noted = takeNote(folder);
    appendLog(folder, { caught });
  }
  const lines = [...(caught ? [words.catch] : []), ...(noted ? [words.note] : [])];
  return lines.length > 0 ? say("UserPromptSubmit", lines.join("\n")) : "";
});
