import { expect, test } from "@playwright/test";
import { SCALE_SESSIONS, hostGet, log, startPi } from "../real-host/harness.ts";
import { sessionRow, shoot, state, watchConsole } from "./support.ts";

// Scale (coordinator request, §36.3 "the list is virtualized", §28): the host lists hundreds of sessions
// (an operator host listed 555). The harness seeded SCALE_SESSIONS history-only journals before the host
// started. The list must stay responsive and live sessions must be easy to find.
const NAME = "acc-scale";

test("note: with hundreds of sessions the list stays virtualized and responsive, and live sessions are easy to find", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  const id = await startPi(s, NAME);
  const listed = (await hostGet<{ sessions: Array<{ state: string }> }>(s, "/v1/sessions")).sessions;
  const live = listed.filter((x) => x.state !== "history_only").length;
  log(s, `scale: host lists ${listed.length} sessions, ${live} live`);
  expect(listed.length).toBeGreaterThanOrEqual(SCALE_SESSIONS);

  const t0 = Date.now();
  await page.goto(`/agent/${id}`);
  await page.getByRole("radio", { name: "All" }).click();
  await expect(sessionRow(page, NAME)).toBeVisible();
  const openMs = Date.now() - t0;
  const header = page.getByRole("listitem").filter({ hasText: /^Other\d+$/ });
  await expect(header).toBeVisible();
  // Virtualized: only the rows in view (plus overscan) are mounted.
  const mounted = await page.getByTestId("session-row").count();
  log(s, `scale: list open in ${openMs} ms; ${mounted} session rows mounted for ${listed.length} sessions; group ${await header.innerText()}`);
  expect(mounted).toBeLessThan(80);
  await shoot(page, "note-scale-list", s);

  // Live sessions sit above the mass of old history: no seeded history row precedes a live row.
  const labels = await page.getByTestId("session-row").evaluateAll((rows) => rows.map((r) => r.getAttribute("aria-label") ?? ""));
  const firstSeeded = labels.findIndex((l) => l.startsWith("scale-"));
  const lastLive = labels.reduce((n, l, i) => (l.endsWith("history only") ? n : i), -1);
  log(s, `scale: mounted rows ${JSON.stringify(labels.slice(0, 12))}…; last live row ${lastLive}, first seeded row ${firstSeeded}`);
  expect(lastLive).toBeGreaterThanOrEqual(0);
  expect(firstSeeded === -1 || firstSeeded > lastLive).toBe(true);

  // The filter finds a live session among hundreds at once.
  const t1 = Date.now();
  await page.getByRole("textbox", { name: "Filter sessions" }).fill(NAME);
  await expect(page.getByTestId("session-row")).toHaveCount(1);
  log(s, `scale: filter to ${NAME} in ${Date.now() - t1} ms`);
  expect(Date.now() - t1).toBeLessThan(3_000);
  await shoot(page, "note-scale-filter", s);

  // The oldest seeded session is reachable by scrolling to the end.
  await page.getByRole("textbox", { name: "Filter sessions" }).fill("");
  const list = page.getByRole("list", { name: "Sessions" });
  const t2 = Date.now();
  for (let i = 0; i < 20 && !(await sessionRow(page, `scale-${String(SCALE_SESSIONS - 1).padStart(3, "0")}`).count()); i++) {
    await list.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.waitForTimeout(100);
  }
  await expect(sessionRow(page, `scale-${String(SCALE_SESSIONS - 1).padStart(3, "0")}`)).toBeVisible();
  log(s, `scale: scrolled to the oldest session in ${Date.now() - t2} ms`);
  await shoot(page, "note-scale-scrolled", s);
});
