import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/action-button";
import { Skeleton } from "@/components/ui/skeleton";
import { requireStaff } from "@/lib/auth";
import { NIL_UUID, PAGE_SIZE, readAll } from "@/lib/supabase/read-all";
import { createClient } from "@/lib/supabase/server";
import { isId } from "@/lib/validation";
import { DeleteScheduleButton } from "../delete-schedule-button";
import { setSchedulePaused } from "../actions";
import { ScheduleForm } from "../schedule-form";

export default function SchedulePage({ params }: PageProps<"/app/schedules/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Schedule params={params} />
    </Suspense>
  );
}

async function Schedule({ params }: Pick<PageProps<"/app/schedules/[id]">, "params">) {
  const { id } = await params;
  if (!isId(id)) notFound();
  const staff = await requireStaff();
  const supabase = await createClient();
  const [schedule, active, booked] = await Promise.all([
    supabase
      .from("schedules")
      .select(
        "id, template_id, title, every_months, next_send_on, due_after_days, paused, templates(name, template_items(required))",
      )
      .eq("id", id)
      .eq("firm_id", staff.firmId)
      .maybeSingle(),
    // Every active client with at least one contact to email; the inner join drops the rest.
    readAll((last?: { id: string }) =>
      supabase
        .from("clients")
        .select("id, name, archived_at, client_contacts!inner(user_id)")
        .eq("firm_id", staff.firmId)
        .is("archived_at", null)
        .gt("id", last?.id ?? NIL_UUID)
        .order("id")
        .limit(PAGE_SIZE),
    ),
    readAll((last?: { client_id: string }) =>
      supabase
        .from("schedule_clients")
        .select("client_id, clients(name, archived_at, client_contacts(user_id))")
        .eq("firm_id", staff.firmId)
        .eq("schedule_id", id)
        .gt("client_id", last?.client_id ?? NIL_UUID)
        .order("client_id")
        .limit(PAGE_SIZE),
    ),
  ]);
  if (schedule.error) throw schedule.error;
  if (!schedule.data) notFound();
  const row = schedule.data;

  // Skipped clients stay on the form, marked so staff can remove them.
  const activeIds = new Set(active.map((client) => client.id));
  const marks: Record<string, "Archived" | "No contacts"> = {};
  for (const entry of booked) {
    if (activeIds.has(entry.client_id)) continue;
    marks[entry.client_id] = entry.clients.archived_at ? "Archived" : "No contacts";
  }
  const clients = [
    ...active.map((client) => ({ id: client.id, name: client.name, contacts: client.client_contacts.length })),
    ...booked
      .filter((entry) => !activeIds.has(entry.client_id))
      .map((entry) => ({
        id: entry.client_id,
        name: entry.clients.name,
        contacts: entry.clients.client_contacts.length,
      })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  const hasRequired = row.templates.template_items.some((item) => item.required);

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Schedule</h1>
        <p className="text-sm text-muted-foreground">
          Repeats{" "}
          <Link className="underline-offset-4 hover:underline" href={`/app/templates/${row.template_id}`}>
            {row.templates.name}
          </Link>{" "}
          on the schedule&apos;s dates.
        </p>
      </div>
      {!hasRequired && (
        <p className="text-sm text-muted-foreground">
          {row.templates.name} has no required item, so nothing is sent until it has one.{" "}
          <Link className="underline-offset-4 hover:underline" href={`/app/templates/${row.template_id}`}>
            Open the template
          </Link>
        </p>
      )}
      {/* Keyed by schedule: Next keeps this page mounted, and switching schedules must not carry state over. */}
      <ScheduleForm
        key={row.id}
        mode="edit"
        templateId={row.template_id}
        scheduleId={row.id}
        defaultTitle={row.title}
        clients={clients}
        marks={marks}
        initial={{
          title: row.title,
          everyMonths: row.every_months,
          nextSendOn: row.next_send_on,
          dueAfterDays: row.due_after_days,
          clientIds: booked.map((entry) => entry.client_id),
        }}
      />
      <div className="flex gap-2">
        <ActionButton
          action={setSchedulePaused.bind(null, row.id, !row.paused)}
          success={row.paused ? "Resumed." : "Paused."}
        >
          {row.paused ? "Resume" : "Pause"}
        </ActionButton>
        <DeleteScheduleButton scheduleId={row.id} />
      </div>
    </>
  );
}
