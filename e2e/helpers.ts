import { expect, type Page } from "@playwright/test";
import { readSignInCode } from "./mailpit";

/** A fresh address for every run, so specs never collide in the shared local database. */
export function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

export async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  const code = page.getByRole("textbox", { name: "Code" });
  await expect(code).toBeVisible();
  await code.fill(await readSignInCode(email));
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Signs up a new user and creates a firm, ending on the dashboard. */
export async function signUpWithFirm(page: Page, email: string, firmName: string, fullName: string) {
  await signIn(page, email);
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole("textbox", { name: "Firm name" }).fill(firmName);
  await page.getByRole("textbox", { name: "Your full name" }).fill(fullName);
  await page.getByRole("button", { name: "Create firm" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

export async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: text }).first()).toBeVisible();
}

/** Creates a client from the client list and ends on its page. */
export async function addClient(page: Page, name: string) {
  await page.getByRole("link", { name: "Clients" }).click();
  await page.getByRole("button", { name: "New client" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

/** Fills the request editor's title, a due date next month, and one item. */
export async function fillRequest(page: Page, title: string, item: string) {
  await page.getByRole("textbox", { name: "Title", exact: true }).fill(title);
  await page.getByRole("button", { name: "Due date" }).click();
  await page.getByRole("button", { name: "Go to the Next Month" }).click();
  await page.getByRole("button", { name: /15th/ }).click();
  await page.getByRole("button", { name: "Add item" }).click();
  await page.getByRole("textbox", { name: "Item 1 title" }).fill(item);
}

/** Creates a client with one contact of the same name and ends on the client's page. */
export async function addClientWithContact(page: Page, name: string, email: string) {
  await addClient(page, name);
  await page.getByRole("button", { name: "Add contact" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Full name" }).fill(name);
  await dialog.getByRole("textbox", { name: "Email" }).fill(email);
  await dialog.getByRole("button", { name: "Add contact" }).click();
  await expect(page.getByRole("cell", { name: email })).toBeVisible();
}
