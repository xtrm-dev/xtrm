import { appendJsonl } from "./fs.ts";
import type { RuntimeFact } from "../chain/types.ts";

export interface Logger {
  fact(fact: RuntimeFact): Promise<void>;
  human(line: string): void;
  ndjson(fact: RuntimeFact): void;
}

export interface LoggerOptions {
  forensicsPath: string;
  ndjsonMode: boolean;
  humanRender?: (fact: RuntimeFact) => string | null;
}

export function createLogger(opts: LoggerOptions): Logger {
  return {
    async fact(fact) {
      await appendJsonl(opts.forensicsPath, fact);
      if (opts.ndjsonMode) {
        process.stdout.write(JSON.stringify(fact) + "\n");
      } else if (opts.humanRender) {
        const line = opts.humanRender(fact);
        if (line) process.stdout.write(line + "\n");
      }
    },
    human(line) {
      if (!opts.ndjsonMode) process.stdout.write(line + "\n");
    },
    ndjson(fact) {
      if (opts.ndjsonMode) process.stdout.write(JSON.stringify(fact) + "\n");
    },
  };
}

/** Human-friendly one-liner per §13 example. */
export function defaultRender(fact: RuntimeFact): string | null {
  const ts = fact.ts.slice(11, 19); // HH:MM:SS
  const chain = fact.chain_id.padEnd(20);
  const who = (fact.role ?? fact.participant_id ?? "runtime").padEnd(20);
  const map: Record<RuntimeFact["kind"], string> = {
    "chain.ready": "READY",
    "step.ready": "READY",
    "step.start": "START",
    "step.done": "DONE ",
    "step.failed": "FAIL ",
    "step.satisfied": "SAT  ",
    "reviewer.verdict": "VERD ",
    "coordinator.action": "COORD",
    "escalation": "ESCLT",
    "provenance.receipt": "PROV ",
    "provenance.receipt.failed": "PROV!",
    "message.rejected": "MRJCT",
    "chain.close": "CLOSE",
  };
  const kind = map[fact.kind] ?? fact.kind;
  return `${ts}  ${chain}  ${who}  ${kind}  ${fact.detail}`;
}
