// Commit evidence for `sb issue link pr` (CORE-2787).
//
// T2 evidence has always been read from the repository the command runs in. In
// remote mode that repository is the server's checkout, so a PR pushed from the
// caller's machine seconds earlier is not there yet and `git log <range>` fails
// with "Invalid revision range": the issue keeps the mention and loses the
// evidence. The caller's own repository is the only place where the commit
// provably exists at that moment, so the caller reads it and sends it as data,
// exactly as the hooks send the commit SHA they resolved locally (ADR-008,
// "Local-file arguments").
//
// Both sides share this module: the CLI validates the document, the forwarder
// produces it.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

export const COMMIT_EVIDENCE_FLAG = "commit-evidence";

export interface CommitEvidence {
  sha: string;
  message: string;
}

const SHA_PATTERN = /^[0-9a-fA-F]{7,40}$/;
// Anything git itself accepts as `<base>..<head>`: no whitespace, one range.
// Deliberately permissive -- `origin/main..HEAD` and `HEAD~3..HEAD` are real
// ranges, and refusing them here would break invocations that work today.
const RANGE_PATTERN = /^\S+\.\.\S+$/;

// The document the caller uploads: a JSON array of {sha, message}. Read the
// same way every other document flag is read here -- an existing path is a
// file, anything else must be inline JSON.
export function readCommitEvidenceDocument(value: string): CommitEvidence[] {
  const text = existsSync(value)
    ? readFileSync(value, "utf8")
    : value;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `--${COMMIT_EVIDENCE_FLAG} ` + JSON.stringify(value.slice(0, 40)) + ": not a readable file and not valid inline JSON (" +
        (err instanceof Error ? err.message : String(err)) + ")",
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`--${COMMIT_EVIDENCE_FLAG} must be a JSON array of {"sha":"<hex>","message":"<commit message>"} entries`);
  }
  // An empty array is refused rather than treated as "no evidence": the caller
  // asked for evidence, so silence would be the silent loss the link must not
  // have. A plain mention is `sb issue link pr` without the flag.
  if (parsed.length === 0) {
    throw new Error(`--${COMMIT_EVIDENCE_FLAG} carried no commits: omit the flag to record a mention instead`);
  }
  const out: CommitEvidence[] = [];
  for (const [index, entry] of parsed.entries()) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`--${COMMIT_EVIDENCE_FLAG}[${index}] must be an object with "sha" and "message"`);
    }
    const record = entry as Record<string, unknown>;
    const sha = typeof record["sha"] === "string" ? record["sha"].trim() : "";
    const message = typeof record["message"] === "string" ? record["message"] : "";
    if (!SHA_PATTERN.test(sha)) {
      throw new Error(`--${COMMIT_EVIDENCE_FLAG}[${index}].sha ` + JSON.stringify(sha) + " is not a commit SHA (7 to 40 hex characters)");
    }
    if (message.trim() === "") {
      throw new Error(`--${COMMIT_EVIDENCE_FLAG}[${index}].message is empty: the XTRM-Issue trailer is read from it`);
    }
    out.push({ sha, message });
  }
  return out;
}

// A read the CALLER's repository could not perform. It is not an error for the
// link: the far side may still resolve the same range in its own checkout, so the
// forwarder treats this as a reason to send the original argv and say why.
export class CommitEvidenceUnavailable extends Error {}

// The evidence a caller can produce from its own repository. `git log` writes
// each commit as <sha>\x1f<body>\x1e, the same framing the server reads, and
// `git show -s --format=%B` gives one message for a single SHA.
export function readLocalCommitEvidence(
  input: { range?: string | undefined; commits: string[] },
  repoRoot: string,
): CommitEvidence[] {
  const git = (args: string[]): { status: number | null; stdout: string; stderr: string } => {
    const res = spawnSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" });
    return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
  };
  const out: CommitEvidence[] = [];
  if (input.range !== undefined) {
    if (!RANGE_PATTERN.test(input.range)) throw new Error(`--commits-range must be <base>..<head>, not ` + JSON.stringify(input.range));
    const res = git(["log", "--format=%H%x1f%B%x1e", input.range]);
    if (res.status !== 0) {
      throw new CommitEvidenceUnavailable(
        `--commits-range ${input.range}: git log failed in the calling repository ${repoRoot} (${res.stderr.trim()}); ` +
          "fetch the range or pass --commit <sha> for each commit",
      );
    }
    for (const record of res.stdout.split("\u001e")) {
      const text = record.trim();
      const cut = text.indexOf("\u001f");
      if (text === "" || cut < 0) continue;
      out.push({ sha: text.slice(0, cut).trim(), message: text.slice(cut + 1) });
    }
  }
  for (const sha of input.commits) {
    if (!SHA_PATTERN.test(sha)) throw new Error(`--commit is not a SHA: ${sha}`);
    const res = git(["show", "-s", "--format=%B", sha]);
    if (res.status !== 0) {
      throw new CommitEvidenceUnavailable(
        `--commit ${sha}: git show failed in the calling repository ${repoRoot} (${res.stderr.trim()}); ` +
          "the evidence must come from a commit this machine can read, or omit the flag to record a mention instead",
      );
    }
    out.push({ sha, message: res.stdout });
  }
  // An empty answer is not a failure: a range with no commits resolves to a
  // mention on both sides, so the forwarder appends nothing and the far side
  // runs its own git exactly as a local invocation would.
  return out;
}
