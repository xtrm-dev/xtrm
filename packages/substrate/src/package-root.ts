import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Absolute path of the @jaggerxtrm/substrate package root.
 *
 * Resolved by walking up from this module to the nearest directory that holds
 * a package.json, so one call site is correct in both shipped layouts: the
 * TypeScript source checkout (`cli/`, `integrations/`) and the compiled emit
 * (`dist/cli/`, `dist/integrations/`).
 *
 * Depth-relative lookups are not. `join(dirname(import.meta.url), "..")` points
 * at the package root only while the file stays at its source depth; the same
 * expression in dist/ resolves one level short and silently finds nothing, so
 * the version string degrades and `sb init` cannot locate the plugin.
 */
export function packageRoot(from: string = import.meta.url): string {
  let dir = dirname(fileURLToPath(from));
  for (;;) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return dir;
    dir = parent;
  }
}
