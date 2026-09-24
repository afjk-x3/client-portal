import { expect, test } from "@playwright/test";
import { addClient, fillRequest, signIn, signUpWithFirm, uniqueEmail } from "./helpers";

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
// Spaces, parentheses, and an accent: downloads and the zip must keep the name exactly.
const FILENAME = "Scan (1) résumé.pdf";

test("portal uploads, review, zip, downloads, access rules, and the daily cron", async ({ browser }) => {
  const contactEmail = uniqueEmail("contact");
  const staffEmail = uniqueEmail("staff");
  const staff = await (await browser.newContext()).newPage();
  await signUpWithFirm(staff, staffEmail, "Ledger & Co", "Sam Staff");

  // Staff who are nobody's contact see an empty portal.
  await staff.goto("/portal");
  await expect(staff.getByText("You don't have any requests yet.")).toBeVisible();
  await staff.goto("/app");

  // A client with one contact and a sent request with one required item.
  await addClient(staff, "Pat Client");
  await staff.getByRole("button", { name: "Add contact" }).click();
  const contactDialog = staff.getByRole("dialog");
  await contactDialog.getByRole("textbox", { name: "Full name" }).fill("Pat Client");
  await contactDialog.getByRole("textbox", { name: "Email" }).fill(contactEmail);
  await contactDialog.getByRole("button", { name: "Add contact" }).click();
  await expect(staff.getByRole("cell", { name: contactEmail })).toBeVisible();
  await staff.getByRole("link", { name: "New request" }).click();
  await fillRequest(staff, "2026 tax documents", "Photo ID");
  await staff.getByRole("button", { name: "Send", exact: true }).click();
  await expect(staff).toHaveURL(/\/app\/requests\/[0-9a-f-]{36}$/);
  await expect(staff.getByText("Open", { exact: true })).toBeVisible();
  const requestUrl = staff.url();
  const requestId = requestUrl.split("/").pop()!;

  // The contact uploads a PDF and submits the item.
  const contact = await (await browser.newContext()).newPage();
  await signIn(contact, contactEmail);
  await expect(contact).toHaveURL(/\/portal$/);
  await contact.getByRole("link", { name: /2026 tax documents/ }).click();
  await contact.locator('input[type="file"]').setInputFiles({ name: FILENAME, mimeType: "application/pdf", buffer: PDF });
  await expect(contact.getByRole("link", { name: `Download ${FILENAME}` })).toBeVisible();
  await contact.getByRole("button", { name: "Submit" }).click();
  await expect(contact.getByText("Submitted", { exact: true })).toBeVisible();

  // Staff accepts it, and the request completes.
  await staff.reload();
  await staff.getByRole("button", { name: "Photo ID" }).click();
  const sheet = staff.getByRole("dialog", { name: "Photo ID" });
  await sheet.getByRole("button", { name: "Accept" }).click();
  await expect(sheet.getByText("Accepted", { exact: true })).toBeVisible();
  await staff.keyboard.press("Escape");
  await expect(staff.getByRole("heading", { name: /2026 tax documents/ })).toContainText("Completed");

  // The zip holds the file under the item's folder.
  const zip = await staff.request.get(`/api/requests/${requestId}/zip`);
  expect(zip.status()).toBe(200);
  expect(zip.headers()["content-type"]).toBe("application/zip");
  expect((await zip.body()).includes(Buffer.from(`01 Photo ID/${FILENAME}`))).toBe(true);

  // A contact's download redirects to a short-lived signed URL and keeps the original name.
  await contact.reload();
  const href = (await contact.getByRole("link", { name: `Download ${FILENAME}` }).getAttribute("href"))!;
  const redirect = await contact.request.get(href, { maxRedirects: 0 });
  expect(redirect.status()).toBe(307);
  expect(redirect.headers()["location"]).toContain("/storage/v1/object/sign/documents/");
  const file = await contact.request.get(href);
  expect(file.status()).toBe(200);
  expect((await file.body()).toString()).toContain("%PDF-1.4");
  const disposition = file.headers()["content-disposition"] ?? "";
  expect(decodeURIComponent(/filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1] ?? "")).toBe(FILENAME);

  // Contacts cannot use the zip route or the staff area.
  expect((await contact.request.get(`/api/requests/${requestId}/zip`)).status()).toBe(404);
  await contact.goto("/app");
  await expect(contact).toHaveURL(/\/portal$/);

  // Signed-out users go to /login with `next`; files are 404 to them.
  const anon = await (await browser.newContext()).newPage();
  await anon.goto("/app/clients");
  await expect(anon).toHaveURL(/\/login\?next=%2Fapp%2Fclients$/);
  expect((await anon.request.get(href.split("?")[0])).status()).toBe(404);

  // The cron needs its secret, and claims today's digest only once.
  expect((await anon.request.get("/api/cron/daily")).status()).toBe(401);
  const auth = { headers: { Authorization: "Bearer local-cron-secret" } };
  const first = await anon.request.get("/api/cron/daily", auth);
  expect(first.status()).toBe(200);
  expect((await first.json()).digests).toBeGreaterThanOrEqual(1);
  expect((await (await anon.request.get("/api/cron/daily", auth)).json()).digests).toBe(0);

  // Needs changes: the contact sees the note, can remove the file, and cannot submit until they add one.
  await staff.goto(requestUrl);
  await staff.getByRole("button", { name: "Photo ID" }).click();
  const sheet2 = staff.getByRole("dialog", { name: "Photo ID" });
  await sheet2.getByRole("textbox", { name: "What needs to change?" }).fill("The scan is blurry.");
  await sheet2.getByRole("button", { name: "Needs changes" }).click();
  await expect(sheet2.getByText("Needs changes", { exact: true })).toBeVisible();
  await staff.keyboard.press("Escape");
  await expect(staff.getByRole("heading", { name: /2026 tax documents/ })).toContainText("Open");
  await contact.goto(`/portal/requests/${requestId}`);
  await expect(contact.getByText("The scan is blurry.")).toBeVisible();
  await contact.getByRole("button", { name: `Remove ${FILENAME}` }).click();
  await expect(contact.getByText(FILENAME)).toHaveCount(0);
  await expect(contact.getByRole("button", { name: "Submit Photo ID" })).toBeDisabled();

  // Staff who are also a contact see that client's sent requests in the portal, never its drafts.
  await staff.goto(requestUrl);
  await staff.getByRole("link", { name: "Pat Client" }).click();
  await staff.getByRole("button", { name: "Add contact" }).click();
  const selfDialog = staff.getByRole("dialog");
  await selfDialog.getByRole("textbox", { name: "Full name" }).fill("Sam Staff");
  await selfDialog.getByRole("textbox", { name: "Email" }).fill(staffEmail);
  await selfDialog.getByRole("button", { name: "Add contact" }).click();
  await expect(staff.getByRole("cell", { name: staffEmail })).toBeVisible();
  await staff.getByRole("link", { name: "New request" }).click();
  await fillRequest(staff, "Unsent draft", "Anything");
  await staff.getByRole("button", { name: "Save draft" }).click();
  await expect(staff).toHaveURL(/\/app\/requests\/[0-9a-f-]{36}$/);
  await staff.goto("/portal");
  await expect(staff.getByRole("link", { name: /2026 tax documents/ })).toBeVisible();
  await expect(staff.getByText("Unsent draft")).toHaveCount(0);
});
