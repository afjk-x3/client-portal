import { expect, test } from "@playwright/test";
import { addClientWithContact, expectToast, fillRequest, signIn, signUpWithFirm, uniqueEmail } from "./helpers";

test("a client asks and staff answer", async ({ page, browser }) => {
  const contactEmail = uniqueEmail("contact");
  await signUpWithFirm(page, uniqueEmail("staff"), "Ledger & Co", "Sam Staff");
  await addClientWithContact(page, "Pat Client", contactEmail);

  await page.getByRole("link", { name: "New request" }).click();
  await fillRequest(page, "2026 tax documents", "Bank statement");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/requests\/[0-9a-f-]{36}$/);

  const contact = await (await browser.newContext()).newPage();
  await signIn(contact, contactEmail);
  await contact.getByRole("link", { name: /2026 tax documents/ }).click();

  // The contact asks a question with two lines.
  await contact.getByRole("button", { name: "Ask a question" }).click();
  await contact.getByRole("textbox", { name: "Write a message" }).fill("Which bank?\nI have two accounts.");
  await contact.getByRole("button", { name: "Send", exact: true }).click();
  await expectToast(contact, "Message sent.");
  const message = contact.getByRole("listitem").filter({ hasText: "Which bank?" });
  await expect(message).toContainText("You");
  await expect(message).toContainText("Which bank?");
  await expect(message).toContainText("I have two accounts.");
});
