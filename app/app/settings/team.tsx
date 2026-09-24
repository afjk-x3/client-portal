"use client";

import { useActionState, useLayoutEffect, useState, useTransition } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LIMITS } from "@/lib/constants";
import type { ActionResult } from "@/lib/errors";
import { submitKeepingValues } from "@/lib/forms";
import { addStaff, changeRole, removeStaff } from "./actions";

type Member = { userId: string; fullName: string; email: string; role: "admin" | "staff" };

export function Team({ members, currentUserId, isAdmin }: { members: Member[]; currentUserId: string; isAdmin: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Team</h2>
        {isAdmin && <AddStaffDialog />}
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => {
              // An admin's own row is read-only, so every firm keeps an admin.
              const editable = isAdmin && member.userId !== currentUserId;
              return (
                <TableRow key={member.userId}>
                  <TableCell className="font-medium">{member.fullName}</TableCell>
                  <TableCell>{member.email}</TableCell>
                  <TableCell>{editable ? <RoleSelect member={member} /> : roleLabel(member.role)}</TableCell>
                  <TableCell className="text-right">{editable && <RemoveButton member={member} />}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function roleLabel(role: string) {
  return role === "admin" ? "Admin" : "Staff";
}

function RoleSelect({ member }: { member: Member }) {
  const [pending, startTransition] = useTransition();

  return (
    <Select
      value={member.role}
      disabled={pending}
      onValueChange={(role) =>
        startTransition(async () => {
          const result = await changeRole(member.userId, role as Member["role"]);
          if (result.ok) toast.success("Role updated.");
          else toast.error(result.error);
        })
      }
    >
      <SelectTrigger aria-label={`Role for ${member.fullName}`} className="w-28">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="admin">Admin</SelectItem>
        <SelectItem value="staff">Staff</SelectItem>
      </SelectContent>
    </Select>
  );
}

function RemoveButton({ member }: { member: Member }) {
  async function remove() {
    const result = await removeStaff(member.userId);
    if (result.ok) toast.success("Removed from the team.");
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
          <AlertDialogTitle>Remove {member.fullName}?</AlertDialogTitle>
          <AlertDialogDescription>They will lose access to this firm.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={remove}>Remove</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function AddStaffDialog() {
  const [open, setOpen] = useState(false);
  // Next keeps visited pages mounted but hidden; close so Back and Forward never return to it open.
  useLayoutEffect(() => () => setOpen(false), []);
  const [, formAction, pending] = useActionState(async (prev: ActionResult | null, formData: FormData) => {
    const result = await addStaff(prev, formData);
    if (result.ok) {
      toast.success("Added. We emailed them a sign-in link.");
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
          Add staff
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add staff</DialogTitle>
          <DialogDescription>Every staff member sees every client in the firm.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submitKeepingValues(formAction)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="staff-name">Full name</Label>
            <Input id="staff-name" name="fullName" maxLength={LIMITS.name} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="staff-email">Email</Label>
            <Input id="staff-email" name="email" type="email" required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="staff-role">Role</Label>
            <Select name="role" defaultValue="staff">
              <SelectTrigger id="staff-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="staff">Staff</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add staff"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
