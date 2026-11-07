import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { substrateCliApi } from "./server/substrate-cli.ts";
import { researchCliApi } from "./server/research-cli.ts";
import { agentHostSshApi } from "./server/agent-host-ssh.ts";

// Console v1 backend that still owns GitHub fetch/cache (shell architecture §9.3).
const consoleUrl = process.env.XTRM_CONSOLE_URL ?? "http://127.0.0.1:3030";

// Same /api proxies for `vite dev` and `vite preview`: the production serve mode
// (`npm run research:serve`) is the same app without the dev server's per-module cost.
const proxy = {
  "/api/github": { target: consoleUrl, changeOrigin: true },
  "/api/programme": { target: consoleUrl, changeOrigin: true },
};
// Tailnet access via MagicDNS; not public.
const allowedHosts = [".ts.net"];

export default defineConfig({
  plugins: [react(), tailwindcss(), substrateCliApi(), researchCliApi(), agentHostSshApi()],
  server: {
    port: 5178,
    allowedHosts,
    proxy,
  },
  preview: { port: 5178, allowedHosts, proxy },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "server/**/*.test.ts"],
  },
});
