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

test("the back link returns to the live dashboard", async ({ page }) => {
  await page.goto(`/trace/${TRACE_IDS.checkout}`);
  await page.getByRole("link", { name: "← Live" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(".trace-list")).toBeVisible();
});
