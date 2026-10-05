import { describe, expect, it } from "vitest";
import { archiveResultMessage, unarchiveResultMessage } from "./archive-message";

describe("archiveResultMessage", () => {
  it("counts every ticked request when all were archived", () => {
    expect(archiveResultMessage(2, 2)).toBe("Archived 2 requests.");
    expect(archiveResultMessage(1, 1)).toBe("Archived 1 request.");
  });
  it("names the rest as already changed", () => {
    expect(archiveResultMessage(1, 2)).toBe("Archived 1 of 2 requests. The rest had already changed.");
  });
});

describe("unarchiveResultMessage", () => {
  it("counts every ticked request when all were unarchived", () => {
    expect(unarchiveResultMessage(2, 2)).toBe("Unarchived 2 requests.");
    expect(unarchiveResultMessage(1, 1)).toBe("Unarchived 1 request.");
  });
  it("names the rest as already open", () => {
    expect(unarchiveResultMessage(1, 2)).toBe("Unarchived 1 of 2 requests. The rest were already open.");
  });
});
