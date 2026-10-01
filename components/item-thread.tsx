"use client";

import { useActionState, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { LIMITS } from "@/lib/constants";
import type { ActionResult } from "@/lib/errors";
import { submitKeepingValues } from "@/lib/forms";

export type ThreadMessage = {
  id: string;
  author: string;
  body: string;
  at: string;
  isNew?: boolean;
};

/** The conversation under an item: the messages, then the box when the viewer may write. */
export function ItemThread({
  messages,
  canWrite,
  label,
  hint,
  send,
  emptyButton,
}: {
  messages: ThreadMessage[];
  canWrite: boolean;
  label: string;
  hint?: string | null;
  send: (body: string) => Promise<ActionResult>;
  /** Opens the box when there are no messages; null keeps the box always visible. */
  emptyButton?: string | null;
}) {
  const [body, setBody] = useState("");
  const [open, setOpen] = useState(false);
  const id = useId();

  const [, formAction, pending] = useActionState(async (_prev: ActionResult | null, formData: FormData) => {
    const result = await send(String(formData.get("body") ?? ""));
    if (result.ok) {
      toast.success("Message sent.");
      setBody("");
    } else toast.error(result.error);
    return result;
  }, null);

  const showBox = canWrite && (emptyButton == null || messages.length > 0 || open);

  return (
    <div className="flex flex-col gap-3">
      {messages.length > 0 && (
        <ul className="flex flex-col gap-2">
          {messages.map((message) => (
            <li key={message.id} className="flex flex-col gap-1 rounded-md bg-muted/50 p-3 text-sm">
              <span className="text-muted-foreground">
                {message.author}
                {message.isNew && (
                  <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary text-xs">New</span>
                )}
                <span className="ml-2">{message.at}</span>
              </span>
              <span className="whitespace-pre-wrap">{message.body}</span>
            </li>
          ))}
        </ul>
      )}
      {canWrite && !showBox && emptyButton && (
        <Button type="button" variant="outline" className="self-start" onClick={() => setOpen(true)}>
          {emptyButton}
        </Button>
      )}
      {showBox && (
        <form onSubmit={submitKeepingValues(formAction)} className="flex flex-col gap-2">
          <label htmlFor={id} className="text-sm font-medium">
            {label}
          </label>
          <Textarea
            id={id}
            name="body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={LIMITS.itemMessage}
            rows={3}
            required
          />
          {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
          <Button type="submit" className="self-start" disabled={pending}>
            Send
          </Button>
        </form>
      )}
    </div>
  );
}
