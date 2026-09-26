import type { ItemInput } from "@/lib/validation";

/** An item row in the request and template editors. `key` is only for React. */
export type EditorItem = {
  key: string;
  title: string;
  description: string;
  kind: "file" | "text";
  required: boolean;
};

export function newEditorItem(from?: {
  title: string;
  description: string | null;
  kind: string;
  required: boolean;
}): EditorItem {
  return {
    key: crypto.randomUUID(),
    title: from?.title ?? "",
    description: from?.description ?? "",
    kind: from?.kind === "text" ? "text" : "file",
    required: from?.required ?? true,
  };
}

export function toItemInputs(items: EditorItem[]): ItemInput[] {
  return items.map(({ title, description, kind, required }) => ({ title, description, kind, required }));
}

/** A new list with the item at `from` moved to index `to`, clamped to the list. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}
