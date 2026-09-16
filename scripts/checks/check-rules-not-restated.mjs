#!/usr/bin/env node
/**
 * @purpose Keeps the rules out of this package. Everything shipped here is a TRIGGER — when to
 * reach for the memory, and where the rules are served — and never the rules themselves. A rule
 * written here survives a deploy: it needs a file edit, a published version, and every user to
 * update before it stops saying the old thing. Every other copy this product has removed lived on
 * something the engine serves, where a correction reaches people the moment it deploys. This
 * repository's own boundary already says why that is wrong: "a second copy will silently diverge
 * from the real one".
 *
 * WHY IT LOOKS AT SHAPE RATHER THAN WORDS. The engine has a fence that fingerprints canonical
 * rulebook content and refuses an exact copy. That fence would pass every file this gate was
 * written for, because what shipped here was never a copy — it was a PARAPHRASE. The sheet taught
 * four verbs in its own sentences and the product has seven; the saving prompt rewrote the capture
 * rule in its own words. Fingerprints cannot see either. So this gate refuses the SHAPE of
 * teaching: a file that defines what the verbs do, numbers the habits, or fences the boundaries is
 * teaching rules whatever sentences it uses.
 *
 * WHAT IT CANNOT REACH, said here rather than discovered later. It sees structure. A rule written
 * as one flowing paragraph with no heading and no list walks past it. That is a real floor and the
 * reason this gate is not the only thing holding the line — the shipped files are small enough to
 * be read whole in review, and the gate is what stops the shape growing back while nobody is
 * looking.
 */
import { join } from "node:path";
import { REPO_ROOT, read, rel, runGate } from "./lib/gate.mjs";

/**
 * Everything shipped into somebody else's AI. Each must be a trigger, never a rule.
 *
 * A prompt carries a `budget`: a trigger is short by nature — it names a moment and a record —
 * and a restated rule is long. The saving prompt stood at 709 characters when this gate was
 * written, and most of them paraphrased the capture rule: "skip anything merely floated,
 * explored or uncertain" is the rulebook's "Unsure it's settled? It isn't — wait", and "never
 * save speculation" is its "never capture half-thoughts".
 *
 * THE BUDGET IS NOT A ROUND NUMBER. It is what a moment, a pointer, and this delivery's OWN two
 * lines actually cost. Those two are not rules and do not belong in the rulebook: one says where
 * to find the saving tool when the harness has not loaded it yet, and one — "IF YOU SAVED
 * NOTHING, THIS CHECKPOINT IS INVISIBLE" — is measured behaviour of this delivery. Its own test
 * records why: "without these words the model reported the absence in every trial, with them in
 * none". A first pass at this gate set the budget below that line's cost and the suite caught it
 * immediately, which is the only reason it is still shipped.
 *
 * A length is a blunt instrument and is used here deliberately: this file has no headings and no
 * lists for the shapes above to catch, so length is the only structural thing left, and it is the
 * one that actually moves when prose turns into a rule.
 */
const SHIPPED = [
  { file: join(REPO_ROOT, "plugins", "dazzer", "skills", "dazzer", "SKILL.md") },
  { file: join(REPO_ROOT, "plugins", "dazzer", "prompts", "capture-tap.txt"), budget: 420 },
];

/**
 * The shapes teaching takes. Each names what it catches so a failure reads as a reason rather
 * than a pattern, and each was present in a real shipped file when this gate was written.
 */
const TEACHING = [
  {
    what: "a list that defines what a verb does",
    // "- **recall** - ask in plain language..." — the verb, then its behaviour.
    find: /^\s*[-*]\s*\*\*(recall|remember|confirm|forget|track|repair|report_gap)\*\*/im,
    instead: "name no verbs: the connection greeting already names all seven, live, from the one table",
  },
  {
    what: "a numbered list of habits",
    // "1. **Recall before you answer.**" — the rulebook's own habits, renumbered here.
    find: /^\s*\d+\.\s*\*\*[^*]+\*\*/m,
    instead: "say WHEN to reach for the memory; the habits are served live and read from there",
  },
  {
    what: "a section that fences the boundaries",
    find: /^#{1,6}\s*Boundaries\s*$/im,
    instead: "the boundaries are a rule the rulebook holds — point at it rather than restating it",
  },
  {
    what: "a section that teaches the verbs",
    find: /^#{1,6}\s*The\s+\w+\s+everyday\s+verbs?\s*$/im,
    instead: "drop the section: an AI learns the verbs from the connection, not from this file",
  },
];

runGate({
  id: "rules-not-restated",
  purpose: "Everything shipped here is a trigger. The rules are served live and never written down here.",
  rule: "a shipped file may say WHEN to reach for the memory and WHERE the rules are, and nothing about what they say",
  assert(findings) {
    for (const { file, budget } of SHIPPED) {
      let text;
      try {
        text = read(file);
      } catch {
        findings.push({ file: rel(file), message: "shipped file is missing" });
        continue;
      }
      const length = text.trim().length;
      if (budget !== undefined && length > budget) {
        findings.push({
          file: rel(file),
          message:
            `restates a rule the live rulebook holds — ${length} characters where a trigger fits in ` +
            `${budget}. Instead: name the moment and the record that holds the rule, and let it be read there`,
        });
      }
      for (const shape of TEACHING) {
        const hit = shape.find.exec(text);
        if (!hit) continue;
        const line = text.slice(0, hit.index).split("\n").length;
        findings.push({
          file: rel(file),
          line,
          message: `restates a rule the live rulebook holds — ${shape.what}. Instead: ${shape.instead}`,
        });
      }
    }
  },
});
