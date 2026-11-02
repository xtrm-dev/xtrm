// Remote transport specification and POSIX command encoding (ADR-008).
//
// One transport: `ssh` process execution. No listener, no daemon (ADR-008
// decision). `ssh` joins its own arguments with spaces before handing them to
// the remote shell, so every forwarded argument goes through one single-quote
// encoder: one argument in, one argument out. Concatenation is the defect class
// this module exists to prevent.

export type RemoteTransportKind = "ssh";

export interface RemoteSpec {
  transport: RemoteTransportKind;
  host: string;
}

export type RemoteErrorKind = "config" | "unreachable" | "mapping" | "remote-failed" | "unsupported";

export class RemoteError extends Error {
  readonly kind: RemoteErrorKind;

  constructor(kind: RemoteErrorKind, message: string) {
    super(message);
    this.name = "RemoteError";
    this.kind = kind;
  }
}

// `ssh:<host>` is the only accepted form. A host starting with "-" would be
// read as an ssh option, so it is refused here rather than at the spawn.
export function parseRemoteSpec(raw: string | null | undefined): RemoteSpec | null {
  const value = (raw ?? "").trim();
  if (value === "") return null;
  const match = /^ssh:([^\s:]+)$/.exec(value);
  if (match === null) {
    throw new RemoteError("config", `invalid remote spec ${JSON.stringify(value)}: expected "ssh:<host>"`);
  }
  const host = match[1]!;
  if (host.startsWith("-")) throw new RemoteError("config", `invalid remote host ${JSON.stringify(host)}: must not start with "-"`);
  return { transport: "ssh", host };
}

// POSIX single-quote encoding: `'` closes, `\'` re-opens as a literal quote.
// The empty string becomes `''` so an empty argument survives as an argument.
export function shellQuote(value: string): string {
  return `'${value.split("'").join("'\\''")}'`;
}

export interface RemoteUpload {
  // Index into argv whose value is a client-side file that must exist as a path
  // on the server. The shell expression is substituted for the quoted argument
  // so the remote shell expands the temp path itself.
  argvIndex: number;
  content: Buffer;
}

export interface RemoteCommandPlan {
  command: string;
  // The framed document stream for the uploads, or null when there are none.
  // Every uploaded byte travels here, never in the command string: the remote
  // argv and /proc/<pid>/cmdline are world-readable on a shared host, so a base64
  // argument was a plaintext disclosure to any local user (review H1/M7).
  stdin: string | null;
}

export interface RemoteCommandInput {
  sbPath: string;
  argv: string[];
  cwd?: string | null;
  env?: Record<string, string | undefined>;
  uploads?: RemoteUpload[];
  tmpTemplate?: string;
}

const TMP_TEMPLATE = "/tmp/sb-remote.XXXXXX";
// Splits the framed stream into <dir>/fN.b64 files. Written against POSIX awk:
// no gawk extensions, no pipes, so quoting cannot be broken by a payload.
const FRAME_AWK =
  '/^@@sb-remote-file /{f=d"/"$2".b64";next} /^@@sb-remote-end$/{f="";next} f!=""{print >> f}';


// Frame markers. Base64 cannot contain "@", so no payload line can imitate one.
const FILE_MARKER = "@@sb-remote-file ";
const END_MARKER = "@@sb-remote-end";

// The stream the server unpacks: one framed, base64-coded document per upload.
// stdin has no ARG_MAX, so any number and size of documents now travel (the old
// inline-in-argv path reported E2BIG as "cannot reach host").
export function frameUploads(uploads: RemoteUpload[]): string {
  const lines: string[] = [];
  for (const upload of uploads) {
    lines.push(FILE_MARKER + `f${upload.argvIndex}`);
    const body = upload.content.toString("base64");
    if (body !== "") lines.push(body);
  }
  lines.push(END_MARKER, "");
  return lines.join("\n");
}

// Builds the one command string `ssh` hands to the remote shell:
//   [upload preamble] [cd <cwd>] env K=V ... <sb> <args...>
// The environment is an explicit allowlist prefix, never inherited: ssh does not
// forward the environment and server AcceptEnv cannot be assumed.
export function buildRemoteCommand(input: RemoteCommandInput): RemoteCommandPlan {
  const uploads = input.uploads ?? [];
  const lines: string[] = [];
  const substitutions = new Map<number, string>();

  if (uploads.length > 0) {
    const template = input.tmpTemplate ?? TMP_TEMPLATE;
    lines.push(`sb_remote_dir=$(mktemp -d ${shellQuote(template)}) || { echo "sb remote: cannot create a temp dir on the server" >&2; exit 70; }`);
    lines.push("trap 'sb_remote_rc=$?; rm -rf \"$sb_remote_dir\"; exit $sb_remote_rc' EXIT");
    // Every target exists first, so a zero-byte document still reaches the
    // server as a real, empty file instead of a missing path.
    for (const upload of uploads) {
      const path = `"$sb_remote_dir/f${upload.argvIndex}"`;
      substitutions.set(upload.argvIndex, path);
      lines.push(`: > ${path}`);
    }
    lines.push(
      `awk -v d="$sb_remote_dir" '${FRAME_AWK}' || { echo "sb remote: cannot unpack the uploaded documents" >&2; exit 70; }`,
    );
    lines.push(`for b in "$sb_remote_dir"/*.b64; do`);
    lines.push(`  [ -e "$b" ] || continue`);
    lines.push(`  base64 -d "$b" > "\${b%.b64}" || { echo "sb remote: cannot decode an uploaded document" >&2; exit 70; }`);
    lines.push(`  rm -f "$b"`);
    lines.push(`done`);
  }

  const parts: string[] = [];
  for (const [name, value] of Object.entries(input.env ?? {})) {
    if (value === undefined) continue;
    parts.push(`${name}=${shellQuote(value)}`);
  }
  const encodedArgv = input.argv.map((arg, index) => substitutions.get(index) ?? shellQuote(arg));
  const invocation = [...(parts.length > 0 ? ["env", ...parts] : []), shellQuote(input.sbPath), ...encodedArgv].join(" ");
  if (input.cwd !== undefined && input.cwd !== null) {
    // The path travels as a quoted argument to printf, never inside a
    // double-quoted string: a cwd containing $(...), backticks or a backslash
    // would otherwise be expanded by the remote shell.
    lines.push(
      `cd ${shellQuote(input.cwd)} || { printf 'sb remote: cannot cd to %s on the server\\n' ${shellQuote(input.cwd)} >&2; exit 71; }`,
    );
  }
  lines.push(invocation);
  return { command: lines.join("\n"), stdin: uploads.length === 0 ? null : frameUploads(uploads) };
}
