"use client";

import { useActionState, useEffect, useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { ActionButton } from "@/components/action-button";
import { ItemStatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { LIMITS, MAX_FILES_PER_ITEM } from "@/lib/constants";
import type { ActionResult } from "@/lib/errors";
import { ACCEPT_ATTRIBUTE, MAX_FILE_BYTES, uploadMimeType } from "@/lib/files";
import { submitKeepingValues } from "@/lib/forms";
import { createClient } from "@/lib/supabase/client";
import { createUploadUrl, registerFile, removeFile, submitItem } from "./actions";

export type PortalItem = {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  required: boolean;
  status: string;
  textAnswer: string | null;
  reviewNote: string | null;
  files: { id: string; filename: string; sizeBytes: number }[];
};

export function ItemCard({ item, requestOpen }: { item: PortalItem; requestOpen: boolean }) {
  // ponytail: optional items lock when a request completes. Upgrade path: allow
  // optional submissions on completed requests.
  const editable = requestOpen && (item.status === "requested" || item.status === "needs_changes");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{item.title}</CardTitle>
        <CardDescription>{item.required ? "Required" : "Optional"}</CardDescription>
        <CardAction>
          <ItemStatusBadge status={item.status} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {item.description && <p className="whitespace-pre-wrap text-sm">{item.description}</p>}
        {item.status === "needs_changes" && item.reviewNote && (
          <Alert variant="destructive">
            <AlertTitle>Changes requested</AlertTitle>
            <AlertDescription className="whitespace-pre-wrap">{item.reviewNote}</AlertDescription>
          </Alert>
        )}
        {item.kind === "file" ? (
          <FileItem item={item} editable={editable} />
        ) : (
          <TextItem item={item} editable={editable} />
        )}
      </CardContent>
    </Card>
  );
}

type Upload = { key: string; file: File; status: "pending" | "uploading" | "failed"; error?: string };

function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Why a file can never be uploaded (so retrying cannot help), or null. */
function rejection(file: File): string | null {
  if (!uploadMimeType(file)) return `${file.name}: this file type is not accepted.`;
  if (file.size > MAX_FILE_BYTES) return `${file.name}: files must be 25 MB or smaller.`;
  return null;
}

/**
 * Section 10.5: create a signed URL, upload straight to Storage, then register
 * the file. Returns an error message, or null when the file is registered.
 */
async function uploadOne(itemId: string, file: File): Promise<string | null> {
  const type = uploadMimeType(file)!;
  const created = await createUploadUrl(itemId, file.name);
  if (!created.ok) return created.error;
  const { path, token } = created.data!;

  const storage = createClient().storage.from("documents");
  const body = type === file.type ? file : new File([file], file.name, { type });
  const { error } = await storage.uploadToSignedUrl(path, token, body, { contentType: type });
  if (error) return "Upload failed. Check your connection and retry.";

  const registered = await registerFile(itemId, path, file.name);
  if (registered.ok) return null;
  // The object is not registered, so the contact may still delete it; a retry uploads it again.
  // ponytail: the object is orphaned if this delete fails too. Upgrade path: a nightly
  // cleanup of objects that have no item_files row.
  await storage.remove([path]);
  return registered.error;
}

function FileItem({ item, editable }: { item: PortalItem; editable: boolean }) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const queue = useRef<Promise<void>>(Promise.resolve());

  // A file dropped outside the drop zone would replace the page, and uploads in progress with it.
  useEffect(() => {
    function ignoreFileDrop(event: globalThis.DragEvent) {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    }
    window.addEventListener("dragover", ignoreFileDrop);
    window.addEventListener("drop", ignoreFileDrop);
    return () => {
      window.removeEventListener("dragover", ignoreFileDrop);
      window.removeEventListener("drop", ignoreFileDrop);
    };
  }, []);

  function update(key: string, patch: Partial<Upload> | null) {
    setUploads((current) =>
      patch === null ? current.filter((u) => u.key !== key) : current.map((u) => (u.key === key ? { ...u, ...patch } : u)),
    );
  }

  // One file at a time, in the order they were added.
  function enqueue(upload: Upload) {
    async function run() {
      update(upload.key, { status: "uploading", error: undefined });
      let error: string | null;
      try {
        error = await uploadOne(item.id, upload.file);
      } catch {
        // A dropped connection or a new deployment makes the action call throw.
        error = "Upload failed. Check your connection and retry.";
      }
      update(upload.key, error ? { status: "failed", error } : null);
    }
    queue.current = queue.current.then(run, run);
  }

  const room = MAX_FILES_PER_ITEM - item.files.length - uploads.length;

  function addFiles(files: FileList | null) {
    const picked: File[] = [];
    for (const file of Array.from(files ?? [])) {
      const reason = rejection(file);
      if (reason) toast.error(reason);
      else picked.push(file);
    }
    if (picked.length > room) toast.error(`An item can have at most ${MAX_FILES_PER_ITEM} files.`);
    const added = picked
      .slice(0, Math.max(0, room))
      .map((file) => ({ key: crypto.randomUUID(), file, status: "pending" as const }));
    setUploads((current) => [...current, ...added]);
    added.forEach(enqueue);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  }

  const busy = uploads.some((u) => u.status !== "failed");

  return (
    <div className="flex flex-col gap-3">
      {item.files.length > 0 && (
        <ul className="flex flex-col gap-2">
          {item.files.map((file) => (
            <li key={file.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">
                {file.filename} <span className="text-muted-foreground">({formatSize(file.sizeBytes)})</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <a className="underline" href={`/api/files/${file.id}?download=1`} aria-label={`Download ${file.filename}`}>
                  Download
                </a>
                {editable && (
                  <ActionButton
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${file.filename}`}
                    action={() => removeFile(file.id)}
                    success="File removed."
                  >
                    Remove
                  </ActionButton>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {uploads.length > 0 && (
        <ul className="flex flex-col gap-3" aria-live="polite">
          {uploads.map((upload) => (
            <li key={upload.key} className="flex flex-col gap-1 text-sm">
              <span className="truncate">{upload.file.name}</span>
              {upload.status === "failed" ? (
                <span className="flex flex-wrap items-center gap-2 text-destructive">
                  <span>{upload.error}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Retry ${upload.file.name}`}
                    onClick={() => enqueue(upload)}
                  >
                    Retry
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Dismiss ${upload.file.name}`}
                    onClick={() => update(upload.key, null)}
                  >
                    Dismiss
                  </Button>
                </span>
              ) : (
                <span className="text-muted-foreground">
                  {upload.status === "uploading" ? "Uploading…" : "Waiting…"}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && room > 0 && (
        <label
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex cursor-pointer flex-col items-center gap-1 rounded-md border border-dashed p-6 text-center text-sm focus-within:ring-[3px] focus-within:ring-ring/50 ${
            dragging ? "bg-muted" : ""
          }`}
        >
          <span className="font-medium">Choose files or drag them here</span>
          <span className="text-muted-foreground">PDF, images, Word, Excel, or CSV. Up to 25 MB each.</span>
          <input
            type="file"
            multiple
            accept={ACCEPT_ATTRIBUTE}
            className="sr-only"
            onChange={(event) => {
              addFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
      )}
      {editable && (
        <ActionButton
          className="self-start"
          disabled={item.files.length === 0 || busy}
          aria-label={`Submit ${item.title}`}
          action={() => submitItem(item.id)}
          success="Submitted. We'll let you know if anything else is needed."
        >
          Submit
        </ActionButton>
      )}
    </div>
  );
}

function TextItem({ item, editable }: { item: PortalItem; editable: boolean }) {
  const [, formAction, pending] = useActionState(async (_prev: ActionResult | null, formData: FormData) => {
    const result = await submitItem(item.id, String(formData.get("answer") ?? ""));
    if (result.ok) toast.success("Submitted. We'll let you know if anything else is needed.");
    else toast.error(result.error);
    return result;
  }, null);

  if (!editable) {
    return <p className="whitespace-pre-wrap text-sm">{item.textAnswer ?? "No answer."}</p>;
  }
  return (
    <form onSubmit={submitKeepingValues(formAction)} className="flex flex-col gap-2">
      <Textarea
        name="answer"
        aria-label={`Answer for ${item.title}`}
        defaultValue={item.textAnswer ?? ""}
        maxLength={LIMITS.textAnswer}
        rows={4}
        required
      />
      <Button type="submit" className="self-start" disabled={pending} aria-label={`Submit ${item.title}`}>
        Submit
      </Button>
    </form>
  );
}
