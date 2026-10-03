import { expect, test } from "@playwright/test";

// Agent host SSH connection states on the fixture (PRD §35.5, XTRM-585). The real ssh path is
// covered by server/agent-host-ssh.integration.test.ts.

test("connection walks unconfigured → disconnected → connecting → error / connected, and Open in terminal builds the ssh -t command", async ({ page }) => {
  await page.goto("/agent/pi-main");
  const panel = page.getByTestId("host-connection");
  const phase = page.getByTestId("host-connection-phase");
  const toggle = page.getByTestId("host-connection-toggle");
  await expect(toggle).toHaveAccessibleName("Agent host · Not configured");
  // Without a connection, Open in terminal is the local tmux attach.
  await expect(page.getByRole("button", { name: "Open in terminal · copies tmux attach -t xtrm-main" })).toBeVisible();
  await toggle.click();
  await expect(phase).toHaveText("Not configured");

  // Protocol-major mismatch: the error names the protocol versions and the fix.
  await panel.getByRole("textbox", { name: "SSH target" }).fill("mismatch.example");
  await panel.getByRole("button", { name: "Save", exact: true }).click();
  await expect(phase).toHaveText("Disconnected");
  await panel.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(panel).toHaveAttribute("data-phase", "connecting");
  await expect(phase).toHaveText("Connecting");
  await expect(phase).toHaveText("Connection failed");
  await expect(page.getByTestId("host-connection-error")).toContainText("speaks protocol v2; this app speaks v1");

  // Another target with a stored remote command connects and lists sessions over the forward.
  await panel.getByRole("button", { name: "Edit connection" }).click();
  await panel.getByRole("textbox", { name: "SSH target" }).fill("agent-box");
  await expect(panel.getByRole("textbox", { name: "Remote command" })).toHaveCount(0);
  await panel.getByRole("button", { name: "Set a remote command…" }).click();
  await panel.getByRole("textbox", { name: "Remote command" }).fill("~/.local/bin/xt host ensure --json");
  await panel.getByRole("button", { name: "Save", exact: true }).click();
  await panel.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(phase).toHaveText("Connected");
  await expect(panel).toContainText("protocol v1");
  await expect(panel).toContainText("via login shell");
  await expect(page.getByTestId("host-session-count")).toHaveText("2 sessions on host");

  // Open in terminal for the selected tmux-hosted session goes over ssh.
  await page.getByRole("button", { name: "Open in terminal over ssh" }).click();
  await expect(page.getByRole("button", { name: "Command copied · ssh -t agent-box tmux attach -t xtrm-main" })).toBeVisible();

  await panel.getByRole("button", { name: "Disconnect" }).click();
  await expect(phase).toHaveText("Disconnected");
  await expect(toggle).toHaveAccessibleName("Agent host · Disconnected");
});

test("an ssh failure shows the error and offers Retry", async ({ page }) => {
  await page.goto("/agent/pi-main");
  const panel = page.getByTestId("host-connection");
  await page.getByTestId("host-connection-toggle").click();
  await panel.getByRole("textbox", { name: "SSH target" }).fill("offline.example");
  await panel.getByRole("button", { name: "Save", exact: true }).click();
  await panel.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByTestId("host-connection-error")).toContainText("Permission denied (publickey)");
  await expect(panel.getByRole("button", { name: "Retry" })).toBeVisible();
  // A failure stays visible after the panel is closed.
  await page.getByTestId("host-connection-toggle").click();
  await expect(page.getByTestId("host-connection-error")).toBeVisible();
});

// Direct mode (PRD §35.5, XTRM-600) on the fixture: the real front, pairing and revoke are covered by
// e2e/real-host/direct-mode.spec.ts.
test("direct mode pairs once with a pairing token, refuses a replay, and forgets the device", async ({ page }) => {
  await page.goto("/agent/pi-main");
  const panel = page.getByTestId("host-connection");
  const toggle = page.getByTestId("host-connection-toggle");
  await toggle.click();
  await panel.getByTestId("host-mode-direct").click();
  await expect(page.getByTestId("host-direct-phase")).toHaveText("Not paired");
  const form = panel.getByRole("form", { name: "Pair with an agent host" });
  const pairButton = form.getByRole("button", { name: "Pair", exact: true });
  await form.getByRole("textbox", { name: "Front URL" }).fill("https://agent-box.tailnet.ts.net");
  await expect(pairButton).toBeDisabled();
  // The pairing token is a password field: never echoed on screen.
  await expect(form.getByLabel("Pairing token")).toHaveAttribute("type", "password");
  await form.getByLabel("Pairing token").fill("xtp_fixture1");
  await form.getByRole("textbox", { name: "Device name" }).fill("laptop");
  await pairButton.click();
  await expect(page.getByTestId("host-direct-phase")).toHaveText("Paired");
  await expect(page.getByTestId("host-direct-device")).toContainText("as laptop");
  await expect(page.getByTestId("host-session-count")).toHaveText("2 sessions on host");
  await expect(toggle).toHaveAccessibleName("Agent host · Paired");

  // The same token again is refused, and the paired device stays.
  await panel.getByRole("button", { name: "Pair again" }).click();
  await form.getByLabel("Pairing token").fill("xtp_fixture1");
  await pairButton.click();
  await expect(page.getByTestId("host-direct-error")).toContainText("unknown, used or expired");
  await expect(form.getByLabel("Pairing token")).toHaveValue("");
  await panel.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("host-direct-phase")).toHaveText("Paired");

  await panel.getByRole("button", { name: "Forget device" }).click();
  await expect(page.getByTestId("host-direct-phase")).toHaveText("Not paired");
  await expect(form.getByRole("textbox", { name: "Front URL" })).toHaveValue("");
});
