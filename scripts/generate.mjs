#!/usr/bin/env node
/**
 * Writes every per-tool file from two sources: source/manifest.json (the version, the plugins and
 * what each tool's manifest adds) and source/words.json (every sentence the plugin says).
 *
 *   node scripts/generate.mjs           write every generated file
 *   node scripts/generate.mjs --check   write nothing; exit 1 naming each file that differs
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

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(process.env.DAZZER_REPO_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), ".."));
const readJson = (path) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));

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

/** Each reminder file, the tools that read it, and the event its check-first sentence rides on. */
const REMINDER_FILES = [
  {
    path: "hooks/hooks.json",
    tools: ["claude-code", "codex"],
    recallOn: "SessionStart",
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
const cadence = new Map([["copilot", COPILOT_CADENCE]]);

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

/** Each manifest format: where it is written and how it is laid out. */
const MANIFESTS = {
  claude: { paths: [".claude-plugin/plugin.json"], inline: true },
  cursor: { paths: [".cursor-plugin/plugin.json"], inline: false },
  devin: { paths: [".devin-plugin/plugin.json"], inline: false },
  // Antigravity reads plugin.json; the marketplace's own hosts read .claude-plugin/plugin.json.
  antigravity: { paths: ["plugin.json", ".claude-plugin/plugin.json"], inline: false },
};

files.set(
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
);

for (const plugin of manifest.plugins) {
  const dir = `plugins/${plugin.name}`;

  for (const [format, extra] of Object.entries(plugin.manifests)) {
    const shape = MANIFESTS[format];
    if (shape === undefined) throw new Error(`${plugin.name}: no manifest format called "${format}"`);
    for (const path of shape.paths) files.set(`${dir}/${path}`, json({ ...base(plugin), ...extra }, { inline: shape.inline }));
  }

  const hookFiles = { reminders: REMINDER_FILES, "antigravity reminders": [ANTIGRAVITY_FILE] }[plugin.carries] ?? [];
  for (const file of hookFiles) {
    files.set(`${dir}/${file.path}`, json(file.doc));
    for (const tool of file.tools) cadence.set(tool, CADENCE[file.recallOn]);
  }

  if (plugin.carries === "reminders") {
    files.set(`${dir}/instructions/copilot.md`, `${words.copilot.join("\n")}\n\n${words.recall}\n`);
    files.set(`${dir}/prompts/capture-tap.txt`, words.checkpoint);
  }

  if (plugin.carries === "connection") {
    const { name, url } = manifest.connection;
    files.set(
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
  if (check) process.stdout.write("  Change source/ and run: node scripts/generate.mjs\n");
  process.exit(1);
}
process.stdout.write(check ? `ok   generated (${files.size} files match source/)\n` : `${files.size} files match source/\n`);
