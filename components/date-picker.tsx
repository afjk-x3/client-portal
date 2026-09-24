"use client";

import { useState } from "react";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDate, fromDateString, toDateString } from "@/lib/dates";

/** Picks a YYYY-MM-DD date. With `name`, also submits it in a form. */
export function DatePicker({
  id,
  name,
  value,
  onChange,
}: {
  id?: string;
  name?: string;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button id={id} type="button" variant="outline" className="w-full justify-start font-normal">
            <CalendarIcon />
            {value ? formatDate(value) : "Pick a date"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={value ? fromDateString(value) : undefined}
            onSelect={(date) => {
              onChange(date ? toDateString(date) : null);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      {name && <input type="hidden" name={name} value={value ?? ""} />}
    </>
  );
}
