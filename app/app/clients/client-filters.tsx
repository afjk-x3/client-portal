"use client";

import type { ChangeEvent } from "react";
import Form from "next/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { ClientFilters } from "@/lib/list-params";

/** A GET form like the Requests page's: Enter searches, any other change submits at once. */
export function ClientFiltersForm({
  filters,
  members,
}: {
  filters: ClientFilters;
  members: { userId: string; fullName: string }[];
}) {
  const submit = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => event.currentTarget.form?.requestSubmit();
  return (
    <Form action="/app/clients" key={JSON.stringify(filters)} className="flex flex-wrap items-end gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="clients-q">Search</Label>
        <Input id="clients-q" name="q" type="search" placeholder="Client or contact" defaultValue={filters.q} className="w-64" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="clients-owner">Owner</Label>
        <NativeSelect id="clients-owner" name="owner" defaultValue={filters.owner ?? ""} onChange={submit}>
          <NativeSelectOption value="">Anyone</NativeSelectOption>
          <NativeSelectOption value="none">No owner</NativeSelectOption>
          {members.map((member) => (
            <NativeSelectOption key={member.userId} value={member.userId}>
              {member.fullName}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="clients-kind">Type</Label>
        <NativeSelect id="clients-kind" name="kind" defaultValue={filters.kind ?? ""} onChange={submit}>
          <NativeSelectOption value="">Any</NativeSelectOption>
          <NativeSelectOption value="individual">Individual</NativeSelectOption>
          <NativeSelectOption value="business">Business</NativeSelectOption>
        </NativeSelect>
      </div>
      <div className="flex items-center gap-2 pb-2">
        <input
          id="clients-archived"
          name="archived"
          type="checkbox"
          value="1"
          defaultChecked={filters.archived}
          onChange={submit}
          className="size-4 accent-primary"
        />
        <Label htmlFor="clients-archived">Show archived</Label>
      </div>
    </Form>
  );
}
