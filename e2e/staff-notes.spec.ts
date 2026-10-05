import { expect, test } from "@playwright/test";
import { addClientWithContact, expectToast, fillRequest, signIn, signUpWithFirm, uniqueEmail } from "./helpers";

test("staff notes stay inside the firm", async ({ page, browser }) => {
  const contactEmail = uniqueEmail("contact");
  await signUpWithFirm(page, uniqueEmail("admin"), "Notes Firm", "Tia");

  // Tia adds Sam to the team.
  await page.getByRole("link", { name: "Settings" }).click();
  const samEmail = uniqueEmail("sam");
  await page.getByRole("button", { name: "Add staff" }).click();
  const addDialog = page.getByRole("dialog");
  await addDialog.getByRole("textbox", { name: "Full name" }).fill("Sam Staff");
  await addDialog.getByRole("textbox", { name: "Email" }).fill(samEmail);
  await addDialog.getByRole("button", { name: "Add staff" }).click();
  await expectToast(page, "Added.");

  // Tia sends Pat a request.
  await addClientWithContact(page, "Pat Client", contactEmail);
  await page.getByRole("link", { name: "New request" }).click();
  await fillRequest(page, "2026 taxes", "Photo ID");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/requests\/[0-9a-f-]{36}$/);
  const requestUrl = page.url();
  const requestId = requestUrl.split("/").pop()!;

  // A two-line note keeps both lines.
  const notes = page.getByRole("region", { name: "Notes" });
  await page.getByRole("textbox", { name: "Add a note" }).fill("Called Pat.\nShe'll drop off the rest Friday.");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(notes).toContainText("Tia");
  await expect(notes).toContainText("Called Pat.");
  await expect(notes).toContainText("She'll drop off the rest Friday.");

  // Sam reads it but cannot touch it.
  const sam = await (await browser.newContext()).newPage();
  await signIn(sam, samEmail);
  await expect(sam).toHaveURL(/\/app/);
  await sam.goto(requestUrl);
  const samNotes = sam.getByRole("region", { name: "Notes" });
  await expect(samNotes).toContainText("Called Pat.");
  await expect(samNotes.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(samNotes.getByRole("button", { name: "Delete" })).toHaveCount(0);

  // Tia edits it; it says it was edited.
  const note = notes.locator("li").filter({ hasText: "Called Pat." });
  await note.getByRole("button", { name: "Edit", exact: true }).click();
  await note.getByRole("textbox").fill("Called Pat. Friday.");
  await note.getByRole("button", { name: "Save", exact: true }).click();
  await expect(note).toContainText("· edited");

  // The client page lists it, labeled and linked to the request.
  await page.getByRole("link", { name: "Clients", exact: true }).click();
  // The heading first: the same link still exists (hidden) on the page we left.
  await expect(page.getByRole("heading", { name: "Clients", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Pat Client" }).click();
  const clientNotes = page.getByRole("region", { name: "Notes" });
  await expect(clientNotes).toContainText("Called Pat. Friday.");
  await expect(clientNotes.getByRole("link", { name: "On 2026 taxes" })).toHaveAttribute(
    "href",
    `/app/requests/${requestId}`,
  );

  // The contact's portal never shows it.
  const contact = await (await browser.newContext()).newPage();
  await signIn(contact, contactEmail);
  await expect(contact).toHaveURL(/\/portal$/);
  await contact.goto(`/portal/requests/${requestId}`);
  await expect(contact.locator("body")).not.toContainText("Called Pat");

  // Tia deletes it; it is gone from both pages.
  const clientNote = clientNotes.locator("li").filter({ hasText: "Called Pat." });
  await clientNote.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(clientNotes).not.toContainText("Called Pat.");
  await page.goto(requestUrl);
  await expect(page.getByRole("region", { name: "Notes" })).not.toContainText("Called Pat.");
});
