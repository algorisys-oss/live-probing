import { test, expect } from "@playwright/test";
import { seed, OPS, GATEWAY } from "./seed";

test.beforeEach(async ({ request }) => {
  await seed(request);
});

test("live dashboard lists seeded traces in the feed", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".trace-list")).toBeVisible();
  await expect(page.locator(".trace-row", { hasText: OPS.checkout })).toBeVisible();
  await expect(page.locator(".trace-row", { hasText: OPS.cart })).toBeVisible();
  await expect(page.locator(".trace-row", { hasText: OPS.catalog })).toBeVisible();
});

test("flow view renders topology nodes for the seeded services", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".flow-svg")).toBeVisible();
  expect(await page.locator(".flow-node-group").count()).toBeGreaterThan(0);
  // web-gateway is in every seeded trace, so its node label must render.
  await expect(page.locator(".flow-svg")).toContainText(GATEWAY);
});

test("the errored checkout trace is flagged in the feed", async ({ page }) => {
  await page.goto("/");
  const row = page.locator(".trace-row", { hasText: OPS.checkout });
  await expect(row.locator(".dot-error")).toBeVisible();
});

test("the header shows the app version", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".version")).toHaveText(/^v\d+\.\d+\.\d+/);
});

test("pause toggles the live feed control", async ({ page }) => {
  await page.goto("/");
  const pause = page.getByRole("button", { name: /pause/i });
  await expect(pause).toBeVisible();
  await pause.click();
  await expect(page.getByRole("button", { name: /paused/i })).toBeVisible();
});
