import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { substrateCliApi } from "./server/substrate-cli.ts";
import { researchCliApi } from "./server/research-cli.ts";
import { agentHostSshApi } from "./server/agent-host-ssh.ts";
import { statusBoardApi } from "./server/status-board-api.ts";
import { jiraApi } from "./server/jira-api.ts";

// Console v1 backend that still owns GitHub fetch/cache (shell architecture §9.3).
const consoleUrl = process.env.XTRM_CONSOLE_URL ?? "http://127.0.0.1:3030";

// Same /api proxies for `vite dev` and `vite preview`: the production serve mode
// (`npm run research:serve`) is the same app without the dev server's per-module cost.
const proxy = {
  "/api/github": { target: consoleUrl, changeOrigin: true },
};
// Tailnet access via MagicDNS; not public.
const allowedHosts = [".ts.net"];

export default defineConfig({
  plugins: [react(), tailwindcss(), substrateCliApi(), researchCliApi(), agentHostSshApi(), statusBoardApi(), jiraApi()],
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
    // XTRM-914: vitest's 5 s default is below the wall time these suites need on a loaded
    // runner. A full `vitest run` on a host at ~150% CPU measured one test at 4914 ms and six
    // above 4 s (slowest: GitHub Issues surface 4914 ms, Issues toolbar 4788 ms), so the gate
    // failed at random and reviewers re-ran it. 20 s keeps 4x margin over the slowest measured
    // test and still ends a hung test quickly; the tests that need more set their own value
    // (pi-ai import scan 30 s). Assertions are unchanged.
    testTimeout: 20_000,
  },
});
