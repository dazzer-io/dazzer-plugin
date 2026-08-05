#!/usr/bin/env node
/**
 * @purpose Keeps the address we TELL people to connect to agreeing with the address we
 * actually ship. They are written in two files by hand, and the existing address gate does
 * not compare them - it asks whether each URL is encrypted and one of ours, which both
 * would still be after a move that changed only one of them.
 *
 * What that costs: setup instructions send someone to one place while the shipped
 * connection points at another, and every check stays green. Nobody finds out until a
 * person follows the instructions and reaches nothing.
 *
 * SCOPE, deliberately: this compares only files this repository owns. The same address is
 * also written in the dashboard, twice - its own copy of this manifest and the address it
 * authenticates against - and those cannot be seen from here. That four-way comparison
 * belongs where all four are visible, which is the dashboard, not here. Reaching across
 * the network for them would make somebody else's outage into a failing build.
 */

import { join } from "node:path";
import { REPO_ROOT, readJson, rel, runGate } from "./lib/gate.mjs";

const MANIFEST = join(REPO_ROOT, "tools.manifest.json");
const SHIPPED = join(REPO_ROOT, "plugins", "dazzer-connect", ".mcp.json");

runGate({
  id: "address-parity",
  purpose: "The address in the instructions is the address we ship.",
  rule: "the manifest's connection address and server name match the shipped connection",
  assert(findings) {
    const manifest = readJson(MANIFEST, findings);
    const shipped = readJson(SHIPPED, findings);
    if (manifest === undefined || shipped === undefined) return;

    const declared = manifest.connection;
    if (declared === null || typeof declared !== "object") {
      findings.push({ file: rel(MANIFEST), message: "no connection block; nothing states where to connect" });
      return;
    }

    const servers = shipped.mcpServers ?? {};
    const names = Object.keys(servers);

    if (names.length !== 1) {
      findings.push({
        file: rel(SHIPPED),
        message: `ships ${names.length} connections (${names.join(", ") || "none"}); the manifest names exactly one, so a reader cannot tell which is meant`,
      });
      return;
    }

    const [shippedName] = names;
    const shippedUrl = servers[shippedName]?.url;

    if (declared.serverName !== shippedName) {
      findings.push({
        file: rel(MANIFEST),
        message: `calls the connection "${declared.serverName}" but we ship it as "${shippedName}". Anyone told to look for the first will not find it.`,
      });
    }

    if (declared.url !== shippedUrl) {
      findings.push({
        file: rel(MANIFEST),
        message: `sends people to ${declared.url} but we ship ${shippedUrl}. One of these reaches nothing.`,
      });
    }
  },
});
