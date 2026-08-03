#!/usr/bin/env node
/**
 * @purpose Bars the mistakes that produced every defect found in the shipped script,
 * as classes rather than instances. Four of the six defects were one habit - treating
 * a structured message as loose text and then trusting the result - so the rules below
 * describe the shape correct code has, not the specific bugs we happened to find.
 *
 * Each rule reports its own id so the ledger can hold them one at a time.
 */

import { join } from "node:path";
import { REPO_ROOT, read, rel, runGate, walk } from "./lib/gate.mjs";

/** Scripts that run on a user's machine. Test files live under their own contract. */
const shippedScripts = () =>
  walk(join(REPO_ROOT, "plugins")).filter((f) => f.endsWith(".sh") && !f.endsWith(".test.sh"));

/** Comments carry prose about the very patterns we ban, so analyse code only. */
const codeLines = (text) =>
  text.split("\n").map((t, i) => ({ n: i + 1, text: t.replace(/(^|\s)#.*$/, "$1") }));

/** Names assigned from a function that reads the incoming message. */
function payloadDerivedNames(all) {
  const names = new Set();
  for (const { text } of all) {
    const m = text.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=.*\$\(\s*(read_field|read_bool|read_json)\b/);
    if (m) names.add(m[1]);
  }
  return names;
}

const RULES = [
  {
    id: "payload-glob",
    why: "matching the raw message as text instead of reading the field",
    check(all, findings, file) {
      for (const { n, text } of all) {
        if (/\bcase\s+"?\$\{?INPUT\b/.test(text)) {
          findings.push({
            file,
            line: n,
            id: "payload-glob",
            message:
              "matches the whole incoming message as text. A word appearing anywhere in it " +
              "can flip the result - which is how an ordinary prompt containing 'true' " +
              "silenced saving. Read the named field and compare its value.",
          });
        }
        if (/\b(grep|expr)\b[^|]*\$\{?INPUT\b/.test(text)) {
          findings.push({ file, line: n, id: "payload-glob", message: "searches the raw message as text; read the field instead" });
        }
      }
    },
  },
  {
    id: "unfenced-path",
    why: "a value out of the message becoming a filename with nothing checking where it lands",
    check(all, findings, file) {
      const derived = payloadDerivedNames(all);
      if (derived.size === 0) return;
      const fenced = /\b(fence_path|fence_under|confine_to)\b/.test(all.map((l) => l.text).join("\n"));
      for (const { n, text } of all) {
        for (const name of derived) {
          const usedInPath = new RegExp(`=\\s*"[^"]*/[^"]*\\$\\{?${name}\\b|=\\s*"[^"]*\\$\\{?${name}\\}?[^"]*/`).test(text);
          if (usedInPath && !fenced) {
            findings.push({
              file,
              line: n,
              id: "unfenced-path",
              message:
                `$${name} comes from the incoming message and is being used as a filename. ` +
                "Nothing stops it containing '../', so the write lands outside the folder this " +
                "plugin owns. Confine the resolved path to its own directory first.",
            });
          }
        }
      }
    },
  },
  {
    id: "unvalidated-setting",
    why: "a setting taken from the environment and used without checking its shape",
    check(all, findings, file) {
      const body = all.map((l) => l.text).join("\n");
      const seen = new Set();
      for (const { n, text } of all) {
        const m = text.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=.*\$\{(DAZZER_[A-Z0-9_]+)/);
        if (!m) continue;
        const [, holder, envName] = m;
        if (seen.has(envName)) continue;
        seen.add(envName);
        const validated = new RegExp(`case\\s+"?\\$\\{?${holder}\\b`).test(body);
        if (!validated) {
          findings.push({
            file,
            line: n,
            id: "unvalidated-setting",
            message:
              `${envName} is used without checking its shape. A typo in it reaches a numeric ` +
              "comparison, which fails loudly and falls through to the opposite of the intended " +
              `behaviour. Check $${holder} and fall back to the packaged default.`,
          });
        }
      }
    },
  },
  {
    id: "non-atomic-write",
    why: "a saved value that can be observed half-written",
    check(all, findings, file) {
      const body = all.map((l) => l.text).join("\n");
      const movesIntoPlace = /\bmv\s+(-f\s+)?"/.test(body);
      for (const { n, text } of all) {
        const redirect = text.match(/>\s*"\$\{?([A-Za-z_][A-Za-z0-9_]*)/);
        if (!redirect) continue;
        if (/^\s*(printf|echo|cat)\b/.test(text) === false) continue;
        const target = redirect[1];
        const toTemp = /\$\$|\.tmp/.test(text);
        if (!toTemp || !movesIntoPlace) {
          findings.push({
            file,
            line: n,
            id: "non-atomic-write",
            message:
              `writes $${target} in place. Interrupted, it leaves an empty file that reads back ` +
              "as zero and causes a duplicate prompt; and if the write fails the shell prints an " +
              "error this script cannot suppress. Write beside it, then move it into place.",
          });
        }
      }
    },
  },
  {
    id: "bare-number",
    why: "a tuning value baked into the code where nobody can find or change it",
    check(all, findings, file) {
      for (const { n, text } of all) {
        if (/\bdefault_for\b/.test(text)) continue;
        const m = text.match(/^\s*[A-Za-z_][A-Za-z0-9_]*=.*?:-\s*(\d{2,})\s*\}/);
        if (m) {
          findings.push({
            file,
            line: n,
            id: "bare-number",
            message: `${m[1]} is written into the code. Move it to the defaults file so it is named, documented and changeable.`,
          });
        }
      }
    },
  },
];

runGate({
  id: "shell-contract",
  purpose: "The shipped script obeys the rules derived from every defect we have found.",
  rule: "read fields, check shapes, confine paths, write atomically, keep numbers in the defaults file",
  assert(findings) {
    for (const file of shippedScripts()) {
      const all = codeLines(read(file));
      for (const rule of RULES) rule.check(all, findings, rel(file));
    }
    // Let the ledger hold each class separately rather than the whole gate.
    for (const id of new Set(findings.map((f) => f.id).filter(Boolean))) {
      process.stdout.write(`FAILID shell-contract::${id}\n`);
    }
  },
});
