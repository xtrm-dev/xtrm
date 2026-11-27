import { fileURLToPath } from "node:url"

import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

import { piViewerApi } from "./server/plugin.ts"

/**
 * Chunking (XTRM-1067). One 766 kB chunk meant every reload of the thread view re-parsed react-dom,
 * the markdown stack and the motion library that only the resizable shell uses. Three vendor chunks
 * let the browser keep those across a deploy, and the app chunk holds only this package's code.
 */
const VENDOR_CHUNKS: [string, RegExp][] = [
  ["react", /node_modules\/(react|react-dom|scheduler)\//],
  ["markdown", /node_modules\/(react-markdown|remark-.+|unified|micromark.*|mdast.*|hast.*|unist.*|vfile.*|bail|trough|is-plain-obj|devlop|character-entities.*|decode-named-character-reference|trim-lines|space-separated-tokens|comma-separated-tokens|property-information|html-url-attributes|ccount|markdown-table|longest-streak|zwitch|estree-util-.+|html-void-elements|stringify-entities|escape-string-regexp|github-slugger|style-to-.+|web-namespaces)\//],
  ["motion", /node_modules\/(motion-panels|motion-dom|motion-utils|framer-motion|motion)\//],
]

export default defineConfig({
  plugins: [react(), tailwindcss(), piViewerApi()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          for (const [name, pattern] of VENDOR_CHUNKS) if (pattern.test(id)) return name
          return undefined
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: { host: "127.0.0.1", port: 5199, strictPort: true },
  preview: { host: "127.0.0.1", port: 5199, strictPort: true },
})
