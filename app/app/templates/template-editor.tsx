"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { ItemEditor } from "@/components/item-editor";
import { LIMITS } from "@/lib/constants";
import { toItemInputs, type EditorItem } from "@/lib/editor-items";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteTemplate, saveTemplate } from "./actions";

export function TemplateEditor({
  templateId,
  initial,
}: {
  templateId: string;
  initial: { name: string; items: EditorItem[] };
}) {
  const id = useId();
  const [name, setName] = useState(initial.name);
  const [items, setItems] = useState(initial.items);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await saveTemplate({ templateId, name, items: toItemInputs(items) });
      if (result.ok) toast.success("Template saved.");
      else toast.error(result.error);
    });
  }

  async function remove() {
    const result = await deleteTemplate(templateId);
    if (!result.ok) toast.error(result.error);
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-name`}>Name</Label>
        <Input id={`${id}-name`} value={name} maxLength={LIMITS.name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Items</h2>
        <ItemEditor items={items} onChange={setItems} />
      </div>
      <div className="flex gap-2">
        <Button type="button" disabled={pending} onClick={save}>
          Save template
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="ghost">
              Delete template
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this template?</AlertDialogTitle>
              <AlertDialogDescription>Requests created from it are not affected.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
