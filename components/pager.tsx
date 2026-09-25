import Link from "next/link";
import { Button } from "@/components/ui/button";
import { LIST_PAGE_SIZE } from "@/lib/list-params";

/** "Showing 51–100 of 230" with Previous and Next links; `href` builds a page's URL. */
export function Pager({
  page,
  shown,
  total,
  href,
}: {
  page: number;
  shown: number;
  total: number;
  href: (page: number) => string;
}) {
  if (shown === 0) {
    if (page === 1) return null;
    return (
      <p className="text-sm text-muted-foreground">
        No results on this page.{" "}
        <Link className="underline" href={href(1)}>
          Back to page 1
        </Link>
      </p>
    );
  }
  const first = (page - 1) * LIST_PAGE_SIZE + 1;
  const last = first + shown - 1;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
      <span>
        Showing {first}–{last} of {total}
      </span>
      <span className="flex gap-2">
        {page > 1 && (
          <Button variant="outline" size="sm" asChild>
            <Link href={href(page - 1)}>Previous</Link>
          </Button>
        )}
        {last < total && (
          <Button variant="outline" size="sm" asChild>
            <Link href={href(page + 1)}>Next</Link>
          </Button>
        )}
      </span>
    </div>
  );
}
