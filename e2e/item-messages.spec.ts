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
  const asked = contact.getByRole("listitem").filter({ hasText: "Which bank?" });
  await expect(asked).toContainText("You");
  await expect(asked).toContainText("Which bank?");
  await expect(asked).toContainText("I have two accounts.");

  // The dashboard's Messages tab shows it; its item link opens the sheet.
  await page.goto("/app");
  await page.getByRole("tab", { name: "Messages (1)" }).click();
  const row = page.getByRole("row").filter({ hasText: "Which bank?" });
  await expect(row).toContainText("Pat Client");
  await expect(row).toContainText("2026 tax documents");
  await expect(row).toContainText("Bank statement");
  await row.getByRole("link", { name: "Bank statement" }).click();
  const sheet = page.getByRole("dialog", { name: "Bank statement" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("New", { exact: true })).toBeVisible();
  await expect(sheet.getByText("Which bank?")).toBeVisible();

  // Staff answer under "Write to the client"; the reply marks the question read.
  await sheet.getByRole("textbox", { name: "Write to the client" }).fill("The BDO one, please.");
  await sheet.getByRole("button", { name: "Send", exact: true }).click();
  await expectToast(page, "Message sent.");
  await page.goto("/app");
  await expect(page.getByRole("tab", { name: "Messages (0)" })).toBeVisible();

  // The contact reloads and sees the firm's reply.
  await contact.reload();
  const replied = contact.getByRole("listitem").filter({ hasText: "The BDO one, please." });
  await expect(replied).toContainText("Ledger & Co");
  await expect(replied).toContainText("The BDO one, please.");

  // A second question is cleared with "Mark as read".
  await contact.getByRole("textbox", { name: "Write a message" }).fill("Thanks!");
  await contact.getByRole("button", { name: "Send", exact: true }).click();
  await expectToast(contact, "Message sent.");
  await page.goto("/app");
  await page.getByRole("tab", { name: "Messages (1)" }).click();
  await page.getByRole("row").filter({ hasText: "Thanks!" }).getByRole("link", { name: "Bank statement" }).click();
  const sheet2 = page.getByRole("dialog", { name: "Bank statement" });
  await sheet2.getByRole("button", { name: "Mark as read" }).click();
  await expectToast(page, "Marked as read.");
  await page.goto("/app");
  await expect(page.getByRole("tab", { name: "Messages (0)" })).toBeVisible();

  // A message written just before archiving never shows in the tab.
  await contact.getByRole("textbox", { name: "Write a message" }).fill("One more thing.");
  await contact.getByRole("button", { name: "Send", exact: true }).click();
  await expectToast(contact, "Message sent.");
  await page.goto("/app");
  await page.getByRole("tab", { name: "Messages (1)" }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "One more thing." })
    .getByRole("link", { name: "2026 tax documents" })
    .click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await page.goto("/app");
  await expect(page.getByRole("tab", { name: "Messages (0)" })).toBeVisible();
});
