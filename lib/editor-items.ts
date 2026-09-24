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
