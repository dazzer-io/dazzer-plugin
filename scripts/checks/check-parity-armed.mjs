#!/usr/bin/env node
/**
 * @purpose Proves the three parity gates can still see a fault. Each of them passes by
 * finding nothing, which is exactly how one goes quietly blank - a changed filename, a
 * heading that stopped matching, a parse that now returns an empty list - and reports
 * success forever after. A gate nobody has watched fail is a gate nobody should trust.
 *
 * The same idea as harness-contract, aimed at the checks rather than at the shell suite:
 * seed each fault deliberately, and refuse unless the gate refuses.
 *
 * Adding a case here is how a new parity rule earns its place. If a rule cannot be broken
 * on purpose, it is not being enforced.
 */

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT, runGate } from "./lib/gate.mjs";

const CHECKS = join(REPO_ROOT, "scripts", "checks");

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const writeJson = (p, v) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);

/** A throwaway copy of the parts of the repo the parity gates read. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "dazzer-parity-"));
  mkdirSync(join(root, "plugins", "dazzer-connect"), { recursive: true });
  mkdirSync(join(root, "plugins", "dazzer", "hooks"), { recursive: true });

  cpSync(join(REPO_ROOT, "README.md"), join(root, "README.md"));
  cpSync(join(REPO_ROOT, "tools.manifest.json"), join(root, "tools.manifest.json"));
  cpSync(
    join(REPO_ROOT, "plugins", "dazzer-connect", ".mcp.json"),
    join(root, "plugins", "dazzer-connect", ".mcp.json"),
  );
  cpSync(
    join(REPO_ROOT, "plugins", "dazzer", "hooks", "hooks.json"),
    join(root, "plugins", "dazzer", "hooks", "hooks.json"),
  );
  // The other hooks file - the plain-words one, read by a different host than the file
  // just above it. Leaving it out of the copy is how a fault seeded in it would look
  // caught while the gate was never shown the file it lives in.
  cpSync(
    join(REPO_ROOT, "plugins", "dazzer", "hooks.json"),
    join(root, "plugins", "dazzer", "hooks.json"),
  );
  return root;
}

/** Runs one gate against a tree. True = the gate refused. */
function refuses(gate, root) {
  try {
    execFileSync(process.execPath, [join(CHECKS, `check-${gate}.mjs`)], {
      env: { ...process.env, DAZZER_REPO_ROOT: root },
      stdio: "pipe",
    });
    return false;
  } catch {
    return true;
  }
}

/** Where the gates read from, so a file the fixture forgets cannot make a fault look caught. */
const WRAPPED_HOOKS = ["plugins", "dazzer", "hooks", "hooks.json"];
const BARE_HOOKS = ["plugins", "dazzer", "hooks.json"];
const MANIFEST = ["tools.manifest.json"];

/** Read, change, write back. Every seed is one of these, so only the fault itself shows. */
function edit(root, where, change) {
  const p = join(root, ...where);
  const doc = readJson(p);
  change(doc);
  writeJson(p, doc);
}

/**
 * Quoting words for a shell, and reading them back out. These have to handle the very
 * escape the gate tells an author to write - a lone ' becomes '\'' - because otherwise the
 * moment anyone follows that advice these helpers throw, three seeded faults stop testing
 * the rules they name, and the run blames the wording instead of this file.
 */
const quoted = (text) => `'${text.replaceAll("'", "'\\''")}'`;
const unquoted = (text) => text.replaceAll("'\\''", "'");
const unwrap = (command) =>
  JSON.parse(unquoted(command.slice(command.indexOf("'") + 1, command.lastIndexOf("'"))));
const rewrap = (doc) => `printf %s ${quoted(JSON.stringify(doc))}`;

/** Say the same thing a different way - correct, and deliberately not the shape we ship. */
const echoSingleQuoted = (sentence) => `echo ${quoted(sentence)}`;

