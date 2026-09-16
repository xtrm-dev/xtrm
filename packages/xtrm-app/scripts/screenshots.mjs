// Runnable receipt: screenshots of the executable Console v2 shell.
// Usage (dev server running):
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core XTRM_APP_URL=http://127.0.0.1:5178 node scripts/screenshots.mjs <outDir> [dark|light]
// playwright-core is not a package dependency; point PLAYWRIGHT_CORE at any local install.
// The script never saves an edit: editors are opened and cancelled.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const core = process.env.PLAYWRIGHT_CORE;
if (!core) throw new Error("set PLAYWRIGHT_CORE to a playwright-core directory");
const { chromium } = await import(pathToFileURL(join(core, "index.mjs")).href);

const out = process.argv[2] ?? "screenshots";
const theme = process.argv[3] ?? "dark";
const base = process.env.XTRM_APP_URL ?? "http://127.0.0.1:5178";
const repo = process.env.XTRM_REPO ?? "xtrm-dev/xtrm";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));

await page.goto(base + "/repositories");
await page.evaluate((t) => {
  localStorage.setItem("xtrm.console.theme.v1", t);
  localStorage.removeItem("xtrm.console.layout.v1");
}, theme);

async function shot(name, url, act) {
  await page.goto(base + url);
  await page.waitForTimeout(3500);
  if (act) await act();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/${theme}-${name}.png` });
  console.log("shot", name, page.url());
}

const issues = `/rep/${repo}/work/issues`;
await shot("01-issues", issues);
await shot("02-issue-drawer", `${issues}?inspect=issue:XTRM-252`);
await shot("03-issue-page", `${issues}/XTRM-252`);
await shot("04-issue-imported-normalize", `${issues}/XTRM-94`);
await shot("05-normalize-review", `${issues}/XTRM-94`, () => page.getByRole("button", { name: "Review mapping" }).click());
await shot("06-edit-problem-rich", `${issues}/XTRM-393`, () => page.getByRole("button", { name: "Edit Problem" }).click());
await shot("07-edit-scope-list", `${issues}/XTRM-393`, () => page.getByRole("button", { name: "Edit Scope" }).click());
await shot("08-status-select", `${issues}/XTRM-393`, () => page.getByRole("button", { name: /^Status:/ }).click());
await shot("09-new-issue", issues, () => page.getByRole("button", { name: "New issue" }).click());
await shot("10-issue-activity-page-scrolled", `${issues}/XTRM-252`, () => page.mouse.wheel(0, 2400));
await shot("11-program-mode", "/program?inspect=program:WS-003");
await shot("12-search", issues, async () => {
  await page.keyboard.press("Control+k");
  await page.keyboard.type("substrate");
});
await shot("13-collapsed-sidebar-pinned", `${issues}?inspect=issue:XTRM-393&drawer=pinned`, () => page.keyboard.press("Control+b"));

console.log("errors", JSON.stringify(errors.slice(0, 20)));
await browser.close();
