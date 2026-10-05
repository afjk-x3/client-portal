import { expect, test } from "@playwright/test";
import { signUpWithFirm, uniqueEmail } from "./helpers";

// A signed-in visitor never sees the public pages, so Back after signing in
// cannot land on them; each page sends them where they belong instead.
test("signed-in visitors are redirected off / and /login", async ({ page }) => {
  await signUpWithFirm(page, uniqueEmail("f11"), "Firm & Co", "Ada Admin");

  await page.goto("/");
  await expect(page).toHaveURL(/\/app$/);

  await page.goto("/login");
  await expect(page).toHaveURL(/\/app$/);
});

test("signed-out visitors still get the public pages", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Get started" })).toBeVisible();

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in to" })).toBeVisible();
});
