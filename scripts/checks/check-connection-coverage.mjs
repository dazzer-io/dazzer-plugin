#!/usr/bin/env node
/**
 * @purpose Every tool we support gets a way to reach the Brain, in its own wording. The
 * reminders and the connection are two separate installs, and a tool that ships one without
 * the other leaves an AI being told to check something it cannot open.
 *
 * THIS IS WHAT SHIPPED, AND WHAT IT COST. The connection was written down once, in Claude's
 * wording, marked as Claude's. Every other tool's setup ended after the reminders. The owner
 * followed the GPT instructions to the letter on a clean machine, was never asked to sign in
 * because there was nothing to sign in to, and watched his AI go hunting through an unrelated
 * archive for the memory it had just been told to check. The command it needed existed and
 * worked the whole time; nobody had written it down.
 *
 * Nothing caught it. Every gate here compares what we SAY against what we SHIP, and both said
 * the same thing: one connection, Claude's. A rule that only asks "do the two copies agree"
 * cannot see a step missing from both.
 *
 * SO THIS ASKS A DIFFERENT QUESTION - is anything MISSING - and that is why it is worth its
 * own file rather than another clause in the parity gates.
 *
 * A TOOL MAY HAVE NO WAY IN, and that is allowed, but only out loud: set its entry to null
 * with the reason. Silence is the failure this exists to refuse.
 */

import { join } from "node:path";
import { REPO_ROOT, readJson, rel, runGate } from "./lib/gate.mjs";

const MANIFEST = join(REPO_ROOT, "tools.manifest.json");

/** A step has to actually tell somebody to do something. */
function isUsable(step) {
  if (step === null || typeof step !== "object") return false;
  if (step.kind === "run") return typeof step.command === "string" && step.command.length > 0;
  if (step.kind === "choose") return typeof step.label === "string" && step.label.length > 0;
  return false;
}

runGate({
  id: "connection-coverage",
  purpose: "No supported tool is left with reminders and no way to reach the Brain.",
  rule: "every supported tool has its own connection step, or says plainly that it has none",
  assert(findings) {
    const manifest = readJson(MANIFEST, findings);
    if (manifest === undefined) return 0;

    const tools = Array.isArray(manifest.tools) ? manifest.tools : [];
    const supported = tools.filter((t) => t?.status === "supported");
    if (supported.length === 0) {
      findings.push({
        file: rel(MANIFEST),
        message: "no supported tools at all; either they are gone or this gate has stopped seeing them",
      });
      return 0;
    }

    const byTool = manifest.installConnection?.byTool;
    if (byTool === null || typeof byTool !== "object") {
      findings.push({
        file: rel(MANIFEST),
        message:
          "installConnection has no per-tool entries. One connection written in one tool's " +
          "wording is what left every other tool's setup ending with no way to reach the Brain.",
      });
      return supported.length;
    }

    for (const tool of supported) {
      const step = byTool[tool.id];

      if (step === undefined) {
        findings.push({
          file: rel(MANIFEST),
          message:
            `"${tool.id}" is supported and has no connection entry. Its setup ends with the ` +
            "reminders installed and the Brain unreachable, which is an AI told to check " +
            "something it cannot open. Give it its line, or set it to null with the reason.",
        });
        continue;
      }

      // Declared as having no way in. Allowed, but the reason is the whole point: it is what
      // stops the next person quietly assuming it was an oversight and inventing a command.
      if (step === null) continue;
      if (typeof step === "object" && step.none === true) {
        if (typeof step.because !== "string" || step.because.length === 0) {
          findings.push({
            file: rel(MANIFEST),
            message: `"${tool.id}" declares no way to reach the Brain but gives no reason for it.`,
          });
        }
        continue;
      }

      if (!isUsable(step)) {
        findings.push({
          file: rel(MANIFEST),
          message: `"${tool.id}" has a connection entry with nothing in it a person could follow.`,
        });
        continue;
      }

      // A connection line that reads exactly like the reminders line is the mistake this
      // repairs, arriving from the other direction: one tool's wording copied onto another.
      const reminders = tool.installReminders?.steps ?? [];
      const sameAsReminder = reminders.some(
        (r) => r?.kind === "run" && r.command === step.command,
      );
      if (sameAsReminder) {
        findings.push({
          file: rel(MANIFEST),
          message:
            `"${tool.id}" has the same line for the connection as for the reminders. One of ` +
            "the two is wrong, and following them installs the same thing twice.",
        });
      }
    }

    return supported.length;
  },
});
