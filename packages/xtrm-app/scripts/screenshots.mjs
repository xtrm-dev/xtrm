// Runnable receipt: screenshots of the executable Console v2 shell.
// Usage (dev server running on :5178):
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core node scripts/screenshots.mjs <outDir> [dark|light]
// playwright-core is not a package dependency; point PLAYWRIGHT_CORE at any local install.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const core = process.env.PLAYWRIGHT_CORE;
if (!core) throw new Error("set PLAYWRIGHT_CORE to a playwright-core directory");
const { chromium } = await import(pathToFileURL(join(core, "index.mjs")).href);

const out = process.argv[2] ?? "screenshots";
const theme = process.argv[3] ?? "dark";
const base = process.env.XTRM_APP_URL ?? "http://127.0.0.1:5178";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));

await page.goto(base + "/repositories");
await page.evaluate((t) => localStorage.setItem("xtrm.console.theme.v1", t), theme);

async function shot(name, url, act) {
  await page.goto(base + url);
  await page.waitForTimeout(2500);
  if (act) await act();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${out}/${theme}-${name}.png` });
  console.log("shot", name, page.url());
}

await shot("01-issues", "/rep/xtrm-dev/xtrm/work/issues");
await shot("02-issue-contextual", "/rep/xtrm-dev/xtrm/work/issues?inspect=issue:XTRM-252");
await shot("03-issue-pinned", "/rep/xtrm-dev/xtrm/work/issues?inspect=issue:XTRM-252&drawer=pinned");
await shot("04-activity", "/rep/xtrm-dev/xtrm/code/activity", () => page.getByRole("listitem").first().getByRole("button").click());
await shot("05-program-maximized", "/program?inspect=program:WS-003&drawer=maximized");
await shot("06-search", "/rep/xtrm-dev/xtrm/work/issues", async () => {
  await page.keyboard.press("Control+k");
  await page.keyboard.type("console");
});
await shot("07-collapsed-sidebar", "/rep/xtrm-dev/xtrm/code/activity", () => page.keyboard.press("Control+b"));
await page.keyboard.press("Control+b");
await shot("08-agents-deferred", "/agents");
await shot("09-repository-selector", "/rep/xtrm-dev/xtrm/work/issues", () => page.getByRole("button", { name: /Repository:/ }).click());

console.log("errors", JSON.stringify(errors.slice(0, 20)));
await browser.close();
