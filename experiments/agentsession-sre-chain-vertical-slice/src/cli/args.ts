export interface CliArgs {
  repo?: string;
  rootBead?: string;
  incident?: string;
  incidentFile?: string;
  stateDir: string;
  dryRun: boolean;
  json: boolean;
  resume?: string;
  chainId?: string;
  help: boolean;
  targetRepoIsSynthetic: boolean;
  incidentBrief: string;
  reallyRunAgents: boolean; // when false, do a plan-only walk (safer default for CI)
  /** Load real Specialist JSON cognition and freeze source hashes for the ChainRun. */
  specialistJson: "off" | "auto" | "required";
}

const HELP = `
Direct AgentSession SRE Chain — vertical slice

Usage:
  bun run src/cli/main.ts [flags]

Flags:
  --repo <path>            Target repository (read-only). Default: ./fixtures/tiny-repo
  --root-bead <id>         External root bead reference (optional, stored in fingerprint only)
  --incident <text>        Inline incident brief for the coordinator entry
  --incident-file <path>   File containing the incident brief
  --state-dir <path>       Where to persist chain runs. Default: ~/.cache/agentsession-sre-chain-vertical-slice
  --dry-run                Materialize + fingerprint + persist plan, then exit (no dispatch)
  --json                   Emit NDJSON runtime facts to stdout
  --resume <chain-run-id>  Reload existing run and continue (no re-materialization)
  --chain-id <id>          Override chain_id (for deterministic runs)
  --no-agents              Skip AgentSession dispatch (walks reducer with fake evidence to validate topology)
  --specialist-json <mode> Real Specialist JSON cognition: off | auto | required. Default: off
                           Bindings are source-hashed and persisted under chain/specialist-bindings.json.
  --help                   Show this help
`;

export function parseArgs(argv: string[]): CliArgs {
  const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";
  const args: CliArgs = {
    stateDir: `${HOME}/.cache/agentsession-sre-chain-vertical-slice`,
    dryRun: false,
    json: false,
    help: false,
    targetRepoIsSynthetic: true,
    incidentBrief: "",
    reallyRunAgents: true,
    specialistJson: "off",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => argv[++i];
    switch (a) {
      case "--repo":              args.repo = next(); break;
      case "--root-bead":         args.rootBead = next(); break;
      case "--incident":          args.incident = next(); break;
      case "--incident-file":     args.incidentFile = next(); break;
      case "--state-dir":         args.stateDir = next()!; break;
      case "--dry-run":           args.dryRun = true; break;
      case "--json":              args.json = true; break;
      case "--resume":            args.resume = next(); break;
      case "--chain-id":          args.chainId = next(); break;
      case "--no-agents":         args.reallyRunAgents = false; break;
      case "--specialist-json": {
        const mode = next();
        if (mode !== "off" && mode !== "auto" && mode !== "required") {
          throw new Error(`--specialist-json must be off|auto|required, got: ${mode}`);
        }
        args.specialistJson = mode;
        break;
      }
      case "--help":
      case "-h":                  args.help = true; break;
      default:
        if (a.startsWith("--")) throw new Error(`unknown flag: ${a}`);
    }
  }
  args.incidentBrief = args.incident ?? "";
  return args;
}

export function helpText(): string {
  return HELP;
}
