import { Badge } from "@/components/ui/badge";

type Variant = "default" | "secondary" | "destructive" | "outline";

const ITEM: Record<string, [string, Variant]> = {
  requested: ["Requested", "outline"],
  submitted: ["Submitted", "secondary"],
  needs_changes: ["Needs changes", "destructive"],
  accepted: ["Accepted", "default"],
};

const REQUEST: Record<string, [string, Variant]> = {
  draft: ["Draft", "outline"],
  open: ["Open", "secondary"],
  completed: ["Completed", "default"],
  archived: ["Archived", "outline"],
};

export function ItemStatusBadge({ status }: { status: string }) {
  const [label, variant] = ITEM[status] ?? [status, "outline"];
  return <Badge variant={variant}>{label}</Badge>;
}

export function RequestStatusBadge({ status }: { status: string }) {
  const [label, variant] = REQUEST[status] ?? [status, "outline"];
  return <Badge variant={variant}>{label}</Badge>;
}
