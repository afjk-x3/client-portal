import { expect, test, vi } from "vitest";
import { uploadFile } from "./upload";

// A Server Action call rejects when the connection drops or a new deployment replaces the server.
vi.mock("./actions", () => ({
  createUploadUrl: vi.fn(async () => {
    throw new TypeError("Failed to fetch");
  }),
  registerFile: vi.fn(),
}));

test("a failed action call is reported as a retryable error, not thrown", async () => {
  const file = new File(["%PDF-1.4"], "scan.pdf", { type: "application/pdf" });
  await expect(uploadFile("10000000-0000-0000-0000-0000000000a1", file)).resolves.toBe(
    "Upload failed. Check your connection and retry.",
  );
});
