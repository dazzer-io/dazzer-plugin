#!/usr/bin/env node
/**
 * @purpose Keeps every shipped connection pointed at an address we own and control,
 * because the first release shipped a hosting-generated hostname. Every install would
 * have baked in one provider, one project and one region, and any move would have
 * broken every copy in the field with no way to reach them.
 *
 * Guards commit a33a129, generalised from that one hostname to the class of them.
 */

import { REPO_ROOT, readJson, rel, runGate, walk } from "./lib/gate.mjs";

/** Hosts we own. A shipped connection must be under one of these. */
const OWNED_SUFFIXES = [".dazzer.io"];

/**
 * Shapes that mean "a hosting provider generated this for us". Matching one is the
 * failure the original incident was made of, so they are named rather than inferred.
 */
const GENERATED = [
  { pattern: /\.run\.app$/i, what: "a container-hosting generated hostname" },
  { pattern: /\.cloudfunctions\.net$/i, what: "a serverless-function generated hostname" },
  { pattern: /\.vercel\.app$/i, what: "a preview-deployment generated hostname" },
  { pattern: /\.web\.app$|\.firebaseapp\.com$/i, what: "a static-hosting generated hostname" },
  { pattern: /\.ngrok(-free)?\.(io|app|dev)$/i, what: "a tunnel hostname" },
  { pattern: /^(\d{1,3}\.){3}\d{1,3}$/, what: "a bare IP address" },
  { pattern: /^localhost$|\.local$/i, what: "a local-only address" },
];

/** Every string value anywhere in this JSON that looks like a URL. */
function urlsIn(value, out = []) {
  if (typeof value === "string") {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) out.push(value);
  } else if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) urlsIn(child, out);
  }
  return out;
}

runGate({
  id: "connection-address",
  purpose: "Shipped connections point at an address we own, never one a host generated.",
  rule: `every shipped connection URL must be https and end in ${OWNED_SUFFIXES.join(" or ")}`,
  assert(findings) {
    for (const file of walk(REPO_ROOT)) {
      if (!file.endsWith(".mcp.json")) continue;

      const parsed = readJson(file, findings);
      if (parsed === undefined) continue;

      for (const raw of urlsIn(parsed)) {
        const where = { file: rel(file) };
        let url;
        try {
          url = new URL(raw);
        } catch {
          findings.push({ ...where, message: `"${raw}" is not a usable address` });
          continue;
        }

        if (url.protocol !== "https:") {
          findings.push({ ...where, message: `${raw} is not https; a shipped connection must be encrypted` });
        }

        const generated = GENERATED.find((g) => g.pattern.test(url.hostname));
        if (generated) {
          findings.push({
            ...where,
            message:
              `${url.hostname} is ${generated.what}. Every install would bake in one provider and ` +
              `region, and moving would break every copy in the field (commit a33a129). ` +
              `Use an address we own.`,
          });
          continue;
        }

        if (!OWNED_SUFFIXES.some((suffix) => url.hostname.endsWith(suffix))) {
          findings.push({
            ...where,
            message: `${url.hostname} is not an address we own (expected one ending in ${OWNED_SUFFIXES.join(" or ")})`,
          });
        }
      }
    }
  },
});
