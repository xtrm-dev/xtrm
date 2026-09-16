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

// A package root holds either the TypeScript sources (a checkout, or
// SUBSTRATE_HOME pointing at one) or the compiled emit (an installed copy,
// where Node refuses to strip types under node_modules). Probe both layouts and
// keep the winner, so the emitted module path is used only when it exists.
const LAYOUTS = ["integrations/claude-code/runtime.ts", "dist/integrations/claude-code/runtime.js"];

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

async function probe(base, isPackage) {
  for (const layout of LAYOUTS) {
    const specifier = isPackage ? `@jaggerxtrm/substrate/${layout}` : new URL(layout, base).href;
    if (await tryImport(specifier)) {
      return { base, package: isPackage, dir: layout.replace(/runtime\.(ts|js)$/, "") };
    }
  }
  return null;
}

async function resolveRoot() {
  if (root) return root;

  const home = process.env["SUBSTRATE_HOME"];
  if (home) {
    const hit = await probe(dirUrl(home), false);
    if (hit) {
      root = hit;
      return root;
    }
  }

  const installed = await probe(null, true);
  if (installed) {
    root = installed;
    return root;
  }

  const hit = await probe(new URL(REPO_RELATIVE, import.meta.url).href, false);
  if (hit) {
    root = hit;
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
  // Callers name source files; an installed copy answers with its emit.
  const name = r.dir.startsWith("dist/") ? file.replace(/\.ts$/, ".js") : file;
  const specifier = r.package ? `@jaggerxtrm/substrate/${r.dir}${name}` : new URL(`${r.dir}${name}`, r.base).href;
  const mod = await tryImport(specifier);
  if (!mod) throw new Error(`substrate plugin: cannot resolve ${r.dir}${name}`);
  return mod;
}
