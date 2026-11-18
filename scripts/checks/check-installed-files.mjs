#!/usr/bin/env node
/**
 * @purpose Keeps tests and their sample data out of the folders people install. Every file under
 * plugins/ is copied onto the machine of everyone who installs that plugin, so a test there ships
 * its fixtures to every user, and a fixture holding real data would leak it to all of them. Tests
 * live in tests/, which nothing installs.
 */

import { join } from "node:path";
import { REPO_ROOT, rel, runGate, walk } from "./lib/gate.mjs";

/** A test file by name, or anything inside a folder that holds tests or their data. */
const TEST_FILE = /\.(test|spec)\.[A-Za-z0-9]+$/;
const TEST_FOLDER = /(^|\/)(tests?|__tests__|fixtures?)\//;

runGate({
  id: "installed-files",
  purpose: "Nothing that installs on a person's machine is a test or test data.",
  rule: "no test file and no tests or fixtures folder anywhere under plugins/; tests live in tests/",
  assert(findings) {
    for (const file of walk(join(REPO_ROOT, "plugins"))) {
      const path = rel(file);
      if (TEST_FILE.test(path) || TEST_FOLDER.test(path.slice("plugins/".length))) {
        findings.push({ file: path, message: "installs on every user's machine with its plugin; move it to tests/" });
      }
    }
  },
});
