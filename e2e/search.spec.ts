import { test, expect } from "@playwright/test";
import { seed, OPS } from "./seed";

test.beforeEach(async ({ request }) => {
  await seed(request);
});

test("search by endpoint substring returns the matching trace", async ({ page }) => {
  await page.goto("/search");
  await expect(page.getByRole("heading", { name: "Search traces" })).toBeVisible();

  await page.getByPlaceholder(/endpoint contains/).fill("checkout");
  await page.getByPlaceholder(/endpoint contains/).press("Enter");

  await expect(page.locator(".search-count")).toBeVisible();
  await expect(
    page.locator(".search-results .trace-row", { hasText: OPS.checkout }),
  ).toBeVisible();
});

test("search by span attribute finds the errored trace", async ({ page }) => {
  await page.goto("/search");
  const attr = page.getByPlaceholder(/attribute:/);
  await attr.fill("http.status_code=402");
  await attr.press("Enter");

  await expect(
    page.locator(".search-results .trace-row", { hasText: OPS.checkout }),
  ).toBeVisible();
});
