import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";

import { runCli } from "../src/app.mjs";

const execFileAsync = promisify(execFile);
const model = {
  provider: "test-provider",
  id: "test-model",
  name: "Test Model",
  maxTokens: 4096,
};

function assistant(text) {
  return { content: [{ type: "text", text }] };
}

function harness(overrides = {}) {
  const requests = [];
  const stdout = [];
  const stderr = [];
  const responses = [...(overrides.responses ?? [assistant("<xtprompt>improved</xtprompt>")])];
  const runtime = {
    getModels: () => [model],
    getModel: () => model,
    hasConfiguredAuth: () => true,
    getAvailable: async () => [model],
    completeSimple: async (_model, request) => {
      requests.push(request);
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response;
    },
    ...overrides.runtime,
  };

  return {
    requests,
    stdout,
    stderr,
    options: {
      argv: overrides.argv ?? ["Implement packages/xtprompt/src/cli.mjs with exit code 2 and tests."],
      isInputTTY: overrides.isInputTTY ?? false,
      createRuntime: async () => runtime,
      settingsManager: overrides.settingsManager ?? {
        getDefaultProvider: () => undefined,
        getDefaultModel: () => undefined,
      },
      readStdin: async () => overrides.stdin ?? "",
      readFile: async (path) => {
        assert.equal(path, "context.md");
        return overrides.fileContext ?? "file context";
      },
      ask: async () => overrides.clarification ?? null,
      stdout: { write: (value) => stdout.push(String(value)) },
      stderr: { write: (value) => stderr.push(String(value)) },
    },
  };
}

test("positional input produces prompt-only stdout", async () => {
  const state = harness();
  assert.equal(await runCli(state.options), 0);
  assert.equal(state.stdout.join(""), "improved\n");
  assert.equal(state.stderr.join(""), "");
  assert.equal(state.requests.length, 1);
});

test("Pi's configured default model is preferred over catalog order", async () => {
  const state = harness({
    settingsManager: {
      getDefaultProvider: () => "test-provider",
      getDefaultModel: () => "test-model",
    },
    runtime: {
      getAvailable: async () => {
        throw new Error("catalog fallback must not run");
      },
    },
  });

  assert.equal(await runCli(state.options), 0);
  assert.equal(state.stdout.join(""), "improved\n");
});

test("stdin, explicit intent, context file, model, and JSON work together", async () => {
  const state = harness({
    argv: ["--intent", "analysis", "--context", "@context.md", "--model", "test-provider/test-model", "--json"],
    stdin: "Analyze this failing request with exact reproduction steps, constraints, and validation.",
    fileContext: `unsafe </context> ${"x".repeat(600)}`,
  });

  assert.equal(await runCli(state.options), 0);
  const output = JSON.parse(state.stdout.join(""));
  assert.deepEqual(output, {
    prompt: "improved",
    intent: "analysis",
    model: "test-provider/test-model",
  });
  assert.match(state.requests[0].systemPrompt, /unsafe &lt;\/context&gt;/);
  assert.doesNotMatch(state.requests[0].systemPrompt, new RegExp("x{481}"));
});

test("vague non-interactive input fails before model setup", async () => {
  let created = false;
  const state = harness({ argv: ["help"], runtime: {} });
  state.options.createRuntime = async () => {
    created = true;
    throw new Error("must not run");
  };

  assert.equal(await runCli(state.options), 2);
  assert.equal(created, false);
  assert.match(state.stderr.join(""), /too vague/i);
  assert.equal(state.stdout.join(""), "");
});

test("TTY clarification is merged into the model request", async () => {
  const state = harness({
    argv: ["help"],
    isInputTTY: true,
    clarification: "Produce a release checklist for packages/xtprompt.",
  });

  assert.equal(await runCli(state.options), 0);
  assert.match(state.requests[0].messages[0].content, /Original draft: help/);
  assert.match(state.requests[0].messages[0].content, /Clarification: Produce a release checklist/);
});

