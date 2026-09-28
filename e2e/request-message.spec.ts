import { expect, test } from "@playwright/test";
import { addClientWithContact, expectToast, fillRequest, signIn, signUpWithFirm, uniqueEmail } from "./helpers";

test("a personal message reaches the portal and can be changed", async ({ page, browser }) => {
  const contactEmail = uniqueEmail("contact");
  await signUpWithFirm(page, uniqueEmail("staff"), "Ledger & Co", "Sam Staff");
  await addClientWithContact(page, "Pat Client", contactEmail);

  await page.getByRole("link", { name: "New request" }).click();
  await fillRequest(page, "2026 tax documents", "Photo ID");
  await page
    .getByRole("textbox", { name: "Message to the client (optional)" })
    .fill("Hi Pat,\nThese are for your 2026 return.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/requests\/[0-9a-f-]{36}$/);

  // The contact sees the message above the progress bar, both lines kept.
  const contact = await (await browser.newContext()).newPage();
  await signIn(contact, contactEmail);
  await expect(contact).toHaveURL(/\/portal$/);
  await contact.getByRole("link", { name: /2026 tax documents/ }).click();
  const card = contact.locator('[data-slot="card"]', { hasText: "Message from Ledger & Co" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Hi Pat,");
  await expect(card).toContainText("These are for your 2026 return.");
  const cardBox = await card.boundingBox();
  const progressBox = await contact.getByRole("progressbar").boundingBox();
  expect(cardBox!.y).toBeLessThan(progressBox!.y);

  // Staff change the message in Edit details; the portal shows the new text.
  await page.getByRole("button", { name: "Edit details" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Message to the client (optional)" }).fill("Please upload by the 15th.");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expectToast(page, "Request updated.");

  await contact.reload();
  await expect(card).toContainText("Please upload by the 15th.");
  await expect(card).not.toContainText("Hi Pat,");

  // Clearing the message removes the card.
  await page.getByRole("button", { name: "Edit details" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Message to the client (optional)" }).fill("");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expectToast(page, "Request updated.");

  await contact.reload();
  await expect(contact.locator('[data-slot="card"]', { hasText: "Message from Ledger & Co" })).toHaveCount(0);
});
