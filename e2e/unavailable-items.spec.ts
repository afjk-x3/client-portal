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
  const requestUrl = staff.url();

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
  // The F4 badge: a submitted-with-reason item reads "Not available", not "Submitted".
  await expect(contact.getByText("Not available", { exact: true })).toBeVisible();
  await expect(contact.getByText("Choose files or drag them here")).toHaveCount(0);

  // Staff see the answer as ready for review, marked "Not available".
  await staff.goto("/app");
  await staff.getByRole("tab", { name: /Ready for review/ }).click();
  const readyRow = staff.getByRole("row").filter({ hasText: "Investment statements" });
  await expect(readyRow).toContainText("Not available");

  // The request page marks the row; the sheet explains in place of files.
  await readyRow.getByRole("link", { name: "2026 tax documents" }).click();
  await expect(staff.getByRole("row").filter({ hasText: "Investment statements" })).toContainText("Not available");
  await staff.getByRole("button", { name: "Investment statements" }).click();
  const sheet = staff.getByRole("dialog", { name: "Investment statements" });
  await expect(sheet.getByText("The client says they don't have this")).toBeVisible();
  await expect(sheet.getByText("No investment account this year")).toBeVisible();
  await expect(sheet.getByText("No files yet.")).toHaveCount(0);

  // Staff send it back with a note.
  await sheet.getByRole("textbox", { name: "What needs to change?" }).fill("Please check your bank app");
  await sheet.getByRole("button", { name: "Needs changes" }).click();
  // Wait for the server action's success toast (the button label alone is visible pre-commit).
  await expectToast(staff, "Returned to the client with your note.");
  await staff.keyboard.press("Escape");

  // The contact sees the note and answers again.
  await contact.reload();
  await expect(contact.getByText("Changes requested")).toBeVisible();
  await expect(contact.getByText("Please check your bank app")).toBeVisible();
  await contact.getByRole("button", { name: "I don't have this" }).click();
  await contact.getByRole("textbox", { name: "Why not?" }).fill("Closed the account in 2025");
  await contact.getByRole("button", { name: "Send to Ledger & Co" }).click();
  await expectToast(contact, "Sent. Ledger & Co will review it.");
  await expect(contact.getByText("You told Ledger & Co you don't have this: “Closed the account in 2025”")).toBeVisible();

  // Staff accept it; the request completes and Activity records the answer.
  await staff.goto(requestUrl);
  await staff.getByRole("button", { name: "Investment statements" }).click();
  const sheet2 = staff.getByRole("dialog", { name: "Investment statements" });
  await sheet2.getByRole("button", { name: "Accept" }).click();
  await expect(sheet2.getByText("Accepted", { exact: true })).toBeVisible();
  await staff.keyboard.press("Escape");
  await expect(staff.getByRole("heading", { name: /2026 tax documents/ })).toContainText("Completed");
  await expect(
    staff.getByText("Pat Client said they don't have Investment statements: “Closed the account in 2025”"),
  ).toBeVisible();
});
