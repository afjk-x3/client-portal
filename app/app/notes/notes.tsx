"use client";

import { useActionState, useId, useTransition, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LIMITS } from "@/lib/constants";
import type { ActionResult } from "@/lib/errors";
import { submitKeepingValues } from "@/lib/forms";
import { addNote, deleteNote, updateNote } from "./actions";

export type NoteRow = {
  id: string;
  author: string;
  at: string;
  edited: boolean;
  body: string;
  own: boolean;
  request: { id: string; title: string } | null;
};

/** The staff-only note list and its add box. The same section serves the request and client pages. */
export function Notes({
  notes,
  clientId,
  requestId,
  olderHidden,
}: {
  notes: NoteRow[];
  clientId: string;
  requestId: string | null;
  olderHidden: boolean;
}) {
  return (
    <section aria-labelledby="notes-heading" className="flex flex-col gap-3">
      <h2 id="notes-heading" className="text-lg font-semibold">
        Notes
      </h2>
      <AddNote clientId={clientId} requestId={requestId} />
      {notes.length > 0 && (
        <div className="flex flex-col gap-3 border-t pt-3">
          <h3 className="text-sm font-medium text-muted-foreground">Previous notes</h3>
          <ol className="flex flex-col gap-4">
            {notes.map((note) => (
              <NoteItem key={note.id} note={note} />
            ))}
          </ol>
        </div>
      )}
      {olderHidden && <p className="text-sm text-muted-foreground">Older notes are not shown.</p>}
    </section>
  );
}

function AddNote({ clientId, requestId }: { clientId: string; requestId: string | null }) {
  const id = useId();
  const [body, setBody] = useState("");
  const [, formAction, pending] = useActionState(async (_prev: ActionResult | null, formData: FormData) => {
    const result = await addNote(clientId, requestId, String(formData.get("body") ?? ""));
    if (result.ok) setBody("");
    else toast.error(result.error);
    return result;
  }, null);

  return (
    <form onSubmit={submitKeepingValues(formAction)} className="flex max-w-xl flex-col gap-2">
      <Label htmlFor={`${id}-body`}>Add a note</Label>
      <Textarea
        id={`${id}-body`}
        name="body"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        maxLength={LIMITS.note}
        required
      />
      <div>
        <Button type="submit" disabled={pending}>
          Add note
        </Button>
      </div>
    </form>
  );
}

function NoteItem({ note }: { note: NoteRow }) {
  const [editing, setEditing] = useState(false);

  return (
    <li className="flex flex-col gap-1">
      <p className="text-sm text-muted-foreground">
        {note.author} · {note.at}
        {note.edited && " · edited"}
      </p>
      {editing ? (
        <EditNote note={note} onDone={() => setEditing(false)} />
      ) : (
        <>
          <p className="whitespace-pre-wrap">{note.body}</p>
          {note.request && (
            <Link
              className="w-fit text-sm underline-offset-4 hover:underline"
              href={`/app/requests/${note.request.id}`}
            >
              On {note.request.title}
            </Link>
          )}
          {note.own && (
            <div className="mt-1 flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <DeleteNote noteId={note.id} />
            </div>
          )}
        </>
      )}
    </li>
  );
}

function EditNote({ note, onDone }: { note: NoteRow; onDone: () => void }) {
  const id = useId();
  const [body, setBody] = useState(note.body);
  const [, formAction, pending] = useActionState(async (_prev: ActionResult | null, formData: FormData) => {
    const result = await updateNote(note.id, String(formData.get("body") ?? ""));
    if (result.ok) onDone();
    else toast.error(result.error);
    return result;
  }, null);

  return (
    <form onSubmit={submitKeepingValues(formAction)} className="flex flex-col gap-2">
      <Label htmlFor={`${id}-body`}>Note</Label>
      <Textarea
        id={`${id}-body`}
        name="body"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        maxLength={LIMITS.note}
        required
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          Save
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function DeleteNote({ noteId }: { noteId: string }) {
  const [pending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const result = await deleteNote(noteId);
      if (!result.ok) toast.error(result.error);
    });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" disabled={pending}>
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this note?</AlertDialogTitle>
          <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={remove}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
