#!/usr/bin/env node
/**
 * @purpose Keeps what a person is told they will SEE matching what actually fires on their tool.
 *
 * The manifest made one promise for everybody — the check-first reminder arrives "every message" —
 * and that is only true where the tool offers a per-message moment. Cursor's plugin fires it once,
 * at the start of a session. Copilot gets it as a standing instruction the tool reads before each
 * conversation. Claude's chat apps have no moment at all and the manifest already says so. A person
 * choosing a tool on the strength of "every message" and getting one nudge a session was told
 * something untrue by us, not by them.
 *
 * HOW IT DECIDES, WITHOUT TAKING ANYONE'S WORD. The cadence is not read from prose; it is derived
 * from the configuration each tool is actually shipped, by the event that configuration hooks. A
 * per-message event is a per-message promise; a session event is a per-session one. The map below
 * says which file each tool installs, and it is the same mapping the plugin manifests declare —
 * so a tool switched to a different file changes what this gate expects, rather than drifting from
 * it silently.
 *
 * WHAT IT CANNOT REACH. It reads the event a hook is bound to, not what the host does with it. A
 * host that fires its per-message event once, or silently drops what a hook returns, would still
 * read as per-message here — which is exactly how the Copilot case was found, by running one rather
 * than by reading a file. Where a tool's real behaviour is known to differ from its event, the
 * manifest says so in that tool's own limits, and this gate defers to the declared cadence.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, read, rel, runGate } from "./lib/gate.mjs";

const MANIFEST = join(REPO_ROOT, "tools.manifest.json");

/** The event a hook binds to, and what a person actually experiences because of it. */
const CADENCE_OF_EVENT = {
  UserPromptSubmit: "every message",
  PreInvocation: "every message",
  SessionStart: "once a session",
  sessionStart: "once a session",
  stop: "at the end of a reply",
};

/**
 * Which configuration each tool installs. Taken from the plugin manifests rather than guessed:
 * a `hooks` field names a file, and its absence means the folder's own hooks.json.
 */
const SHIPS = {
  "claude-code": { config: "plugins/dazzer/hooks.json", event: "UserPromptSubmit" },
  codex: { config: "plugins/dazzer/hooks.json", event: "UserPromptSubmit" },
  devin: { config: "plugins/dazzer/hooks.json", event: "UserPromptSubmit" },
  antigravity: { config: "plugins/dazzer-antigravity/hooks.json", event: "PreInvocation" },
  cursor: { config: "plugins/dazzer/hooks/cursor.json", event: "sessionStart" },
};

/**
 * The events a configuration binds. Three shapes are in use and all three are real: a `hooks`
 * object, a bare object of events, and — Antigravity's — the events nested under the plugin's own
 * name, because that host namespaces them. Reaching one level in when the top level holds no known
 * event is what keeps this gate reading the file rather than a guess about it.
 */
const hooksOf = (text) => {
  const parsed = JSON.parse(text);
  const top = parsed.hooks ?? parsed;
  const keys = Object.keys(top);
  if (keys.some((k) => k in CADENCE_OF_EVENT)) return top;
  for (const key of keys) {
    const nested = top[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      if (Object.keys(nested).some((k) => k in CADENCE_OF_EVENT)) return nested;
    }
  }
  return top;
};

runGate({
  id: "reminder-cadence",
  purpose: "What a person is told they will see is what their tool actually fires.",
  rule: "every tool says how often its check-first reminder arrives, and it matches the event that tool's shipped configuration hooks",
  assert(findings) {
    if (!existsSync(MANIFEST)) {
      findings.push({ file: "tools.manifest.json", message: "missing" });
      return;
    }
    const manifest = JSON.parse(read(MANIFEST));

    for (const tool of manifest.tools ?? []) {
      const id = tool.id;
      const supported = tool.reminders?.recall;
      if (supported !== "works") continue;

      const stated = tool.recallArrives;
      if (typeof stated !== "string" || stated.length === 0) {
        findings.push({
          file: "tools.manifest.json",
          message:
            `${id} says the check-first reminder works but never says how often a person sees it. ` +
            `Add recallArrives, taken from the event its configuration hooks.`,
        });
        continue;
      }

      const ships = SHIPS[id];
      if (!ships) continue;
      const configPath = join(REPO_ROOT, ships.config);
      if (!existsSync(configPath)) {
        findings.push({ file: ships.config, message: `${id} installs this and it is not here` });
        continue;
      }
      const events = Object.keys(hooksOf(read(configPath)));
      const binds = events.includes(ships.event);
      if (!binds) {
        findings.push({
          file: rel(configPath),
          message: `${id} is expected to hook ${ships.event}; this file hooks ${events.join(", ")}`,
        });
        continue;
      }
      const real = CADENCE_OF_EVENT[ships.event];
      if (real && stated !== real) {
        findings.push({
          file: "tools.manifest.json",
          message:
            `${id} promises "${stated}" and its configuration fires ${real}. ` +
            `A person picking this tool on that promise is told something untrue.`,
        });
      }
    }

    for (const reminder of manifest.reminders ?? []) {
      if (!/every message/i.test(String(reminder.when ?? ""))) continue;
      const cannot = (manifest.tools ?? [])
        .filter((t) => t.reminders?.recall === "works" && t.recallArrives && t.recallArrives !== "every message")
        .map((t) => t.id);
      if (reminder.id === "recall" && cannot.length > 0) {
        findings.push({
          file: "tools.manifest.json",
          message:
            `the ${reminder.id} reminder promises "every message" for everybody, and ${cannot.join(", ")} ` +
            `cannot keep it. Say the moment it applies, and let each tool say how often it arrives.`,
        });
      }
    }
  },
});
