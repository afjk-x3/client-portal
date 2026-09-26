import { expect, test } from "@playwright/test";
import { addClient, expectToast, signUpWithFirm, uniqueEmail } from "./helpers";

// Item 3's handle and item 1 must both be on screen: otherwise Playwright scrolls
// between pressing the mouse and moving it, and Chromium starts no drag.
test.use({ viewport: { width: 1280, height: 1200 } });

test("items in a draft can be dragged into a new order", async ({ page }) => {
  await signUpWithFirm(page, uniqueEmail("drag"), "Drag Firm", "Dee Staff");
  await addClient(page, "Drag Client");
  await page.getByRole("link", { name: "New request" }).click();
  await page.getByRole("combobox", { name: "Start from" }).click();
  await page.getByRole("option", { name: "Annual tax return (starter)" }).click();
  await page.getByRole("button", { name: "Due date" }).click();
  await page.getByRole("button", { name: "Go to the Next Month" }).click();
  await page.getByRole("button", { name: /15th/ }).click();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expectToast(page, "Draft saved.");
  await expect(page).toHaveURL(/\/app\/requests\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("textbox", { name: "Item 3 title" })).toHaveValue("Bank and investment statements");
  // Let the first toast close (4 seconds), so the next "Draft saved." belongs to the second save.
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 10_000 });

  // Drop item 3 on the top edge of item 1.
  await page
    .getByTitle("Drag item 3")
    .dragTo(page.getByRole("textbox", { name: "Item 1 title" }), { targetPosition: { x: 20, y: 2 } });
  await expect(page.getByRole("textbox", { name: "Item 1 title" })).toHaveValue("Bank and investment statements");
  await expect(page.getByRole("textbox", { name: "Item 2 title" })).toHaveValue("Government-issued photo ID");

  await page.getByRole("button", { name: "Save draft" }).click();
  await expectToast(page, "Draft saved.");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Item 1 title" })).toHaveValue("Bank and investment statements");
});
