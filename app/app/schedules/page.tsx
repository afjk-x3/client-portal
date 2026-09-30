import { Suspense } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireStaff } from "@/lib/auth";
import { formatDate, todayIn } from "@/lib/dates";
import { describeRepeat } from "@/lib/schedules";
import { createClient } from "@/lib/supabase/server";

export default function SchedulesPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Schedules</h1>
      <Suspense fallback={<Skeleton className="h-48" />}>
        <Schedules />
      </Suspense>
    </>
  );
}

async function Schedules() {
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data: schedules, error } = await supabase
    .from("schedules")
    .select(
      "id, title, every_months, day_of_month, next_send_on, last_sent_on, paused, templates(name), schedule_clients(count)",
    )
    .eq("firm_id", staff.firmId)
    .order("title");
  if (error) throw error;

  if (schedules.length === 0) {
    return <p className="text-sm text-muted-foreground">No schedules yet. Start one from a template&apos;s page.</p>;
  }

  const today = todayIn(staff.timeZone);
  const nextSend = (schedule: (typeof schedules)[number]) => {
    if (schedule.paused) return "Paused";
    if (schedule.next_send_on < today) return `Late since ${formatDate(schedule.next_send_on)}`;
    return formatDate(schedule.next_send_on);
  };

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Template</TableHead>
            <TableHead>Clients</TableHead>
            <TableHead>Repeats</TableHead>
            <TableHead>Next send</TableHead>
            <TableHead>Last sent</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {schedules.map((schedule) => (
            <TableRow key={schedule.id}>
              <TableCell>
                <Link className="font-medium underline-offset-4 hover:underline" href={`/app/schedules/${schedule.id}`}>
                  {schedule.title}
                </Link>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">{schedule.templates.name}</TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {schedule.schedule_clients[0]?.count ?? 0}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {describeRepeat(schedule.every_months as 1 | 3 | 12, schedule.day_of_month, schedule.next_send_on)}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">{nextSend(schedule)}</TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {schedule.last_sent_on ? formatDate(schedule.last_sent_on) : "Never"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
