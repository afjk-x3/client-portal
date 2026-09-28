import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { expectToast, signIn, signUpWithFirm, uniqueEmail } from "./helpers";

const HEADER = "\uFEFFclient_name,client_type,contact_name,contact_email";
const individuals = Array.from({ length: 55 }, (_, i) => {
  const n = String(i + 1).padStart(2, "0");
  return `Person ${n},individual,Contact ${n},contact${n}@example.com`;
});
const business = '"Peña, Ann Ltd",business,Ann Peña,-ann@example.com';
const source = [
  "client_name,client_type,contact_name,contact_email",
  ...individuals,
  business,
].join("\r\n");

test("exporting clients writes the import's columns, in the list's order", async ({ page }) => {
  await signUpWithFirm(page, uniqueEmail("export"), "Ledger & Co", "Ada Admin");

  await page.getByRole("link", { name: "Clients", exact: true }).click();
  await page.getByRole("link", { name: "Import CSV" }).click();
  await page.getByLabel("CSV file").setInputFiles({
    name: "clients.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(source),
  });
  await expect(page.getByRole("button", { name: "Import 56 rows" })).toBeVisible();
  await page.getByRole("button", { name: "Import 56 rows" }).click();
  await expect(
    page.getByText("56 clients created, 56 contacts added, 0 rows skipped, 0 rows failed."),
  ).toBeVisible();

  await page.getByRole("link", { name: "Back to clients" }).click();
  await expect(page.getByRole("link", { name: "Export CSV" })).toBeVisible();
  await page.getByLabel("Type").selectOption("individual");
  await expect(page).toHaveURL(/kind=individual/);

  const filteredDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export CSV" }).click();
  const filteredFile = await filteredDownload;
  expect(filteredFile.suggestedFilename()).toMatch(/^clients-\d{4}-\d{2}-\d{2}\.csv$/);
  const filtered = readFileSync((await filteredFile.path()) as string, "utf8");
  expect(filtered.startsWith(HEADER)).toBe(true);
  const filteredLines = filtered.split("\r\n");
  expect(filteredLines.length).toBe(56);
  expect(filtered).not.toContain("Peña");

  await page.getByLabel("Type").selectOption("");
  await expect(page).not.toHaveURL(/kind=individual/);
  const allDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export CSV" }).click();
  const allFile = await allDownload;
  const all = readFileSync((await allFile.path()) as string, "utf8");
  expect(all.split("\r\n").length).toBe(57);
  expect(all).toContain('"Peña, Ann Ltd",business,Ann Peña,\'-ann@example.com');

  // A bogus filter falls back to no filter instead of erroring.
  const bogus = await page.request.get("/api/clients/export?kind=bogus");
  expect(bogus.status()).toBe(200);
  expect((await bogus.text()).split("\r\n").length).toBe(57);

  // The export imports cleanly back: every row already exists.
  await page.getByRole("link", { name: "Import CSV" }).click();
  await page.getByLabel("CSV file").setInputFiles({
    name: "export.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(all),
  });
  await expect(page.getByRole("row").filter({ hasText: "Skipped" })).toHaveCount(56);
  await expect(page.getByRole("button", { name: "Import 0 rows" })).toBeDisabled();
});

test("only admins export, and everyone else gets 404", async ({ page, browser, request }) => {
  const staffEmail = uniqueEmail("cy");
  await signUpWithFirm(page, uniqueEmail("admin"), "Ledger & Co", "Ada Admin");
  await page.getByRole("link", { name: "Clients", exact: true }).click();
  await expect(page.getByRole("link", { name: "Export CSV" })).toBeVisible();

  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Add staff" }).click();
  const addDialog = page.getByRole("dialog");
  await addDialog.getByRole("textbox", { name: "Full name" }).fill("Cy Staff");
  await addDialog.getByRole("textbox", { name: "Email" }).fill(staffEmail);
  await addDialog.getByRole("button", { name: "Add staff" }).click();
  await expectToast(page, "Added.");

  const staffContext = await browser.newContext();
  const staffPage = await staffContext.newPage();
  await signIn(staffPage, staffEmail);
  await staffPage.getByRole("link", { name: "Clients", exact: true }).click();
  await expect(staffPage.getByRole("link", { name: "Export CSV" })).toHaveCount(0);
  expect((await staffPage.request.get("/api/clients/export")).status()).toBe(404);

  expect((await request.get("/api/clients/export")).status()).toBe(404);
  await staffContext.close();
});
