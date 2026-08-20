import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { defaultConfig, readConfig, writeConfig } from "../src/config.mjs";

async function withTempConfig(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "xts-config-"));
  const prevDir = process.env.XTS_CONFIG_DIR;
  process.env.XTS_CONFIG_DIR = dir;
  try {
    await run(path.join(dir, "xts.json"));
  } finally {
    if (prevDir === undefined) delete process.env.XTS_CONFIG_DIR;
    else process.env.XTS_CONFIG_DIR = prevDir;
  }
}

test("config defaults", () => {
  assert.deepEqual(defaultConfig(), { model: null });
});

test("missing file reads as default", async () => {
  await withTempConfig(async () => {
    assert.deepEqual(await readConfig(), { model: null });
  });
});

test("corrupt file reads as default", async () => {
  await withTempConfig(async (file) => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(file, "{ not json", "utf8");
    assert.deepEqual(await readConfig(), { model: null });
  });
});

test("write then read round-trips the model", async () => {
  await withTempConfig(async () => {
    const config = { model: { provider: "test-provider", id: "test-model" } };
    await writeConfig(config);
    assert.deepEqual(await readConfig(), config);
  });
});

test("write creates the config dir with mode 0700", async () => {
  await withTempConfig(async (file) => {
    await writeConfig({ model: null });
    const dirStat = await stat(path.dirname(file));
    assert.equal(dirStat.mode & 0o777, 0o700);
    const { readFile } = await import("node:fs/promises");
    assert.equal(await readFile(file, "utf8"), '{\n  "model": null\n}\n');
  });
});
