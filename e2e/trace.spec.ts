import { test, expect } from "@playwright/test";
import { seed, OPS, TRACE_IDS } from "./seed";

test.beforeEach(async ({ request }) => {
  await seed(request);
});

test("clicking a trace opens its page with a waterfall of spans", async ({ page }) => {
  await page.goto("/");
  await page.locator(".trace-row", { hasText: OPS.checkout }).click();

  await expect(page).toHaveURL(new RegExp(`/trace/${TRACE_IDS.checkout}`));
  await expect(page.locator(".trace-page")).toBeVisible();

  // Waterfall is the default tab; the checkout trace has 3 spans.
  await expect(page.locator(".wf-row").first()).toBeVisible();
  expect(await page.locator(".wf-row").count()).toBeGreaterThanOrEqual(3);
});

test("switching to the sequence tab renders the sequence diagram", async ({ page }) => {
  await page.goto(`/trace/${TRACE_IDS.checkout}`);
  await page.locator(".tab", { hasText: "Sequence" }).click();
  await expect(page.locator(".seq-svg")).toBeVisible();
});

test("waterfall shows a time axis, depth rails, and the shared span detail", async ({ page }) => {
  await page.goto(`/trace/${TRACE_IDS.checkout}`);
  // time axis ticks over the track column
  await expect(page.locator(".wf-tick-label").first()).toBeVisible();
  // nested spans draw a depth rail
  await expect(page.locator(".wf-rail").first()).toBeVisible();
  // the checkout trace errors — the shared detail auto-selects the failing span
  await expect(page.locator(".wf-detail")).toContainText("payments");
  await expect(page.locator(".wf-detail")).toContainText("error");
});

test("span selection is shared across the waterfall and sequence tabs", async ({ page }) => {
  await page.goto(`/trace/${TRACE_IDS.checkout}`);

  // select the root span in the waterfall
  await page.locator(".wf-row", { hasText: OPS.checkout }).first().click();
  await expect(page.locator(".wf-detail")).toContainText(OPS.checkout);

  // switch to the sequence tab — the same span stays selected in the shared detail
  await page.locator(".tab", { hasText: "Sequence" }).click();
  await expect(page.locator(".seq-svg")).toBeVisible();
  await expect(page.locator(".wf-detail")).toContainText(OPS.checkout);

  // clicking a message arrow selects the span it represents (the failing "charge")
  await page.locator(".seq-msg-clickable").first().click();
  await expect(page.locator(".wf-detail")).toContainText("charge");

  // back on the waterfall, that span is the highlighted row
  await page.locator(".tab", { hasText: "Waterfall" }).click();
  await expect(page.locator(".wf-row-selected")).toContainText("charge");
});

test("the back link returns to the live dashboard", async ({ page }) => {
  await page.goto(`/trace/${TRACE_IDS.checkout}`);
  await page.getByRole("link", { name: "← Live" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(".trace-list")).toBeVisible();
});
