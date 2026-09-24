import { Suspense } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { ActionButton } from "@/components/action-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createTemplate } from "./actions";

export default function TemplatesPage() {
  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Templates</h1>
        <ActionButton action={createTemplate}>
          <Plus />
          New template
        </ActionButton>
      </div>
      <Suspense fallback={<Skeleton className="h-48" />}>
        <Templates />
      </Suspense>
    </>
  );
}

async function Templates() {
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data: templates, error } = await supabase
    .from("templates")
    .select("id, name, template_items(count)")
    .eq("firm_id", staff.firmId)
    .order("name");
  if (error) throw error;

  if (templates.length === 0) {
    return <p className="text-sm text-muted-foreground">No templates yet.</p>;
  }
  return (
    <Table>
      <TableBody>
        {templates.map((template) => (
          <TableRow key={template.id}>
            <TableCell>
              <Link className="font-medium underline-offset-4 hover:underline" href={`/app/templates/${template.id}`}>
                {template.name}
              </Link>
            </TableCell>
            <TableCell className="text-right text-sm text-muted-foreground">
              {template.template_items[0]?.count ?? 0} items
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
