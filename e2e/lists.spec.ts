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
