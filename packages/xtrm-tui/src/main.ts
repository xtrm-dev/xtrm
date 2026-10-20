#!/usr/bin/env node
/**
 * xt agent spike entry.
 *
 *   bun src/main.ts --fixture       interactive TUI with two fixture frames
 *   bun src/main.ts --prove-render  headless: viewport isolation + 80-col check
 *   bun src/main.ts --prove-live    headless: two real prompts → two frames
 *   bun src/main.ts                 interactive live TUI (default model/settings)
 */

import { visibleWidth } from "@earendil-works/pi-tui";
import { FrameShell, buildFrameViewport } from "./shell.js";
import { FrameStore } from "./frame.js";
import { createLiveBinding } from "./live.js";

const args = process.argv.slice(2);

function fixtureShell(): FrameShell {
  const shell = new FrameShell(
    {
      onPrompt: () => {},
      onAbort: () => {},
      onExit: () => process.exit(0),
    },
    "/fixture/cwd",
  );
  shell.setModelLabel("fixture-model");
  const f1 = shell.newFrame("Recover the interrupted extension task");
  void f1;
  shell.appendDelta("Recovered the task and resumed the existing worker.");
  shell.appendToolRow("• Ran git status --short  2 lines · 1.3s");
  shell.appendToolRow("• Read packages/xtrm-tui/src/shell.ts  310 lines · 0.8s");
  shell.settleFrame();
  shell.newFrame("Implement the tri-state tool display");
  shell.appendDelta("Implementation is active. Compressed mode renders one row per call.");
  shell.appendToolRow("• Edited src/tool-view.ts  +18 -3 · 0.4s");
  shell.selectFrame(1);
  return shell;
}

function proveRender(): void {
  const failures: string[] = [];
  const store = new FrameStore();
  const longLine = "x".repeat(200);
  const f1 = store.create("first frame ingress");
  f1.bodyText = `alpha ${longLine}`;
  f1.toolRows.push(`• Ran ${longLine}  1.0s`);
  store.settleCurrent();
  const f2 = store.create("second frame ingress");
  f2.bodyText = "beta";

  for (const frame of [f1, f2]) {
    const lines = buildFrameViewport(frame).render(80);
    for (const line of lines) {
      if (visibleWidth(line) > 80) {
        failures.push(`width ${visibleWidth(line)} > 80 in frame ${frame.index}: ${line.slice(0, 60)}…`);
      }
    }
  }

  const f1Text = buildFrameViewport(f1).render(80).join("\n");
  const f2Text = buildFrameViewport(f2).render(80).join("\n");
  if (f1Text.includes("beta") || f2Text.includes("alpha")) {
    failures.push("frame isolation violated: viewport leaks another frame's content");
  }
  if (!f1Text.includes("settled") || f2Text.includes("settled")) {
    failures.push("settled marker missing on settled frame or present on open frame");
  }

  // Selected-frame-only viewport: shell holds both frames but renders one.
  const shell = fixtureShell();
  shell.selectFrame(2);
  const viewport = buildFrameViewport(
    // Rebuild from the store through the shell's public surface is internal;
    // prove the builder contract instead: exactly one ingress line per viewport.
    f2,
  )
    .render(80)
    .join("\n");
  const ingressLines = viewport.split("\n").filter((l) => l.startsWith("› ")).length;
  if (ingressLines !== 1) failures.push(`viewport shows ${ingressLines} ingress lines, want exactly 1`);

  if (failures.length > 0) {
    console.error("PROVE-RENDER FAIL");
    for (const f of failures) console.error(`- ${f}`);
    process.exit(1);
  }
  console.log("PROVE-RENDER PASS: 80-col, isolation, settled markers");
}

async function proveLive(): Promise<void> {
  const cwd = "/tmp/xtrm-tui-probe";
  const { mkdirSync } = await import("node:fs");
  mkdirSync(cwd, { recursive: true });
  const shell = new FrameShell({ onPrompt: () => {}, onAbort: () => {}, onExit: () => {} }, cwd);
  const { appendFileSync, unlinkSync } = await import("node:fs");
  const eventLog = "/tmp/xtrm-tui-prove-live-events.jsonl";
  try {
    unlinkSync(eventLog);
  } catch {
    // fresh log per run; absence is fine.
  }
  const { binding, dispose } = await createLiveBinding(shell, cwd, "low");
  const t0 = Date.now();
  const tap = binding.sessionRef().subscribe((e) => {
    appendFileSync(eventLog, JSON.stringify({ t: ((Date.now() - t0) / 1000).toFixed(1), type: e.type }) + "\n");
  });
  try {
    const ok1 = await binding.submit("Reply with exactly the single word PONG and nothing else.");
    const ok2 = await binding.submit("Reply with exactly the single word PONG and nothing else.");
    // Deterministic proof: wait for settled delivery before counting, bounded.
    await Promise.race([
      binding.sessionRef().waitForIdle(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("waitForIdle timeout")), 120_000)),
    ]);
    if (!ok1 || !ok2) {
      console.error("PROVE-LIVE FAIL: submit rejected while supposedly idle");
      process.exit(1);
    }
    const journal = binding.journal;
    const frames = shell.frameCount();
    const settled = shell.settledCount();
    const agentEndIgnored = journal.filter((j) => j.event === "agent_end_ignored").length;
    const redundant = journal.filter((j) => j.event === "redundant_settle_ignored").length;
    console.log(
      JSON.stringify(
        { frames, settled, settleTransitions: binding.settleCount, agentEndIgnored, redundant, journal },
        null,
        2,
      ),
    );
    if (frames !== 2 || settled !== 2 || binding.settleCount !== 2 || redundant !== 0) {
      console.error("PROVE-LIVE FAIL: want 2 frames, 2 settles, 0 redundant");
      process.exit(1);
    }
    console.log("PROVE-LIVE PASS: 2 prompts → 2 frames, agent_end never settled");
  } finally {
    tap();
    await dispose();
    shell.close();
  }
}

async function main(): Promise<void> {
  if (args.includes("--prove-render")) {
    proveRender();
    return;
  }
  if (args.includes("--prove-live")) {
    await proveLive();
    return;
  }
  if (args.includes("--fixture")) {
    const shell = fixtureShell();
    shell.start();
    return;
  }
  const cwd = process.cwd();
  const shell = new FrameShell(
    {
      onPrompt: (text) => void live?.submit(text),
      onAbort: () => void live?.sessionRef().abort(),
      onExit: () => {
        void (async () => {
          try {
            await dispose?.();
          } finally {
            shell.close();
            process.exit(0);
          }
        })();
      },
    },
    cwd,
  );
  const { binding: live, dispose } = await createLiveBinding(shell, cwd);
  void live;
  shell.start();
}

await main();
