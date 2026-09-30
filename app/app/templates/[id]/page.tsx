import { Suspense } from "react";
import Link from "next/link";
import { CalendarClock, Send } from "lucide-react";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { requireStaff } from "@/lib/auth";
import { newEditorItem } from "@/lib/editor-items";
import { createClient } from "@/lib/supabase/server";
import { isId } from "@/lib/validation";
import { TemplateEditor } from "../template-editor";

export default function TemplatePage({ params }: PageProps<"/app/templates/[id]">) {
  return (
    <>
      <h1 className="text-2xl font-semibold">Edit template</h1>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Template params={params} />
      </Suspense>
    </>
  );
}

async function Template({ params }: Pick<PageProps<"/app/templates/[id]">, "params">) {
  const { id } = await params;
  if (!isId(id)) notFound();
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data: template, error } = await supabase
    .from("templates")
    .select("id, name, template_items(title, description, kind, required, position), schedules(count)")
    .eq("id", id)
    .eq("firm_id", staff.firmId)
    .order("position", { referencedTable: "template_items" })
    .order("id", { referencedTable: "template_items" })
    .maybeSingle();
  if (error) throw error;
  if (!template) notFound();

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" asChild>
          <Link href={`/app/templates/${template.id}/send`}>
            <Send />
            Send to clients
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href={`/app/templates/${template.id}/schedule`}>
            <CalendarClock />
            Send on a schedule
          </Link>
        </Button>
      </div>
      <TemplateEditor
        templateId={template.id}
        scheduleCount={template.schedules[0]?.count ?? 0}
        initial={{ name: template.name, items: template.template_items.map((item) => newEditorItem(item)) }}
      />
    </>
  );
}
