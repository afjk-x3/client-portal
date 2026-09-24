import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/safe-next-path";

describe("safeNextPath", () => {
  it.each(["/app", "/portal/requests/123?tab=files", "/app/clients#contacts"])("accepts %s", (path) => {
    expect(safeNextPath(path)).toBe(path);
  });

  it("resolves dot segments", () => {
    expect(safeNextPath("/app/./clients/../templates")).toBe("/app/templates");
  });

  it.each([
    null,
    undefined,
    "",
    "app",
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "/app\n",
    "/.//evil.example",
    "/..//evil.example",
    "/%2e%2e//evil.example",
  ])("rejects %j", (path) => {
    expect(safeNextPath(path)).toBeNull();
  });
});
