import { expect, test } from "@playwright/test";
import { addClient, addClientWithContact, fillRequest, signUpWithFirm, uniqueEmail } from "./helpers";

test("copy a sent request", async ({ page }) => {
  const staffEmail = uniqueEmail("staff");
  await signUpWithFirm(page, staffEmail, "Ledger & Co", "Sam Staff");
  await addClientWithContact(page, "Pat Client", uniqueEmail("contact"));
  const clientId = page.url().split("/").pop()!;

  await page.getByRole("link", { name: "New request" }).click();
  await fillRequest(page, "2026 tax documents", "Photo ID");
  await page.getByRole("button", { name: "Add item" }).click();
  await page.getByRole("textbox", { name: "Item 2 title" }).fill("Any changes this year?");
  await page.getByRole("combobox", { name: "Item 2 type" }).click();
  await page.getByRole("option", { name: "Written answer" }).click();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/requests\/[0-9a-f-]{36}$/);
  const requestId = page.url().split("/").pop()!;

  await page.getByRole("link", { name: "Copy" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/requests/new\\?client=${clientId}&from=${requestId}`));
  await expect(page.getByText("Copy of “2026 tax documents”")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("2026 tax documents");
  await expect(page.getByRole("textbox", { name: "Item 1 title" })).toHaveValue("Photo ID");
  await expect(page.getByRole("textbox", { name: "Item 2 title" })).toHaveValue("Any changes this year?");
  await expect(page.getByRole("combobox", { name: "Item 2 type" })).toContainText("Written answer");
  await expect(page.getByRole("button", { name: "Due date" })).toContainText("Pick a date");

  await page.getByRole("button", { name: "Due date" }).click();
  await page.getByRole("button", { name: /15th/ }).click();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/\/app\/requests\/[0-9a-f-]{36}$/);
  const draftId = page.url().split("/").pop()!;
  await expect(page.getByRole("textbox", { name: "Item 1 title" })).toHaveValue("Photo ID");
  await expect(page.getByRole("textbox", { name: "Item 2 title" })).toHaveValue("Any changes this year?");

  // A draft is not a source: no copy line, no prefilled title.
  await page.goto(`/app/requests/new?client=${clientId}&from=${draftId}`);
  await expect(page.getByText(/Copy of/)).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("");

  // The plain New request page for the same client starts empty, even after a copy.
  await page.goto(`/app/requests/new?client=${clientId}&from=${requestId}`);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("2026 tax documents");
  await page.getByRole("link", { name: "Pat Client" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/clients/${clientId}`));
  await page.getByRole("link", { name: "New request" }).click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("");
  await expect(page.getByText(/Copy of/)).toHaveCount(0);
});

test("save a sent request as a template", async ({ page }) => {
  await signUpWithFirm(page, uniqueEmail("staff"), "Ledger & Co", "Sam Staff");
  await addClientWithContact(page, "Pat Client", uniqueEmail("contact"));

  await page.getByRole("link", { name: "New request" }).click();
  await fillRequest(page, "2026 tax documents", "Photo ID");
  await page.getByRole("button", { name: "Add item" }).click();
  await page.getByRole("textbox", { name: "Item 2 title" }).fill("Any changes this year?");
  await page.getByRole("combobox", { name: "Item 2 type" }).click();
  await page.getByRole("option", { name: "Written answer" }).click();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/requests\/[0-9a-f-]{36}$/);

  await page.getByRole("button", { name: "Save as template" }).click();
  await expect(page).toHaveURL(/\/app\/templates\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("2026 tax documents");
  await expect(page.getByRole("textbox", { name: "Item 1 title" })).toHaveValue("Photo ID");
  await expect(page.getByRole("textbox", { name: "Item 2 title" })).toHaveValue("Any changes this year?");

  await addClient(page, "Second Client");
  await page.getByRole("link", { name: "New request" }).click();
  await page.getByRole("combobox", { name: "Start from" }).click();
  await expect(page.getByRole("option", { name: "2026 tax documents" })).toBeVisible();
});