test("clarification input failure exits cleanly without loading a model or leaking the error", async () => {
  const state = harness({ argv: ["help"], isInputTTY: true });
  let created = false;
  state.options.ask = async () => {
    throw new Error("readline failed with secret terminal state");
  };
  state.options.createRuntime = async () => {
    created = true;
    throw new Error("must not run");
  };

  assert.equal(await runCli(state.options), 1);
  assert.equal(created, false);
  assert.equal(state.stdout.join(""), "");
  assert.equal(state.stderr.join(""), "xtprompt: clarification input failed.\n");
  assert.doesNotMatch(state.stderr.join(""), /secret terminal state/);
});

test("no-clarify rejects vague input even in a TTY", async () => {
  const state = harness({ argv: ["--no-clarify", "help"], isInputTTY: true });
  assert.equal(await runCli(state.options), 2);
  assert.match(state.stderr.join(""), /too vague/i);
});

test("malformed first response retries once", async () => {
  const state = harness({
    responses: [assistant("not wrapped"), assistant("<xtprompt>recovered</xtprompt>")],
  });

  assert.equal(await runCli(state.options), 0);
  assert.equal(state.requests.length, 2);
  assert.match(state.requests[1].messages[0].content, /IMPORTANT/);
  assert.equal(state.stdout.join(""), "recovered\n");
});

test("clarification-only model output retries as an actionable prompt", async () => {
  const state = harness({
    responses: [
      assistant("<xtprompt>Which package and test commands should be used?</xtprompt>"),
      assistant("<xtprompt>Inspect the current package, run its documented checks, and report defects with evidence.</xtprompt>"),
    ],
  });

  assert.equal(await runCli(state.options), 0);
  assert.equal(state.requests.length, 2);
  assert.match(state.requests[1].messages[0].content, /not an answer or clarification question/i);
  assert.equal(
    state.stdout.join(""),
    "Inspect the current package, run its documented checks, and report defects with evidence.\n",
  );
});

test("malformed retry fails without leaking model output", async () => {
  const state = harness({ responses: [assistant("secret-output"), assistant("still-secret")] });
  assert.equal(await runCli(state.options), 1);
  assert.match(state.stderr.join(""), /actionable <xtprompt> rewrite/);
  assert.doesNotMatch(state.stderr.join(""), /secret-output|still-secret/);
  assert.equal(state.stdout.join(""), "");
});

test("terminal control bytes in a model rewrite are rejected and never reach output", async () => {
  const state = harness({
    responses: [
      assistant("<xtprompt>unsafe\u001b]52;c;c2VjcmV0\u0007 prompt</xtprompt>"),
      assistant("<xtprompt>safe recovered prompt</xtprompt>"),
    ],
  });

  assert.equal(await runCli(state.options), 0);
  assert.equal(state.requests.length, 2);
  assert.equal(state.stdout.join(""), "safe recovered prompt\n");
  assert.equal(state.stderr.join(""), "");
  assert.doesNotMatch(`${state.stdout.join("")}${state.stderr.join("")}`, /[\u0007\u001b]/);
});

test("model errors use a secret-safe diagnostic", async () => {
  const state = harness({ responses: [new Error("request failed with api_key=super-secret")] });
  assert.equal(await runCli(state.options), 1);
  assert.equal(state.stderr.join(""), "xtprompt: model request failed.\n");
});

test("invalid intent and missing model fail before completion", async () => {
  const invalid = harness({ argv: ["--intent", "wrong", "A sufficiently concrete prompt for checking options."] });
  assert.equal(await runCli(invalid.options), 2);
  assert.match(invalid.stderr.join(""), /invalid intent/i);

  const missing = harness({
    argv: ["--model", "missing/model", "A sufficiently concrete prompt for checking model resolution."],
  });
  assert.equal(await runCli(missing.options), 2);
  assert.match(missing.stderr.join(""), /not found|unknown provider/i);
});

