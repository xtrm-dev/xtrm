// Module resolution seam for the packaged plugin (bead xtrm-iip.1, closeout E1).
//
// The plugin must load from a directory OUTSIDE the xtrm checkout, where a
// relative path like ../../../integrations/claude-code/ resolves to nothing.
// Resolution order, first hit wins:
//
//   1. SUBSTRATE_HOME          operator override; the substrate package root
//   2. @jaggerxtrm/substrate         installed package (normal deployment)
//   3. repo-relative           running from inside the xtrm checkout (dev)
//
// Only substrate's own modules resolve through here. The plugin deliberately
// does NOT resolve substrate's dependencies: the MCP SDK is imported by
// mcp-server.ts alone, so there is exactly one SDK instance. An earlier version
// of this seam resolved @modelcontextprotocol/server/stdio itself, hit the CJS
// condition (dist/stdio.cjs) while mcp-server.ts imports dist/stdio.mjs, and
// produced two instances whose cross-checks failed at runtime. See
// scripts/substrate-mcp.ts.

const REPO_RELATIVE = "../../../";

async function tryImport(specifier) {
  try {
    return await import(specifier);
  } catch {
    return null;
  }
}

function dirUrl(path) {
  return `file://${path.replace(/\/?$/, "/")}`;
}

// Resolved once and reused, so every module comes from the same installation.
let root = null;

async function resolveRoot() {
  if (root) return root;

  const home = process.env["SUBSTRATE_HOME"];
  if (home) {
    const base = dirUrl(home);
    if (await tryImport(new URL("integrations/claude-code/runtime.ts", base).href)) {
      root = { base };
      return root;
    }
  }

  if (await tryImport("@jaggerxtrm/substrate/integrations/claude-code/runtime.ts")) {
    root = { base: "@jaggerxtrm/substrate/", package: true };
    return root;
  }

  const local = new URL(REPO_RELATIVE, import.meta.url).href;
  if (await tryImport(new URL("integrations/claude-code/runtime.ts", local).href)) {
    root = { base: local };
    return root;
  }

  throw new Error(
    "substrate plugin: cannot locate the @jaggerxtrm/substrate package. " +
      "Set SUBSTRATE_HOME to its root, or install @jaggerxtrm/substrate where the plugin runs.",
  );
}

/**
 * Load one module from the Claude integration surface.
 * @param {string} file e.g. "runtime.ts", "precompact.ts", "mcp-server.ts"
 */
export async function resolveSubstrate(file) {
  const r = await resolveRoot();
  const specifier = r.package ? `@jaggerxtrm/substrate/integrations/claude-code/${file}` : new URL(`integrations/claude-code/${file}`, r.base).href;
  const mod = await tryImport(specifier);
  if (!mod) throw new Error(`substrate plugin: cannot resolve integrations/claude-code/${file}`);
  return mod;
}
