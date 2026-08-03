#!/usr/bin/env node
/**
 * @purpose Keeps the test suite capable of seeing failures. Three of the six defects
 * hid for one reason: the suite threw away everything the script printed to the error
 * channel, and three of those defects announce themselves there. A suite that cannot
 * observe a failure reports success for the wrong reason, which is worse than no suite.
 *
 * It also keeps the suite honest about which shell it exercised. Naming the interpreter
 * inside the file means running the suite under a different shell still tests the same
 * one - so a run "under both shells" silently covers one, on exactly the comparison
 * where the two behave differently.
 */

import { join } from "node:path";
import { REPO_ROOT, read, rel, runGate, walk } from "./lib/gate.mjs";

const REQUIRED_COVERAGE = [
  { tag: "shrink:", why: "a conversation that gets shorter, then grows again - the moment a context reset creates" },
  { tag: "escape:", why: "a session name trying to write outside the folder this plugin owns" },
  { tag: "setting:", why: "a mistyped setting, which must fall back rather than misbehave" },
];

runGate({
  id: "harness-contract",
  purpose: "The suite can observe every way the script can fail.",
  rule: "assert the error channel, take the shell from outside, and cover the cases that hid defects before",
  assert(findings) {
    const suites = walk(join(REPO_ROOT, "plugins")).filter((f) => f.endsWith(".test.sh"));

    if (suites.length === 0) {
      findings.push({ file: "plugins/", message: "there is no test suite" });
      return;
    }

    for (const file of suites) {
      const body = read(file);
      const where = rel(file);
      const code = body.split("\n").map((t, i) => ({ n: i + 1, text: t.replace(/(^|\s)#.*$/, "$1") }));

      // Only the SUBJECT's error channel matters. The suite's own housekeeping may quiet
      // itself; throwing away what the thing under test said is the habit that hid defects.
      const invokesSubject = /\$\{?(SUBJECT|SWEEP|DAZZER_SWEEP_BIN)\b/;

      for (const { n, text } of code) {
        if (invokesSubject.test(text) && /2>\s*(\/dev\/null|&1)/.test(text)) {
          findings.push({
            file: where,
            line: n,
            id: "discards-errors",
            message:
              "throws away what the script under test printed to the error channel. That single " +
              "habit hid three defects. Capture it and assert it is empty.",
          });
        }
        if (/\|\s*(sh|bash|dash|zsh)\s+"?\$/.test(text)) {
          findings.push({
            file: where,
            line: n,
            id: "hardcoded-shell",
            message:
              "names the shell inside the file, so running this suite under a different shell " +
              "still tests the same one. Take the interpreter from the environment so two runs " +
              "genuinely differ.",
          });
        }
      }

      if (!/\bSHELL_UNDER_TEST\b|\bDAZZER_TEST_SHELL\b/.test(body)) {
        findings.push({
          file: where,
          id: "hardcoded-shell",
          message: "offers no way to choose the interpreter, so the two-shell run cannot be real",
        });
      }
      // Capturing the subject's error channel somewhere real is the only way an assertion
      // about it can exist at all.
      const capturesErrors = code.some(
        ({ text }) => invokesSubject.test(text) && /2>\s*["'$]/.test(text),
      );
      if (!capturesErrors) {
        findings.push({
          file: where,
          id: "discards-errors",
          message: "never captures the error channel of the script under test, so it cannot be asserting it is empty",
        });
      }

      for (const { tag, why } of REQUIRED_COVERAGE) {
        if (!body.includes(tag)) {
          findings.push({
            file: where,
            id: `missing-coverage::${tag.replace(":", "")}`,
            message: `has no case tagged "${tag}" - ${why}`,
          });
        }
      }
    }

    for (const id of new Set(findings.map((f) => f.id).filter(Boolean))) {
      process.stdout.write(`FAILID harness-contract::${id}\n`);
    }
  },
});
