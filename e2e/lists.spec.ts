import { expect, test } from "@playwright/test";
import { addClientWithContact, expectToast, fillRequest, signUpWithFirm, uniqueEmail } from "./helpers";

test("the Requests page searches, filters, and keeps its state in the URL", async ({ page }) => {
  await signUpWithFirm(page, uniqueEmail("lists"), "List Firm", "Lee Staff");
  await addClientWithContact(page, "Nora North", uniqueEmail("nora"));
  await addClientWithContact(page, "Sol South", uniqueEmail("sol"));

  // Two sent requests from the starter template, then one draft.
  await page.getByRole("link", { name: "Templates" }).click();
  await page.getByRole("link", { name: "Annual tax return (starter)" }).click();
  await page.getByRole("link", { name: "Send to clients" }).click();
  await page.getByRole("checkbox", { name: /Nora North/ }).click();
  await page.getByRole("checkbox", { name: /Sol South/ }).click();
  await page.getByRole("button", { name: "Due date" }).click();
  await page.getByRole("button", { name: "Go to the Next Month" }).click();
  await page.getByRole("button", { name: /15th/ }).click();
  await page.getByRole("button", { name: "Send to 2 clients" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Send" }).click();
  await expectToast(page, "Sent to 2 clients.");
  // The dashboard's search filters both tabs and their counts.
  await expect(page.getByRole("tab", { name: "Waiting on clients (2)" })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search the dashboard" }).fill("nora");
  await expect(page.getByRole("tab", { name: "Waiting on clients (1)" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Annual tax return (starter)" })).toHaveCount(1);
  await page.getByRole("link", { name: "Clients", exact: true }).click();
  await page.getByRole("link", { name: "Nora North" }).click();
  await page.getByRole("link", { name: "New request" }).click();
  await fillRequest(page, "Quarterly payroll", "Payroll register");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expectToast(page, "Draft saved.");

  await page.getByRole("link", { name: "Requests", exact: true }).click();
  await expect(page.getByText("Showing 1–3 of 3")).toBeVisible();
  const search = page.getByRole("searchbox", { name: "Search", exact: true });
  await search.fill("payroll");
  await search.press("Enter");
  await expect(page).toHaveURL(/q=payroll/);
  await expect(page.getByRole("link", { name: "Quarterly payroll" })).toBeVisible();
  await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

  await search.fill("sol south");
  await search.press("Enter");
  await expect(page.getByRole("link", { name: "Annual tax return (starter)" })).toHaveCount(1);
  await page.getByRole("combobox", { name: "Status" }).selectOption("draft");
  await expect(page).toHaveURL(/status=draft/);
  await expect(page.getByText("No requests match.")).toBeVisible();

  // Back restores the previous filters, in the form as well as the table.
  await page.goBack();
  await expect(page.getByRole("combobox", { name: "Status" })).toHaveValue("active");
  await expect(page.getByRole("link", { name: "Annual tax return (starter)" })).toHaveCount(1);

  // A page past the end offers a way back.
  await page.goto("/app/requests?page=9");
  await page.getByRole("link", { name: "Back to page 1" }).click();
  await expect(page.getByText("Showing 1–3 of 3")).toBeVisible();
});

test("the client list searches contacts and filters by type, owner, and archived", async ({ page }) => {
  await signUpWithFirm(page, uniqueEmail("clients"), "Client Firm", "Cleo Staff");
  const hidden = uniqueEmail("hidden-contact");
  await addClientWithContact(page, "Avery Home", hidden);
  await page.getByRole("link", { name: "Clients", exact: true }).click();
  await page.getByRole("button", { name: "New client" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Birch Bakery");
  await dialog.getByRole("combobox", { name: "Type" }).click();
  await page.getByRole("option", { name: "Business" }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Birch Bakery" })).toBeVisible();

  await page.getByRole("link", { name: "Clients", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "Search", exact: true });
  await search.fill(hidden.slice(0, 20));
  await search.press("Enter");
  await expect(page.getByRole("link", { name: "Avery Home" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Birch Bakery" })).toHaveCount(0);

  await search.fill("");
  await search.press("Enter");
  // Wait for the new page, so the next change starts from it.
  await expect(page.getByRole("link", { name: "Birch Bakery" })).toBeVisible();
  await page.getByRole("combobox", { name: "Type" }).selectOption("business");
  await expect(page.getByRole("link", { name: "Birch Bakery" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Avery Home" })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Owner" }).selectOption("none");
  await expect(page).toHaveURL(/owner=none/);
  await expect(page.getByRole("link", { name: "Birch Bakery" })).toBeVisible();
});
