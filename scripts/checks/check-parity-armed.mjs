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

/** Each case names the real mistake it stands for, so a failure here reads as a warning. */
const CASES = [
  {
    gate: "reminder-parity",
    what: "a reminder reworded where nothing declares the new wording",
    seed(root) {
      const p = join(root, "plugins", "dazzer", "hooks", "hooks.json");
      const hooks = readJson(p);
      const triggers = hooks.hooks ?? hooks;
      triggers.UserPromptSubmit[0].hooks[0].command = 'echo "[Dazzer] Reworded and told nobody."';
      writeJson(p, hooks);
    },
  },
  {
    gate: "reminder-parity",
    what: "words a reader is told to expect that nothing actually says - the one that rejects correct installs",
    seed(root) {
      const p = join(root, "tools.manifest.json");
      const manifest = readJson(p);
      manifest.spokenSentences.push({ id: "invented", text: "[Dazzer] Nothing says this." });
      writeJson(p, manifest);
    },
  },
  {
    gate: "address-parity",
    what: "the instructions moved to another address we own while the shipped one stayed put",
    seed(root) {
      const p = join(root, "tools.manifest.json");
      const manifest = readJson(p);
      manifest.connection.url = "https://brain.dazzer.io/mcp";
      writeJson(p, manifest);
    },
  },
  {
    gate: "address-parity",
    what: "the connection renamed on one side, so anyone told to look for it does not find it",
    seed(root) {
      const p = join(root, "tools.manifest.json");
      const manifest = readJson(p);
      manifest.connection.serverName = "dazzer-brain";
      writeJson(p, manifest);
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
      const p = join(root, "tools.manifest.json");
      const manifest = readJson(p);
      manifest.tools[0].installReminders.steps.push({ kind: "run", where: "claude", command: "/plugin install invented@dazzer" });
      writeJson(p, manifest);
    },
  },
  {
    gate: "install-parity",
    what: "a tool offered as supported with no way to install the reminders",
    seed(root) {
      const p = join(root, "tools.manifest.json");
      const manifest = readJson(p);
      manifest.tools.push({ id: "invented", name: "Invented", status: "supported", installReminders: { steps: [] } });
      writeJson(p, manifest);
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
