// `sb serve --stdio`: the typed service in-process consumers call over one ssh
// connection per client process.
//
// Shape, and why:
//   - newline-delimited JSON in, newline-delimited JSON out; stdout carries the
//     protocol and nothing else, so a client's log lines never corrupt a frame;
//   - the first frame is `hello`, which returns the protocol version, the server
//     package version and the exact capability list. A client can therefore name
//     a skew ("server speaks protocol 1, needs 2") instead of failing later with
//     a domain error that looks like bad data;
//   - operations come from a closed table (`ops.ts`). Nothing here accepts SQL,
//     a file path or an expression, so the wire cannot be widened by a caller;
//   - one store, opened here, on the machine that owns the file.
//
// Frames are split on 0x0A in the BYTE stream and decoded only once a frame is
// complete. Decoding each 64 KiB read separately (what this did first) splits a
// multibyte character at a read boundary into U+FFFD and answers `ok: true` with
// corrupted text; a newline byte cannot occur inside a UTF-8 sequence, so
// splitting on newline first is both correct and cheaper than a StringDecoder.
//
// A frame longer than MAX_FRAME_BYTES is discarded to its terminating newline and
// answered with an error: without that cap the process buffers whatever a caller
// sends, and the linear rescans made a 64 MB frame take seconds of CPU.
//
// A malformed frame is answered and the connection survives: a client that
// writes a half line must not be able to kill a session that holds the store.
// A handler that fails answers `ok: false`; a handler that throws asynchronously
// (journal.checkpoint is async) is awaited here, so its failure is that answer
// and not an unhandled rejection that ends the process.

import { readSync, writeSync } from "node:fs";
import type { SubstrateDatabase } from "../store/database.ts";
import { openSubstrate } from "../store/sqlite.ts";
import { migrate } from "../store/migrations/runner.ts";
import { CAPABILITIES, OPERATIONS, assertKnownArgs, classifyError, createServices } from "./ops.ts";
import {
  MAX_FRAME_BYTES,
  PROTOCOL_VERSION,
  ServiceCallError,
  decodeRequest,
  type HelloResult,
  type ServiceResponse,
} from "./protocol.ts";

/** Where frames come from. The production source reads fd 0 in 64 KiB buffers. */
export interface FrameSource {
  /** The next chunk of bytes, or null at end of file. */
  next(): Promise<Buffer | null>;
}

export interface ServeIO {
  /** One complete response line (the caller adds the newline). */
  write(line: string): void;
  /** Diagnostics: never protocol, always a different stream. */
  log(line: string): void;
}

export interface ServeOptions {
  dbPath: string;
  /** The server package version, reported by the handshake. */
  version: string;
  io?: Partial<ServeIO>;
  frames?: FrameSource;
  /** Forks the database handles for a caller that already has one (tests). */
  db?: SubstrateDatabase;
  /** Ambient identity variables to drop before serving (defaults to all of them). */
  stripAmbientIdentity?: boolean;
}

// A service answers identity from the wire, never from whoever started it: the
// server process may itself run inside a harness session, and inheriting that
// holder would attribute a remote caller's writes to the server's environment.
const AMBIENT_IDENTITY_KEYS = [
  "SUBSTRATE_HOLDER",
  "SUBSTRATE_ISSUE_REF",
  "SUBSTRATE_ISSUE",
  "SUBSTRATE_ACTIVATION_ID",
  "SUBSTRATE_SPECIALIST",
  "XTRM_SESSION_ID",
  "XTRM_SESSION_NAME",
] as const;

const NEWLINE = 0x0a;

/** Reads bytes from fd 0 without decoding them. */
function fdFrames(): FrameSource {
  const buffer = Buffer.allocUnsafe(64 * 1024);
  return {
    next: () =>
      new Promise<Buffer | null>((resolve, reject) => {
        try {
          const read = readSync(0, buffer, 0, buffer.length, null);
          resolve(read === 0 ? null : Buffer.from(buffer.subarray(0, read)));
        } catch (error) {
          reject(error);
        }
      }),
  };
}

// A pipe is non-blocking, so writeSync takes what fits and reports the count. Ignoring
// that count truncated every answer above the pipe buffer (~140 KiB observed): the tail
// and its newline were lost, and the caller saw a timeout followed by peer_noise.
const SLEEP = new Int32Array(new SharedArrayBuffer(4));

// A reader that stops draining would otherwise pin the server forever, and the
// hook budget or the caller's timeout would expire with nothing on the wire.
const MAX_WRITE_WAIT_MS = 30_000;

