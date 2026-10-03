import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { substrateCliApi } from "./server/substrate-cli.ts";
import { researchCliApi } from "./server/research-cli.ts";
import { agentHostSshApi } from "./server/agent-host-ssh.ts";

// Console v1 backend that still owns GitHub fetch/cache (shell architecture §9.3).
const consoleUrl = process.env.XTRM_CONSOLE_URL ?? "http://127.0.0.1:3030";

export default defineConfig({
  plugins: [react(), tailwindcss(), substrateCliApi(), researchCliApi(), agentHostSshApi()],
  server: {
    port: 5178,
    // Tailnet preview via MagicDNS (`vite --host <tailscale ip>`); not public.
    allowedHosts: [".ts.net"],
    proxy: {
      "/api/github": { target: consoleUrl, changeOrigin: true },
      "/api/programme": { target: consoleUrl, changeOrigin: true },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "server/**/*.test.ts"],
  },
});
