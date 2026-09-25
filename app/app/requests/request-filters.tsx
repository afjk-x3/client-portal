"use client";

import type { ChangeEvent } from "react";
import Form from "next/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { RequestFilters } from "@/lib/list-params";

/**
 * A GET form: Enter submits the search, any other change submits at once, and
 * leaving out `page` returns to page 1. Keyed by the filters so Back and the
 * pager reset the inputs to the URL.
 */
export function RequestFiltersForm({ filters }: { filters: RequestFilters }) {
  const submit = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => event.currentTarget.form?.requestSubmit();
  return (
    <Form action="/app/requests" key={JSON.stringify(filters)} className="flex flex-wrap items-end gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="requests-q">Search</Label>
        <Input id="requests-q" name="q" type="search" placeholder="Title or client" defaultValue={filters.q} className="w-64" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="requests-status">Status</Label>
        <NativeSelect id="requests-status" name="status" defaultValue={filters.status} onChange={submit}>
          <NativeSelectOption value="active">Active</NativeSelectOption>
          <NativeSelectOption value="draft">Draft</NativeSelectOption>
          <NativeSelectOption value="open">Open</NativeSelectOption>
          <NativeSelectOption value="completed">Completed</NativeSelectOption>
          <NativeSelectOption value="archived">Archived</NativeSelectOption>
          <NativeSelectOption value="all">All</NativeSelectOption>
        </NativeSelect>
      </div>
      <div className="flex items-center gap-2 pb-2">
        <input
          id="requests-overdue"
          name="overdue"
          type="checkbox"
          value="1"
          defaultChecked={filters.overdue}
          onChange={submit}
          className="size-4 accent-primary"
        />
        <Label htmlFor="requests-overdue">Overdue only</Label>
      </div>
    </Form>
  );
}
