#!/usr/bin/env node
/**
 * Writes every per-tool file from two sources: source/manifest.json (the version, the plugins and
 * what each tool's manifest adds) and source/words.json (every sentence the plugin says).
 *
 *   node scripts/generate.mjs           write every generated file
 *   node scripts/generate.mjs --check   write nothing; exit 1 naming each file that differs
 *   node scripts/generate.mjs --selftest  plant one fault per check in a copy; exit 1 unless each is refused
 *
 * Either way it also fails on a file under plugins/ that nobody writes, and on generated files that
 * break what a host needs: the reminders tools.manifest.json promises each tool, the keys each host
 * accepts, the [Dazzer] mark, and the paths a listing names.
 *
 * Six tools read this repository, each in its own format:
 *
 *   Claude Code   .claude-plugin/marketplace.json, <plugin>/.claude-plugin/plugin.json, hooks/hooks.json
 *   Codex         the same three files as Claude Code
 *   Copilot CLI   the Claude marketplace and manifests, and instructions/copilot.md as a standing
 *                 instruction (a Copilot hook cannot speak to the model)
 *   Cursor        <plugin>/.cursor-plugin/plugin.json and hooks/cursor.json
 *   Devin         <plugin>/.devin-plugin/plugin.json and hooks.json at the plugin root
 *   Antigravity   plugin.json and hooks.json in a plugin of its own, because it and Devin both read
 *                 hooks.json at the plugin root and want different shapes inside it
 *
 * A host that meets one key it does not know drops the whole file, so each template below holds
 * exactly the keys its host accepts. tools.manifest.json is written in part: its connection, the
 * sentences each reminder speaks and how often the check-first reminder arrives come from here;
 * everything else in it is written by hand.
 *
 * Every file keeps the layout it had when it was written by hand, so the first generation changed
 * no byte: the Claude manifests write short lists on one line, the other formats one item a line.
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(process.env.DAZZER_REPO_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), ".."));
const readJson = (path) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));

// --- --selftest: every check below can still fail -----------------------------------------------
// A check that passes by finding nothing can go blind and stay green. Each plant below breaks one
// check in a copy of this tree; the run fails unless each is refused with its own words and the
// untouched copy passes. A plant that no longer applies fails too, rather than proving nothing.

/** Replaces the one place `from` occurs; null when it occurs more often or not at all. */
const swap = (from, to) => (text) => (text?.split(from).length === 2 ? text.replace(from, () => to) : null);
const OWN_PLACE = '\n              { type: "command", command: script("own-place.sh") },';
const PLANTS = [
  // [the fault, the file it is planted in, the edit (or the whole new file), words the refusal must carry]
  ["a hook file nobody writes", "plugins/dazzer/hooks/quillpad.json", "{}\n", "quillpad.json is not written by the generator"],
  ["own-place.sh dropped", "scripts/generate.mjs", swap(OWN_PLACE, ""), "never runs own-place.sh"],
  ["own-place.sh dropped where the checkpoint is not told its moment", "scripts/generate.mjs", (text) => swap(OWN_PLACE, "")(swap('\n          { hooks: [{ type: "command", command: `DAZZER_MOMENT=with-next-message ', '\n          { hooks: [{ type: "command", command: `')(text)), "never runs own-place.sh"],
  ["a reminders file with no shape", "scripts/generate.mjs", swap("\n  shape: { may: [reminders.name]", "\n  unshaped: { may: [reminders.name]"), "dazzer-antigravity/hooks.json has no list of the keys its host accepts"],
  ["a key the Codex file may not hold", "scripts/generate.mjs", swap("\n    doc: {\n      hooks: {\n        UserPromptSubmit", "\n    doc: {\n      version: 1,\n      hooks: {\n        UserPromptSubmit"), 'hooks/hooks.json holds "version"'],
  ["a key a listing may not hold, through source/", "source/manifest.json", swap('"types": "./types/index.d.ts",', '"types": "./types/index.d.ts", "hooks": "./hooks/hooks.json",'), 'plugin.json holds "hooks"'],
  ["a moment the file is not for", "scripts/generate.mjs", swap("\n      Stop: [{ type", "\n      Quit: [{ type"), 'answers "Quit"'],
  ["a sentence without the mark", "source/words.json", swap('"resume": "[Dazzer] ', '"resume": "'), '"resume" sentence without the [Dazzer] mark'],
  ["the check-first sentence off its moment", "scripts/generate.mjs", swap('\n    recallOn: "UserPromptSubmit",', '\n    recallOn: "SessionStart",'), "does not speak the check-first sentence at SessionStart"],
  ["a reminder promised and not carried", "tools.manifest.json", swap('"capture": "works-but-visible",\n        "resume": "not-delivered"', '"capture": "works-but-visible",\n        "resume": "works"'), `cursor's resume reminder is "works", and the file does not carry it`],
  ["a tool with no describedAs", "tools.manifest.json", swap('"describedAs": "Cognition’s coding agent",', ""), "devin has no describedAs"],
  ["a listing path that is not there", "source/manifest.json", swap('"./hooks/cursor.json"', '"./hooks/cursr.json"'), "points at ./hooks/cursr.json"],
  ["the plate's hooks file holds more than modules", "plugins/dazzer-plate/hooks/hooks.json", '{ "modules": ["./plate.tsx"], "SessionStart": [] }\n', 'dazzer-plate/hooks/hooks.json holds "SessionStart"'],
  ["the plate's module is not there", "plugins/dazzer-plate/hooks/hooks.json", swap("./plate.tsx", "./plates.tsx"), "must list the plate's modules"],
  ["a plugin name that leaves plugins/", "source/manifest.json", swap('"name": "dazzer-plate"', '"name": "../plate"'), 'plugin name "../plate"'],
  ["a version the release step would not tag", "source/manifest.json", (text) => text.replace(/"version": "[^"]*"/, '"version": "1.2"'), 'version "1.2" must be three whole numbers'],
];
if (process.argv.includes("--selftest")) {
  const scratch = mkdtempSync(join(tmpdir(), "dazzer-generate-selftest-"));
  const failures = [];
  let copies = 0;
  const run = (name, plant) => {
    const copy = join(scratch, String((copies += 1)));
    for (const part of ["source", "scripts", "plugins", ".claude-plugin", "tools.manifest.json"]) cpSync(join(ROOT, part), join(copy, part), { recursive: true });
    if (plant) {
      const [file, edit] = plant;
      const before = existsSync(join(copy, file)) ? readFileSync(join(copy, file), "utf8") : undefined;
      const after = typeof edit === "function" ? edit(before ?? "") : edit;
      if (after === null || after === before) return `${name}: the plant no longer applies to ${file}, so it proves nothing`;
      writeFileSync(join(copy, file), after);
    }
    const result = spawnSync(process.execPath, [join(copy, "scripts", "generate.mjs"), "--check"], { encoding: "utf8", env: { ...process.env, DAZZER_REPO_ROOT: copy } });
    return { said: `${result.stdout}${result.stderr}`, status: result.status };
  };
  try {
    const clean = run("the untouched copy");
    if (clean.status !== 0) failures.push(`the untouched copy fails the check:\n${clean.said}`);
    for (const [name, file, edit, expect] of PLANTS) {
      const result = run(name, [file, edit]);
      if (typeof result === "string") failures.push(result);
      else if (result.status === 0) failures.push(`${name}: planted in ${file}, and the check passed`);
      else if (!result.said.includes(expect)) failures.push(`${name}: refused, but not with "${expect}":\n${result.said}`);
      else process.stdout.write(`ok   refused: ${name}\n`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  if (failures.length > 0) {
    process.stdout.write(`FAIL generator selftest\n${failures.map((line) => `  ${line}`).join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write(`ok   generator selftest (${PLANTS.length} faults refused, the untouched copy passes)\n`);
  process.exit(0);
}

const manifest = readJson("source/manifest.json");
const words = readJson("source/words.json");

/**
 * The sentences are printed by shell commands and inserted into JSON by the save-prompt script, so
 * a quote, a backslash, a backtick, a dollar sign or a line break in one would break the command
 * or the JSON on somebody else's machine. Refused here rather than escaped, so what a host prints
 * is always exactly the sentence written in words.json.
 */
const UNSAFE = /["'\\`$\u0000-\u001f\u007f]/;
const refusals = [];
for (const key of ["recall", "resume", "checkpoint"]) {
  const text = words[key];
  if (typeof text !== "string" || text.trim() === "") {
    refusals.push(`source/words.json: "${key}" must be a sentence`);
  } else if (UNSAFE.test(text)) {
    refusals.push(`source/words.json: "${key}" holds ${JSON.stringify(text.match(UNSAFE)[0])}, which would break the shell command or the JSON that carries it`);
  }
}
if (!Array.isArray(words.copilot) || words.copilot.some((line) => typeof line !== "string")) {
  refusals.push(`source/words.json: "copilot" must be a list of lines`);
}
// A plugin's name becomes a folder under plugins/, so a "../" in one would write outside it.
for (const plugin of manifest.plugins) {
  if (!/^[a-z0-9-]+$/.test(plugin.name)) refusals.push(`source/manifest.json: plugin name ${JSON.stringify(plugin.name)} must be lowercase letters, digits and dashes`);
}
// The same shape the release step tags, so a version it would refuse never ships untagged.
if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(manifest.version)) {
  refusals.push(`source/manifest.json: version ${JSON.stringify(manifest.version)} must be three whole numbers, like 1.2.3`);
}
if (refusals.length > 0) {
  for (const line of refusals) process.stderr.write(`${line}\n`);
  process.exit(1);
}

// --- layout -------------------------------------------------------------------------------------

/** JSON with two-space indents; `inline` writes a list of plain values on one line. */
function layout(value, inline, depth = 0) {
  const pad = (n) => "  ".repeat(n);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (inline && value.every((item) => item === null || typeof item !== "object")) {
      return `[${value.map((item) => JSON.stringify(item)).join(", ")}]`;
    }
    const items = value.map((item) => pad(depth + 1) + layout(item, inline, depth + 1));
    return `[\n${items.join(",\n")}\n${pad(depth)}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    const items = entries.map(([key, item]) => `${pad(depth + 1)}${JSON.stringify(key)}: ${layout(item, inline, depth + 1)}`);
    return `{\n${items.join(",\n")}\n${pad(depth)}}`;
  }
  return JSON.stringify(value);
}
const json = (value, { inline = false } = {}) => `${layout(value, inline)}\n`;

// --- what a hook says ---------------------------------------------------------------------------

/** A hook that prints a JSON reply. Safe to quote with single quotes: no sentence holds one. */
const reply = (doc) => `printf %s '${JSON.stringify(doc)}'`;
/** A hook that prints the sentence itself, for the host that reads plain words. */
const plain = (sentence) => `echo "${sentence}"`;
/** The reply shape Claude Code and Codex read. */
const context = (event, sentence) => reply({ hookSpecificOutput: { hookEventName: event, additionalContext: sentence } });

const reminders = manifest.plugins.find((plugin) => plugin.carries === "reminders");
/** Where the reminders plugin sits: the host's folder variable, or Antigravity's install folder. */
const HOME_OF = (variable) => `\${${variable}:-$HOME/.gemini/config/plugins/${reminders.name}}`;
const script = (name, root = HOME_OF("CLAUDE_PLUGIN_ROOT")) => `sh "${root}/scripts/${name}"`;

/** How often a person sees the check-first reminder, by the event it is bound to. */
const CADENCE = {
  UserPromptSubmit: "every message",
  PreInvocation: "every message",
  SessionStart: "once a session",
  sessionStart: "once a session",
};

/**
 * Each reminder file, the tools that read it, the event its check-first sentence rides on, and the
 * shape its host accepts: the top-level keys it may and must hold, and the moments it answers. Every
 * host here drops a whole file over one key or moment it does not know: Codex refused this one over
 * "version", Cursor refuses its own without one, and Claude Code once loaded none of this because
 * its file carried other tools' moments.
 */
const REMINDER_FILES = [
  {
    path: "hooks/hooks.json",
    tools: ["claude-code", "codex"],
    recallOn: "SessionStart",
    shape: { may: ["hooks"], must: ["hooks"], under: "hooks", moments: ["UserPromptSubmit", "SessionStart"] },
    doc: {
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: "command", command: `DAZZER_MOMENT=with-next-message ${script("capture-sweep.sh")}` }] },
        ],
        SessionStart: [
          {
            hooks: [
              { type: "command", command: context("SessionStart", words.recall) },
              { type: "command", command: script("own-place.sh") },
            ],
          },
          { matcher: "compact", hooks: [{ type: "command", command: context("SessionStart", words.resume) }] },
        ],
      },
    },
  },
  {
    path: "hooks/cursor.json",
    tools: ["cursor"],
    recallOn: "sessionStart",
    shape: { may: ["version", "hooks"], must: ["version", "hooks"], under: "hooks", moments: ["stop", "sessionStart"] },
    doc: {
      version: 1,
      hooks: {
        stop: [{ command: script("capture-sweep.sh", "${CURSOR_PLUGIN_ROOT}") }],
        sessionStart: [{ command: reply({ additional_context: words.recall }) }],
      },
    },
  },
  {
    path: "hooks.json",
    tools: ["devin"],
    recallOn: "UserPromptSubmit",
    // No wrapper: every top-level key is a moment.
    shape: { moments: ["UserPromptSubmit", "SessionStart"] },
    doc: {
      UserPromptSubmit: [{ hooks: [{ type: "command", command: plain(words.recall) }] }],
      SessionStart: [{ matcher: "compact", hooks: [{ type: "command", command: plain(words.resume) }] }],
    },
  },
];

const ANTIGRAVITY_FILE = {
  path: "hooks.json",
  tools: ["antigravity"],
  recallOn: "PreInvocation",
  shape: { may: [reminders.name], must: [reminders.name], under: reminders.name, moments: ["PreInvocation", "Stop"] },
  doc: {
    [reminders.name]: {
      PreInvocation: [{ type: "command", command: reply({ injectSteps: [{ ephemeralMessage: words.recall }] }) }],
      Stop: [{ type: "command", command: `DAZZER_TOOL=antigravity ${script("capture-sweep.sh")}` }],
    },
  },
};

/** Copilot reads a standing instruction file, before every conversation. */
const COPILOT_CADENCE = "once a conversation";

// --- every generated file -----------------------------------------------------------------------

const files = new Map();
/** The shape each generated JSON file's host accepts, for the checks below. */
const shapes = new Map();
const emit = (path, text, shape) => {
  files.set(path, text);
  if (shape !== undefined) shapes.set(path, shape);
};
const cadence = new Map([["copilot", COPILOT_CADENCE]]);
/** The file each tool reads its reminders from, for the checks below. */
const toolFile = new Map();

const base = (plugin) => ({
  name: plugin.name,
  displayName: plugin.displayName,
  version: manifest.version,
  description: plugin.description,
  author: manifest.publisher,
  homepage: manifest.homepage,
  repository: manifest.repository,
  license: manifest.license,
  keywords: plugin.keywords,
});

/** The manifest keys every format here is known to load with. */
const BASE_KEYS = ["name", "displayName", "version", "description", "author", "homepage", "repository", "license", "keywords"];

/**
 * Each manifest format: where it is written, how it is laid out, and the keys it may hold. Only
 * Cursor's may name a hooks file: Claude Code reads a named one as well as its own, which would
 * hand it the file it must not see.
 */
const MANIFESTS = {
  claude: { paths: [".claude-plugin/plugin.json"], inline: true, may: [...BASE_KEYS, "types", "userConfig"] },
  cursor: { paths: [".cursor-plugin/plugin.json"], inline: false, may: [...BASE_KEYS, "category", "hooks"] },
  devin: { paths: [".devin-plugin/plugin.json"], inline: false, may: BASE_KEYS },
  // Antigravity reads plugin.json; the marketplace's own hosts read .claude-plugin/plugin.json.
  antigravity: { paths: ["plugin.json", ".claude-plugin/plugin.json"], inline: false, may: BASE_KEYS },
};

emit(
  ".claude-plugin/marketplace.json",
  json({
    name: manifest.marketplace,
    owner: manifest.publisher,
    plugins: manifest.plugins.map((plugin) => ({
      name: plugin.name,
      source: `./plugins/${plugin.name}`,
      description: plugin.listing,
    })),
  }),
  { may: ["name", "owner", "plugins"], must: ["name", "owner", "plugins"], home: "." },
);

for (const plugin of manifest.plugins) {
  const dir = `plugins/${plugin.name}`;

  for (const [format, extra] of Object.entries(plugin.manifests)) {
    const shape = MANIFESTS[format];
    if (shape === undefined) throw new Error(`${plugin.name}: no manifest format called "${format}"`);
    for (const path of shape.paths) {
      emit(`${dir}/${path}`, json({ ...base(plugin), ...extra }, { inline: shape.inline }), { may: shape.may, must: ["name", "version"], home: dir });
    }
  }

  const hookFiles = { reminders: REMINDER_FILES, "antigravity reminders": [ANTIGRAVITY_FILE] }[plugin.carries] ?? [];
  for (const file of hookFiles) {
    emit(`${dir}/${file.path}`, json(file.doc), file.shape && { ...file.shape, hooks: true, recallOn: file.recallOn });
    for (const tool of file.tools) {
      cadence.set(tool, CADENCE[file.recallOn]);
      toolFile.set(tool, `${dir}/${file.path}`);
    }
  }

  if (plugin.carries === "reminders") {
    files.set(`${dir}/instructions/copilot.md`, `${words.copilot.join("\n")}\n\n${words.recall}\n`);
    toolFile.set("copilot", `${dir}/instructions/copilot.md`);
    files.set(`${dir}/prompts/capture-tap.txt`, words.checkpoint);
  }

  if (plugin.carries === "connection") {
    const { name, url } = manifest.connection;
    emit(
      `${dir}/.mcp.json`,
      json({
        mcpServers: {
          [name]: {
            type: "http",
            url,
            headers: { "X-Dazzer-Distribution": "plugin", "X-Dazzer-Plugin-Version": manifest.version },
          },
        },
      }),
      { may: ["mcpServers"], must: ["mcpServers"] },
    );
  }
}

// tools.manifest.json: only the facts held here are rewritten; the rest is kept as written.
const toolsPath = "tools.manifest.json";
const tools = readJson(toolsPath);
tools.connection.url = manifest.connection.url;
tools.connection.serverName = manifest.connection.name;
for (const sentence of tools.spokenSentences) {
  if (!(sentence.id in words)) throw new Error(`${toolsPath}: no sentence "${sentence.id}" in source/words.json`);
  sentence.text = words[sentence.id];
}
for (const tool of tools.tools) {
  if (cadence.has(tool.id)) tool.recallArrives = cadence.get(tool.id);
}
files.set(toolsPath, json(tools));

// --- write, or compare --------------------------------------------------------------------------

const check = process.argv.includes("--check");
const problems = [];

// Every plugin folder is in the source, and every source plugin has its folder.
const listed = new Set(manifest.plugins.map((plugin) => plugin.name));
for (const entry of readdirSync(join(ROOT, "plugins"), { withFileTypes: true })) {
  if (entry.isDirectory() && !listed.has(entry.name)) {
    problems.push(`plugins/${entry.name} is not in source/manifest.json, so nobody can install it`);
  }
}
for (const name of listed) {
  if (!existsSync(join(ROOT, "plugins", name))) problems.push(`source/manifest.json lists ${name}, and plugins/${name} does not exist`);
}

/**
 * The files under plugins/ written by hand. Every other file there must be one this generator
 * writes, so a hook, manifest, connection or instruction file added by hand cannot ship words
 * nothing keeps current.
 */
const HAND_WRITTEN = new Set([
  "plugins/dazzer/scripts/capture-sweep.sh",
  "plugins/dazzer/scripts/own-place.sh",
  "plugins/dazzer/config/capture.defaults",
  "plugins/dazzer/skills/dazzer/SKILL.md",
  "plugins/dazzer-plate/hooks/hooks.json",
  "plugins/dazzer-plate/hooks/plate.tsx",
  "plugins/dazzer-plate/types/index.d.ts",
]);
for (const entry of readdirSync(join(ROOT, "plugins"), { recursive: true, withFileTypes: true })) {
  if (entry.isDirectory() || entry.name === ".DS_Store") continue;
  const path = relative(ROOT, join(entry.parentPath, entry.name)).split(sep).join("/");
  if (!files.has(path) && !HAND_WRITTEN.has(path)) {
    problems.push(`${path} is not written by the generator nor on its hand-written list in scripts/generate.mjs, so nothing keeps it right`);
  }
}

// --- what the files must say --------------------------------------------------------------------
// The comparison below proves each file matches its template. These prove the templates are right.

const textOf = (path) => files.get(path) ?? (existsSync(join(ROOT, path)) ? readFileSync(join(ROOT, path), "utf8") : undefined);
const parse = (path, text) => {
  try {
    return JSON.parse(text);
  } catch (error) {
    problems.push(`${path} is not JSON: ${error.message}`);
    return {};
  }
};
const valuesIn = (node, key) =>
  node === null || typeof node !== "object" ? [] : [...(typeof node[key] === "string" ? [node[key]] : []), ...Object.values(node).flatMap((child) => valuesIn(child, key))];
const stringsIn = (node) => (typeof node === "string" ? [node] : node !== null && typeof node === "object" ? Object.values(node).flatMap(stringsIn) : []);

// The plate's hooks file is written by hand and checked like the generated ones: modules only.
const PLATE = "plugins/dazzer-plate/hooks/hooks.json";
shapes.set(PLATE, { may: ["modules"], must: ["modules"], hooks: true });
const modules = parse(PLATE, textOf(PLATE) ?? "{}").modules;
if (!Array.isArray(modules) || modules.length === 0 || !modules.every((m) => typeof m === "string" && existsSync(join(ROOT, dirname(PLATE), m)))) {
  problems.push(`${PLATE} must list the plate's modules, each a file that is there`);
}

/** The moments capture-sweep.sh reads as a person's next message, by the event name the host sends. */
const NEXT_MESSAGE = ["UserPromptSubmit"];
const unmatched = (groups) => (Array.isArray(groups) ? groups.filter((group) => group?.matcher === undefined) : []);

// Every JSON file the generator writes, and the plate's, holds only what its host accepts.
for (const [path, text] of files) if (path.endsWith(".json") && path !== toolsPath && !shapes.has(path)) problems.push(`${path} has no list of the keys its host accepts`);
for (const [path, shape] of shapes) {
  const text = textOf(path);
  if (text === undefined) {
    problems.push(`${path} is missing, and its host reads no other file`);
    continue;
  }
  const doc = parse(path, text);
  const moments = (shape.under ? doc[shape.under] : doc) ?? {};
  for (const key of Object.keys(doc)) if (!(shape.may ?? shape.moments ?? []).includes(key)) problems.push(`${path} holds "${key}", which its host does not accept`);
  for (const key of shape.must ?? []) if (!(key in doc)) problems.push(`${path} has no "${key}", which its host needs`);
  if (shape.under) for (const moment of Object.keys(moments)) if (!shape.moments.includes(moment)) problems.push(`${path} answers "${moment}", a moment this file is not for`);
  // Every "./" a listing names is there.
  for (const pointer of shape.home === undefined ? [] : stringsIn(doc).filter((s) => s.startsWith("./"))) {
    if (!files.has(join(shape.home, pointer)) && !existsSync(join(ROOT, shape.home, pointer))) problems.push(`${path} points at ${pointer}, which is not there`);
  }
  if (!shape.hooks) continue;
  for (const command of valuesIn(doc, "command")) {
    if (command.includes("/scripts/") || command.includes("[Dazzer] ")) continue;
    const said = Object.keys(words).find((key) => typeof words[key] === "string" && command.includes(words[key]));
    problems.push(`${path} speaks ${said ? `the "${said}" sentence` : command.slice(0, 60)} without the [Dazzer] mark`);
  }
  // The check-first sentence rides the moment recallOn names, since its cadence is read from there.
  if (shape.recallOn && !valuesIn(unmatched(moments[shape.recallOn]), "command").some((c) => c.includes(words.recall))) {
    problems.push(`${path} does not speak the check-first sentence at ${shape.recallOn}, where its recallOn says it rides`);
  }
  // A checkpoint at the next message names the chat's thread, and only own-place.sh tells the model
  // that thread: at the start of a chat, in the group with no matcher, which also runs after a reset.
  const nextMessage = Object.entries(moments).some(([moment, groups]) =>
    valuesIn(groups, "command").some((c) => /\bcapture-sweep\.sh\b/.test(c) && (NEXT_MESSAGE.includes(moment) || /DAZZER_MOMENT=["']?with-next-message/.test(c))),
  );
  const start = Object.entries(moments).find(([moment]) => moment.toLowerCase() === "sessionstart")?.[1];
  if (nextMessage && !valuesIn(unmatched(start), "command").some((c) => /\bown-place\.sh\b/.test(c))) problems.push(`${path} names the chat's thread at each checkpoint and never runs own-place.sh when a chat starts`);
}

// Each tool's file carries exactly the reminders tools.manifest.json says arrive there.
const CARRIES = {
  recall: (text) => text.includes(words.recall),
  resume: (text) => text.includes(words.resume),
  capture: (text) => /\bcapture-sweep\.sh\b/.test(text),
};
for (const tool of tools.tools) {
  if (typeof tool.describedAs !== "string" || tool.describedAs.trim() === "") problems.push(`${toolsPath}: ${tool.id} has no describedAs, so a screen naming it cannot say what it is`);
  if (tool.status !== "supported") continue;
  const path = toolFile.get(tool.id);
  const text = (path && textOf(path)) ?? "";
  for (const [id, carries] of Object.entries(CARRIES)) {
    const promised = ["works", "works-but-visible"].includes(tool.reminders?.[id]);
    if (promised !== carries(text)) problems.push(`${path ?? tool.id}: ${toolsPath} says ${tool.id}'s ${id} reminder is "${tool.reminders?.[id]}", and the file ${promised ? "does not carry it" : "carries it"}`);
  }
}

for (const [path, text] of files) {
  const full = join(ROOT, path);
  const current = existsSync(full) ? readFileSync(full, "utf8") : undefined;
  if (current === text) continue;
  if (check) {
    problems.push(`${path} ${current === undefined ? "is missing" : "differs from what the generator writes"}`);
  } else {
    writeFileSync(full, text);
    process.stdout.write(`wrote ${path}\n`);
  }
}

if (problems.length > 0) {
  process.stdout.write(`FAIL generated\n${problems.map((line) => `  ${line}`).join("\n")}\n`);
  if (check) process.stdout.write("  Fix what is named (most often in source/), then run: node scripts/generate.mjs\n");
  process.exit(1);
}
process.stdout.write(check ? `ok   generated (${files.size} files match source/)\n` : `${files.size} files match source/\n`);
