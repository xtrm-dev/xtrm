// Writes the package version into the Claude plugin manifest (XTRM-640).
//
// Claude Code detects a plugin update by its version string: a changed plugin
// with an unchanged plugin.json version is never redelivered. plugin.json must
// therefore move with package.json. Wired as the npm `version` lifecycle script,
// so `npm version <x>` keeps them equal. tests/marketplace-distribution.test.ts
// fails when they differ.
//
// Replaces the version value in place so the manifest keeps its formatting.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const file = join(root, "plugin", "substrate", ".claude-plugin", "plugin.json");
const text = readFileSync(file, "utf8");
const pattern = /("version"\s*:\s*)"[^"]*"/;
if (!pattern.test(text)) throw new Error(`sync-plugin-version: no "version" key in ${file}`);
writeFileSync(file, text.replace(pattern, `$1"${version}"`));
console.log(`plugin.json version = ${version}`);