function writeAll(fd: number, line: string): void {
  const payload = Buffer.from(line + "\n", "utf8");
  const deadline = Date.now() + MAX_WRITE_WAIT_MS;
  let offset = 0;
  while (offset < payload.length) {
    if (Date.now() > deadline) {
      throw new Error(`the peer has not read a response for ${MAX_WRITE_WAIT_MS} ms; giving up on this frame`);
    }
    try {
      offset += writeSync(fd, payload, offset, payload.length - offset);
    } catch (error) {
      const code = (error as { code?: string }).code;
      // The reader has not drained the pipe yet. Waiting is the whole point of a
      // synchronous server: a frame either arrives complete or the server fails loudly.
      if (code !== "EAGAIN" && code !== "EWOULDBLOCK") throw error;
      Atomics.wait(SLEEP, 0, 0, 2);
    }
  }
}

function fdIO(): ServeIO {
  return {
    write: (line) => {
      writeAll(1, line);
    },
    log: (line) => {
      writeAll(2, line);
    },
  };
}

type Frame = { kind: "line"; text: string; terminated: boolean } | { kind: "oversize"; bytes: number };

/**
 * Splits a byte stream into newline-terminated frames.
 *
 * Keeps the chunks it has not yet delivered, scans each chunk once for the
 * newline byte (so the cost is bounded by the byte cap, not quadratic in
 * the frame), and enforces MAX_FRAME_BYTES by discarding to the next newline.
 */
export class FrameReader {
  private parts: Buffer[] = [];
  private bytes = 0;
  private discarding = false;
  private discarded = 0;

  private readonly source: FrameSource;

  constructor(source: FrameSource) {
    this.source = source;
  }

  async next(): Promise<Frame | null> {
    for (;;) {
      if (this.discarding) {
        const found = this.findNewline();
        if (found !== null) {
          this.take(found);
          this.discarding = false;
          const bytes = this.discarded;
          this.discarded = 0;
          return { kind: "oversize", bytes };
        }
        this.discarded += this.bytes;
        this.parts = [];
        this.bytes = 0;
        const chunk = await this.source.next();
        if (chunk === null) {
          this.discarding = false;
          return { kind: "oversize", bytes: this.discarded };
        }
        this.parts.push(chunk);
        this.bytes += chunk.length;
        continue;
      }

      const found = this.findNewline();
      if (found !== null) {
        // A frame that arrives complete in the same read still has to pass the
        // cap: checking only "no newline yet" let one 8 MB write through.
        const size = this.sizeBefore(found);
        const line = this.take(found);
        if (size > MAX_FRAME_BYTES) return { kind: "oversize", bytes: size };
        return { kind: "line", text: line.toString("utf8"), terminated: true };
      }

      if (this.bytes > MAX_FRAME_BYTES) {
        this.discarding = true;
        this.discarded = this.bytes;
        this.parts = [];
        this.bytes = 0;
        continue;
      }

      const chunk = await this.source.next();
      if (chunk === null) {
        if (this.bytes === 0) return null;
        const last = Buffer.concat(this.parts, this.bytes);
        this.parts = [];
        this.bytes = 0;
        // A writer that closes mid-frame must be told, not answered as if its
        // request were complete.
        return { kind: "line", text: last.toString("utf8"), terminated: false };
      }
      this.parts.push(chunk);
      this.bytes += chunk.length;
    }
  }

  private sizeBefore(found: { part: number; index: number }): number {
    let total = found.index;
    for (let part = 0; part < found.part; part += 1) total += this.parts[part]!.length;
    return total;
  }

  private findNewline(): { part: number; index: number } | null {
    for (let part = 0; part < this.parts.length; part += 1) {
      const index = this.parts[part]!.indexOf(NEWLINE);
      if (index >= 0) return { part, index };
    }
    return null;
  }

  private take(found: { part: number; index: number }): Buffer {
    const head = this.parts.slice(0, found.part);
    head.push(this.parts[found.part]!.subarray(0, found.index));
    const rest = this.parts[found.part]!.subarray(found.index + 1);
    this.parts = rest.length > 0 ? [rest] : [];
    this.bytes = rest.length;
    return Buffer.concat(head);
  }
}

/** A client label is echoed into a log line, so it is reduced to printable ASCII. */
function label(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  const printable = value.replace(/[^\x20-\x7e]/g, "").slice(0, 64);
  return printable === "" ? "unknown" : printable;
}

function has(operation: string): boolean {
  return Object.hasOwn(OPERATIONS, operation);
}

