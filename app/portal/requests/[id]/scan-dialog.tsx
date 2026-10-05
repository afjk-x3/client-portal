"use client";

import { ArrowDown, ArrowUp, Camera, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { MAX_FILE_BYTES } from "@/lib/files";
import { imagesToPdf } from "@/lib/pdf";
import { preparePhoto, type ScanPage } from "./scan";

const MAX_PAGES = 30;
const LIMIT = "A PDF can have at most 30 pages.";

export function ScanDialog({ itemTitle, onPdf }: { itemTitle: string; onPdf: (file: File) => void }) {
  const [open, setOpen] = useState(false);
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // The ref is the truth the limits are checked against, so a slow photo
  // cannot push the list past 30 while state updates are still pending.
  const pagesRef = useRef<ScanPage[]>([]);
  // Discards bump this so a photo still decoding lands nowhere after the
  // list it belonged to is gone: preparePhoto can outlive a click.
  const generationRef = useRef(0);

  function replace(next: ScanPage[]) {
    pagesRef.current = next;
    setPages(next);
  }

  function clear() {
    generationRef.current++;
    for (const page of pagesRef.current) URL.revokeObjectURL(page.url);
    replace([]);
  }

  useEffect(
    () => () => {
      generationRef.current++;
      for (const page of pagesRef.current) URL.revokeObjectURL(page.url);
    },
    [],
  );

  async function addPhotos(files: FileList | null) {
    const generation = generationRef.current;
    for (const file of Array.from(files ?? [])) {
      if (generation !== generationRef.current) return;
      if (pagesRef.current.length >= MAX_PAGES) {
        toast.error(LIMIT);
        return;
      }
      try {
        const page = await preparePhoto(file);
        if (generation !== generationRef.current) {
          URL.revokeObjectURL(page.url);
          return;
        }
        // Another pick can be decoding in parallel; re-check after the await.
        if (pagesRef.current.length >= MAX_PAGES) {
          URL.revokeObjectURL(page.url);
          toast.error(LIMIT);
          return;
        }
        replace([...pagesRef.current, page]);
      } catch {
        if (generation !== generationRef.current) return;
        toast.error(`${file.name}: this photo can't be read here. Take a new photo, or upload it with Choose files.`);
      }
    }
  }

  function move(index: number, delta: -1 | 1) {
    const next = [...pagesRef.current];
    const [page] = next.splice(index, 1);
    next.splice(index + delta, 0, page);
    replace(next);
  }

  function remove(index: number) {
    URL.revokeObjectURL(pagesRef.current[index].url);
    replace(pagesRef.current.filter((_, i) => i !== index));
  }

  async function create() {
    setCreating(true);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    try {
      const bytes = imagesToPdf(pagesRef.current);
      if (bytes.length > MAX_FILE_BYTES) {
        toast.error("This PDF is over 25 MB. Remove some pages, or scan the rest separately.");
        return;
      }
      onPdf(new File([bytes], `${itemTitle}.pdf`, { type: "application/pdf" }));
      clear();
      setOpen(false);
    } finally {
      setCreating(false);
    }
  }

  function onOpenChange(next: boolean) {
    if (next) setOpen(true);
    else if (pagesRef.current.length > 0) setConfirming(true);
    else {
      clear();
      setOpen(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogTrigger asChild>
          <Button variant="outline" className="self-start">
            <Camera aria-hidden="true" />
            Scan pages
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Scan pages</DialogTitle>
            <DialogDescription>{itemTitle}</DialogDescription>
          </DialogHeader>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            aria-label="Add photos"
            onChange={(event) => {
              void addPhotos(event.target.files);
              event.target.value = "";
            }}
          />
          <Button variant="outline" className="self-start" onClick={() => inputRef.current?.click()}>
            Add photos
          </Button>
          {pages.length > 0 && (
            <ul className="flex flex-col gap-2">
              {pages.map((page, index) => (
                <li key={page.url} className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- blob preview URLs cannot use the Next image loader */}
                  <img
                    src={page.url}
                    alt={`Page ${index + 1}: ${page.name}`}
                    className="h-16 w-12 rounded border object-cover"
                  />
                  <span className="flex-1 text-sm">Page {index + 1}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Move page ${index + 1} up`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Move page ${index + 1} down`}
                    disabled={index === pages.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove page ${index + 1}`}
                    onClick={() => remove(index)}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Button disabled={pages.length === 0 || creating} onClick={() => void create()}>
            {creating ? "Creating…" : "Create PDF"}
          </Button>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard {pages.length} pages?</AlertDialogTitle>
            <AlertDialogDescription>The photos you added will be lost.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                clear();
                setOpen(false);
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
