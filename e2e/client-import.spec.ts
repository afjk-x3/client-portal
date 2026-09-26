import { expect, test } from "@playwright/test";
import { addClientWithContact, signUpWithFirm, uniqueEmail } from "./helpers";

test("importing clients previews each row, then adds only what is new", async ({ page }) => {
  await signUpWithFirm(page, uniqueEmail("import"), "Import Firm", "Ivy Staff");
  const known = uniqueEmail("known");
  await addClientWithContact(page, "Rivera Household", known);

  const jo = uniqueEmail("jo");
  const sam = uniqueEmail("sam");
  const file = {
    name: "clients.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      [
        "client_name,client_type,contact_name,contact_email",
        `Acme Bakery,business,Jo Baker,${jo}`,
        "Acme Bakery,business,,",
        `rivera household,,Sam Rivera,${sam}`,
        `Rivera Household,,Known Person,${known.toUpperCase()}`,
        "Broken Co,,Bad Email,not-an-email",
      ].join("\n"),
    ),
  };
  const result = (row: number) =>
    page.getByRole("row").filter({ has: page.getByRole("cell", { name: String(row), exact: true }) });

  await page.getByRole("link", { name: "Clients", exact: true }).click();
  await page.getByRole("link", { name: "Import CSV" }).click();
  await page.getByLabel("CSV file").setInputFiles(file);
  await expect(result(2)).toContainText("New client");
  await expect(result(3)).toContainText("Client listed in an earlier row.");
  await expect(result(4)).toContainText("Adds a contact to Rivera Household.");
  await expect(result(5)).toContainText("Contact already on this client.");
  await expect(result(6)).toContainText("Enter a valid email address.");

  await page.getByRole("button", { name: "Import 2 rows" }).click();
  await expect(page.getByText("1 client created, 2 contacts added, 2 rows skipped, 1 row failed.")).toBeVisible();
  await expect(page.getByText("Row 6: Enter a valid email address.")).toBeVisible();

  await page.getByRole("link", { name: "Back to clients" }).click();
  const search = page.getByRole("searchbox", { name: "Search", exact: true });
  await search.fill(sam);
  await search.press("Enter");
  await expect(page.getByRole("link", { name: "Rivera Household" })).toBeVisible();

  // The same file again changes nothing.
  await page.getByRole("link", { name: "Import CSV" }).click();
  await page.getByLabel("CSV file").setInputFiles(file);
  await expect(result(2)).toContainText("Contact already on this client.");
  await expect(page.getByRole("button", { name: "Import 0 rows" })).toBeDisabled();
});
