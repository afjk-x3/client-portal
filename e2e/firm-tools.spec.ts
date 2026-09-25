import { expect, test } from "@playwright/test";
import { addClientWithContact, expectToast, signIn, signUpWithFirm, uniqueEmail } from "./helpers";

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

test("time zones, sending to many clients, reminders now, and staff uploads", async ({ browser }) => {
  // The firm's time zone comes from the browser at signup, and admins can change it.
  const staff = await (await browser.newContext({ timezoneId: "Asia/Manila" })).newPage();
  await signUpWithFirm(staff, uniqueEmail("tz"), "Harbor Tax", "Hana Admin");
  await staff.getByRole("link", { name: "Settings" }).click();
  await expect(staff.getByRole("combobox", { name: "Time zone" })).toHaveText("Asia/Manila");
  await staff.getByRole("combobox", { name: "Time zone" }).click();
  await staff.getByRole("option", { name: "America/New York" }).click();
  await staff.getByRole("button", { name: "Save time zone" }).click();
  await expectToast(staff, "Time zone saved.");

  // One template, sent to two clients at once.
  const tessEmail = uniqueEmail("tess");
  await addClientWithContact(staff, "Tess Client", tessEmail);
  await addClientWithContact(staff, "Uma Client", uniqueEmail("uma"));
  await staff.getByRole("link", { name: "Templates" }).click();
  await staff.getByRole("link", { name: "Annual tax return (starter)" }).click();
  await staff.getByRole("link", { name: "Send to clients" }).click();
  await expect(staff.getByRole("heading", { name: "Send to clients" })).toBeVisible();
  await staff.getByRole("checkbox", { name: /Tess Client/ }).click();
  await staff.getByRole("checkbox", { name: /Uma Client/ }).click();
  await staff.getByRole("button", { name: "Due date" }).click();
  await staff.getByRole("button", { name: "Go to the Next Month" }).click();
  await staff.getByRole("button", { name: /15th/ }).click();
  await staff.getByRole("button", { name: "Send to 2 clients" }).click();
  await staff.getByRole("alertdialog").getByRole("button", { name: "Send" }).click();
  await expectToast(staff, "Sent to 2 clients.");
  await expect(staff).toHaveURL(/\/app$/);
  await expect(staff.getByRole("tab", { name: "Waiting on clients (2)" })).toBeVisible();

  // Times show in the firm's zone; a reminder goes out at most once a day.
  await staff.getByRole("row", { name: /Tess Client/ }).getByRole("link").click();
  await expect(staff.getByText(/Sent .* E[DS]T/)).toBeVisible();
  const requestUrl = staff.url();
  await staff.getByRole("button", { name: "Send reminder" }).click();
  await expectToast(staff, "Reminder sent.");
  await staff.getByRole("button", { name: "Send reminder" }).click();
  await expectToast(staff, "A reminder already went out today.");

  // Staff add a file for the client, who sees it but cannot remove it.
  await staff.getByRole("button", { name: "Government-issued photo ID" }).click();
  let sheet = staff.getByRole("dialog", { name: "Government-issued photo ID" });
  await sheet.locator('input[type="file"]').setInputFiles({ name: "id-scan.pdf", mimeType: "application/pdf", buffer: PDF });
  await expectToast(staff, "id-scan.pdf added.");
  await expect(sheet.getByText("id-scan.pdf")).toBeVisible();
  await expect(sheet.getByText("Added by staff")).toBeVisible();

  const tess = await (await browser.newContext()).newPage();
  await signIn(tess, tessEmail);
  await expect(tess).toHaveURL(/\/portal$/);
  await tess.getByRole("link", { name: /Annual tax return/ }).click();
  await expect(tess.getByText("Added by Harbor Tax")).toBeVisible();
  await expect(tess.getByRole("button", { name: "Remove id-scan.pdf" })).toHaveCount(0);
  await tess.locator('input[type="file"]').first().setInputFiles({ name: "tess.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(tess.getByRole("button", { name: "Remove tess.pdf" })).toBeVisible();

  // Staff can remove only what staff added.
  await staff.goto(requestUrl);
  await staff.getByRole("button", { name: "Government-issued photo ID" }).click();
  sheet = staff.getByRole("dialog", { name: "Government-issued photo ID" });
  await expect(sheet.getByText("tess.pdf")).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Remove tess.pdf" })).toHaveCount(0);
  await sheet.getByRole("button", { name: "Remove id-scan.pdf" }).click();
  await expectToast(staff, "File removed.");
  await expect(sheet.getByText("id-scan.pdf")).toHaveCount(0);
});
