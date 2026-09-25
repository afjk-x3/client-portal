import { expect, test } from "@playwright/test";
import { addClientWithContact, expectToast, fillRequest, signIn, signUpWithFirm, uniqueEmail } from "./helpers";

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

test("the Activity section shows who did what, newest first", async ({ browser }) => {
  const staff = await (await browser.newContext()).newPage();
  await signUpWithFirm(staff, uniqueEmail("activity"), "Timeline Firm", "Tia Staff");
  const contactEmail = uniqueEmail("remy");
  await addClientWithContact(staff, "Remy Client", contactEmail);
  await staff.getByRole("link", { name: "New request" }).click();
  await fillRequest(staff, "Year-end", "Bank letter");
  await staff.getByRole("button", { name: "Send", exact: true }).click();
  await expectToast(staff, "Request sent.");
  const activity = staff.getByRole("region", { name: "Activity" });
  await expect(activity.getByRole("listitem")).toHaveText([/^Tia Staff sent the request · /]);

  const contact = await (await browser.newContext()).newPage();
  await signIn(contact, contactEmail);
  await contact.getByRole("link", { name: /Year-end/ }).click();
  await contact.locator('input[type="file"]').setInputFiles({ name: "letter.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(contact.getByRole("button", { name: "Remove letter.pdf" })).toBeVisible();
  await contact.getByRole("button", { name: "Submit Bank letter" }).click();
  await expectToast(contact, /Submitted/);

  await staff.reload();
  await staff.getByRole("button", { name: "Bank letter" }).click();
  await staff.getByRole("dialog", { name: "Bank letter" }).getByRole("button", { name: "Accept" }).click();
  await expectToast(staff, "Item accepted.");
  await staff.keyboard.press("Escape");
  await staff.reload();
  await expect(activity.getByRole("listitem")).toHaveText([
    /^Tia Staff completed the request · /,
    /^Tia Staff accepted Bank letter · /,
    /^Remy Client submitted Bank letter · /,
    /^Remy Client added “letter\.pdf” to Bank letter · /,
    /^Tia Staff sent the request · /,
  ]);
});
