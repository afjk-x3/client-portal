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

/** Noisy JPEGs of the largest size the scanner keeps (2000px): about 1.9 MB each. */
async function noise(page: Page, count: number): Promise<Buffer[]> {
  const base64s = await page.evaluate(async (n) => {
    const canvas = document.createElement("canvas");
    canvas.width = 2000;
    canvas.height = 1500;
    const context = canvas.getContext("2d")!;
    const image = context.createImageData(canvas.width, canvas.height);
    for (let i = 0; i < image.data.length; i += 4) {
      const value = Math.random() * 255;
      image.data[i] = value;
      image.data[i + 1] = value;
      image.data[i + 2] = value;
      image.data[i + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    const data = canvas.toDataURL("image/jpeg", 0.85).split(",")[1]!;
    return Array.from({ length: n }, () => data);
  }, count);
  return base64s.map((data) => Buffer.from(data, "base64"));
}

/** A contact with an open request holding one file item, on the request page. */async function portalWithItem(browser: Browser, itemTitle: string): Promise<Page> {
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

test("a PDF over 25 MB is refused", async ({ browser }) => {
  const contact = await portalWithItem(browser, "Bank statement");

  await contact.getByRole("button", { name: "Scan pages" }).click();
  const dialog = contact.getByRole("dialog", { name: "Scan pages" });
  // 16 pages of noise weigh about 30 MB together: over MAX_FILE_BYTES, under the page limit.
  await dialog.locator('input[type="file"]').setInputFiles(
    (await noise(contact, 16)).map((buffer, i) => ({
      name: `noise${i + 1}.jpg`,
      mimeType: "image/jpeg",
      buffer,
    })),
  );
  await expect(dialog.locator("img")).toHaveCount(16);
  await dialog.getByRole("button", { name: "Create PDF" }).click();
  await expectToast(contact, "This PDF is over 25 MB. Remove some pages, or scan the rest separately.");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("img")).toHaveCount(16);
});
