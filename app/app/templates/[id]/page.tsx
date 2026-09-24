import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { requireStaff } from "@/lib/auth";
import { newEditorItem } from "@/lib/editor-items";
import { createClient } from "@/lib/supabase/server";
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
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data: template } = await supabase
    .from("templates")
    .select("id, name, template_items(title, description, kind, required, position)")
    .eq("id", id)
    .eq("firm_id", staff.firmId)
    .order("position", { referencedTable: "template_items" })
    .order("id", { referencedTable: "template_items" })
    .maybeSingle();
  if (!template) notFound();

  return (
    <TemplateEditor
      templateId={template.id}
      initial={{ name: template.name, items: template.template_items.map((item) => newEditorItem(item)) }}
    />
  );
}
