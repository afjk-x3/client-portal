import { expect, test } from "@playwright/test";
import { addClientWithContact, signUpWithFirm, uniqueEmail } from "./helpers";

/** The 15th of next month, formatted as the schedule list shows it. */
function nextMonth15() {
  const now = new Date();
  const date = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 15));
  return date.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}

test("create a schedule", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await signUpWithFirm(page, uniqueEmail("admin"), "Schedule Firm", "Ada Admin");
  await addClientWithContact(page, "Beta Builders", uniqueEmail("beta"));
  await addClientWithContact(page, "Gamma Goods", uniqueEmail("gamma"));

  await page.getByRole("link", { name: "Templates" }).click();
  await page.getByRole("link", { name: "Annual tax return (starter)" }).click();
  await page.getByRole("link", { name: "Send on a schedule" }).click();
  await expect(page.getByRole("heading", { name: "Send on a schedule" })).toBeVisible();

  await page.getByRole("checkbox", { name: /Beta Builders/ }).click();
  await page.getByRole("checkbox", { name: /Gamma Goods/ }).click();
  await page.getByRole("button", { name: "First send date" }).click();
  await page.getByRole("button", { name: "Go to the Next Month" }).click();
  await page.getByRole("button", { name: /15th/ }).click();
  await page.getByRole("button", { name: "Create schedule" }).click();

  await expect(page).toHaveURL(/\/app\/schedules$/);
  await expect(page.getByRole("heading", { name: "Schedules" })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "Annual tax return (starter)" });
  await expect(row.getByRole("cell", { name: "Monthly on the 15th" })).toBeVisible();
  await expect(row.getByRole("cell", { name: "2", exact: true })).toBeVisible();
  await expect(row.getByRole("cell", { name: nextMonth15() })).toBeVisible();
  await expect(row.getByRole("cell", { name: "Never" })).toBeVisible();
  await page.close();
});
