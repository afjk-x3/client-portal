import { expect, test } from "@playwright/test";
import { addClientWithContact, expectToast, fillRequest, signIn, signUpWithFirm, uniqueEmail } from "./helpers";

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

test("every file of a client's requests is listed, even from archived ones", async ({ browser, page }) => {
  const contactEmail = uniqueEmail("files");
  await signUpWithFirm(page, uniqueEmail("staff"), "Ledger & Co", "Sam Staff");
  await addClientWithContact(page, "Rita Client", contactEmail);

  for (const title of ["2025 taxes", "2026 taxes"]) {
    await page.getByRole("link", { name: "New request" }).click();
    await fillRequest(page, title, "Bank statement");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/requests\/[0-9a-f-]{36}$/);
    await expectToast(page, "Request sent.");
    await page.getByRole("link", { name: "Rita Client", exact: true }).click();
    await expect(page.getByRole("link", { name: "New request" })).toBeVisible();
  }

  // The contact uploads a statement to each request and submits.
  const contact = await (await browser.newContext()).newPage();
  await signIn(contact, contactEmail);
  for (const title of ["2025 taxes", "2026 taxes"]) {
    await contact.getByRole("link", { name: new RegExp(title) }).click();
    await contact.locator('input[type="file"]').setInputFiles({
      name: "statement.pdf",
      mimeType: "application/pdf",
      buffer: PDF,
    });
    await expect(contact.getByRole("link", { name: "Download statement.pdf" })).toBeVisible();
    await contact.getByRole("button", { name: "Submit" }).click();
    await expect(contact.getByText("Submitted", { exact: true })).toBeVisible();
    await contact.goto("/portal");
  }

  // Staff archive the older request, then open the client's page.
  await page.getByRole("link", { name: "2025 taxes", exact: true }).click();
  // Wait for the request page, or "Archive" resolves on the client page still mounted underneath.
  await expect(page).toHaveURL(/\/app\/requests\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
  await expectToast(page, "Request archived. Reminders have stopped.");
  await page.getByRole("link", { name: "Rita Client", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Files (2)" })).toBeVisible();
  const rowFor = (request: string) =>
    page
      .getByRole("row")
      .filter({ hasText: "statement.pdf" })
      .filter({ has: page.getByRole("link", { name: request, exact: true }) });
  await expect(rowFor("2025 taxes")).toContainText("statement.pdf");
  await expect(rowFor("2025 taxes")).toContainText("Client");
  await expect(rowFor("2026 taxes")).toContainText("statement.pdf");
  await expect(rowFor("2026 taxes")).toContainText("Client");

  const downloads = page.getByRole("link", { name: "Download", exact: true });
  await expect(downloads).toHaveCount(2);
  for (const href of await downloads.evaluateAll((links) => links.map((link) => link.getAttribute("href")))) {
    expect(href).toMatch(/\/api\/files\/[0-9a-f-]{36}\?download=1/);
  }

  // The search trims and ignores case, then narrows, then says nothing matches.
  const search = page.getByRole("searchbox", { name: "Search this client's files" });
  const fileRows = page.getByRole("row").filter({ hasText: "statement.pdf" });
  await search.fill("  BANK ");
  await expect(fileRows).toHaveCount(2);
  await search.fill("2025");
  await expect(fileRows).toHaveCount(1);
  await expect(fileRows).toContainText("2025 taxes");
  await search.fill("zzz");
  await expect(page.getByText("No files match.")).toBeVisible();

  // A client with nothing uploaded yet.
  await page.getByRole("link", { name: "Clients", exact: true }).click();
  await page.getByRole("button", { name: "New client" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("New Folks");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Files (0)" })).toBeVisible();
  await expect(page.getByText("No files yet.")).toBeVisible();
});