/** Each case names the real mistake it stands for, so a failure here reads as a warning. */
const CASES = [
  {
    gate: "reminder-parity",
    what: "a reminder reworded where nothing declares the new wording",
    seed(root) {
      // Reworded INSIDE the wrapper, and in both files at once, so that no shape rule
      // refuses first. Seeded as bare words instead, this stopped proving its own rule and
      // quietly became a duplicate of the plain-words case below.
      const reworded = "[Dazzer] Reworded and told nobody.";
      edit(root, WRAPPED_HOOKS, (hooks) => {
        const hook = hooks.hooks.UserPromptSubmit[0].hooks[0];
        const doc = unwrap(hook.command);
        doc.hookSpecificOutput.additionalContext = reworded;
        hook.command = rewrap(doc);
      });
      edit(root, BARE_HOOKS, (hooks) => {
        hooks.UserPromptSubmit[0].hooks[0].command = `echo "${reworded}"`;
      });
    },
  },
  {
    gate: "reminder-parity",
    what: "words a reader is told to expect that nothing actually says - the one that rejects correct installs",
    seed(root) {
      edit(root, MANIFEST, (manifest) => {
        manifest.spokenSentences.push({ id: "invented", text: "[Dazzer] Nothing says this." });
      });
    },
  },
  {
    gate: "reminder-parity",
    what: "a reminder handed to a host that reads replies as data, but written as plain words - which that host discards while showing the person an error on every message",
    seed(root) {
      edit(root, WRAPPED_HOOKS, (hooks) => {
        const hook = hooks.hooks.UserPromptSubmit[0].hooks[0];
        hook.command = `echo "${unwrap(hook.command).hookSpecificOutput.additionalContext}"`;
      });
    },
  },
  {
    gate: "reminder-parity",
    what: "the same mistake spelled another way, which a gate that recognised only the spellings we happened to write let straight through",
    seed(root) {
      edit(root, WRAPPED_HOOKS, (hooks) => {
        const hook = hooks.hooks.UserPromptSubmit[0].hooks[0];
        hook.command = echoSingleQuoted(unwrap(hook.command).hookSpecificOutput.additionalContext);
      });
    },
  },
  {
    gate: "reminder-parity",
    what: "the right words wrapped under the wrong event name, which that host refuses just as flatly",
    seed(root) {
      edit(root, WRAPPED_HOOKS, (hooks) => {
        const hook = hooks.hooks.UserPromptSubmit[0].hooks[0];
        const doc = unwrap(hook.command);
        doc.hookSpecificOutput.hookEventName = "SessionStart";
        hook.command = rewrap(doc);
      });
    },
  },
  {
    gate: "reminder-parity",
    what: "an apostrophe in ordinary English wording, which ends the quoting early so the reminder never speaks at all",
    seed(root) {
      // The wording stays perfectly sensible - that is the trap. Only a shell can tell.
      // Applied to the resume words, which just two places say, and changed in the other
      // place too: then nothing is missing and nothing is undeclared, so the shell is the
      // only thing left that can object.
      const withApostrophe = "[Dazzer] Restore what you were doing before the session's reset.";
      edit(root, WRAPPED_HOOKS, (hooks) => {
        const hook = hooks.hooks.SessionStart[0].hooks[0];
        const doc = unwrap(hook.command);
        doc.hookSpecificOutput.additionalContext = withApostrophe;
        // Written out by hand, the way a person rewording this file would - straight into
        // the quotes, with nothing escaped. `rewrap` deliberately is NOT used here: it
        // escapes correctly, which would make this case seed no fault at all.
        hook.command = `printf %s '${JSON.stringify(doc)}'`;
      });
      edit(root, BARE_HOOKS, (hooks) => {
        hooks.SessionStart[0].hooks[0].command = `echo "${withApostrophe}"`;
      });
      edit(root, MANIFEST, (manifest) => {
        manifest.spokenSentences[1].text = withApostrophe;
      });
    },
  },
  {
    gate: "reminder-parity",
    what: "the same words spelled differently in the two files, so which one a person gets depends on which tool they installed",
    seed(root) {
      // Both wordings declared, so only the disagreement itself is left to catch.
      const theirs = "[Dazzer] Restored session - carry on where you left off.";
      edit(root, WRAPPED_HOOKS, (hooks) => {
        const hook = hooks.hooks.SessionStart[0].hooks[0];
        const doc = unwrap(hook.command);
        doc.hookSpecificOutput.additionalContext = theirs;
        hook.command = rewrap(doc);
      });
      edit(root, MANIFEST, (manifest) => {
        manifest.spokenSentences.push({ id: "theirs", text: theirs });
      });
    },
  },
  {
    gate: "reminder-parity",
    what: "a reminder that runs something instead of saying something, so the host it answers hears nothing at all",
    seed(root) {
      edit(root, WRAPPED_HOOKS, (hooks) => {
        hooks.hooks.SessionStart[0].hooks[0].command = 'sh "${CLAUDE_PLUGIN_ROOT}/scripts/capture-sweep.sh"';
      });
    },
  },
  {
    gate: "reminder-parity",
    what: "one extra key beside the hooks, which makes a strict host discard every reminder in the file",
    seed(root) {
      edit(root, WRAPPED_HOOKS, (hooks) => {
        hooks.version = 1;
      });
    },
  },
  {
    gate: "reminder-parity",
    what: "the same extra key in the other file, which the host reading THAT one discards just as completely - only silently",
    seed(root) {
      edit(root, BARE_HOOKS, (hooks) => {
        hooks.version = 1;
      });
    },
  },
  {
    gate: "reminder-parity",
    what: "one tool handed the other declared sentence, which every rule that only pools them accepts",
    seed(root) {
      edit(root, WRAPPED_HOOKS, (hooks) => {
        const group = hooks.hooks.sessionStart[0];
        const doc = unwrap(group.command);
        // Both sentences stay declared and both are still said somewhere, so nothing that
        // pools them objects. Only knowing WHICH words belong here catches it.
        doc.additional_context = unwrap(hooks.hooks.SessionStart[0].hooks[0].command)
          .hookSpecificOutput.additionalContext;
        group.command = rewrap(doc);
      });
    },
  },
  {
    gate: "reminder-parity",
    what: "a reworded reminder in the shape one host writes them, which this gate had never once read",
    seed(root) {
      // That host writes the hook straight into the group instead of nesting a list inside
      // it. Read only the nested shape and this entry is invisible, so its wording could
      // drift away from everyone else's with nothing to notice.
      edit(root, WRAPPED_HOOKS, (hooks) => {
        hooks.hooks.sessionStart[0].command = 'echo "[Dazzer] Reworded where nothing was looking."';
      });
    },
  },
  {
    gate: "reminder-parity",
    what: "a reminder that prints nothing at all, which arrives as silence",
    seed(root) {
      edit(root, WRAPPED_HOOKS, (hooks) => {
        hooks.hooks.UserPromptSubmit[0].hooks[0].command = "printf %s ''";
      });
    },
  },
  {
    gate: "reminder-parity",
    what: "correctly shaped words that are not ours, so nothing downstream can tell the reminders arrived",
    seed(root) {
      edit(root, WRAPPED_HOOKS, (hooks) => {
        const hook = hooks.hooks.UserPromptSubmit[0].hooks[0];
        const doc = unwrap(hook.command);
        doc.hookSpecificOutput.additionalContext = "Something else entirely.";
        hook.command = rewrap(doc);
      });
    },
  },
  {
    gate: "reminder-parity",
    what: "a second command riding along behind the words, which turns a reminder into an instruction",
    seed(root) {
      // Seeded on a trigger whose words are said elsewhere too, so no wording rule can
      // notice - what is wrong here is the command, not the sentence.
      edit(root, WRAPPED_HOOKS, (hooks) => {
        const hook = hooks.hooks.sessionStart[0];
        hook.command = `${hook.command}; touch /tmp/dazzer-should-never-happen`;
      });
    },
  },
  {
    gate: "reminder-parity",
    what: "Cursor's reminder written as plain words, which Cursor throws away without telling anyone",
    seed(root) {
      edit(root, WRAPPED_HOOKS, (hooks) => {
        const group = hooks.hooks.sessionStart[0];
        group.command = `echo "${unwrap(group.command).additional_context}"`;
      });
    },
  },
  {
    gate: "reminder-parity",
    what: "Antigravity's reminder written as plain words, which reaches it just as little",
    seed(root) {
      edit(root, WRAPPED_HOOKS, (hooks) => {
        const hook = hooks.hooks.PreInvocation[0].hooks[0];
        hook.command = `echo "${unwrap(hook.command).injectSteps[0].ephemeralMessage}"`;
      });
    },
  },
  {
    gate: "reminder-parity",
    what: "a whole tool losing its reminder, which every wording rule is blind to",
    seed(root) {
      edit(root, WRAPPED_HOOKS, (hooks) => {
        delete hooks.hooks.userPromptSubmitted;
      });
    },
  },
  {
    gate: "reminder-parity",
    what: "the one wrapper line removed, which would switch every shape rule off at once",
    seed(root) {
      edit(root, WRAPPED_HOOKS, (hooks) => {
        const triggers = hooks.hooks;
        delete hooks.hooks;
        for (const [name, groups] of Object.entries(triggers)) hooks[name] = groups;
        // ...and with the shapes no longer demanded, plain words again.
        const hook = hooks.UserPromptSubmit[0].hooks[0];
        hook.command = `echo "${unwrap(hook.command).hookSpecificOutput.additionalContext}"`;
      });
    },
  },
  {
    gate: "reminder-parity",
    what: "the marker written unquoted, where a shell matches it against filenames and replaces it",
    seed(root) {
      edit(root, BARE_HOOKS, (hooks) => {
        const hook = hooks.UserPromptSubmit[0].hooks[0];
        hook.command = `echo ${/^echo "([\s\S]*)"$/.exec(hook.command)[1]}`;
      });
    },
  },
  {
    gate: "reminder-parity",
    what: "the plain-words file losing a reminder, which leaves one tool silent while the others still say the words",
    seed(root) {
      edit(root, BARE_HOOKS, (hooks) => {
        delete hooks.SessionStart;
      });
    },
  },
  {
    gate: "reminder-parity",
    what: "a reminder split across two lines, where a shell deletes the join and runs the halves together",
    seed(root) {
      // Seeded in the plain-words file: there the sentence sits in double quotes, where a
      // trailing backslash continues the line. Inside single quotes it would be literal and
      // this would test nothing.
      edit(root, BARE_HOOKS, (hooks) => {
        const hook = hooks.UserPromptSubmit[0].hooks[0];
        hook.command = hook.command.replace(" already know", " already\\\nknow");
      });
    },
  },
  {
    gate: "reminder-parity",
    what: "an unquoted payload, which some shells tear in half before the command ever sees it",
    seed(root) {
      edit(root, WRAPPED_HOOKS, (hooks) => {
        const hook = hooks.hooks.UserPromptSubmit[0].hooks[0];
        hook.command = `printf %s ${JSON.stringify(unwrap(hook.command))}`;
      });
    },
  },
  {
    gate: "reminder-parity",
    what: "a backslash handed to echo, which shells disagree about",
    seed(root) {
      edit(root, BARE_HOOKS, (hooks) => {
        const hook = hooks.UserPromptSubmit[0].hooks[0];
        hook.command = hook.command.replace("recall it", "recall\\tit");
      });
    },
  },
  {
    gate: "address-parity",
    what: "the instructions moved to another address we own while the shipped one stayed put",
    seed(root) {
      edit(root, MANIFEST, (manifest) => {
        manifest.connection.url = "https://brain.dazzer.io/mcp";
      });
    },
  },
  {
    gate: "address-parity",
    what: "the connection renamed on one side, so anyone told to look for it does not find it",
    seed(root) {
      edit(root, MANIFEST, (manifest) => {
        manifest.connection.serverName = "dazzer-brain";
      });
    },
  },
  {
    gate: "install-parity",
    what: "a command corrected for a human and not for the screen",
    seed(root) {
      const p = join(root, "README.md");
      writeFileSync(p, readFileSync(p, "utf8").replace("/plugin install dazzer@dazzer", "/plugin add dazzer@dazzer"));
    },
  },
  {
    gate: "install-parity",
    what: "a step the screen would hand somebody that no human instruction mentions",
    seed(root) {
      edit(root, MANIFEST, (manifest) => {
        manifest.tools[0].installReminders.steps.push({ kind: "run", where: "claude", command: "/plugin install invented@dazzer" });
      });
    },
  },
  {
    gate: "install-parity",
    what: "a tool offered as supported with no way to install the reminders",
    seed(root) {
      edit(root, MANIFEST, (manifest) => {
        manifest.tools.push({ id: "invented", name: "Invented", status: "supported", installReminders: { steps: [] } });
      });
    },
  },
];

