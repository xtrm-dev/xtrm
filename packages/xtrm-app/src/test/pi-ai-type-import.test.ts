// XTRM-745 guard: pi-ai stopped re-exporting TypeBox in pi 1.5.0
// (`pi-coding-agent` CHANGELOG 1.5.0: "now that pi-ai itself no longer
// re-exports TypeBox"). Importing `Type` from `@earendil-works/pi-ai` still
// works inside pi through loader aliasing, but fails under plain Node with
// `SyntaxError: The requested module '@earendil-works/pi-ai' does not provide
// an export named 'Type'`. TypeBox is imported from `typebox` instead.
//
// The scan parses each file with the TypeScript compiler API, so a match is one
// import/export declaration and never spans statements. Scope: named bindings in
// static `import ... from` and `export ... from` declarations, including type-only
// and aliased forms. Not covered: namespace imports (`import * as`) and member
// access (`X.Type`), `export * from`, CommonJS `require()`, and dynamic
// `import()`. Those do not appear in the repository today; add a shape here
// before introducing one.
//
// The scan covers the repository except experiments/, which is out of scope.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

// Vitest runs from packages/xtrm-app; two levels up is the repository root.
const REPO_ROOT = resolve(process.cwd(), "..", "..");
const SCANNED_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git", "experiments", "dist", "build"]);
const PI_AI_PACKAGE = "@earendil-works/pi-ai";

const SCRIPT_KINDS: Record<string, ts.ScriptKind> = {
  ".ts": ts.ScriptKind.TS,
  ".tsx": ts.ScriptKind.TSX,
  ".mts": ts.ScriptKind.TS,
  ".cts": ts.ScriptKind.TS,
  ".js": ts.ScriptKind.JS,
  ".jsx": ts.ScriptKind.JSX,
  ".mjs": ts.ScriptKind.JS,
  ".cjs": ts.ScriptKind.JS,
};

function isPiAiSpecifier(specifier: string): boolean {
  return specifier === PI_AI_PACKAGE || specifier.startsWith(`${PI_AI_PACKAGE}/`);
}

/** The imported name of a named binding: `Type` and `Type as T` both yield `Type`. */
function importedName(element: ts.ImportSpecifier | ts.ExportSpecifier): string {
  return (element.propertyName ?? element.name).text;
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0] ?? "";
}

/**
 * Every pi-ai `Type` binding in one file, as `line N: statement` findings.
 * `fileName` only selects the parser mode; it is not read.
 */
export function findPiAiTypeImports(fileName: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    SCRIPT_KINDS[extname(fileName)] ?? ts.ScriptKind.TS,
  );
  const findings: string[] = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (!specifier || !ts.isStringLiteral(specifier) || !isPiAiSpecifier(specifier.text)) continue;

    const named = ts.isImportDeclaration(statement)
      ? statement.importClause?.namedBindings
      : statement.exportClause;
    if (!named || !ts.isNamedImports(named) && !ts.isNamedExports(named)) continue;

    for (const element of named.elements) {
      if (importedName(element) !== "Type") continue;
      const line = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1;
      findings.push(`line ${line}: ${firstLine(statement.getText(sourceFile))}`);
      break;
    }
  }

  return findings;
}

function sourceFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      sourceFiles(join(dir, entry.name), files);
    } else if (SCANNED_EXTENSIONS.has(extname(entry.name))) {
      files.push(join(dir, entry.name));
    }
  }
  return files;
}

describe("pi-ai Type import guard (XTRM-745)", () => {
  it("detects the forbidden import after other imports (pre-#358 substrate block)", () => {
    const preSubstrateFix = [
      'import { homedir } from "node:os";',
      'import { join } from "node:path";',
      'import { Type, type Usage } from "@earendil-works/pi-ai";',
      "",
      "export const root = join(homedir(), \"x\");",
    ].join("\n");
    expect(findPiAiTypeImports("extension.ts", preSubstrateFix)).toEqual([
      'line 3: import { Type, type Usage } from "@earendil-works/pi-ai";',
    ]);
  });

  it("detects the forbidden import directly after another import statement", () => {
    const source = [
      'import { join } from "node:path";',
      'import { Type } from "@earendil-works/pi-ai";',
    ].join("\n");
    expect(findPiAiTypeImports("probe.ts", source)).toEqual([
      'line 2: import { Type } from "@earendil-works/pi-ai";',
    ]);
  });

  it("detects aliased, type-only and re-exported bindings", () => {
    expect(findPiAiTypeImports("a.ts", 'import { Type as TSchema } from "@earendil-works/pi-ai";'))
      .toHaveLength(1);
    expect(findPiAiTypeImports("a.ts", 'import { type Type } from "@earendil-works/pi-ai";'))
      .toHaveLength(1);
    expect(findPiAiTypeImports("a.ts", 'export { Type } from "@earendil-works/pi-ai";'))
      .toHaveLength(1);
    expect(findPiAiTypeImports("a.ts", 'export { type Type } from "@earendil-works/pi-ai/esm";'))
      .toHaveLength(1);
  });

  it("accepts the typebox import followed by a type-only pi-ai import", () => {
    const falsePositivePair = [
      'import { Type } from "typebox";',
      'import type { Usage } from "@earendil-works/pi-ai";',
      "",
      "export type Cost = Usage;",
    ].join("\n");
    expect(findPiAiTypeImports("a.ts", falsePositivePair)).toEqual([]);
  });

  it("accepts other pi-ai bindings and code-adjacent text", () => {
    expect(findPiAiTypeImports("a.ts", 'import { StringEnum } from "@earendil-works/pi-ai";')).toEqual([]);
    expect(
      findPiAiTypeImports(
        "a.ts",
        [
          "// import { Type } from \"@earendil-works/pi-ai\";",
          'const s = "import { Type } from \\"@earendil-works/pi-ai\\"";',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("finds no pi-ai Type import outside experiments/", () => {
    // A wrong working directory must fail loudly instead of scanning nothing.
    expect(existsSync(join(REPO_ROOT, "packages", "xtrm-app", "package.json"))).toBe(true);
    const files = sourceFiles(REPO_ROOT);
    expect(files.length).toBeGreaterThan(100);

    const violations = files.flatMap((file) =>
      findPiAiTypeImports(file, readFileSync(file, "utf8")).map(
        (finding) => `${relative(REPO_ROOT, file)} ${finding}`,
      ),
    );
    expect(violations, "import Type from typebox, not from @earendil-works/pi-ai").toEqual([]);
    // The scan parses every source file in the monorepo; on a loaded CI runner it
    // measured 16 s against the 5 s default and failed the gate at random (XTRM-863).
  }, 30_000);

  it("scans the real-host probe extension that XTRM-745 fixed", () => {
    const probe = join(REPO_ROOT, "packages", "xtrm-app", "e2e", "real-host", "probe-extension.ts");
    const source = readFileSync(probe, "utf8");
    expect(findPiAiTypeImports(probe, source)).toEqual([]);
    expect(source).toMatch(/import \{ Type \} from "typebox";/);
  });
});
