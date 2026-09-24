"use client";

import { useActionState, useId, useLayoutEffect, useState } from "react";
import { Plus } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { LIMITS } from "@/lib/constants";
import type { ActionResult } from "@/lib/errors";
import { submitKeepingValues } from "@/lib/forms";
import { addContact, removeContact } from "./actions";

type Contact = { userId: string; fullName: string; email: string };

export function Contacts({ clientId, contacts }: { clientId: string; contacts: Contact[] }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Contacts</h2>
        <AddContactDialog clientId={clientId} />
      </div>
      {contacts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No contacts yet. Add the people who will sign in and upload documents.
        </p>
      ) : (
        <Table>
          <TableBody>
            {contacts.map((contact) => (
              <TableRow key={contact.userId}>
                <TableCell className="font-medium">{contact.fullName}</TableCell>
                <TableCell>{contact.email}</TableCell>
                <TableCell className="text-right">
                  <RemoveContactButton clientId={clientId} contact={contact} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function AddContactDialog({ clientId }: { clientId: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  // Next keeps visited pages mounted but hidden; close so Back and Forward never return to it open.
  useLayoutEffect(() => () => setOpen(false), []);
  const [, formAction, pending] = useActionState(async (prev: ActionResult | null, formData: FormData) => {
    const result = await addContact(clientId, prev, formData);
    if (result.ok) {
      toast.success("Contact added.");
      setOpen(false);
    } else {
      toast.error(result.error);
    }
    return result;
  }, null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus />
          Add contact
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add contact</DialogTitle>
          <DialogDescription>They sign in with a code sent to this email. Nothing is sent until you send a request.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submitKeepingValues(formAction)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-name`}>Full name</Label>
            <Input id={`${id}-name`} name="fullName" maxLength={LIMITS.name} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-email`}>Email</Label>
            <Input id={`${id}-email`} name="email" type="email" required />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add contact"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RemoveContactButton({ clientId, contact }: { clientId: string; contact: Contact }) {
  async function remove() {
    const result = await removeContact(clientId, contact.userId);
    if (result.ok) toast.success("Contact removed.");
    else toast.error(result.error);
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Remove
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {contact.fullName}?</AlertDialogTitle>
          <AlertDialogDescription>They will lose access to this client&apos;s requests.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={remove}>Remove</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