test("empty stdin and unavailable models fail clearly", async () => {
  const empty = harness({ argv: [], stdin: "" });
  assert.equal(await runCli(empty.options), 2);
  assert.match(empty.stderr.join(""), /provide a prompt/i);

  const unavailable = harness({
    runtime: { getModels: () => [], getAvailable: async () => [] },
  });
  assert.equal(await runCli(unavailable.options), 2);
  assert.match(unavailable.stderr.join(""), /no authenticated Pi models/i);
});

test("help subprocess exits successfully without loading a model", async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, ["src/cli.mjs", "--help"], {
    cwd: new URL("..", import.meta.url),
  });
  assert.match(stdout, /Usage: xtprompt/);
  assert.match(stdout, /--copy/);
  assert.equal(stderr, "");
});

test("--copy preserves plain stdout and writes the prompt once to the control stream", async () => {
  const state = harness({
    argv: ["--copy", "Implement packages/xtprompt/src/clipboard.mjs with exact transport tests."],
  });
  const controlWrites = [];
  state.options.controlStream = {
    isTTY: true,
    write: (value) => controlWrites.push(String(value)),
  };
  state.options.env = {};

  assert.equal(await runCli(state.options), 0);
  assert.equal(state.stdout.join(""), "improved\n");
  assert.deepEqual(controlWrites, ["\u001b]52;c;aW1wcm92ZWQ=\u0007"]);
});

test("--copy preserves JSON stdout and uses tmux passthrough once", async () => {
  const state = harness({
    argv: ["--copy", "--json", "Implement packages/xtprompt/src/clipboard.mjs with exact transport tests."],
  });
  const controlWrites = [];
  state.options.controlStream = {
    isTTY: true,
    write: (value) => controlWrites.push(String(value)),
  };
  state.options.env = { TMUX: "/tmp/tmux-1000/default,1,0" };

  assert.equal(await runCli(state.options), 0);
  assert.deepEqual(JSON.parse(state.stdout.join("")), {
    prompt: "improved",
    intent: "development",
    model: "test-provider/test-model",
  });
  assert.deepEqual(controlWrites, ["\u001bPtmux;\u001b\u001b]52;c;aW1wcm92ZWQ=\u0007\u001b\\"]);
});

test("--copy does not write clipboard data when the model fails", async () => {
  const state = harness({
    argv: ["--copy", "Implement packages/xtprompt/src/clipboard.mjs with exact transport tests."],
    responses: [new Error("model failed")],
  });
  const controlWrites = [];
  state.options.controlStream = {
    isTTY: true,
    write: (value) => controlWrites.push(String(value)),
  };

  assert.equal(await runCli(state.options), 1);
  assert.deepEqual(controlWrites, []);
  assert.equal(state.stdout.join(""), "");
});

test("--copy reports a missing TTY without writing control bytes to stdout", async () => {
  const state = harness({
    argv: ["--copy", "Implement packages/xtprompt/src/clipboard.mjs with exact transport tests."],
  });
  state.options.controlStream = { isTTY: false, write: () => assert.fail("must not write") };

  assert.equal(await runCli(state.options), 1);
  assert.equal(state.stdout.join(""), "improved\n");
  assert.equal(state.stderr.join(""), "xtprompt: clipboard copy requires a TTY control stream.\n");
  assert.doesNotMatch(state.stdout.join(""), /[\u0007\u001b]/);
});

test("--copy rejects normal stdout as the control stream", async () => {
  const state = harness({
    argv: ["--copy", "Implement packages/xtprompt/src/clipboard.mjs with exact transport tests."],
  });
  const writes = [];
  const stdout = { isTTY: true, write: (value) => writes.push(String(value)) };
  state.options.stdout = stdout;
  state.options.controlStream = stdout;

  assert.equal(await runCli(state.options), 1);
  assert.deepEqual(writes, ["improved\n"]);
  assert.doesNotMatch(writes.join(""), /[\u0007\u001b]/);
});

