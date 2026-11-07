import { expect, test } from "@playwright/test";

test("shows live agent evidence and reports, then follows a forced revision over polling fallback", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("Valid API credentials");
  await page.getByLabel("Bearer token").fill("local-e2e-token-0000000000000000000000");
  await page.getByRole("button", { name: "Apply credentials" }).click();
  await expect(page.getByLabel("Project", { exact: true })).toHaveValue("demo");
  await expect(page.getByRole("status")).toContainText("Live updates");
  await expect(page.getByRole("button", { name: /research rev 1/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /analysis rev 1/ })).toBeVisible();
  await page.getByLabel("Topic filter").fill("unmatched");
  await expect(page.getByText("No results match this project and topic.")).toBeVisible();
  await page.getByLabel("Topic filter").fill("sample");

  await page.getByRole("button", { name: "Publishers", exact: true }).click();
  await expect(page.getByRole("region", { name: "Publishers" }).getByText("research")).toBeVisible();
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await page.getByRole("button", { name: "sample · Revision 1" }).click();
  const detail = page.getByRole("region", { name: "Consolidation details" });
  await expect(detail.getByText("Simulated report generated from deterministic mock fixtures.")).toBeVisible();
  await expect(detail.getByRole("heading", { name: "Contradictions" })).toBeVisible();
  await expect(detail.getByText("Missing publisher · review")).toBeVisible();
  await detail.getByRole("button", { name: /^Source / }).first().click();
  await expect(detail.getByText("Event ID", { exact: true })).toBeVisible();
  await detail.getByRole("button", { name: "Close details" }).click();

  await page.route("**/api/events?*", route => route.abort());
  await page.reload();
  await page.getByLabel("Bearer token").fill("local-e2e-token-0000000000000000000000");
  await page.getByRole("button", { name: "Apply credentials" }).click();
  await expect(page.getByRole("status")).toContainText("Polling fallback");
  await page.getByLabel("Topic filter").fill("sample");
  await page.getByRole("checkbox", { name: "Force new revision" }).check();
  await page.getByRole("button", { name: "Run consolidation" }).click();
  await expect(detail.getByRole("heading", { name: "Report revision 2" })).toBeVisible({ timeout: 12_000 });
  await expect(detail.getByText("completed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await expect(page.getByRole("button", { name: "sample · Revision 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "sample · Revision 2" })).toBeVisible();

  await page.getByLabel("Project", { exact: true }).selectOption("other");
  await expect(page.getByText("No results match this project and topic.")).toBeVisible();
  await expect(page.getByRole("button", { name: /research rev 1/ })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(pageErrors).toEqual([]);
});
