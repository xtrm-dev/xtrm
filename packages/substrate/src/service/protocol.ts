// The wire between `sb serve --stdio` and its clients.
//
// One JSON object per line, both directions. The client writes a request and
// reads the response with the same id; nothing else is accepted on stdout, so
// the stream stays parseable even when a client logs to stderr.
//
// The protocol carries OPERATIONS, never SQL. Every op is a named, typed call
// against the same services the CLI uses (`IssueService`, `JournalService`,
// `ProvenanceService`, the activation authority), which is what makes it safe to
// expose over a connection to another machine: a client can ask for a claim to
// be released, and cannot ask for `DELETE FROM issue_claims`.

/** Bumped when a request or response shape changes incompatibly. */
export const PROTOCOL_VERSION = 1;

/** A frame larger than this is refused before it is parsed. */
export const MAX_FRAME_BYTES = 8 * 1024 * 1024;

export type ServiceErrorCode =
  | "timeout"
  | "bad_request"
  | "unknown_op"
  | "not_found"
  | "conflict"
  | "unsupported"
  | "internal"
  // The transport failed in four distinguishable ways, because they call for four
  // different actions: install a newer sb, fix the ssh program, retry the call, or
  // upgrade one of the two sides.
  | "not_installed"
  | "spawn_failed"
  | "connection_lost"
  | "protocol_mismatch"
  | "peer_noise";

export interface ServiceError {
  code: ServiceErrorCode;
  message: string;
}

export interface ServiceRequest {
  id: number | string;
  op: string;
  args?: Record<string, unknown>;
}

/** The request shape a client hands to `encodeRequest`. */
export type ServiceRequestLike = ServiceRequest;

export type ServiceResponse =
  | { id: number | string | null; ok: true; result: unknown }
  | { id: number | string | null; ok: false; error: ServiceError };

/** The first message on every connection. A client that skips it gets nothing. */
export interface HelloRequest {
  op: "hello";
  args: {
    protocol: number;
    /** `pi`, `claude`, `specialists`, `cli` — recorded, never trusted for authorisation. */
    client: string;
    clientVersion?: string;
  };
}

export interface HelloResult {
  protocol: number;
  /** The server package version, so the client can name the skew instead of guessing. */
  substrate: string;
  /** The closed set of ops this server implements. */
  capabilities: string[];
}

export class ServiceCallError extends Error {
  readonly code: ServiceErrorCode;

  constructor(code: ServiceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "ServiceCallError";
  }
}

export function encodeRequest(request: ServiceRequest): string {
  return JSON.stringify(request) + "\n";
}

/**
 * Parse one line. A malformed frame is an error with a null id: it can be
 * reported, and it cannot be attributed to a caller, so the connection survives
 * and the next frame is read normally.
 */
export function decodeRequest(line: string): ServiceRequest | ServiceError {
  const trimmed = line.trim();
  if (trimmed === "") return { code: "bad_request", message: "empty frame" };
  if (Buffer.byteLength(trimmed, "utf8") > MAX_FRAME_BYTES) {
    return { code: "bad_request", message: `frame exceeds ${MAX_FRAME_BYTES} bytes` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return { code: "bad_request", message: "frame is not JSON" };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { code: "bad_request", message: "frame must be a JSON object" };
  }
  const frame = raw as Record<string, unknown>;
  const id = frame["id"];
  if (typeof id !== "number" && typeof id !== "string") {
    return { code: "bad_request", message: "frame has no id" };
  }
  const op = frame["op"];
  if (typeof op !== "string" || op === "") {
    return { code: "bad_request", message: "frame has no op" };
  }
  const args = frame["args"];
  if (args !== undefined && (typeof args !== "object" || args === null || Array.isArray(args))) {
    return { code: "bad_request", message: "args must be an object" };
  }
  return { id, op, args: (args as Record<string, unknown> | undefined) ?? {} };
}

export function decodeResponse(line: string): ServiceResponse | ServiceError {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return { code: "internal", message: "response is not JSON" };
  }
  if (typeof raw !== "object" || raw === null) {
    return { code: "internal", message: "response must be a JSON object" };
  }
  const frame = raw as Record<string, unknown>;
  if (frame["ok"] === true) return { id: (frame["id"] as number | string | null) ?? null, ok: true, result: frame["result"] };
  if (frame["ok"] === false) {
    const error = frame["error"];
    if (typeof error === "object" && error !== null && typeof (error as Record<string, unknown>)["message"] === "string") {
      const code = (error as Record<string, unknown>)["code"];
      return {
        id: (frame["id"] as number | string | null) ?? null,
        ok: false,
        error: {
          code: (typeof code === "string" ? code : "internal") as ServiceErrorCode,
          message: (error as Record<string, unknown>)["message"] as string,
        },
      };
    }
    return { code: "internal", message: "error frame without a message" };
  }
  return { code: "internal", message: "response is neither ok nor error" };
}
