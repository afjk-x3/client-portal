"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DatePicker } from "@/components/date-picker";
import { ItemEditor } from "@/components/item-editor";
import { LIMITS } from "@/lib/constants";
import { newEditorItem, toItemInputs, type EditorItem } from "@/lib/editor-items";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { deleteDraft, saveDraft, sendRequest } from "./actions";

export type TemplateOption = {
  id: string;
  name: string;
  items: { title: string; description: string | null; kind: string; required: boolean }[];
};

/** Editor for a new request or a draft. Everything is editable until the request is sent. */
export function RequestEditor({
  clientId,
  requestId,
  initial,
  templates = [],
}: {
  clientId: string;
  requestId?: string;
  initial: { title: string; dueDate: string | null; items: EditorItem[] };
  templates?: TemplateOption[];
}) {
  const router = useRouter();
  const id = useId();
  const [templateId, setTemplateId] = useState("blank");
  const [title, setTitle] = useState(initial.title);
  const [dueDate, setDueDate] = useState(initial.dueDate);
  const [items, setItems] = useState(initial.items);
  const [pending, startTransition] = useTransition();

  function applyTemplate(value: string) {
    setTemplateId(value);
    const template = templates.find((t) => t.id === value);
    setItems(template ? template.items.map((item) => newEditorItem(item)) : []);
    if (template && !title) setTitle(template.name);
  }

  function save(send: boolean) {
    startTransition(async () => {
      const saved = await saveDraft({ requestId, clientId, title, dueDate: dueDate ?? "", items: toItemInputs(items) });
      if (!saved.ok) {
        toast.error(saved.error);
        return;
      }
      const savedId = saved.data!.id;
      if (send) {
        const sent = await sendRequest(savedId);
        if (!sent.ok) toast.error(sent.error);
        else if (sent.data?.contacts) toast.success("Request sent.");
        else toast.warning("Request sent, but this client has no contacts yet. Add one so they can sign in.");
      } else {
        toast.success("Draft saved.");
      }
      if (!requestId) {
        // Next keeps this page mounted (hidden) after navigating, so clear the form
        // for the next visit. One transition, so the old form stays until the new page shows.
        startTransition(() => {
          setTemplateId("blank");
          setTitle("");
          setDueDate(null);
          setItems([]);
          router.push(`/app/requests/${savedId}`);
        });
      }
    });
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {templates.length > 0 && (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-template`}>Start from</Label>
          <Select value={templateId} onValueChange={applyTemplate}>
            <SelectTrigger id={`${id}-template`} className="w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="blank">Start blank</SelectItem>
              {templates.map((template) => (
                <SelectItem key={template.id} value={template.id}>
                  {template.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-[1fr_16rem]">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-title`}>Title</Label>
          <Input id={`${id}-title`} value={title} maxLength={LIMITS.name} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-due-date`}>Due date</Label>
          <DatePicker id={`${id}-due-date`} value={dueDate} onChange={setDueDate} />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Items</h2>
        <ItemEditor items={items} onChange={setItems} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={pending} onClick={() => save(false)}>
          Save draft
        </Button>
        <Button type="button" disabled={pending} onClick={() => save(true)}>
          Send
        </Button>
        {requestId && <DeleteDraftButton requestId={requestId} />}
      </div>
    </div>
  );
}

function DeleteDraftButton({ requestId }: { requestId: string }) {
  async function remove() {
    const result = await deleteDraft(requestId);
    if (!result.ok) toast.error(result.error);
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost">
          Delete draft
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
          <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
