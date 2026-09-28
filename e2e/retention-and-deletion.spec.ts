import { expect, test } from "@playwright/test";
import { addClientWithContact, expectToast, fillRequest, signUpWithFirm, uniqueEmail } from "./helpers";

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
