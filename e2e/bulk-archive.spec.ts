import { expect, test } from "@playwright/test";
import { addClientWithContact, expectToast, fillRequest, signUpWithFirm, uniqueEmail } from "./helpers";

test("staff tick requests and archive them together", async ({ page }) => {
  await signUpWithFirm(page, uniqueEmail("bulk"), "Ledger & Co", "Sam Staff");
  await addClientWithContact(page, "Pat Client", uniqueEmail("contact"));

  for (const [title, action] of [
    ["Q1 papers", "Send"],
    ["Q2 papers", "Send"],
    ["Q3 draft", "Save draft"],
  ] as const) {
    await page.getByRole("link", { name: "New request" }).click();
    await fillRequest(page, title, "Photo ID");
    await page.getByRole("button", { name: action, exact: true }).click();
    await expect(page).toHaveURL(/\/app\/requests\/[0-9a-f-]{36}$/);
    await expectToast(page, action === "Send" ? "Request sent." : "Draft saved.");
    await page.getByRole("link", { name: "Pat Client", exact: true }).click();
    await expect(page.getByRole("link", { name: "New request" })).toBeVisible();
  }

  // Only open and completed rows can be ticked.
  await page.getByRole("link", { name: "Requests", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/requests$/);
  await expect(page.getByRole("checkbox", { name: "Select Q3 draft" })).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Select all on this page" }).click();
  await expect(page.getByText("2 selected")).toBeVisible();

  // Clearing and changing a filter both drop the selection.
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByText("2 selected")).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Select Q1 papers" }).click();
  await expect(page.getByText("1 selected")).toBeVisible();
  await page.getByLabel("Status").selectOption("archived");
  await expect(page).toHaveURL(/status=archived/);
  await expect(page.getByText("1 selected")).toHaveCount(0);
  await page.getByLabel("Status").selectOption("active");
  await expect(page.getByRole("checkbox", { name: "Select Q1 papers" })).toBeVisible();

  // Both sent requests archive together, with the open count in the dialog.
  await page.getByRole("checkbox", { name: "Select Q1 papers" }).click();
  await page.getByRole("checkbox", { name: "Select Q2 papers" }).click();
  await page.getByRole("button", { name: "Archive 2 requests" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("heading", { name: "Archive 2 requests?" })).toBeVisible();
  await expect(dialog).toContainText("2 of them are still open.");
  await dialog.getByRole("button", { name: "Archive", exact: true }).click();
  await expectToast(page, "Archived 2 requests.");

  await expect(page.getByRole("link", { name: "Q1 papers" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Q2 papers" })).toHaveCount(0);
  await page.getByLabel("Status").selectOption("archived");
  await expect(page.getByRole("link", { name: "Q1 papers" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Q2 papers" })).toBeVisible();

  await page.getByRole("link", { name: "Q1 papers" }).click();
  const activity = page.getByRole("region", { name: "Activity" });
  await expect(activity.getByRole("listitem").first()).toHaveText(/^Sam Staff archived the request/);

  // A colleague archives the ticked request first: the batch is stale.
  await page.getByRole("link", { name: "Clients", exact: true }).click();
  await page.getByRole("link", { name: "Pat Client", exact: true }).click();
  await page.getByRole("link", { name: "New request" }).click();
  await fillRequest(page, "Q4 papers", "Photo ID");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/requests\/[0-9a-f-]{36}$/);
  await expectToast(page, "Request sent.");

  await page.getByRole("link", { name: "Requests", exact: true }).click();
  await page.getByRole("checkbox", { name: "Select Q4 papers" }).click();
  const archive = page.getByRole("button", { name: "Archive 1 request" });
  await expect(archive).toBeVisible();

  const href = await page.getByRole("link", { name: "Q4 papers" }).getAttribute("href");
  const second = await page.context().newPage();
  await second.goto(href!);
  await second.getByRole("button", { name: "More actions" }).click();
  await second.getByRole("menuitem", { name: "Archive", exact: true }).click();
  await expectToast(second, "Request archived. Reminders have stopped.");
  await second.close();

  await archive.click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Archive", exact: true }).click();
  await expectToast(page, "This has changed since the page loaded. Refresh and try again.");
});
