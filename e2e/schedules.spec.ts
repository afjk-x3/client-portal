import { expect, test, type Page } from "@playwright/test";
import { addClientWithContact, expectToast, signUpWithFirm, uniqueEmail } from "./helpers";

/** The 15th of next month, formatted as the schedule list shows it. */
function nextMonth15() {
  const now = new Date();
  const date = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 15));
  return date.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}

/** Two clients exist with contacts; sends the starter template to both on the 15th. */
async function createSchedule(page: Page) {
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
}

test("create a schedule", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await signUpWithFirm(page, uniqueEmail("admin"), "Schedule Firm", "Ada Admin");
  await addClientWithContact(page, "Beta Builders", uniqueEmail("beta"));
  await addClientWithContact(page, "Gamma Goods", uniqueEmail("gamma"));
  await createSchedule(page);

  await expect(page.getByRole("heading", { name: "Schedules" })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "Annual tax return (starter)" });
  await expect(row.getByRole("cell", { name: "Monthly on the 15th" })).toBeVisible();
  await expect(row.getByRole("cell", { name: "2", exact: true })).toBeVisible();
  await expect(row.getByRole("cell", { name: nextMonth15() })).toBeVisible();
  await expect(row.getByRole("cell", { name: "Never" })).toBeVisible();
  await page.close();
});

test("pause, resume, edit, and delete a schedule", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await signUpWithFirm(page, uniqueEmail("admin"), "Schedule Firm", "Ada Admin");
  await addClientWithContact(page, "Beta Builders", uniqueEmail("beta"));
  await addClientWithContact(page, "Gamma Goods", uniqueEmail("gamma"));
  await createSchedule(page);

  // Pausing shows "Paused"; resuming brings the date back.
  await page.getByRole("link", { name: "Annual tax return (starter)" }).click();
  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("link", { name: "Schedules" }).click();
  await expect(page.getByRole("cell", { name: "Paused" })).toBeVisible();
  await page.getByRole("link", { name: "Annual tax return (starter)" }).click();
  await page.getByRole("button", { name: "Resume" }).click();
  await page.getByRole("link", { name: "Schedules" }).click();
  await expect(page.getByRole("cell", { name: nextMonth15() })).toBeVisible();

  // Editing the title shows on the list.
  await page.getByRole("link", { name: "Annual tax return (starter)" }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("Monthly bookkeeping");
  await page.getByRole("button", { name: "Save" }).click();
  await expectToast(page, "Schedule saved.");
  await page.getByRole("link", { name: "Schedules" }).click();
  await expect(page.getByRole("link", { name: "Monthly bookkeeping" })).toBeVisible();

  // An archived client is marked on the schedule's page.
  await page.getByRole("link", { name: "Clients", exact: true }).click();
  await page.getByRole("link", { name: "Beta Builders" }).click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expectToast(page, "Client archived.");
  await page.getByRole("link", { name: "Schedules" }).click();
  await page.getByRole("link", { name: "Monthly bookkeeping" }).click();
  // Scoped to the picker row: pages navigated away stay mounted hidden (<Activity>),
  // and the archived client's own page also has an "Archived" badge.
  const betaRow = page.getByRole("listitem").filter({ hasText: "Beta Builders" });
  await expect(betaRow.getByText("Archived", { exact: true })).toBeVisible();

  // The template's delete dialog counts the schedules it takes with it.
  await page.getByRole("link", { name: "Templates" }).click();
  // The heading first: the same link still exists (hidden) on the page we left.
  await expect(page.getByRole("heading", { name: "Templates", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Annual tax return (starter)" }).click();
  await page.getByRole("button", { name: "Delete template" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Its 1 schedules will be deleted too.");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // Deleting the schedule empties the list.
  await page.getByRole("link", { name: "Schedules" }).click();
  await page.getByRole("link", { name: "Monthly bookkeeping" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/schedules$/);
  await expect(page.getByText("No schedules yet. Start one from a template's page.")).toBeVisible();
  await page.close();
});
