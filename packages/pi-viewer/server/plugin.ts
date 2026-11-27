import type { IncomingMessage, ServerResponse } from "node:http"
import type { Connect, Plugin } from "vite"

import { handleApi, INTERNAL_ERROR } from "./api.ts"

function attach(middlewares: Connect.Server): void {
  middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
    handleApi(req, res)
      .then((handled) => {
        if (!handled) next()
      })
      .catch((error: unknown) => {
        // Same fixed body as handleApi's own unhandled-rejection sink; the detail stays in the log
        // (XTRM-1116, PR #512 review).
        console.error("[pi-viewer] api error", error)
        if (!res.headersSent) {
          res.statusCode = 500
          res.setHeader("content-type", "application/json; charset=utf-8")
        }
        res.end(JSON.stringify({ error: INTERNAL_ERROR }))
      })
  })
}

/** Serves the read-only tmux/pi API in both dev and preview. No other process is touched. */
export function piViewerApi(): Plugin {
  return {
    name: "pi-viewer-api",
    configureServer(server) {
      attach(server.middlewares)
    },
    configurePreviewServer(server) {
      attach(server.middlewares)
    },
  }
}
