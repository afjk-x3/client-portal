import { expect, test } from "@playwright/test";
import { addClient, fillRequest, signUpWithFirm, uniqueEmail } from "./helpers";

test("forms keep typed values, pages kept mounted stay correct", async ({ page }) => {
  await signUpWithFirm(page, uniqueEmail("safeguards"), "Fix Firm", "Fix Staff");

  // Back after "New client" shows the new client: the list was revalidated.
  await addClient(page, "Alpha Client");
  await page.goBack();
  await expect(page.getByRole("link", { name: "Alpha Client" })).toBeVisible();

  // A server-side validation error keeps what was typed.
  await page.getByRole("link", { name: "Alpha Client" }).click();
  await page.getByRole("button", { name: "Add contact" }).click();
  const contactDialog = page.getByRole("dialog");
  await contactDialog.getByRole("textbox", { name: "Full name" }).fill("Pat Typo");
  await contactDialog.getByRole("textbox", { name: "Email" }).fill("pat@example");
  await contactDialog.getByRole("button", { name: "Add contact" }).click();
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  await expect(contactDialog.getByRole("textbox", { name: "Full name" })).toHaveValue("Pat Typo");
  await expect(contactDialog.getByRole("textbox", { name: "Email" })).toHaveValue("pat@example");
  await page.keyboard.press("Escape");

  // An unsaved request for one client does not carry over to another client's New request.
  await page.getByRole("link", { name: "New request" }).click();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Only for Alpha");
  await addClient(page, "Beta Client");
  await page.getByRole("link", { name: "New request" }).click();
  await expect(page.getByText("For Beta Client")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("");

  // "Edit details" starts from the saved due date, not one picked and then cancelled.
  await fillRequest(page, "Beta docs", "Receipts");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Open", { exact: true })).toBeVisible();
  const savedDue = await page.getByText(/^For .* · Due /).textContent();
  await page.getByRole("button", { name: "Edit details" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Due date" }).click();
  await page.getByRole("button", { name: /20th/ }).click();
  await expect(page.getByRole("grid")).toBeHidden();
  await expect(dialog.getByRole("button", { name: "Due date" })).toContainText("20");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "Edit details" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Request updated.")).toBeVisible();
  await expect(page.getByText(/^For .* · Due /)).toHaveText(savedDue!);
});
