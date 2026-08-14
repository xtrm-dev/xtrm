#!/usr/bin/env node

import { createInterface } from "node:readline/promises";

import { runCli } from "./app.mjs";

async function ask(question) {
  const readline = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await readline.question(question);
  } finally {
    readline.close();
  }
}

export function openInteractive() {
  const readline = createInterface({ input: process.stdin, output: process.stderr });
  let closed = false;
  let interrupted = false;
  let rejectPending;
  readline.once("close", () => { closed = true; });
  readline.once("SIGINT", () => {
    interrupted = true;
    rejectPending?.(interruptedError());
    readline.close();
  });
  return {
    read: async (question) => {
      if (interrupted) throw interruptedError();
      if (closed) return undefined;
      try {
        return await Promise.race([
          readline.question(question),
          new Promise((_, reject) => { rejectPending = reject; }),
        ]);
      } catch (error) {
        if (interrupted) throw interruptedError();
        if (closed || error?.code === "ERR_USE_AFTER_CLOSE" || error?.name === "AbortError") return undefined;
        throw error;
      } finally {
        rejectPending = undefined;
      }
    },
    close: () => readline.close(),
  };
}

function interruptedError() {
  return Object.assign(new Error("interactive input interrupted"), { code: "XT_SIGINT" });
}

if (import.meta.main) {
  process.exitCode = await runCli({ ask, openInteractive, controlStream: process.stderr });
}
