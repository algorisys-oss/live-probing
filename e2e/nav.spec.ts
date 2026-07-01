import { test, expect } from "@playwright/test";
import { seed, OPS } from "./seed";

// Smoke coverage for the history-store-backed pages (errors / history / day).
// Seeded data is persisted synchronously on ingest, so these render populated.
test.beforeEach(async ({ request }) => {
  await seed(request);
});

test("errors page lists the seeded error endpoint", async ({ page }) => {
  await page.goto("/errors");
  await expect(page.getByRole("heading", { name: "Errors" })).toBeVisible();
  await expect(page.locator(".errors-table")).toContainText(OPS.checkout);
});

test("history page renders and links to a day", async ({ page }) => {
  await page.goto("/history");
  await expect(page.getByRole("heading", { name: "History" })).toBeVisible();

  const dayLink = page.locator(".day-link").first();
  await expect(dayLink).toBeVisible();

  // Following the day link renders the day rollup dashboard.
  await dayLink.click();
  await expect(page).toHaveURL(/\/day\/\d{4}-\d{2}-\d{2}/);
  expect(await page.locator(".rollup-card").count()).toBeGreaterThan(0);
});
