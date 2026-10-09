/**
 * @purpose At the end of each turn, checks without a word that a correction caught in this turn,
 * or a save the reply claims, really reached the Brain; when it did not, leaves a note that the
 * next message carries to Dazzer. It prints nothing, ever: anything said at the end of a turn is
 * shown to the person as an error and costs them an extra reply.
 *
 * A turn starts at the person's last message in the session's log. The reply's own text is read
 * only to look for a claimed save, and only when Claude Code hands it over; without it, a catch
 * is still checked against the saves. A claim counts only when it names the Brain or memory as
 * where the save went; the claim phrases are in kit.defaults.json.
 */

import { clearNote, leaveNote, matchesAny, readLog, sessionFolder, text, trigger } from "./lib.mjs";

trigger(({ input, defaults }) => {
  const folder = sessionFolder(input);
  if (folder === null) return "";
  const log = readLog(folder);
  let start = -1;
  for (let at = log.length - 1; at >= 0; at -= 1) {
    if (typeof log[at].caught === "boolean") {
      start = at;
      break;
    }
  }
  const saved = log.slice(start + 1).some((line) => line.save === true);
  const caught = start >= 0 && log[start].caught === true;
  const reply = text(input, "last_assistant_message");
  const claimed = reply !== undefined && matchesAny(defaults.claimed_save_phrases, reply, "i");
  if (!saved && (caught || claimed)) leaveNote(folder);
  else clearNote(folder);
  return "";
});
