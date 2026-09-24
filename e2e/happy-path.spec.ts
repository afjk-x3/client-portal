import { expect, test, type Page } from "@playwright/test";
import { readSignInCode } from "./mailpit";

const run = Date.now();
const staffEmail = `staff-${run}@example.com`;
const contactEmail = `contact-${run}@example.com`;

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  const code = page.getByRole("textbox", { name: "Code" });
  await expect(code).toBeVisible();
  await code.fill(await readSignInCode(email));
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("a firm collects a document from a client", async ({ browser }) => {
  const staff = await (await browser.newContext()).newPage();

  // 1. Staff signs up and creates a firm.
  await signIn(staff, staffEmail);
  await expect(staff).toHaveURL(/\/onboarding$/);
  await staff.getByRole("textbox", { name: "Firm name" }).fill("Ledger & Co");
  await staff.getByRole("textbox", { name: "Your full name" }).fill("Sam Staff");
  await staff.getByRole("button", { name: "Create firm" }).click();
  await expect(staff.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  // 2. Staff adds a client with one contact.
  await staff.getByRole("link", { name: "Clients" }).click();
  await staff.getByRole("button", { name: "New client" }).click();
  const clientDialog = staff.getByRole("dialog");
  await clientDialog.getByRole("textbox", { name: "Name", exact: true }).fill("Pat Client");
  await clientDialog.getByRole("button", { name: "Save" }).click();
  await expect(staff.getByRole("heading", { name: "Pat Client" })).toBeVisible();
  await staff.getByRole("button", { name: "Add contact" }).click();
  const contactDialog = staff.getByRole("dialog");
  await contactDialog.getByRole("textbox", { name: "Full name" }).fill("Pat Client");
  await contactDialog.getByRole("textbox", { name: "Email" }).fill(contactEmail);
  await contactDialog.getByRole("button", { name: "Add contact" }).click();
  await expect(staff.getByRole("cell", { name: contactEmail })).toBeVisible();

  // 3. Staff sends a request with one required item.
  await staff.getByRole("link", { name: "New request" }).click();
  await staff.getByRole("textbox", { name: "Title", exact: true }).fill("2026 tax documents");
  await staff.getByRole("button", { name: "Due date" }).click();
  await staff.getByRole("button", { name: "Go to the Next Month" }).click();
  await staff.getByRole("button", { name: /15th/ }).click();
  await staff.getByRole("button", { name: "Add item" }).click();
  await staff.getByRole("textbox", { name: "Item 1 title" }).fill("Photo ID");
  await staff.getByRole("button", { name: "Send", exact: true }).click();
  await expect(staff).toHaveURL(/\/app\/requests\/[0-9a-f-]{36}$/);
  await expect(staff.getByText("Open", { exact: true })).toBeVisible();
});