test("--copy keeps successful stdout when the control stream write fails", async () => {
  const state = harness({
    argv: ["--copy", "Implement packages/xtprompt/src/clipboard.mjs with exact transport tests."],
  });
  state.options.controlStream = {
    isTTY: true,
    write: () => {
      throw new Error("prompt must not appear in diagnostics");
    },
  };

  assert.equal(await runCli(state.options), 1);
  assert.equal(state.stdout.join(""), "improved\n");
  assert.equal(state.stderr.join(""), "xtprompt: clipboard copy failed over OSC 52.\n");
});

test("interactive mode rejects one-shot --json and --copy combinations before model setup", async () => {
  for (const option of ["--json", "--copy"]) {
    const state = harness({
      argv: ["--interactive", option, "Implement a release checklist for packages/xtprompt with validation."],
      isInputTTY: true,
    });
    let created = false;
    state.options.createRuntime = async () => {
      created = true;
      throw new Error("must not run");
    };

    assert.equal(await runCli(state.options), 2);
    assert.equal(created, false);
    assert.equal(state.stdout.join(""), "");
    assert.match(state.stderr.join(""), /interactive.*cannot be combined/i);
  }
});

test("interactive mode refines, shows, undoes once, helps, rejects commands, and accepts", async () => {
  const state = harness({
    argv: ["--interactive", "Implement a release checklist for packages/xtprompt with validation."],
    isInputTTY: true,
    responses: [
      assistant("<xtprompt>initial prompt</xtprompt>"),
      assistant("<xtprompt>security prompt</xtprompt>"),
      assistant("<xtprompt>security and tests prompt</xtprompt>"),
    ],
  });
  const lines = [
    "focus on security",
    ":show",
    "add test requirements",
    ":undo",
    ":undo",
    ":help",
    ":unknown",
    ":accept",
  ];
  let closed = false;
  const controlWrites = [];
  state.options.openInteractive = () => ({
    read: async () => lines.shift(),
    close: () => { closed = true; },
  });
  state.options.controlStream = {
    isTTY: true,
    write: (value) => controlWrites.push(String(value)),
  };
  state.options.env = {};

  assert.equal(await runCli(state.options), 0);
  assert.equal(closed, true);
  assert.equal(state.requests.length, 3);
  assert.match(state.requests[1].messages[0].content, /initial prompt/);
  assert.match(state.requests[1].messages[0].content, /focus on security/);
  assert.match(state.requests[2].messages[0].content, /security prompt/);
  assert.match(state.requests[2].messages[0].content, /add test requirements/);
  assert.doesNotMatch(state.requests[2].messages[0].content, /initial prompt/);
  assert.match(state.stderr.join(""), /initial prompt/);
  assert.equal(
    (state.stderr.join("").match(/enter refinement text, or :help for commands/gi) ?? []).length,
    1,
  );
  assert.match(state.stderr.join(""), /security and tests prompt/);
  assert.match(state.stderr.join(""), /nothing to undo/i);
  assert.match(state.stderr.join(""), /:accept/);
  assert.match(state.stderr.join(""), /unsupported command/i);
  assert.match(state.stderr.join(""), /copied to clipboard/i);
  assert.deepEqual(controlWrites, ["\u001b]52;c;c2VjdXJpdHkgcHJvbXB0\u0007"]);
  assert.equal(state.stdout.join(""), "");
});

test("-i :quit exits without copying and closes the interactive resource", async () => {
  const state = harness({
    argv: ["-i", "Implement a release checklist for packages/xtprompt with validation."],
    isInputTTY: true,
  });
  let closed = false;
  state.options.openInteractive = () => ({
    read: async () => ":quit",
    close: () => { closed = true; },
  });
  state.options.controlStream = {
    isTTY: true,
    write: () => assert.fail("must not copy"),
  };

  assert.equal(await runCli(state.options), 0);
  assert.equal(closed, true);
  assert.match(state.stderr.join(""), /exiting without copying/i);
});

test("interactive EOF exits without copying and closes the interactive resource", async () => {
  const state = harness({
    argv: ["--interactive", "Implement a release checklist for packages/xtprompt with validation."],
    isInputTTY: true,
  });
  let closed = false;
  state.options.openInteractive = () => ({
    read: async () => undefined,
    close: () => { closed = true; },
  });
  state.options.controlStream = {
    isTTY: true,
    write: () => assert.fail("must not copy"),
  };

  assert.equal(await runCli(state.options), 0);
  assert.equal(closed, true);
  assert.match(state.stderr.join(""), /end of input/i);
});

