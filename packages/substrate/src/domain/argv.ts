// One argv parser for the CLI and for the remote forwarder.
//
// The remote forwarder must decide which command it is forwarding and which
// values are documents before it rewrites anything (XTRM-685 review M5): a
// second, simpler parser got the answer wrong whenever a value flag came first
// (`--project X export project --file out` looked like an `export`, and
// `--project remote issue list` looked like an `issue`), and the two parsers
// then disagreed about which flags exist. This module is the only parser.

// A boolean flag is presence-only; every other flag consumes the next token as
// its value unless that token is another flag. `--dry-run` is a command flag,
// not a global one, but it is boolean everywhere it exists.
export const BOOLEAN_FLAGS: ReadonlySet<string> = new Set(["json", "help", "version", "dry-run", "rebuild"]);

export type FlagValue = true | string[];
export type Flags = Map<string, FlagValue>;

export interface ParsedArgv {
  flags: Flags;
  positionals: string[];
}

// Repeated-flag semantics (XTRM-552): a non-boolean flag accumulates every
// supplied value in caller order. Scalar readers use flag() and take the last
// value (explicit last-wins); list readers use flagList() and take every value.
// A bare non-boolean flag (`--reason` with no value) is presence without a
// value and never clobbers values already supplied.
export function parseArgs(argv: string[]): ParsedArgv {
  const flags: Flags = new Map();
  const positionals: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const a = argv[i] as string;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!BOOLEAN_FLAGS.has(key) && next !== undefined && !next.startsWith("--")) {
        const prev = flags.get(key);
        if (Array.isArray(prev)) prev.push(next);
        else flags.set(key, [next]);
        i += 2;
      } else if (!flags.has(key)) {
        flags.set(key, true);
        i += 1;
      } else {
        i += 1;
      }
    } else {
      positionals.push(a);
      i += 1;
    }
  }
  return { flags, positionals };
}

export function flag(flags: Flags, name: string): string | undefined {
  const v = flags.get(name);
  if (v === undefined || v === true) return undefined;
  return v[v.length - 1];
}

// Every value supplied for a repeated flag, in caller order (XTRM-552).
export function flagList(flags: Flags, name: string): string[] | undefined {
  const v = flags.get(name);
  if (v === undefined || v === true) return undefined;
  return v.slice();
}

// A value flag spelled `--name=value`. The CLI does not split this form, so a
// forwarder must not split it either: the server would reject it as an unknown
// flag, which is the safe outcome, and splitting it would invent an argument the
// caller never wrote. Returns null for every other token.
export function equalsFlagValue(token: string): { name: string; value: string } | null {
  if (!token.startsWith("--")) return null;
  const eq = token.indexOf("=");
  if (eq <= 2) return null;
  return { name: token.slice(2, eq), value: token.slice(eq + 1) };
}