runGate({
  id: "parity-armed",
  purpose: "Every parity gate still refuses a fault seeded on purpose.",
  rule: "each seeded fault is refused by its gate, and an untouched tree is not",
  assert(findings) {
    // A gate that refuses everything is as useless as one that refuses nothing - so an
    // untouched tree must pass. "Untouched" here means a copy of this repository as it
    // stands, which is only a fair test while the repository itself is passing. When a
    // gate is legitimately refusing real files, there is no clean tree to copy and the
    // question is unanswerable: asserting it anyway turns one honest failure into two,
    // and the second one accuses a gate that is working exactly as intended.
    const clean = fixture();
    try {
      for (const gate of new Set(CASES.map((c) => c.gate))) {
        if (!refuses(gate, REPO_ROOT)) {
          if (refuses(gate, clean)) {
            findings.push({ file: `scripts/checks/check-${gate}.mjs`, message: "refuses a copy of a tree it accepts in place, so something about the copy misleads it" });
          }
        }
      }
    } finally {
      rmSync(clean, { recursive: true, force: true });
    }

    for (const c of CASES) {
      const root = fixture();
      try {
        c.seed(root);
        if (!refuses(c.gate, root)) {
          findings.push({
            file: `scripts/checks/check-${c.gate}.mjs`,
            message: `let through ${c.what}. Either the rule stopped being enforced, or the gate stopped reading what it thinks it reads.`,
          });
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  },
});
