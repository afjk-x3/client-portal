import { describe, expect, it } from "vitest";
import { moveItem } from "@/lib/editor-items";

describe("moveItem", () => {
  const items = ["a", "b", "c", "d"];

  it("moves an item down or up", () => {
    expect(moveItem(items, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(items, 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("keeps the order when an item is dropped on its own place", () => {
    expect(moveItem(items, 2, 2)).toEqual(items);
  });

  it("clamps a target past either end", () => {
    expect(moveItem(items, 1, 9)).toEqual(["a", "c", "d", "b"]);
    expect(moveItem(items, 2, -3)).toEqual(["c", "a", "b", "d"]);
  });

  it("returns a new list and leaves the old one alone", () => {
    const moved = moveItem(items, 0, 1);
    expect(moved).not.toBe(items);
    expect(items).toEqual(["a", "b", "c", "d"]);
  });
});
