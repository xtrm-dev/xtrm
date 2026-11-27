import type { IncomingMessage, ServerResponse } from "node:http"
import type { Connect, Plugin } from "vite"

import { handleApi } from "./api.ts"

function attach(middlewares: Connect.Server): void {
  middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
    handleApi(req, res)
      .then((handled) => {
        if (!handled) next()
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        if (!res.headersSent) {
          res.statusCode = 500
          res.setHeader("content-type", "application/json; charset=utf-8")
        }
        res.end(JSON.stringify({ error: message }))
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
