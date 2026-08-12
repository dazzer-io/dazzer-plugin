#!/usr/bin/env node
/**
 * @purpose Keeps the repository clean without anyone noticing, in a repo only agents work
 * in — every session starts with no memory of the last, so hygiene that depends on being
 * remembered never happens. One command tells an arriving agent the whole truth; the rest
 * place new work correctly, keep open work recoverable, and retire what everyone forgot.
 *
 * Goal: an agent arriving at any moment finds a trustworthy main checkout, can see what
 * every other agent is doing, and cannot lose work — without a human ever intervening.
 *
 * Deliberately plain Node with no dependencies and no project imports: it is called from
 * shell hooks, from any tool, and from checkouts where install has not run. That is also why
 * a copy of it lives in each sibling repository rather than being shared from one place —
 * sharing would put it behind an install. Behaviour must stay in step; the copies are
 * deliberately not identical, since how lines are printed differs by repository.
 *
 *   status            what is really going on — the main checkout, every worktree, what is
 *                     unsaved, what is unpushed, what has gone cold, and whether two agents
 *                     are changing the same files
 *   new <name>        a worktree placed and named correctly, branched from the main line
 *   save              snapshot open work in the current worktree without touching its
 *                     history (recoverable after a crash, reset, or abandoned session)
 *   sweep [--apply]   retire branches nobody has touched, keeping them restorable
 */

import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";

// A line of work untouched this long is announced; twice that and it is retired. Both are
// measured from its last commit, not from when it was created, so long-running work that is
// still being touched is never at risk.
const COLD_DAYS = 7;
const RETIRE_DAYS = 14;

// Two ways to call git. `run` reports whether it worked, and is what every step that could
// lose something must use — a helper that returns "" on failure makes "the command failed"
// and "the answer is empty" the same value, which is how a failed archive turns into a
// deleted branch. `git` is the reading shorthand, for answers where empty is a real answer.
const run = (args, { cwd = process.cwd(), env } = {}) => {
  try {
    const out = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: env ? { ...process.env, ...env } : process.env,
    });
    return { ok: true, out: out.trim() };
  } catch {
    return { ok: false, out: "" };
  }
};

const git = (args, cwd = process.cwd()) => run(args, { cwd }).out;

// What is unsaved in a working copy. Both flags are explicit because a repository or user
// setting can hide either by default, and a file never committed anywhere is the content that
// exists in exactly one place. Reports whether it could tell: a failure to read a working copy
// must never be mistaken for that copy being clean.
const unsavedIn = (cwd) => {
  const r = run(["status", "--porcelain", "--untracked-files=normal", "--ignore-submodules=none"], {
    cwd,
  });
  return { ok: r.ok, files: r.out.split("\n").filter(Boolean) };
};

// True only when everything in `maybeAncestor` is already contained in `descendant`. A git
// failure answers false, so anything unreadable counts as work that is NOT already in.
const isAncestor = (main, maybeAncestor, descendant) =>
  Boolean(maybeAncestor) &&
  run(["merge-base", "--is-ancestor", maybeAncestor, descendant], { cwd: main }).ok;

// The branch the shared repository treats as its main line, asked rather than assumed, so a
// repository that calls it something else still has it protected from retirement.
const currentHead = (main) => {
  const ref = git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], main);
  return ref ? ref.replace(/^origin\//, "") : "";
};

// The main checkout — the one place git's own directory IS the shared one. Everything else
// in the repository is a linked working copy, however deeply it happens to be nested.
const referenceCopy = () => {
  const common = git(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!common) return "";
  return dirname(common);
};

const worktreeHome = (main) => join(dirname(main), `${basename(main)}-worktrees`);

// The shared main line to measure work against — asked rather than assumed, so a repository
// that calls it something else still works. Prefers the shared copy, because a local main
// that has fallen behind makes every branch look like it changed whatever moved on since;
// falls back to a local name only when there is no shared copy to ask.
const mainLine = (main) => {
  const named = currentHead(main);
  for (const ref of [
    named && `origin/${named}`,
    "origin/main",
    "origin/master",
    named,
    "main",
    "master",
  ]) {
    if (ref && git(["rev-parse", "--verify", "--quiet", ref], main)) return ref;
  }
  return "main";
};

