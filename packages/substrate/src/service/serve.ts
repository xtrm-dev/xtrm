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
// The loop is synchronous on purpose: `sb` is a synchronous CLI, and a service
// that needed an event loop would have to change the entrypoint of every command
// to serve one verb. Reading fd 0 directly also means a closed ssh channel is an
// ordinary EOF, not an error to classify.
//
// A malformed frame is answered and the connection survives: a client that
// writes a half line must not be able to kill a session that holds the store.

import { readSync, writeSync } from "node:fs";
import type { SubstrateDatabase } from "../store/database.ts";
import { openSubstrate } from "../store/sqlite.ts";
import { migrate } from "../store/migrations/runner.ts";
import { CAPABILITIES, OPERATIONS, classifyError, createServices } from "./ops.ts";
import {
  PROTOCOL_VERSION,
  ServiceCallError,
  decodeRequest,
  type HelloResult,
  type ServiceResponse,
} from "./protocol.ts";

/** The three facts a frame can leave the service through. Injectable for tests. */
export interface ServeIO {
  /** The next chunk of input, or null at end of file. */
  read(): string | null;
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
  /** Forks the database handles for a caller that already has one (tests). */
  db?: SubstrateDatabase;
}

function fdIO(): ServeIO {
  const buffer = Buffer.allocUnsafe(64 * 1024);
  return {
    read: () => {
      const read = readSync(0, buffer, 0, buffer.length, null);
      return read === 0 ? null : buffer.subarray(0, read).toString("utf8");
    },
    write: (line) => {
      writeSync(1, line + "\n");
    },
    log: (line) => {
      writeSync(2, line + "\n");
    },
  };
}

/** Serves until EOF. Returns the process exit code. */
export function serveStdio(options: ServeOptions): number {
  const defaults = fdIO();
  const read = options.io?.read ?? defaults.read;
  const write = options.io?.write ?? defaults.write;
  const log = options.io?.log ?? defaults.log;

  const db = options.db ?? openSubstrate(options.dbPath);
  if (options.db === undefined) migrate(db);
  const services = createServices(db);

  const respond = (frame: ServiceResponse | { id: null; ok: false; error: { code: string; message: string } }): void => {
    write(JSON.stringify(frame));
  };

  let greeted = false;
  let pending = "";
  let code = 0;

  try {
    for (;;) {
      const chunk = read();
      if (chunk === null) break;
      pending += chunk;
      for (;;) {
        const newline = pending.indexOf("\n");
        if (newline < 0) break;
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (line.trim() === "") continue;

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
            dbPath: options.dbPath,
            capabilities: CAPABILITIES,
          };
          respond({ id, ok: true, result: hello });
          log(`sb serve: ${String(args["client"] ?? "unknown")} connected (${CAPABILITIES.length} operations)`);
          continue;
        }

        if (!greeted) {
          respond({ id, ok: false, error: { code: "bad_request", message: "send hello before any other operation" } });
          continue;
        }

        const handler = OPERATIONS[op];
        if (!handler) {
          respond({ id, ok: false, error: { code: "unknown_op", message: `unknown operation "${op}"` } });
          continue;
        }
        try {
          respond({ id, ok: true, result: handler(services, args) });
        } catch (error) {
          const classified = classifyError(error);
          log(`sb serve: ${op} failed: ${classified.message}`);
          respond({ id, ok: false, error: classified });
        }
      }
    }
    // A last line without a newline is still a frame: a client that writes one
    // request and closes must not be answered with silence.
    if (pending.trim() !== "") {
      const request = decodeRequest(pending);
      respond(
        "code" in request
          ? { id: null, ok: false, error: { code: request.code, message: request.message } }
          : { id: request.id, ok: false, error: { code: "bad_request", message: "the frame was not newline-terminated" } },
      );
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
