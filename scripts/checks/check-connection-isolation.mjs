#!/usr/bin/env node
/**
 * @purpose Keeps the behaviour half of the plugin free of any connection of its own,
 * because bundling one displaced a user's already-signed-in connection with an
 * unauthenticated one and their memory went dark until they noticed. Installing the
 * reminders must never be able to disturb a connection that already works.
 *
 * Guards commit 3c6fe7a. Re-adding a connection under plugins/dazzer - even "just for
 * telemetry" - reintroduces that outage, which is why this is mechanical and not a note.
 */

import { basename, join } from "node:path";
import { REPO_ROOT, readJson, rel, runGate, walk } from "./lib/gate.mjs";

/** The one plugin allowed to carry a connection. Everything else must carry none. */
const CONNECTION_OWNER = "dazzer-connect";

/** True if any object anywhere in this JSON declares MCP servers. */
function declaresServers(value) {
  if (value === null || typeof value !== "object") return false;
  if (!Array.isArray(value) && Object.hasOwn(value, "mcpServers")) return true;
  return Object.values(value).some(declaresServers);
}

/** The plugin directory a file belongs to, or undefined if it is outside plugins/. */
function owningPlugin(file) {
  const parts = rel(file).split("/");
  return parts[0] === "plugins" && parts.length > 2 ? parts[1] : undefined;
}

runGate({
  id: "connection-isolation",
  purpose: "Only the connection plugin may declare a connection.",
  rule: `only plugins/${CONNECTION_OWNER} may declare a connection; the behaviour plugin must declare none`,
  assert(findings) {
    for (const file of walk(join(REPO_ROOT, "plugins"))) {
      if (!file.endsWith(".json")) continue;

      const owner = owningPlugin(file);
      if (owner === undefined || owner === CONNECTION_OWNER) continue;

      const named = basename(file) === ".mcp.json";
      const parsed = named ? undefined : readJson(file, []);

      if (named || declaresServers(parsed)) {
        findings.push({
          file: rel(file),
          message:
            `plugins/${owner} declares a connection. A bundled connection carries its own ` +
            `sign-in, so installing this would replace a working connection with an ` +
            `unauthenticated one (the outage fixed by commit 3c6fe7a). Move it to ` +
            `plugins/${CONNECTION_OWNER}.`,
        });
      }
    }
  },
});
