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
  // Auto-retrying: the rollups render after the day-summary fetch, which can lose a
  // race against a bare count() snapshot.
  await expect(page.locator(".rollup-card").first()).toBeVisible();
});

test("history chart labels are legible (not black-on-dark)", async ({ page }) => {
  await page.goto("/history");
  const label = page.locator(".trends-chart .axis-label").first();
  await expect(label).toBeVisible();
  // Regression: the axis labels once fell back to the SVG default black fill
  // because .axis-label was only styled scoped under .latency-chart.
  const fill = await label.evaluate((el) => getComputedStyle(el).fill);
  expect(fill).not.toBe("rgb(0, 0, 0)");
});

test("theme toggle switches light/dark and persists", async ({ page }) => {
  await page.goto("/history");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "dark");

  await page.locator(".theme-toggle").click();
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );

  // Choice survives a reload (persisted to localStorage, applied pre-paint).
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
