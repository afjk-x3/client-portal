import { expect, test, type Browser, type Page } from "@playwright/test";
import { addClientWithContact, expectToast, fillRequest, signIn, signUpWithFirm, uniqueEmail } from "./helpers";

/** A tiny solid-colour PNG, built in the page's canvas. */
async function png(page: Page, colour: string): Promise<Buffer> {
  const base64 = await page.evaluate((fill) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 8;
    const context = canvas.getContext("2d")!;
    context.fillStyle = fill;
    context.fillRect(0, 0, 8, 8);
    return canvas.toDataURL("image/png").split(",")[1]!;
  }, colour);
  return Buffer.from(base64, "base64");
}

/** A contact with an open request holding one file item, on the request page. */
async function portalWithItem(browser: Browser, itemTitle: string): Promise<Page> {
  const contactEmail = uniqueEmail("scanner");
  const staff = await (await browser.newContext()).newPage();
  await signUpWithFirm(staff, uniqueEmail("scanstaff"), "Ledger & Co", "Sam Staff");
  await addClientWithContact(staff, "Pat Client", contactEmail);
  await staff.getByRole("link", { name: "New request" }).click();
  await fillRequest(staff, "2026 statements", itemTitle);
  await staff.getByRole("button", { name: "Send", exact: true }).click();
  await expect(staff).toHaveURL(/\/app\/requests\/[0-9a-f-]{36}$/);

  const contact = await (await browser.newContext()).newPage();
  await signIn(contact, contactEmail);
  await contact.getByRole("link", { name: /2026 statements/ }).click();
  return contact;
}

test("scan two photos into one PDF", async ({ browser }) => {
  const contact = await portalWithItem(browser, "Bank statement");
  const red = await png(contact, "red");
  const blue = await png(contact, "blue");

  await contact.getByRole("button", { name: "Scan pages" }).click();
  const dialog = contact.getByRole("dialog", { name: "Scan pages" });
  await dialog.locator('input[type="file"]').setInputFiles([
    { name: "red.png", mimeType: "image/png", buffer: red },
    { name: "blue.png", mimeType: "image/png", buffer: blue },
  ]);
  await expect(dialog.getByAltText("Page 1: red.png")).toBeVisible();
  await expect(dialog.getByAltText("Page 2: blue.png")).toBeVisible();

  await dialog.getByRole("button", { name: "Move page 2 up" }).click();
  await expect(dialog.getByAltText("Page 1: blue.png")).toBeVisible();
  await expect(dialog.getByAltText("Page 1: red.png")).toHaveCount(0);

  await dialog.getByRole("button", { name: "Create PDF" }).click();
  await expect(dialog).toHaveCount(0);
  const download = contact.getByRole("link", { name: "Download Bank statement.pdf" });
  await expect(download).toBeVisible();

  const file = await contact.request.get((await download.getAttribute("href"))!);
  expect(file.status()).toBe(200);
  const body = (await file.body()).toString("latin1");
  expect(body.startsWith("%PDF-")).toBe(true);
  expect(body).toContain("/Count 2");
});

test("limits and mistakes", async ({ browser }) => {
  const contact = await portalWithItem(browser, "Bank statement");
  const red = await png(contact, "red");

  await contact.getByRole("button", { name: "Scan pages" }).click();
  const dialog = contact.getByRole("dialog", { name: "Scan pages" });
  const input = dialog.locator('input[type="file"]');

  await input.setInputFiles({ name: "broken.png", mimeType: "image/png", buffer: Buffer.from("not a photo") });
  await expectToast(
    contact,
    "broken.png: this photo can't be read here. Take a new photo, or upload it with Choose files.",
  );
  await expect(dialog.locator("img")).toHaveCount(0);

  await input.setInputFiles(
    Array.from({ length: 31 }, () => ({ name: "red.png", mimeType: "image/png", buffer: red })),
  );
  await expectToast(contact, "A PDF can have at most 30 pages.");
  await expect(dialog.locator("img")).toHaveCount(30);

  await contact.keyboard.press("Escape");
  const confirm = contact.getByRole("alertdialog", { name: "Discard 30 pages?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("img")).toHaveCount(30);
});
