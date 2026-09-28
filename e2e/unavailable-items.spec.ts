import { expect, test } from "@playwright/test";
import { addClientWithContact, expectToast, fillRequest, signIn, signUpWithFirm, uniqueEmail } from "./helpers";

test("a contact answers that they don't have a document", async ({ browser }) => {
  const contactEmail = uniqueEmail("contact");
  const staffEmail = uniqueEmail("staff");
  const staff = await (await browser.newContext()).newPage();
  await signUpWithFirm(staff, staffEmail, "Ledger & Co", "Sam Staff");

  await addClientWithContact(staff, "Pat Client", contactEmail);
  await staff.getByRole("link", { name: "New request" }).click();
  await fillRequest(staff, "2026 tax documents", "Investment statements");
  await staff.getByRole("button", { name: "Send", exact: true }).click();
  await expect(staff).toHaveURL(/\/app\/requests\/[0-9a-f-]{36}$/);

  const contact = await (await browser.newContext()).newPage();
  await signIn(contact, contactEmail);
  await expect(contact).toHaveURL(/\/portal$/);
  await contact.getByRole("link", { name: /2026 tax documents/ }).click();
  await contact.getByRole("button", { name: "I don't have this" }).click();
  await contact.getByRole("textbox", { name: "Why not?" }).fill("No investment account this year");
  await contact.getByRole("button", { name: "Send to Ledger & Co" }).click();

  await expectToast(contact, "Sent. Ledger & Co will review it.");
  await expect(
    contact.getByText("You told Ledger & Co you don't have this: “No investment account this year”"),
  ).toBeVisible();
  await expect(contact.getByText("Submitted", { exact: true })).toBeVisible();
  await expect(contact.getByText("Choose files or drag them here")).toHaveCount(0);
});