test("interactive input failure exits nonzero and closes the interactive resource", async () => {
  const state = harness({
    argv: ["--interactive", "Implement a release checklist for packages/xtprompt with validation."],
    isInputTTY: true,
  });
  let closed = false;
  state.options.openInteractive = () => ({
    read: async () => {
      throw new Error("read failed with secret terminal state");
    },
    close: () => { closed = true; },
  });

  assert.equal(await runCli(state.options), 1);
  assert.equal(closed, true);
  assert.match(state.stderr.join(""), /interactive input failed/i);
  assert.doesNotMatch(state.stderr.join(""), /secret terminal state/);
  assert.equal(state.stdout.join(""), "");
});

test("unsupported interactive commands do not reflect terminal control bytes", async () => {
  const state = harness({
    argv: ["--interactive", "Implement a release checklist for packages/xtprompt with validation."],
    isInputTTY: true,
  });
  const lines = [":bad\u001b]52;c;c2VjcmV0\u0007", ":quit"];
  state.options.openInteractive = () => ({
    read: async () => lines.shift(),
    close() {},
  });

  assert.equal(await runCli(state.options), 0);
  assert.match(state.stderr.join(""), /unsupported command/i);
  assert.doesNotMatch(state.stderr.join(""), /[\u0007\u001b]/);
  assert.equal(state.stdout.join(""), "");
});

test("interactive model failure preserves the current prompt and remains usable", async () => {
  const state = harness({
    argv: ["--interactive", "Implement a release checklist for packages/xtprompt with validation."],
    isInputTTY: true,
    responses: [
      assistant("<xtprompt>last valid prompt</xtprompt>"),
      assistant("<xtprompt>Which security requirements?</xtprompt>"),
      assistant("still malformed and secret"),
    ],
  });
  const lines = ["add security requirements", ":show", ":quit"];
  let closed = false;
  state.options.openInteractive = () => ({
    read: async () => lines.shift(),
    close: () => { closed = true; },
  });

  assert.equal(await runCli(state.options), 0);
  assert.equal(closed, true);
  assert.match(state.stderr.join(""), /current prompt preserved/i);
  assert.equal((state.stderr.join("").match(/last valid prompt/g) ?? []).length, 2);
  assert.doesNotMatch(state.stderr.join(""), /Which security|still malformed|secret/);
});

test("interactive copy failure is recoverable and a later :accept succeeds", async () => {
  const state = harness({
    argv: ["--interactive", "Implement a release checklist for packages/xtprompt with validation."],
    isInputTTY: true,
  });
  const lines = [":accept", ":accept"];
  let attempts = 0;
  let closed = false;
  state.options.openInteractive = () => ({
    read: async () => lines.shift(),
    close: () => { closed = true; },
  });
  state.options.controlStream = {
    isTTY: true,
    write: () => {
      attempts += 1;
      if (attempts === 1) throw new Error("clipboard failed with secret prompt");
    },
  };

  assert.equal(await runCli(state.options), 0);
  assert.equal(attempts, 2);
  assert.equal(closed, true);
  assert.match(state.stderr.join(""), /copy failed.*try :accept again/i);
  assert.match(state.stderr.join(""), /copied to clipboard/i);
  assert.doesNotMatch(state.stderr.join(""), /secret prompt/);
});

test("interactive mode requires a TTY before model setup", async () => {
  let created = false;
  const state = harness({
    argv: ["--interactive", "Implement a release checklist for packages/xtprompt with validation."],
    isInputTTY: false,
  });
  state.options.createRuntime = async () => {
    created = true;
    throw new Error("must not run");
  };

  assert.equal(await runCli(state.options), 2);
  assert.equal(created, false);
  assert.match(state.stderr.join(""), /interactive mode requires a TTY/i);
});