/** Serves until EOF. Returns the process exit code. */
export async function serveStdio(options: ServeOptions): Promise<number> {
  const io = options.io ?? {};
  const write = io.write ?? fdIO().write;
  const log = io.log ?? fdIO().log;
  const reader = new FrameReader(options.frames ?? fdFrames());

  if (options.stripAmbientIdentity !== false) {
    for (const key of AMBIENT_IDENTITY_KEYS) delete process.env[key];
  }

  const db = options.db ?? openSubstrate(options.dbPath);
  if (options.db === undefined) migrate(db);
  const services = createServices(db);

  const respond = (
    frame: ServiceResponse | { id: null; ok: false; error: { code: string; message: string } },
  ): void => {
    const line = JSON.stringify(frame);
    // The client drops a line past its cap and kills the connection, so an oversized
    // answer becomes a typed refusal naming the operation instead of a dead session.
    if (Buffer.byteLength(line, "utf8") > MAX_FRAME_BYTES) {
      write(
        JSON.stringify({
          id: frame.id,
          ok: false,
          error: {
            code: "bad_request",
            message: `the answer to "${"ok" in frame && frame.ok && "op" in frame ? String((frame as { op?: string }).op ?? "the operation") : "the operation"}" is larger than ${MAX_FRAME_BYTES} bytes; ask for less (fewer rows, a shorter contract, a smaller page)`,
          },
        }),
      );
      return;
    }
    write(line);
  };

  let greeted = false;
  let code = 0;

  try {
    for (;;) {
      const frame = await reader.next();
      if (frame === null) break;
      if (frame.kind === "oversize") {
        respond({
          id: null,
          ok: false,
          error: {
            code: "bad_request",
            message: `the frame exceeded ${MAX_FRAME_BYTES} bytes and was discarded; send smaller operations`,
          },
        });
        continue;
      }
      const line = frame.text;
      if (line.trim() === "") continue;

      if (!frame.terminated) {
        // The writer closed mid-frame: answer with what it can correlate, and do
        // not run an operation whose request is only partly known.
        const partial = decodeRequest(line);
        respond(
          "code" in partial
            ? { id: null, ok: false, error: { code: "bad_request", message: "the frame was not newline-terminated" } }
            : { id: partial.id, ok: false, error: { code: "bad_request", message: "the frame was not newline-terminated" } },
        );
        continue;
      }

      const request = decodeRequest(line);
      if ("code" in request) {
        respond({ id: null, ok: false, error: { code: request.code, message: request.message } });
        continue;
      }
      const { id, op } = request;
      const args = request.args ?? {};

      if (op === "hello") {
        const asked = args["protocol"];
        if (typeof asked !== "number" || !Number.isInteger(asked)) {
          respond({ id, ok: false, error: { code: "bad_request", message: 'hello needs a numeric "protocol"' } });
          continue;
        }
        if (asked !== PROTOCOL_VERSION) {
          respond({
            id,
            ok: false,
            error: {
              code: "unsupported",
              message: `protocol ${asked} is not supported by this server (it speaks ${PROTOCOL_VERSION})`,
            },
          });
          continue;
        }
        greeted = true;
        const hello: HelloResult = {
          protocol: PROTOCOL_VERSION,
          substrate: options.version,
          capabilities: CAPABILITIES,
        };
        respond({ id, ok: true, result: hello });
        log(`sb serve: ${label(args["client"])} connected (${CAPABILITIES.length} operations)`);
        continue;
      }

      if (!greeted) {
        respond({ id, ok: false, error: { code: "bad_request", message: "send hello before any other operation" } });
        continue;
      }

      if (!has(op)) {
        respond({ id, ok: false, error: { code: "unknown_op", message: `unknown operation "${op}"` } });
        continue;
      }
      try {
        // A handler may be async (journal.checkpoint awaits a summarizer): awaiting
        // it here turns its rejection into this frame's answer instead of an
        // unhandled rejection that would end a process holding the store.
        assertKnownArgs(op, args);
        const answer = OPERATIONS[op]!(services, args);
        const result = answer instanceof Promise ? await answer : answer;
        respond({ id, ok: true, result });
      } catch (error) {
        const classified = classifyError(error);
        log(`sb serve: ${op} failed: ${classified.message}`);
        respond({ id, ok: false, error: classified });
      }
    }
  } catch (error) {
    const classified = error instanceof ServiceCallError ? classifyError(error) : classifyError(error);
    log(`sb serve: stopped on an internal error: ${classified.message}`);
    code = 1;
  } finally {
    if (options.db === undefined) db.close();
  }
  return code;
}

/** The wire shape a client parses; exported so the client and server cannot drift. */
export type { ServiceResponse };
