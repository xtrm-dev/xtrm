// XTRM-745 guard: pi-ai stopped re-exporting TypeBox in pi 1.5.0
// (`pi-coding-agent` CHANGELOG 1.5.0: "now that pi-ai itself no longer
// re-exports TypeBox"). Importing `Type` from `@earendil-works/pi-ai` still
// works inside pi through loader aliasing, but fails under plain Node with
// `SyntaxError: The requested module '@earendil-works/pi-ai' does not provide
// an export named 'Type'`. TypeBox is imported from `typebox` instead.
//
// The scan covers the repository except experiments/, which is out of scope.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

// Vitest runs from packages/xtrm-app; two levels up is the repository root.
const REPO_ROOT = resolve(process.cwd(), "..", "..");
const SCANNED_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git", "experiments", "dist", "build"]);

/** Matches an import or re-export whose module specifier is pi-ai. */
const PI_AI_STATEMENT = /(?:^|\n)[ \t]*(?:import|export)\b[\s\S]*?from\s*["'](@earendil-works\/pi-ai(?:\/[^"']*)?)["']/g;

/** Whether a statement's named binding list includes `Type`. */
function bindsType(statement: string): boolean {
  const named = /\{([\s\S]*?)\}/.exec(statement);
  if (!named?.[1]) return false;
  return named[1]
    .split(",")
    .map((binding) => binding.trim().replace(/^type\s+/, ""))
    .some((binding) => /^Type\b/.test(binding));
}

/** Every pi-ai `Type` binding in one file, as `line: statement` findings. */
export function findPiAiTypeImports(source: string): string[] {
  const findings: string[] = [];
  for (const match of source.matchAll(PI_AI_STATEMENT)) {
    if (!bindsType(match[0])) continue;
    const line = source.slice(0, match.index ?? 0).split("\n").length;
    findings.push(`line ${line}: ${match[0].trim().split("\n")[0]}`);
  }
  return findings;
}

function sourceFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      sourceFiles(join(dir, entry.name), files);
    } else if (SCANNED_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      files.push(join(dir, entry.name));
    }
  }
  return files;
}

describe("pi-ai Type import guard (XTRM-745)", () => {
  it("detects the import form it forbids", () => {
    const oldImport = 'import { Type } from "@earendil-works/pi-ai";';
    expect(findPiAiTypeImports(oldImport)).toHaveLength(1);

    const aliased = 'import { Type as TSchema } from "@earendil-works/pi-ai";';
    expect(findPiAiTypeImports(aliased)).toHaveLength(1);

    const reExport = 'export { Type } from "@earendil-works/pi-ai";';
    expect(findPiAiTypeImports(reExport)).toHaveLength(1);
  });

  it("accepts the typebox import and type-only pi-ai imports", () => {
    expect(findPiAiTypeImports('import { Type } from "typebox";')).toEqual([]);
    expect(findPiAiTypeImports('import type { Usage } from "@earendil-works/pi-ai";')).toEqual([]);
    expect(findPiAiTypeImports('import { StringEnum } from "@earendil-works/pi-ai";')).toEqual([]);
  });

  it("finds no pi-ai Type import outside experiments/", () => {
    // A wrong working directory must fail loudly instead of scanning nothing.
    expect(existsSync(join(REPO_ROOT, "packages", "xtrm-app", "package.json"))).toBe(true);
    const files = sourceFiles(REPO_ROOT);
    expect(files.length).toBeGreaterThan(100);

    const violations = files.flatMap((file) =>
      findPiAiTypeImports(readFileSync(file, "utf8")).map(
        (finding) => `${relative(REPO_ROOT, file)} ${finding}`,
      ),
    );
    expect(violations, "import Type from typebox, not from @earendil-works/pi-ai").toEqual([]);
  });

  it("scans the real-host probe extension that XTRM-745 fixed", () => {
    const probe = join(REPO_ROOT, "packages", "xtrm-app", "e2e", "real-host", "probe-extension.ts");
    const source = readFileSync(probe, "utf8");
    expect(findPiAiTypeImports(source)).toEqual([]);
    expect(source).toMatch(/import \{ Type \} from "typebox";/);
  });
});
