import { expect, test } from "@playwright/test";
import { addClientWithContact, expectToast, fillRequest, signIn, signUpWithFirm, uniqueEmail } from "./helpers";

test("an admin deletes an archived client", async ({ page }) => {
  await signUpWithFirm(page, uniqueEmail("admin"), "Ledger & Co", "Ada Admin");
  await addClientWithContact(page, "Pat Client", uniqueEmail("contact"));
  const clientId = page.url().split("/").pop()!;

  await page.getByRole("link", { name: "New request" }).click();
  await fillRequest(page, "Year-end pack", "Bank statement");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/requests\/[0-9a-f-]{36}$/);

  await page.getByRole("link", { name: "Pat Client" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/clients/${clientId}`));
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expectToast(page, "Client archived.");

  await page.getByRole("button", { name: "Delete client" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("heading", { name: "Delete Pat Client?" })).toBeVisible();
  await expect(dialog).toContainText(
    "This permanently deletes Pat Client, their contacts, every request with its answers and files, and its Activity history. It can't be undone.",
  );
  const confirm = dialog.getByRole("textbox", { name: "Type Pat Client to confirm" });
  const action = dialog.getByRole("button", { name: "Delete client" });
  await expect(action).toBeDisabled();
  await confirm.fill("  Pat Client  ");
  await action.click();

  await expect(page).toHaveURL(/\/app\/clients$/);
  await page.getByRole("checkbox", { name: "Show archived" }).check();
  await expect(page.getByRole("cell", { name: "Pat Client", exact: true })).toHaveCount(0);
});

test("retention saves without a dialog when nothing would be deleted", async ({ page }) => {
  await signUpWithFirm(page, uniqueEmail("retention"), "Ledger & Co", "Ada Admin");

  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("combobox", { name: "Keep files from archived requests" }).click();
  await page.getByRole("option", { name: "1 year after archiving" }).click();
  await page.getByRole("button", { name: "Save file retention" }).click();
  await expectToast(page, "File retention saved.");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("combobox", { name: "Keep files from archived requests" })).toContainText("1 year");
});

test("staff who are not admins cannot delete clients", async ({ page, browser }) => {
  const staffEmail = uniqueEmail("cy");
  await signUpWithFirm(page, uniqueEmail("admin"), "Ledger & Co", "Ada Admin");

  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Add staff" }).click();
  const addDialog = page.getByRole("dialog");
  await addDialog.getByRole("textbox", { name: "Full name" }).fill("Cy Staff");
  await addDialog.getByRole("textbox", { name: "Email" }).fill(staffEmail);
  await addDialog.getByRole("button", { name: "Add staff" }).click();
  await expectToast(page, "Added.");

  await page.getByRole("link", { name: "Clients", exact: true }).click();
  await addClientWithContact(page, "Pat Client", uniqueEmail("contact"));
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expectToast(page, "Client archived.");

  const staffPage = await (await browser.newContext()).newPage();
  await signIn(staffPage, staffEmail);
  await staffPage.getByRole("link", { name: "Clients", exact: true }).click();
  await staffPage.getByRole("checkbox", { name: "Show archived" }).check();
  await staffPage.getByRole("link", { name: "Pat Client" }).click();
  await expect(staffPage.getByRole("button", { name: "Delete client" })).toHaveCount(0);

  await staffPage.getByRole("link", { name: "Settings" }).click();
  await expect(
    staffPage.getByRole("combobox", { name: "Keep files from archived requests" }),
  ).toBeDisabled();
});