const daysSince = (iso) => (Date.now() - new Date(iso).getTime()) / 86_400_000;

// Location only makes a copy a CANDIDATE for the tool's own scratch; what it HOLDS decides.
// A location-only rule labels live work "not yours to manage" — a report that is confidently
// wrong is worse than none, because it gets acted on.
//
// A copy with no branch is judged by its own recorded position, which git reports for every
// copy including ones whose folder has been deleted: those commits are still reachable and
// readable until someone prunes, so "the folder is gone" is not a reason to call them
// disposable. An unreadable position makes the check fail, which reads as real work — the
// direction every uncertainty in this file falls.
const isToolScratch = (copy, main, base) => {
  const inToolFolder =
    copy.path.includes("/.claude/worktrees/") || /^worktree-agent-/.test(copy.branch);
  if (!inToolFolder) return false;
  // Unsaved files exist in exactly one place, so any of them makes a copy real work — and a
  // copy we could not read might hold some, which is not the same as holding none.
  if (copy.unsaved || copy.unreadable) return false;
  return isAncestor(main, copy.branch || copy.head, base);
};

const listWorkingCopies = (main) => {
  const out = git(["worktree", "list", "--porcelain"], main);
  const copies = [];
  let current = null;
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice(9), branch: "", head: "", detached: false };
      copies.push(current);
    } else if (line.startsWith("HEAD ") && current) {
      // Reported for every copy, branch or not, and still reported once the folder is gone.
      // It is what keeps a branchless copy's commits reachable, so it is what they are
      // judged and described by. All-zeros means a branch with nothing committed yet.
      const sha = line.slice(5);
      current.head = /^0+$/.test(sha) ? "" : sha;
    } else if (line.startsWith("branch ") && current) {
      current.branch = line.slice(7).replace("refs/heads/", "");
    } else if (line === "detached" && current) {
      current.detached = true;
    }
  }
  return copies;
};

const describe = (copy, main) => {
  const missing = !existsSync(copy.path);
  // A folder that is gone has no unsaved state of its own. Reading the main checkout in its
  // place would report the main checkout's dirty files as this worktree's, which is exactly
  // the kind of confident wrong number that stops anyone trusting the report.
  // Untracked files are asked for explicitly: a repository or user setting can turn them off
  // by default, and a file never committed anywhere is exactly the content that exists in one
  // place — the whole reason this count is consulted.
  const read = missing ? { ok: true, files: [] } : unsavedIn(copy.path);
  const unsaved = read.files.length;
  const unreadable = !read.ok;
  // A copy with no branch is described by its own position, so the one class of work that
  // exists nowhere else is not printed as blank and "nothing yet".
  const ref = copy.branch || copy.head;
  const lastIso = ref ? git(["log", "-1", "--format=%cI", ref], main) : "";
  const subject = ref ? git(["log", "-1", "--format=%s", ref], main) : "";
  const backedUp = copy.branch
    ? git(["rev-parse", "--verify", "--quiet", `origin/${copy.branch}`], main) !== ""
    : false;
  return { ...copy, unsaved, unreadable, lastIso, backedUp, subject, missing };
};

// Which files are machine-written is a question the repository can answer, so it is asked
// rather than guessed. A hand-kept list drifts as generators come and go, and matching on a
// file's name alone also catches hand-written fixtures that happen to share it — hiding real
// collisions while a stale entry lets false ones through. Marked in .gitattributes, which
// needs no install and works in a checkout where nothing has been run.
const generatedAmong = (main, files) => {
  if (!files.length) return new Set();
  const out = run(["check-attr", "-z", "generated", "--", ...files], { cwd: main });
  if (!out.ok) return new Set();
  // Records arrive as path, attribute, value, each NUL-terminated.
  const parts = out.out.split("\0");
  const marked = new Set();
  for (let i = 0; i + 2 < parts.length; i += 3) {
    if (parts[i + 2] === "set" || parts[i + 2] === "true") marked.add(parts[i]);
  }
  return marked;
};

