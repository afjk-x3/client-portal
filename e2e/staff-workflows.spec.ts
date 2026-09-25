import { expect, test } from "@playwright/test";
import { addClient, expectToast, fillRequest, signIn, signUpWithFirm, uniqueEmail } from "./helpers";

test("settings, team, templates, drafts, and open-request edits", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await signUpWithFirm(page, uniqueEmail("admin"), "Smoke Firm", "Ada Admin");

  // Settings: rename the firm; add staff, including an address that already belongs to a firm.
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("textbox", { name: "Firm name" }).fill("Smoke Firm LLP");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expectToast(page, "Firm name saved.");
  const bo = uniqueEmail("bo");
  await page.getByRole("button", { name: "Add staff" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Full name" }).fill("Bo Staff");
  await dialog.getByRole("textbox", { name: "Email" }).fill(bo);
  await dialog.getByRole("button", { name: "Add staff" }).click();
  await expectToast(page, "Added.");
  await expect(page.getByRole("cell", { name: bo })).toBeVisible();
  await page.getByRole("button", { name: "Add staff" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Full name" }).fill("Bo Again");
  await dialog.getByRole("textbox", { name: "Email" }).fill(bo.toUpperCase());
  await dialog.getByRole("button", { name: "Add staff" }).click();
  await expectToast(page, "This person already belongs to a firm.");
  await page.keyboard.press("Escape");

  // Staff added by mistake can leave, then set up their own firm.
  const boPage = await (await browser.newContext()).newPage();
  await signIn(boPage, bo);
  await expect(boPage.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await boPage.getByRole("link", { name: "Settings" }).click();
  await boPage.getByRole("button", { name: "Leave firm" }).click();
  await boPage.getByRole("alertdialog").getByRole("button", { name: "Leave firm" }).click();
  await expect(boPage).toHaveURL(/\/onboarding$/);
  await boPage.getByRole("textbox", { name: "Firm name" }).fill("Bo's Books");
  await boPage.getByRole("textbox", { name: "Your full name" }).fill("Bo Staff");
  await boPage.getByRole("button", { name: "Create firm" }).click();
  await expect(boPage.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("cell", { name: bo })).toHaveCount(0);

  // Admins change another member's role and remove them; their own row is read-only.
  const cy = uniqueEmail("cy");
  await page.getByRole("button", { name: "Add staff" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Full name" }).fill("Cy Staff");
  await dialog.getByRole("textbox", { name: "Email" }).fill(cy);
  await dialog.getByRole("button", { name: "Add staff" }).click();
  await expectToast(page, "Added.");
  await page.getByRole("combobox", { name: "Role for Cy Staff" }).click();
  await page.getByRole("option", { name: "Admin" }).click();
  await expectToast(page, "Role updated.");
  await expect(page.getByRole("combobox", { name: "Role for Ada Admin" })).toHaveCount(0);
  await page.getByRole("button", { name: "Remove" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
  await expectToast(page, "Removed from the team.");

  // Templates: reorder the starter template; create and delete another.
  await page.getByRole("link", { name: "Templates" }).click();
  await page.getByRole("link", { name: "Annual tax return (starter)" }).click();
  await expect(page.getByRole("textbox", { name: "Item 7 title" })).toHaveValue("Anything else we should know?");
  await page.getByRole("button", { name: "Move item 2 up" }).click();
  await expect(page.getByRole("textbox", { name: "Item 1 title" })).toHaveValue("Income statements from all employers");
  await page.getByRole("button", { name: "Save template" }).click();
  await expectToast(page, "Template saved.");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Item 1 title" })).toHaveValue("Income statements from all employers");
  await page.getByRole("link", { name: "Templates" }).click();
  await page.getByRole("button", { name: "New template" }).click();
  await expect(page.getByRole("heading", { name: "Edit template" })).toBeVisible();
  await page.getByRole("button", { name: "Delete template" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(/\/app\/templates$/);
  await expect(page.getByText("Untitled template")).toHaveCount(0);

  // A draft from the template: save, then delete.
  await addClient(page, "Draft Client");
  const clientUrl = page.url();
  await page.getByRole("link", { name: "New request" }).click();
  await page.getByRole("combobox", { name: "Start from" }).click();
  await page.getByRole("option", { name: "Annual tax return (starter)" }).click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Annual tax return (starter)");
  await page.getByRole("button", { name: "Due date" }).click();
  await page.getByRole("button", { name: "Go to the Next Month" }).click();
  await page.getByRole("button", { name: /20th/ }).click();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expectToast(page, "Draft saved.");
  await expect(page).toHaveURL(/\/app\/requests\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("textbox", { name: "Item 7 title" })).toBeVisible();
  await page.getByRole("button", { name: "Delete draft" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(clientUrl);

  // A sent request: add an item, remove it, edit details, archive, unarchive.
  await page.getByRole("link", { name: "New request" }).click();
  await fillRequest(page, "Quarterly", "Bank statements");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expectToast(page, "Request sent, but this client has no contacts yet.");
  await expect(page).toHaveURL(/\/app\/requests\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Add item" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Title" }).fill("Receipts");
  await dialog.getByRole("button", { name: "Add item" }).click();
  await expectToast(page, "Item added.");
  await page.getByRole("button", { name: "Receipts" }).click();
  await page.getByRole("dialog", { name: "Receipts" }).getByRole("button", { name: "Remove item" }).click();
  await expectToast(page, "Item removed.");
  await expect(page.getByRole("button", { name: "Receipts" })).toHaveCount(0);
  await page.getByRole("button", { name: "Edit details" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Title" }).fill("Quarterly (Q3)");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expectToast(page, "Request updated.");
  await expect(page.getByRole("heading", { name: /Quarterly \(Q3\)/ })).toBeVisible();
  await page.getByRole("button", { name: "Archive" }).click();
  await expectToast(page, "Request archived.");
  await expect(page.getByRole("heading", { name: /Quarterly/ })).toContainText("Archived");
  await page.getByRole("button", { name: "Unarchive" }).click();
  await expectToast(page, "Request unarchived.");
  await expect(page.getByRole("heading", { name: /Quarterly/ })).toContainText("Open");

  // Client archive and the "Show archived" filter.
  await page.goto(clientUrl);
  await page.getByRole("button", { name: "Archive" }).click();
  await expectToast(page, "Client archived.");
  await page.getByRole("link", { name: "Clients" }).click();
  await expect(page.getByRole("link", { name: "Draft Client" })).toHaveCount(0);
  await page.getByRole("switch", { name: "Show archived" }).click();
  await expect(page.getByRole("link", { name: "Draft Client" })).toBeVisible();

  // Sign out is a full page load to /login; the staff area then needs a session again.
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login\?next=%2Fapp$/);
});
