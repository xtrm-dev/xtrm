/**
 * Structural sketch for `xt agent`.
 * Reconcile exact imports and package boundaries against the local Core checkout.
 */

import { Command } from "commander";

export function createAgentCommand(): Command {
  return new Command("agent")
    .description("Launch the XTRM-native Pi AgentSession TUI")
    .argument("[cwd]", "Project directory", ".")
    .option("--model <name>", "Initial Pi model")
    .option("--thinking <level>", "Initial thinking level")
    .option("--resume [id]", "Resume a Pi session")
    .option("--tool-view <mode>", "compressed|normal|expanded", "compressed")
    .action(async (cwd, opts) => {
      // 1. Resolve exact Pi runtime/model/auth through the same Core helpers used
      //    by the managed Pi path.
      // 2. createAgentSessionRuntime(...)
      // 3. create EpisodeProjector and XtrmAgentTui
      // 4. bind runtime.session event subscription
      // 5. run the TUI until exit
      // 6. dispose session/runtime cleanly
      await runXtrmAgentTui({ cwd, ...opts });
    });
}

async function runXtrmAgentTui(_options: Record<string, unknown>): Promise<void> {
  throw new Error("starter sketch: local worker implements against current Pi SDK/TUI");
}