// Below this, a shared file is coincidence — a formatter run, an import list. At or above it,
// two agents are working the same code and neither knows.
const CLASH_THRESHOLD = 2;

// Two agents editing the same files, unaware of each other, is the failure that produces the
// same fix built twice. Comparing each line of work's changed files against the main line
// surfaces it before either one is finished.
const overlaps = (main, copies, base) => {
  const changed = new Map();
  for (const c of copies) {
    if (!c.branch || base.endsWith(`/${c.branch}`) || base === c.branch) continue;
    const files = git(["-c", "core.quotePath=false", "diff", "--name-only", `${base}...${c.branch}`], main)
      .split("\n")
      .filter(Boolean);
    if (files.length) changed.set(c.branch, new Set(files));
  }
  const found = [];
  const names = [...changed.keys()];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const [a, b] = [names[i], names[j]];
      // One branch built on top of another shares every file the first changed. That is one
      // agent's own sequence of work, not two agents colliding, and reporting it teaches
      // agents that this warning means nothing.
      if (isAncestor(main, a, b) || isAncestor(main, b, a)) continue;
      const shared = [...changed.get(a)].filter((f) => changed.get(b).has(f));
      const generated = generatedAmong(main, shared);
      const real = shared.filter((f) => !generated.has(f));
      if (real.length >= CLASH_THRESHOLD) found.push({ a, b, files: real });
    }
  }
  return found;
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const age = (iso) => {
  if (!iso) return "never";
  const d = daysSince(iso);
  if (d < 1) return "today";
  return `${Math.floor(d)}d ago`;
};

const cmdStatus = (main) => {
  // Before reading anything, so "only on this machine" and "behind the main line" describe
  // the shared repository as it is now rather than whenever it was last consulted.
  git(["fetch", "origin", "--prune", "--quiet"], main);

  const copies = listWorkingCopies(main).map((c) => describe(c, main));
  const reference = copies.find((c) => c.path === main);
  const base = mainLine(main);
  const work = [];
  const scratch = [];
  for (const c of copies.filter((c) => c.path !== main)) {
    if (isToolScratch(c, main, base)) scratch.push(c);
    else work.push(c);
  }

  const behindCount = run(["rev-list", "--count", `HEAD..${base}`], { cwd: main });
  const behind = behindCount.ok ? Number(behindCount.out) : 0;
  console.log("REFERENCE COPY");
  console.log(`  ${main}`);
  console.log(
    `  on ${reference?.branch || "(no branch)"} · ${
      reference?.unreadable
        ? "COULD NOT BE READ"
        : reference?.unsaved
          ? `${plural(reference.unsaved, "file", "files")} UNSAVED — should be none`
          : "clean"
    }` +
      `${behind ? ` · ${plural(behind, "change", "changes")} behind the main line` : ""}`,
  );

  console.log(`\nWORK IN PROGRESS (${work.length})`);
  if (!work.length) console.log("  none");
  for (const c of work) {
    const flags = [];
    if (c.missing) flags.push("FOLDER MISSING");
    if (c.unreadable) flags.push("COULD NOT BE READ — treat as holding work");
    else if (c.unsaved) flags.push(`${plural(c.unsaved, "file", "files")} unsaved`);
    if (!c.backedUp) flags.push("only on this machine");
    if (c.lastIso && daysSince(c.lastIso) >= RETIRE_DAYS)
      flags.push(`cold ${age(c.lastIso)} — will be retired`);
    else if (c.lastIso && daysSince(c.lastIso) >= COLD_DAYS) flags.push(`cold ${age(c.lastIso)}`);
    console.log(`  ${c.branch || `(no branch) ${c.head.slice(0, 8)}`}`);
    console.log(`    ${c.subject || "(nothing yet)"}`);
    console.log(
      `    ${basename(c.path)} · last touched ${age(c.lastIso)}${flags.length ? ` · ${flags.join(" · ")}` : ""}`,
    );
  }

  const clashes = overlaps(main, work, base);
  if (clashes.length) {
    console.log(`\nTWO AGENTS IN THE SAME CODE (${clashes.length})`);
    for (const c of clashes) {
      console.log(`  ${c.a}  and  ${c.b}`);
      console.log(
        `    both changing: ${c.files.slice(0, 4).join(", ")}${c.files.length > 4 ? ` +${c.files.length - 4} more` : ""}`,
      );
    }
  }

  if (scratch.length) {
    console.log(
      `\nASSISTANT'S OWN TEMPORARY COPIES (${scratch.length}) — created and removed by the tool, not yours to manage`,
    );
    for (const c of scratch) console.log(`  ${basename(c.path)} · ${age(c.lastIso)}`);
  }

  const retirable = retirableBranches(main);
  console.log(`\nFORGOTTEN WORK`);
  console.log(
    retirable.length
      ? `  ${retirable.length} line(s) untouched ${RETIRE_DAYS}+ days — run: node scripts/git-health.mjs sweep --apply`
      : "  none",
  );
};

