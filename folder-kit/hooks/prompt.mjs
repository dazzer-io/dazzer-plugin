/**
 * @purpose On each message, adds one fixed line when the message may correct, complain about or
 * steer Dazzer's work, so Dazzer deals with it in the same reply; and carries, once, the note the
 * end of the last turn left when a correction or a claimed save may have gone unsaved.
 *
 * The person's words are read only to decide whether to add that line. They are never repeated,
 * never stored, and never shape what is printed: the log keeps only when and whether, so the most
 * a hostile message can do is make the fixed line appear. The phrases that catch, in English and
 * Hebrew, are broad on purpose and live in kit.defaults.json; a false alarm costs one line, and
 * the note it may lead to is conditional. The line goes out first and the log is written after
 * it, so a log that cannot be written never costs the line.
 */

import { appendLog, guarded, matchesAny, say, sessionFolder, takeNote, text, trigger } from "./lib.mjs";

trigger(({ input, defaults, words }) => {
  const message = text(input, "prompt");
  if (message === undefined) return "";
  const caught = matchesAny(defaults.catch_phrases, message, "iu");
  const folder = guarded(() => sessionFolder(input, true), null);
  const noted = folder !== null && guarded(() => takeNote(folder), false);
  const lines = [...(caught ? [words.catch] : []), ...(noted ? [words.note] : [])];
  return {
    out: lines.length > 0 ? say("UserPromptSubmit", lines.join("\n")) : "",
    after: folder === null ? [] : [() => appendLog(folder, { caught })],
  };
});
