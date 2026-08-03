#!/usr/bin/env node
/**
 * @purpose Keeps every borrowed automation step pinned to one exact published commit.
 * A moving tag means somebody else can change what runs in our checks without us
 * knowing, and these checks are what everything else in this repository trusts.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, read, rel, runGate, walk } from "./lib/gate.mjs";

const WORKFLOWS = join(REPO_ROOT, ".github", "workflows");
const PINNED = /^\s*-?\s*uses:\s*\S+@([0-9a-f]{40})\s*(#.*)?$/;

runGate({
  id: "workflow-sha-pin",
  purpose: "Borrowed automation steps cannot change under us.",
  rule: "every borrowed step is pinned to a full commit id and carries a comment naming its release",
  assert(findings) {
    if (!existsSync(WORKFLOWS)) return; // nothing to guard yet

    for (const file of walk(WORKFLOWS)) {
      if (!/\.ya?ml$/.test(file)) continue;

      read(file)
        .split("\n")
        .forEach((text, i) => {
          if (!/^\s*-?\s*uses:/.test(text)) return;
          const match = text.match(PINNED);
          if (!match) {
            findings.push({
              file: rel(file),
              line: i + 1,
              message: `${text.trim()} is not pinned to an exact commit; a moving tag lets someone else change what runs here`,
            });
            return;
          }
          if (!match[2]) {
            findings.push({
              file: rel(file),
              line: i + 1,
              message: "pinned, but with no comment saying which release it is - nobody can tell when it is safe to bump",
            });
          }
        });
    }
  },
});