const cmdNew = (main, name) => {
  if (!name) {
    console.error("Name the work, e.g.  new feat/answers-say-where-they-came-from");
    process.exit(2);
  }
  // The folder is named after the work, so what is where is readable at a glance — the
  // single change that makes a directory of working copies self-describing.
  if (!/^(feat|fix|docs|chore|refactor|test|perf|ci|build)\/[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
    console.error(`Not a usable name: ${name}`);
    console.error(
      "Use  <kind>/<what-it-does>  — kind is one of feat fix docs chore refactor test perf ci build,",
    );
    console.error(
      "and what-it-does is lower-case words joined by hyphens, e.g. fix/saves-no-longer-fail-silently",
    );
    process.exit(2);
  }
  const folder = join(worktreeHome(main), name.split("/").pop());
  if (existsSync(folder)) {
    console.error(`Already taken: ${folder}`);
    process.exit(2);
  }
  git(["fetch", "origin", "--prune", "--quiet"], main);
  const base = mainLine(main);
  // Quiet rather than passed through: git's progress chatter is not this command's voice, and
  // it arrives on the error channel where it reads as a fault. Its reason for failing goes with
  // it, so the message below names what to look at instead.
  const made = run(["worktree", "add", "-q", folder, "-b", name, base], { cwd: main });
  if (!made.ok) {
    console.error(
      `Could not create a working copy at ${folder} — check that ${base} exists, that ${name} is not already a line of work, and that the folder is free`,
    );
    process.exit(1);
  }
  console.log(`\nWorking copy ready. Move into it and do the work there:\n  cd ${folder}`);
};

// Snapshots open work as an object that hangs off no line of work, so a crash, a reset or an
// abandoned session cannot lose it — and nothing appears in the history the agent is writing.
const cmdSave = (main) => {
  const here = process.cwd();
  const gitDir = git(["rev-parse", "--path-format=absolute", "--git-dir"], here);
  const commonDir = git(["rev-parse", "--path-format=absolute", "--git-common-dir"], here);
  if (!gitDir || gitDir === commonDir) return; // reference copy or not a repo — nothing to snapshot
  // Only a confident "nothing here" stops us. If the working copy could not be read, carry on
  // and let the snapshot try: it builds through its own index and does not need the one that
  // may be broken, so stopping here is the only thing that would lose the work.
  const open = unsavedIn(here);
  if (open.ok && !open.files.length) return;

  // Built through a throwaway index rather than git's own stash, because stash silently
  // leaves out files that have never been committed — which is precisely the work most at
  // risk. A brand-new file exists in exactly one place, so a snapshot that skips it saves
  // the least valuable half of what is open.
  //
  // A separate index also means the agent's real staging area, its working tree, and what
  // it sees when it looks at its own work are all completely untouched.
  // Unique per run, and cleaned up along with the lock git writes beside it. A shared name
  // leaves a lock behind when a turn is killed — which this runs at the end of, so being
  // killed is routine — and every later snapshot then fails against that stale lock, quietly
  // switching saving off for that worktree for good.
  const index = join(gitDir, `git-health-snapshot-${process.pid}-${Date.now()}.index`);
  const cleanUp = () => {
    rmSync(index, { force: true });
    rmSync(`${index}.lock`, { force: true });
  };
  const withIndex = (args) => run(args, { cwd: here, env: { GIT_INDEX_FILE: index } });

  const head = git(["rev-parse", "--verify", "--quiet", "HEAD"], here);
  // Every step is checked. Left unchecked, a failed `add` produces a tree identical to the
  // last commit and the whole thing reports success while having saved nothing — the exact
  // failure this command exists to prevent, wearing a reassuring message.
  if (head && !withIndex(["read-tree", "HEAD"]).ok) return failedToSave(cleanUp);
  // Honours the project's ignore rules, so build output and dependencies stay out.
  if (!withIndex(["add", "-A"]).ok) return failedToSave(cleanUp);
  const tree = withIndex(["write-tree"]).out;
  cleanUp();
  if (!tree) return failedToSave();

  // Nothing new to keep: the working tree matches what was already recorded, so writing
  // another snapshot would only add a duplicate that pins the same files forever.
  if (head && git(["rev-parse", "--verify", "--quiet", `${head}^{tree}`], here) === tree) return;

  // Nothing was open after all: with no commits yet there is no previous tree to compare
  // against, so an empty one is recognised directly rather than reported as work saved. The
  // repository is asked what an empty tree looks like — writing the answer down here would be
  // right for one way of naming objects and silently wrong for the other.
  if (!head && tree === git(["hash-object", "-t", "tree", "/dev/null"], here)) return;

  const message = `open work in ${basename(here)}, saved automatically`;
  const snapshot = head
    ? git(["commit-tree", tree, "-p", head, "-m", message], here)
    : git(["commit-tree", tree, "-m", message], here);
  if (!snapshot) return failedToSave();

  const label = basename(here).replace(/[^a-zA-Z0-9._-]/g, "-");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  if (!run(["update-ref", `refs/saved/${label}/${stamp}`, snapshot], { cwd: here }).ok) {
    return failedToSave();
  }
  console.log(
    `open work saved (recover the files with: git restore --source ${snapshot.slice(0, 8)} -- .)`,
  );
};

// Said out loud, on the error stream. This runs unattended with its output discarded, so the
// only thing worse than failing is failing while claiming to have succeeded — and a caller
// that ever does show output should see that work is not being kept.
const failedToSave = (cleanUp) => {
  cleanUp?.();
  console.error("could not save open work here — it is still unsaved on disk only");
};

// Branches nobody is in and nobody has touched. Pure: reads state, changes nothing, so the
// reporting command can call it without a network round-trip or a surprise.
const retirableBranches = (main) => {
  const occupied = new Set(listWorkingCopies(main).map((c) => c.branch));
  const protectedNames = new Set(["main", "master", currentHead(main)].filter(Boolean));
  const out = [];
  // NUL-delimited: a branch name may legally contain any punctuation, and splitting on one
  // would mis-parse the date, which the age test below then reads as "unknown" — see there
  // for why that direction is dangerous.
  const refs = git(
    ["for-each-ref", "--format=%(refname:short)%00%(committerdate:iso-strict)", "refs/heads"],
    main,
  );
  for (const line of refs.split("\n").filter(Boolean)) {
    const [name, iso] = line.split("\0");
    if (!name || protectedNames.has(name) || occupied.has(name)) continue;
    // Written so an unreadable date KEEPS the branch. The natural phrasing — skip when
    // younger than the limit — is false for an unparseable date, so a branch made minutes
    // ago would be retired. Every uncertainty here has to fall towards keeping.
    if (!(daysSince(iso) >= RETIRE_DAYS)) continue;
    out.push({ name, iso });
  }
  return out;
};

// A name for the archive that is free, does not collide with an existing archive, and
// cannot fail against git's ref layout.
//
// Two ways the obvious `archive/<branch>` goes wrong, both seen for real in this
// repository: a tag cannot be created at `archive/feat` once `archive/feat/...` exists,
// because refs are directories; and `--force` onto an existing archive would overwrite the
// earlier work that name once held. Both end in unreachable commits.
const freeArchiveName = (main, branch, sha) => {
  const candidates = [
    `archive/${branch}`,
    `archive/${branch}-${sha.slice(0, 8)}`,
    `archive/${branch.replace(/\//g, "-")}-${sha.slice(0, 8)}`,
  ];
  for (const name of candidates) {
    if (git(["rev-parse", "--verify", "--quiet", `refs/tags/${name}`], main)) continue; // taken
    if (run(["tag", name, sha], main).ok) return name;
  }
  return "";
};

// Retires branches nobody has touched. The archive is written and verified BEFORE the
// branch is deleted, and a branch whose archive could not be written is left alone — the
// one destructive step in this file runs automatically, with its output discarded, so it
// has to refuse rather than proceed on any doubt.
const cmdSweep = (main, apply) => {
  git(["fetch", "origin", "--prune", "--quiet"], main);
  const candidates = retirableBranches(main);

  if (!candidates.length) {
    console.log(`Nothing untouched for ${RETIRE_DAYS}+ days.`);
    return candidates;
  }
  const skipped = [];
  for (const c of candidates) {
    console.log(`${apply ? "retiring" : "would retire"}  ${c.name}  (last touched ${age(c.iso)})`);
    if (!apply) continue;

    const sha = git(["rev-parse", "--verify", "--quiet", `refs/heads/${c.name}`], main);
    if (!sha) {
      skipped.push(`${c.name} — could not read it`);
      continue;
    }
    const archived = freeArchiveName(main, c.name, sha);
    // Verified by reading it back: a tag command that reported success but left nothing
    // readable would otherwise cost the work.
    if (
      !archived ||
      git(["rev-parse", "--verify", "--quiet", `${archived}^{commit}`], main) !== sha
    ) {
      skipped.push(`${c.name} — could not be archived, so it was left alone`);
      continue;
    }
    if (!run(["branch", "-D", c.name], main).ok)
      skipped.push(`${c.name} — archived but not removed`);
  }

  if (apply) {
    pruneOldSnapshots(main);
    console.log(`\nKept as a tag — restore any with: git branch <name> <its archive tag>`);
    if (skipped.length) {
      console.log(`\nLeft alone, nothing lost:`);
      for (const s of skipped) console.log(`  ${s}`);
    }
  } else {
    console.log(`\nAdd --apply to retire them (each is kept as a tag and stays restorable).`);
  }
  return candidates;
};

// Snapshots are written every turn, so without this they grow for as long as a worktree has
// open work and pin every tree they captured against collection. Anything older than the
// retirement window has been superseded many times over.
const pruneOldSnapshots = (main) => {
  const refs = git(
    ["for-each-ref", "--format=%(refname)%00%(committerdate:iso-strict)", "refs/saved"],
    main,
  );
  for (const line of refs.split("\n").filter(Boolean)) {
    const [ref, iso] = line.split("\0");
    if (ref && daysSince(iso) >= RETIRE_DAYS) git(["update-ref", "-d", ref], main);
  }
};

const main = referenceCopy();
if (!main) {
  console.error("Not inside a git repository.");
  process.exit(2);
}
const [command, ...rest] = process.argv.slice(2);
switch (command) {
  case "status":
    cmdStatus(main);
    break;
  case "new":
    cmdNew(main, rest[0]);
    break;
  case "save":
    cmdSave(main);
    break;
  case "sweep":
    cmdSweep(main, rest.includes("--apply"));
    break;
  default: {
    // Asked for help, or got it wrong? The second is a failure and reports on the failure
    // stream, so a caller reading output does not mistake usage text for an answer.
    const wrong = command !== undefined;
    (wrong ? console.error : console.log)(
      "Usage: git-health.mjs status | new <kind>/<what-it-does> | save | sweep [--apply]",
    );
    process.exit(wrong ? 2 : 0);
  }
}
