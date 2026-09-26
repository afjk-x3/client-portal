# PaperLine Backlog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the five backlog features from the approved spec: search and filters, an activity timeline, CSV import, orphaned-file cleanup, and drag-and-drop ordering.

**Architecture:** Postgres does the work where correctness matters: two `security invoker` list functions search and page, triggers record the timeline, and a `security definer` function finds orphaned files. The app adds URL-driven filter forms (`next/form`), an Activity section, a CSV import page with a server-side preview, a second cron route, and native drag events in the item editor.

**Tech Stack:** Next.js 16 (App Router, Cache Components), Supabase (Postgres RLS, Storage), Tailwind v4 with shadcn/ui (adds the `native-select` component), zod 4, Vitest, pgTAP, Playwright.

**Spec:** [`docs/superpowers/specs/2026-09-25-paperline-backlog-design.md`](../specs/2026-09-25-paperline-backlog-design.md). Read it before starting; this plan argues from it.

**Execution:** Native, chosen by the user on 2026-09-25. One session implements Tasks 1–15 in order (superpowers:executing-plans, if the plugin is available), then one fresh reviewer checks the whole branch. Start only when the user says so. Handoff: [`docs/superpowers/handoffs/2026-09-25-backlog-build.md`](../handoffs/2026-09-25-backlog-build.md).

## Global Constraints

- Page size is 50 rows on both lists: the SQL `limit 50` and `LIST_PAGE_SIZE` must match.
- Search is a case-insensitive substring match with `strpos(lower(column), lower(q)) > 0`. `%` and `_` are plain characters. A null, empty, or all-space `q` matches everything.
- The Requests status filter defaults to Active: `draft`, `open`, `completed`. "Overdue" means `open` and due before the firm's today in the firm's time zone.
- The timeline is for staff only. Drafts record nothing, and there is no backfill. A null actor shows as "PaperLine", and an actor found in neither staff nor contacts shows as "Former user". Events are ordered by `id`.
- The CSV header is `client_name,client_type,contact_name,contact_email`, matched ignoring case and surrounding spaces; `client_type` is optional and defaults to individual. Files are limited to 500 rows and 1 MB. No emails are sent, and running the same file again adds nothing.
- Orphans are files in the `documents` bucket with no `item_files` row, older than 24 hours. At most 1,000 are deleted per run. The cron runs at `0 2 * * *`.
- Drag-and-drop uses native drag events and no library. The up and down buttons stay.
- No new npm packages. The shadcn `native-select` component is a copied file, not a package.
- Add new migration files only; never edit an applied one. Run `npm run db:types` after each migration, because CI fails when `lib/database.types.ts` drifts.
- Use Conventional Commits with no AI attribution lines, and make one commit per task. Never push; the user pushes, or asks you to.

## Review Focus

The inputs and conditions below are implied by the spec but easy to leave untested. Each line names the task that pins it with a test.

1. **A CSV with the columns in another order, differently capitalized, or with extra columns** (for example a `notes` column) should read correctly. Pinned in Task 10 (`readImportRows` test).
2. **A contact email that differs from an existing contact's only in case** should be skipped, not added twice. Pinned in Task 10 (`planImport` row 5) and Task 11 (browser test, row 5).
3. **A blank or all-space search** should behave as no search. Pinned in Task 1 (pgTAP, `q => '   '`) and Task 3 (trimming).
4. **A page number past the end**, such as a bookmarked `?page=9` after the list shrank, should offer "Back to page 1" instead of an empty table with no way out. Pinned in Task 4 (browser test).
5. **Two active clients whose names differ only in case** should make the import refuse to guess. Pinned in Task 10 (`planImport` row 7).

## How to run things (Windows)

- Supabase commands need `SUPABASE_INTERNAL_IMAGE_REGISTRY=ghcr.io`. It is set as a user variable, but a PowerShell window opened before that change needs `$env:SUPABASE_INTERNAL_IMAGE_REGISTRY='ghcr.io'`.
- Local stack: `npx supabase start -x vector`. To apply a new migration without wiping data: `npx supabase migration up --local`.
- Test commands:

  | Suite | Command |
  |---|---|
  | pgTAP | `npm run test:db` |
  | Unit | `npm test` |
  | One unit file | `npx vitest run <path>` |
  | Integration | `npm run test:integration` |
  | Types | `npm run typecheck` |
  | Lint | `npm run lint` |
  | Browser | `npm run test:e2e` |
  | One browser file | `npx playwright test <path>` |

- Before any browser test, make sure nothing else serves port 3000. Playwright reuses a running server, and a dev server pointed at another Supabase project makes every sign-in fail.

## File map

| File | Task | Responsibility |
|---|---|---|
| `supabase/migrations/20260925001600_list_functions.sql` | 1 | `list_requests`, `list_clients` |
| `supabase/tests/list_functions_test.sql` | 1 | pgTAP for both |
| `lib/supabase/read-all.ts` | 2 | Shared keyset reader, `PAGE_SIZE`, `NIL_UUID` |
| `lib/list-params.ts` (+ test) | 3 | URL params ⇄ filters, `LIST_PAGE_SIZE`, `listHref` |
| `components/ui/native-select.tsx` | 4 | shadcn component (CLI) |
| `components/pager.tsx` | 4 | "Showing 51–100 of 230" + Previous/Next |
| `app/app/requests/page.tsx`, `request-filters.tsx`, `requests-table.tsx` | 4 | Requests page |
| `app/app/clients/page.tsx`, `client-filters.tsx`, `clients-table.tsx` | 5 | Client list |
| `app/app/dashboard-tabs.tsx` | 6 | Dashboard search box |
| `supabase/migrations/20260925001700_request_events.sql` | 7 | Timeline table and triggers |
| `supabase/tests/request_events_test.sql` | 7 | pgTAP for the timeline |
| `lib/activity.ts` (+ test), `app/app/requests/[id]/activity.tsx` | 8 | Timeline text and section |
| `lib/csv.ts` (+ test) | 9 | CSV reader |
| `lib/client-import.ts` (+ test) | 10 | Header, row checks, import plan |
| `app/app/clients/import/page.tsx`, `import-form.tsx`, `actions.ts` | 11 | Import page and actions |
| `supabase/migrations/20260925001800_orphaned_documents.sql` (+ pgTAP) | 12 | Orphan finder |
| `lib/cron.ts`, `lib/cleanup.ts`, `app/api/cron/cleanup/route.ts`, `integration/cleanup.test.ts` | 13 | Cleanup job |
| `lib/editor-items.ts` (+ test), `components/item-editor.tsx` | 14 | `moveItem`, drag-and-drop |
| `e2e/lists.spec.ts`, `e2e/activity.spec.ts`, `e2e/client-import.spec.ts`, `e2e/drag-and-drop.spec.ts` | 4–14 | Browser tests |

---

# Phase 1: Search and filters

### Task 1: `list_requests` and `list_clients`

**Files:**
- Create: `supabase/migrations/20260925001600_list_functions.sql`
- Create: `supabase/tests/list_functions_test.sql`
- Modify: `lib/database.types.ts` (generated)

**Interfaces:**
- Produces: `public.list_requests(q text default null, statuses text[] default '{draft,open,completed}', overdue_only boolean default false, page int default 1) returns table (id uuid, title text, status text, due_date date, client_id uuid, client_name text, open_items int, total int)`.
- Produces: `public.list_clients(q text default null, owner text default null, kind text default null, include_archived boolean default false, page int default 1) returns table (id uuid, name text, kind text, owner_id uuid, archived boolean, total int)`.
- Called from the app as `supabase.rpc("list_requests", { q, statuses, overdue_only, page })` and `supabase.rpc("list_clients", { q, owner, kind, include_archived, page })`.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/list_functions_test.sql`:

```sql
-- list_requests and list_clients: search, filters, paging, and isolation.
begin;
select plan(22);
\ir fixtures/seed.psql

-- Firm A gets an archived request, a title with a literal %, and 60 requests to page through.
insert into public.requests (id, firm_id, client_id, title, due_date, status, sent_at) values
  ('d0000000-0000-0000-0000-0000000000a5', 'f0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a2',
   'Old archived', current_date - 30, 'archived', now()),
  ('d0000000-0000-0000-0000-0000000000a6', 'f0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a2',
   '100% done', current_date + 7, 'open', now());
insert into public.requests (firm_id, client_id, title, due_date, status, sent_at)
select 'f0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a2',
       'Page ' || lpad(n::text, 2, '0'), current_date + 100, 'open', now()
from generate_series(1, 60) n;

select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select is((select total from public.list_requests() limit 1), 64, 'every active request of the caller''s firm is counted');
select is((select count(*)::int from public.list_requests()), 50, 'a page holds 50 rows');
select is((select count(*)::int from public.list_requests(page => 2)), 14, 'the next page holds the rest');
select is_empty($$ select 1 from public.list_requests(page => 3) $$, 'a page past the end is empty');
select results_eq($$ select title from public.list_requests(q => 'client a2', statuses => array['archived']) $$,
  $$ values ('Old archived') $$, 'search matches the client name, and the status filter applies');
select results_eq($$ select title from public.list_requests(q => 'DRAFT') $$,
  $$ values ('A1 draft') $$, 'search matches the title, ignoring case');
select results_eq($$ select title from public.list_requests(q => '%') $$,
  $$ values ('100% done') $$, 'a % in the search is a plain character');
select is((select total from public.list_requests(q => '   ') limit 1), 64, 'an all-space search matches everything');
select results_eq($$ select title from public.list_requests(statuses => array['draft']) $$,
  $$ values ('A1 draft') $$, 'the status filter keeps only the chosen statuses');

-- Overdue follows the firm's date. The zone is chosen to be a day away from UTC right now,
-- so a check against UTC's date would fail one of these two rows.
reset role;
update public.firms
set time_zone = case when extract(hour from now() at time zone 'UTC') >= 10 then 'Pacific/Kiritimati' else 'Pacific/Pago_Pago' end
where id = 'f0000000-0000-0000-0000-00000000000a';
update public.requests r
set due_date = (now() at time zone f.time_zone)::date
             + case when r.id = 'd0000000-0000-0000-0000-0000000000a1' then -1 else 0 end
from public.firms f
where f.id = r.firm_id
  and r.id in ('d0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-0000000000a2');
select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select results_eq($$ select title from public.list_requests(overdue_only => true) $$,
  $$ values ('A1 open') $$, 'overdue means open and due before the firm''s own today');

-- Staff of firm A who is also a contact of firm B's client.
reset role;
insert into public.client_contacts (client_id, firm_id, user_id, full_name, email) values
  ('c0000000-0000-0000-0000-0000000000b1', 'f0000000-0000-0000-0000-00000000000b',
   '00000000-0000-0000-0000-0000000000a2', 'Staff A as contact', 'staff-a@test.local');
select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select is_empty($$ select 1 from public.list_requests(statuses => array['draft', 'open', 'completed', 'archived'])
  where client_name = 'Client B1' $$, 'staff never see another firm''s requests here, even as its contact');
select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select is_empty($$ select 1 from public.list_requests() $$, 'contacts see nothing');

-- Clients: an owner, a business, an archived client, and 55 more to page through.
reset role;
update public.clients set owner_id = '00000000-0000-0000-0000-0000000000a1' where id = 'c0000000-0000-0000-0000-0000000000a1';
update public.clients set kind = 'business' where id = 'c0000000-0000-0000-0000-0000000000a2';
insert into public.clients (firm_id, name, archived_at) values ('f0000000-0000-0000-0000-00000000000a', 'Gone Client', now());
insert into public.clients (firm_id, name)
select 'f0000000-0000-0000-0000-00000000000a', 'Bulk ' || lpad(n::text, 2, '0') from generate_series(1, 55) n;
select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select is((select total from public.list_clients() limit 1), 57, 'every active client of the caller''s firm is counted');
select is((select count(*)::int from public.list_clients(page => 2)), 7, 'clients page by 50 too');
select results_eq($$ select name from public.list_clients(q => 'CONTACT-A2@') $$,
  $$ values ('Client A2') $$, 'search matches a contact''s email');
select results_eq($$ select name from public.list_clients(q => 'contact a1') $$,
  $$ values ('Client A1') $$, 'and a contact''s name');
select results_eq($$ select name from public.list_clients(owner => '00000000-0000-0000-0000-0000000000a1') $$,
  $$ values ('Client A1') $$, 'the owner filter');
select is((select count(*)::int from public.list_clients(owner => 'none', kind => 'business')), 1,
  '"no owner" and a type combine');
select results_eq($$ select name from public.list_clients(q => 'gone', include_archived => true) $$,
  $$ values ('Gone Client') $$, 'archived clients appear when asked');
select is_empty($$ select 1 from public.list_clients(q => 'gone') $$, 'and not otherwise');
select is_empty($$ select 1 from public.list_clients(q => 'Client B1') $$,
  'staff never see another firm''s clients here, even as its contact');

reset role;
set local role anon;
select throws_ok($$ select public.list_requests() $$, '42501', null, 'anon cannot list');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run test:db`
Expected: `list_functions_test.sql` fails with `function public.list_requests() does not exist`; every other file passes.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260925001600_list_functions.sql`:

```sql
-- Search, filters, and paging for the staff Requests page and the client list.
-- Security invoker: RLS applies. is_firm_member() also keeps out rows a user sees
-- only as another firm's contact. strpos() treats % and _ as plain characters.
-- 50 rows a page; LIST_PAGE_SIZE in lib/list-params.ts must match.

create function public.list_requests(
  q text default null,
  statuses text[] default array['draft', 'open', 'completed'],
  overdue_only boolean default false,
  page int default 1
)
returns table (
  id uuid,
  title text,
  status text,
  due_date date,
  client_id uuid,
  client_name text,
  open_items int,
  total int
)
language sql
stable
set search_path = ''
as $$
  select
    r.id,
    r.title,
    r.status,
    r.due_date,
    r.client_id,
    c.name,
    (select count(*)::int
     from public.request_items i
     where i.request_id = r.id and i.status in ('requested', 'needs_changes')),
    (count(*) over ())::int
  from public.requests r
  join public.clients c on c.id = r.client_id
  join public.firms f on f.id = r.firm_id
  where public.is_firm_member(r.firm_id)
    and r.status = any (list_requests.statuses)
    and (
      coalesce(btrim(list_requests.q), '') = ''
      or strpos(lower(r.title), lower(btrim(list_requests.q))) > 0
      or strpos(lower(c.name), lower(btrim(list_requests.q))) > 0
    )
    and (
      not list_requests.overdue_only
      or (r.status = 'open' and r.due_date < (now() at time zone f.time_zone)::date)
    )
  order by r.due_date, r.title, r.id
  limit 50
  offset (greatest(list_requests.page, 1) - 1) * 50;
$$;

-- owner: null for anyone, 'none' for no owner, or a member's user id.
create function public.list_clients(
  q text default null,
  owner text default null,
  kind text default null,
  include_archived boolean default false,
  page int default 1
)
returns table (
  id uuid,
  name text,
  kind text,
  owner_id uuid,
  archived boolean,
  total int
)
language sql
stable
set search_path = ''
as $$
  select c.id, c.name, c.kind, c.owner_id, c.archived_at is not null, (count(*) over ())::int
  from public.clients c
  where public.is_firm_member(c.firm_id)
    and (list_clients.include_archived or c.archived_at is null)
    and (list_clients.kind is null or c.kind = list_clients.kind)
    and (
      list_clients.owner is null
      or (list_clients.owner = 'none' and c.owner_id is null)
      or c.owner_id::text = lower(list_clients.owner)
    )
    and (
      coalesce(btrim(list_clients.q), '') = ''
      or strpos(lower(c.name), lower(btrim(list_clients.q))) > 0
      or exists (
        select 1
        from public.client_contacts cc
        where cc.client_id = c.id
          and (
            strpos(lower(cc.full_name), lower(btrim(list_clients.q))) > 0
            or strpos(lower(cc.email), lower(btrim(list_clients.q))) > 0
          )
      )
    )
  order by c.name, c.id
  limit 50
  offset (greatest(list_clients.page, 1) - 1) * 50;
$$;

revoke execute on function public.list_requests(text, text[], boolean, int) from public, anon;
revoke execute on function public.list_clients(text, text, text, boolean, int) from public, anon;
```

- [ ] **Step 4: Apply it, run the tests, and regenerate types**

Run: `npx supabase migration up --local`, then `npm run test:db`.
Expected: `Files=21, Tests=276`, `Result: PASS`.
Run: `npm run db:types`, then `npm run typecheck`.
Expected: `lib/database.types.ts` gains `list_requests` and `list_clients` under `Functions`, and typecheck passes.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260925001600_list_functions.sql supabase/tests/list_functions_test.sql lib/database.types.ts
git commit -m "feat(db): search, filter, and page requests and clients"
```

### Task 2: Shared keyset reader; every client in the send picker

**Files:**
- Create: `lib/supabase/read-all.ts`
- Modify: `lib/daily-jobs.ts` (remove its own `PAGE_SIZE`, `NIL_UUID`, `readAll`)
- Modify: `app/app/templates/[id]/send/page.tsx`

**Interfaces:**
- Produces: `readAll<Row>(page: (last: Row | undefined) => PromiseLike<PostgrestResponse<Row>>): Promise<Row[]>`, `PAGE_SIZE = 1000`, and `NIL_UUID`, all from `@/lib/supabase/read-all`. Tasks 11 and 13 use them.

This is a move plus one new caller. The integration test "paging past 1,000 rows" already covers `readAll`, and `e2e/firm-tools.spec.ts` covers the picker.

- [ ] **Step 1: Create `lib/supabase/read-all.ts`**

```ts
import type { PostgrestResponse } from "@supabase/supabase-js";

// PostgREST cuts responses off at max_rows (1000 by default) without an error. A page larger
// than max_rows would come back short and end the read early (see the README).
export const PAGE_SIZE = 1000;
export const NIL_UUID = "00000000-0000-0000-0000-000000000000"; // sorts before every generated id

/**
 * Every row of a query, a page at a time. Each page starts after the previous
 * page's last row (keyset paging), so rows that change during the read cannot
 * shift others into a second page or out of both. Callers type `last` with the
 * key columns they page by.
 */
export async function readAll<Row>(page: (last: Row | undefined) => PromiseLike<PostgrestResponse<Row>>): Promise<Row[]> {
  const rows: Row[] = [];
  for (;;) {
    const { data, error } = await page(rows.at(-1));
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
}
```

- [ ] **Step 2: Make `lib/daily-jobs.ts` use it**

In `lib/daily-jobs.ts`:
- Change the first import to `import type { SupabaseClient } from "@supabase/supabase-js";`.
- Add `import { NIL_UUID, PAGE_SIZE, readAll } from "@/lib/supabase/read-all";`.
- Delete the `// PostgREST cuts responses off…` comment, `const PAGE_SIZE = 1000;`, `const NIL_UUID = …;`, and the whole `readAll` function with its doc comment.

The constants block that remains is:

```ts
const FIRM_CONCURRENCY = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
```

- [ ] **Step 3: Page the send picker**

In `app/app/templates/[id]/send/page.tsx`, add `import { NIL_UUID, PAGE_SIZE, readAll } from "@/lib/supabase/read-all";` and replace the query block through `if (!template.data) notFound();` with:

```tsx
  const [template, clients] = await Promise.all([
    supabase.from("templates").select("id, name").eq("id", id).eq("firm_id", staff.firmId).maybeSingle(),
    // Every active client with at least one contact to email; the inner join drops the rest.
    readAll((last?: { id: string }) =>
      supabase
        .from("clients")
        .select("id, name, client_contacts!inner(user_id)")
        .eq("firm_id", staff.firmId)
        .is("archived_at", null)
        .gt("id", last?.id ?? NIL_UUID)
        .order("id")
        .limit(PAGE_SIZE),
    ),
  ]);
  if (template.error) throw template.error;
  if (!template.data) notFound();
  clients.sort((a, b) => a.name.localeCompare(b.name));
```

Then change `clients={clients.data.map((client) => ({` to `clients={clients.map((client) => ({`.

- [ ] **Step 4: Run the checks**

Run: `npm run typecheck`, `npm run test:integration`, and `npx playwright test e2e/firm-tools.spec.ts`.
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/supabase/read-all.ts lib/daily-jobs.ts "app/app/templates/[id]/send/page.tsx"
git commit -m "refactor: share the keyset reader and list every client in the send picker"
```

### Task 3: List filters from the URL

**Files:**
- Create: `lib/list-params.ts`
- Test: `lib/list-params.test.ts`

**Interfaces:**
- Produces:
  - `LIST_PAGE_SIZE = 50`.
  - `REQUEST_STATUS_FILTERS: Record<"active" | "draft" | "open" | "completed" | "archived" | "all", readonly string[]>`.
  - `type RequestFilters = { q: string; status: RequestStatusFilter; overdue: boolean; page: number }`.
  - `type ClientFilters = { q: string; owner: string | null; kind: "individual" | "business" | null; archived: boolean; page: number }`.
  - `parseRequestFilters(params)` and `parseClientFilters(params)`, where `params` is `Record<string, string | string[] | undefined>`.
  - `listHref(path: string, params: Record<string, string | number | boolean | null>): string`.

- [ ] **Step 1: Write the failing test**

Create `lib/list-params.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { listHref, parseClientFilters, parseRequestFilters } from "@/lib/list-params";

describe("parseRequestFilters", () => {
  it("defaults to active requests on page 1", () => {
    expect(parseRequestFilters({})).toEqual({ q: "", status: "active", overdue: false, page: 1 });
  });

  it("reads every param, trimming the search", () => {
    expect(parseRequestFilters({ q: "  tax  ", status: "archived", overdue: "1", page: "3" })).toEqual({
      q: "tax",
      status: "archived",
      overdue: true,
      page: 3,
    });
  });

  it("falls back to defaults for values a hand-edited URL can hold", () => {
    expect(parseRequestFilters({ status: "nope", overdue: "yes", page: "-2" })).toEqual({
      q: "",
      status: "active",
      overdue: false,
      page: 1,
    });
    expect(parseRequestFilters({ page: "2.5" }).page).toBe(1);
    expect(parseRequestFilters({ q: ["first", "second"] }).q).toBe("first");
  });
});

describe("parseClientFilters", () => {
  it("defaults to every active client", () => {
    expect(parseClientFilters({})).toEqual({ q: "", owner: null, kind: null, archived: false, page: 1 });
  });

  it("reads owner, type, and archived", () => {
    const id = "0A1B2C3D-0000-4000-8000-000000000001";
    expect(parseClientFilters({ owner: id, kind: "business", archived: "1" })).toMatchObject({
      owner: id.toLowerCase(),
      kind: "business",
      archived: true,
    });
    expect(parseClientFilters({ owner: "none" }).owner).toBe("none");
  });

  it("ignores an owner or type it does not know", () => {
    expect(parseClientFilters({ owner: "someone", kind: "robot" })).toMatchObject({ owner: null, kind: null });
  });
});

describe("listHref", () => {
  it("keeps set params and drops empty ones", () => {
    expect(listHref("/app/requests", { q: "a b", status: null, overdue: true, page: 2 })).toBe(
      "/app/requests?q=a+b&overdue=1&page=2",
    );
    expect(listHref("/app/clients", { q: "", archived: false })).toBe("/app/clients");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run lib/list-params.test.ts`
Expected: FAIL, `Cannot find module '@/lib/list-params'` or equivalent.

- [ ] **Step 3: Write `lib/list-params.ts`**

```ts
import { z } from "zod";

/** Rows per page on the Requests page and the client list; list_requests and list_clients use the same number. */
export const LIST_PAGE_SIZE = 50;

/** The statuses each Status choice shows. "active" is the default and hides archived requests. */
export const REQUEST_STATUS_FILTERS = {
  active: ["draft", "open", "completed"],
  draft: ["draft"],
  open: ["open"],
  completed: ["completed"],
  archived: ["archived"],
  all: ["draft", "open", "completed", "archived"],
} as const satisfies Record<string, readonly string[]>;

export type RequestStatusFilter = keyof typeof REQUEST_STATUS_FILTERS;
export type RequestFilters = { q: string; status: RequestStatusFilter; overdue: boolean; page: number };
export type ClientFilters = {
  q: string;
  owner: string | null;
  kind: "individual" | "business" | null;
  archived: boolean;
  page: number;
};

type SearchParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const search = z.string().trim().transform((value) => value.slice(0, 200)).catch("");
const page = z.coerce.number().int().min(1).max(10_000).catch(1);
const status = z
  .enum(Object.keys(REQUEST_STATUS_FILTERS) as [RequestStatusFilter, ...RequestStatusFilter[]])
  .catch("active");
const owner = z
  .union([z.literal("none"), z.uuid().transform((id) => id.toLowerCase())])
  .nullable()
  .catch(null);
const kind = z.enum(["individual", "business"]).nullable().catch(null);

/** Requests page filters from the URL. Anything invalid falls back to its default. */
export function parseRequestFilters(params: SearchParams): RequestFilters {
  return {
    q: search.parse(first(params.q)),
    status: status.parse(first(params.status)),
    overdue: first(params.overdue) === "1",
    page: page.parse(first(params.page)),
  };
}

/** Client list filters from the URL. Anything invalid falls back to its default. */
export function parseClientFilters(params: SearchParams): ClientFilters {
  return {
    q: search.parse(first(params.q)),
    owner: owner.parse(first(params.owner)),
    kind: kind.parse(first(params.kind)),
    archived: first(params.archived) === "1",
    page: page.parse(first(params.page)),
  };
}

/** A list URL with the given params; empty, null, and false values are left out. */
export function listHref(path: string, params: Record<string, string | number | boolean | null>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === "" || value === false) continue;
    query.set(key, value === true ? "1" : String(value));
  }
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run lib/list-params.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/list-params.ts lib/list-params.test.ts
git commit -m "feat: read list filters from the URL"
```

### Task 4: Requests page

**Files:**
- Create: `components/ui/native-select.tsx` (shadcn CLI)
- Create: `components/pager.tsx`
- Create: `app/app/requests/page.tsx`, `app/app/requests/request-filters.tsx`, `app/app/requests/requests-table.tsx`
- Modify: `app/app/app-sidebar.tsx` (a "Requests" link)
- Modify: `e2e/helpers.ts` (move `addClientWithContact` here), `e2e/firm-tools.spec.ts` (import it)
- Test: `e2e/lists.spec.ts`

**Interfaces:**
- Consumes: `list_requests` (Task 1); `parseRequestFilters`, `REQUEST_STATUS_FILTERS`, `listHref`, `LIST_PAGE_SIZE`, `RequestFilters` (Task 3).
- Produces: `<Pager page shown total href />` from `@/components/pager`, where `href: (page: number) => string`, used again in Task 5. Also `addClientWithContact(page, name, email)` in `e2e/helpers.ts`, used in Tasks 5, 8, and 11.

- [ ] **Step 1: Move the test helper**

In `e2e/helpers.ts`, append:

```ts
/** Creates a client with one contact of the same name and ends on the client's page. */
export async function addClientWithContact(page: Page, name: string, email: string) {
  await addClient(page, name);
  await page.getByRole("button", { name: "Add contact" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Full name" }).fill(name);
  await dialog.getByRole("textbox", { name: "Email" }).fill(email);
  await dialog.getByRole("button", { name: "Add contact" }).click();
  await expect(page.getByRole("cell", { name: email })).toBeVisible();
}
```

In `e2e/firm-tools.spec.ts`, delete the local `addClientWithContact` function. Change the imports to:

```ts
import { expect, test } from "@playwright/test";
import { addClientWithContact, expectToast, signIn, signUpWithFirm, uniqueEmail } from "./helpers";
```

- [ ] **Step 2: Write the failing browser test**

Create `e2e/lists.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { addClientWithContact, expectToast, fillRequest, signUpWithFirm, uniqueEmail } from "./helpers";

test("the Requests page searches, filters, and keeps its state in the URL", async ({ page }) => {
  await signUpWithFirm(page, uniqueEmail("lists"), "List Firm", "Lee Staff");
  await addClientWithContact(page, "Nora North", uniqueEmail("nora"));
  await addClientWithContact(page, "Sol South", uniqueEmail("sol"));

  // Two sent requests from the starter template, then one draft.
  await page.getByRole("link", { name: "Templates" }).click();
  await page.getByRole("link", { name: "Annual tax return (starter)" }).click();
  await page.getByRole("link", { name: "Send to clients" }).click();
  await page.getByRole("checkbox", { name: /Nora North/ }).click();
  await page.getByRole("checkbox", { name: /Sol South/ }).click();
  await page.getByRole("button", { name: "Due date" }).click();
  await page.getByRole("button", { name: "Go to the Next Month" }).click();
  await page.getByRole("button", { name: /15th/ }).click();
  await page.getByRole("button", { name: "Send to 2 clients" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Send" }).click();
  await expectToast(page, "Sent to 2 clients.");
  await page.getByRole("link", { name: "Clients", exact: true }).click();
  await page.getByRole("link", { name: "Nora North" }).click();
  await page.getByRole("link", { name: "New request" }).click();
  await fillRequest(page, "Quarterly payroll", "Payroll register");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expectToast(page, "Draft saved.");

  await page.getByRole("link", { name: "Requests", exact: true }).click();
  await expect(page.getByText("Showing 1–3 of 3")).toBeVisible();
  const search = page.getByRole("searchbox", { name: "Search", exact: true });
  await search.fill("payroll");
  await search.press("Enter");
  await expect(page).toHaveURL(/q=payroll/);
  await expect(page.getByRole("link", { name: "Quarterly payroll" })).toBeVisible();
  await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

  await search.fill("sol south");
  await search.press("Enter");
  await expect(page.getByRole("link", { name: "Annual tax return (starter)" })).toHaveCount(1);
  await page.getByRole("combobox", { name: "Status" }).selectOption("draft");
  await expect(page).toHaveURL(/status=draft/);
  await expect(page.getByText("No requests match.")).toBeVisible();

  // Back restores the previous filters, in the form as well as the table.
  await page.goBack();
  await expect(page.getByRole("combobox", { name: "Status" })).toHaveValue("active");
  await expect(page.getByRole("link", { name: "Annual tax return (starter)" })).toHaveCount(1);

  // A page past the end offers a way back.
  await page.goto("/app/requests?page=9");
  await page.getByRole("link", { name: "Back to page 1" }).click();
  await expect(page.getByText("Showing 1–3 of 3")).toBeVisible();
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx playwright test e2e/lists.spec.ts`
Expected: FAIL at the "Requests" link: `getByRole('link', { name: 'Requests', exact: true })` never appears.

- [ ] **Step 4: Add the shadcn native select**

Run: `npx shadcn@latest add native-select --yes`
Expected: `components/ui/native-select.tsx` is created, exporting `NativeSelect` and `NativeSelectOption`.

- [ ] **Step 5: Write `components/pager.tsx`**

```tsx
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
```

- [ ] **Step 6: Write the filter form, table, and page**

Create `app/app/requests/request-filters.tsx`:

```tsx
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
```

Create `app/app/requests/requests-table.tsx`:

```tsx
"use client";

import Link from "next/link";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { RequestStatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/dates";

export type RequestListRow = {
  id: string;
  title: string;
  status: string;
  dueDate: string;
  clientId: string;
  clientName: string;
  openItems: number;
  overdue: boolean;
};

const columns: DataTableColumn<RequestListRow>[] = [
  {
    id: "client",
    header: "Client",
    cell: ({ row }) => (
      <Link className="underline-offset-4 hover:underline" href={`/app/clients/${row.original.clientId}`}>
        {row.original.clientName}
      </Link>
    ),
  },
  {
    id: "title",
    header: "Request",
    cell: ({ row }) => (
      <Link className="font-medium underline-offset-4 hover:underline" href={`/app/requests/${row.original.id}`}>
        {row.original.title}
      </Link>
    ),
  },
  { id: "status", header: "Status", cell: ({ row }) => <RequestStatusBadge status={row.original.status} /> },
  {
    id: "due",
    header: "Due",
    cell: ({ row }) => (
      <span className="flex items-center gap-2">
        {formatDate(row.original.dueDate)}
        {row.original.overdue && <Badge variant="destructive">Overdue</Badge>}
      </span>
    ),
  },
  { accessorKey: "openItems", header: "Open items" },
];

export function RequestsTable({ rows }: { rows: RequestListRow[] }) {
  return <DataTable columns={columns} data={rows} emptyMessage="No requests match." />;
}
```

Create `app/app/requests/page.tsx`:

```tsx
import { Suspense } from "react";
import { Pager } from "@/components/pager";
import { Skeleton } from "@/components/ui/skeleton";
import { requireStaff } from "@/lib/auth";
import { isOverdue, todayIn } from "@/lib/dates";
import { listHref, parseRequestFilters, REQUEST_STATUS_FILTERS } from "@/lib/list-params";
import { createClient } from "@/lib/supabase/server";
import { RequestFiltersForm } from "./request-filters";
import { RequestsTable } from "./requests-table";

export default function RequestsPage({ searchParams }: PageProps<"/app/requests">) {
  return (
    <>
      <h1 className="text-2xl font-semibold">Requests</h1>
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Requests searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Requests({ searchParams }: Pick<PageProps<"/app/requests">, "searchParams">) {
  const filters = parseRequestFilters(await searchParams);
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_requests", {
    q: filters.q,
    statuses: [...REQUEST_STATUS_FILTERS[filters.status]],
    overdue_only: filters.overdue,
    page: filters.page,
  });
  if (error) throw error;

  const today = todayIn(staff.timeZone);
  const href = (page: number) =>
    listHref("/app/requests", {
      q: filters.q,
      status: filters.status === "active" ? null : filters.status,
      overdue: filters.overdue,
      page: page === 1 ? null : page,
    });

  return (
    <>
      <RequestFiltersForm filters={filters} />
      <RequestsTable
        rows={data.map((request) => ({
          id: request.id,
          title: request.title,
          status: request.status,
          dueDate: request.due_date,
          clientId: request.client_id,
          clientName: request.client_name,
          openItems: request.open_items,
          overdue: request.status === "open" && isOverdue(request.due_date, today),
        }))}
      />
      <Pager page={filters.page} shown={data.length} total={data[0]?.total ?? 0} href={href} />
    </>
  );
}
```

- [ ] **Step 7: Add the sidebar link**

In `app/app/app-sidebar.tsx`, add `Inbox` to the lucide import and insert the Requests entry between Clients and Templates:

```ts
import { FileText, Inbox, LayoutDashboard, LogOut, Settings, Users } from "lucide-react";

const NAV = [
  { href: "/app", label: "Dashboard", icon: LayoutDashboard },
  { href: "/app/clients", label: "Clients", icon: Users },
  { href: "/app/requests", label: "Requests", icon: Inbox },
  { href: "/app/templates", label: "Templates", icon: FileText },
  { href: "/app/settings", label: "Settings", icon: Settings },
];
```

- [ ] **Step 8: Run the checks**

Run: `npm run typecheck`, `npm run lint`, and `npx playwright test e2e/lists.spec.ts e2e/firm-tools.spec.ts`.
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add components/ui/native-select.tsx components/pager.tsx app/app/requests/page.tsx app/app/requests/request-filters.tsx app/app/requests/requests-table.tsx app/app/app-sidebar.tsx e2e/helpers.ts e2e/firm-tools.spec.ts e2e/lists.spec.ts
git commit -m "feat: Requests page with search, status and overdue filters, and paging"
```

### Task 5: Client list search, filters, and paging

**Files:**
- Modify: `app/app/clients/page.tsx`, `app/app/clients/clients-table.tsx`
- Create: `app/app/clients/client-filters.tsx`
- Modify: `e2e/staff-workflows.spec.ts` ("Show archived" becomes a checkbox)
- Test: `e2e/lists.spec.ts` (a second test)

**Interfaces:**
- Consumes: `list_clients` (Task 1); `parseClientFilters`, `listHref`, `ClientFilters` (Task 3); `Pager` (Task 4).
- Produces: `ClientsTable({ clients: ClientRow[] })`, a table with no filtering of its own.

- [ ] **Step 1: Write the failing browser test**

Append to `e2e/lists.spec.ts`:

```ts
test("the client list searches contacts and filters by type, owner, and archived", async ({ page }) => {
  await signUpWithFirm(page, uniqueEmail("clients"), "Client Firm", "Cleo Staff");
  const hidden = uniqueEmail("hidden-contact");
  await addClientWithContact(page, "Avery Home", hidden);
  await page.getByRole("link", { name: "Clients", exact: true }).click();
  await page.getByRole("button", { name: "New client" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Birch Bakery");
  await dialog.getByRole("combobox", { name: "Type" }).click();
  await page.getByRole("option", { name: "Business" }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Birch Bakery" })).toBeVisible();

  await page.getByRole("link", { name: "Clients", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "Search", exact: true });
  await search.fill(hidden.slice(0, 20));
  await search.press("Enter");
  await expect(page.getByRole("link", { name: "Avery Home" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Birch Bakery" })).toHaveCount(0);

  await search.fill("");
  await search.press("Enter");
  // Wait for the new page, so the next change starts from it.
  await expect(page.getByRole("link", { name: "Birch Bakery" })).toBeVisible();
  await page.getByRole("combobox", { name: "Type" }).selectOption("business");
  await expect(page.getByRole("link", { name: "Birch Bakery" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Avery Home" })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Owner" }).selectOption("none");
  await expect(page).toHaveURL(/owner=none/);
  await expect(page.getByRole("link", { name: "Birch Bakery" })).toBeVisible();
});
```

In `e2e/staff-workflows.spec.ts`, replace:

```ts
  await page.getByRole("switch", { name: "Show archived" }).click();
```

with:

```ts
  await page.getByRole("checkbox", { name: "Show archived" }).check();
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx playwright test e2e/lists.spec.ts -g "client list"`
Expected: FAIL. The search by contact email finds no "Avery Home", because the current list searches names only.

- [ ] **Step 3: Write the filter form**

Create `app/app/clients/client-filters.tsx`:

```tsx
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
```

- [ ] **Step 4: Strip the filtering from the table**

Replace `app/app/clients/clients-table.tsx` with:

```tsx
"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/data-table";

export type ClientRow = {
  id: string;
  name: string;
  kind: string;
  owner: string;
  archived: boolean;
};

const columns: DataTableColumn<ClientRow>[] = [
  {
    id: "name",
    header: "Name",
    cell: ({ row }) => (
      <Link className="font-medium underline-offset-4 hover:underline" href={`/app/clients/${row.original.id}`}>
        {row.original.name}
      </Link>
    ),
  },
  { id: "kind", header: "Type", cell: ({ row }) => (row.original.kind === "business" ? "Business" : "Individual") },
  { accessorKey: "owner", header: "Owner" },
  { id: "status", header: "", cell: ({ row }) => row.original.archived && <Badge variant="outline">Archived</Badge> },
];

/** One page of clients; the page's filters decide which. */
export function ClientsTable({ clients }: { clients: ClientRow[] }) {
  return <DataTable columns={columns} data={clients} emptyMessage="No clients." />;
}
```

- [ ] **Step 5: Query through `list_clients`**

Replace `app/app/clients/page.tsx` with:

```tsx
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { Pager } from "@/components/pager";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { requireStaff } from "@/lib/auth";
import { listHref, parseClientFilters } from "@/lib/list-params";
import { createClient } from "@/lib/supabase/server";
import { addClient } from "./actions";
import { ClientFiltersForm } from "./client-filters";
import { ClientFormDialog } from "./client-form-dialog";
import { ClientsTable } from "./clients-table";

export default function ClientsPage({ searchParams }: PageProps<"/app/clients">) {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <Clients searchParams={searchParams} />
    </Suspense>
  );
}

async function Clients({ searchParams }: Pick<PageProps<"/app/clients">, "searchParams">) {
  const filters = parseClientFilters(await searchParams);
  const staff = await requireStaff();
  const supabase = await createClient();
  const [clients, members] = await Promise.all([
    supabase.rpc("list_clients", {
      q: filters.q,
      owner: filters.owner ?? undefined,
      kind: filters.kind ?? undefined,
      include_archived: filters.archived,
      page: filters.page,
    }),
    supabase.from("firm_members").select("user_id, full_name").eq("firm_id", staff.firmId).order("full_name"),
  ]);
  if (clients.error) throw clients.error;
  if (members.error) throw members.error;

  const memberList = members.data.map((m) => ({ userId: m.user_id, fullName: m.full_name }));
  const ownerName = new Map(memberList.map((m) => [m.userId, m.fullName]));
  const href = (page: number) =>
    listHref("/app/clients", {
      q: filters.q,
      owner: filters.owner,
      kind: filters.kind,
      archived: filters.archived,
      page: page === 1 ? null : page,
    });

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Clients</h1>
        <ClientFormDialog
          title="New client"
          members={memberList}
          action={addClient}
          openAfterSave
          trigger={
            <Button>
              <Plus />
              New client
            </Button>
          }
        />
      </div>
      <ClientFiltersForm filters={filters} members={memberList} />
      <ClientsTable
        clients={clients.data.map((c) => ({
          id: c.id,
          name: c.name,
          kind: c.kind,
          owner: (c.owner_id && ownerName.get(c.owner_id)) || "",
          archived: c.archived,
        }))}
      />
      <Pager page={filters.page} shown={clients.data.length} total={clients.data[0]?.total ?? 0} href={href} />
    </>
  );
}
```

- [ ] **Step 6: Run the checks**

Run: `npm run typecheck`, `npm run lint`, and `npx playwright test e2e/lists.spec.ts e2e/staff-workflows.spec.ts`.
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add app/app/clients/page.tsx app/app/clients/clients-table.tsx app/app/clients/client-filters.tsx e2e/lists.spec.ts e2e/staff-workflows.spec.ts
git commit -m "feat: client list searches contacts, filters by owner and type, and pages"
```

### Task 6: Dashboard search

**Files:**
- Modify: `app/app/dashboard-tabs.tsx`
- Test: `e2e/lists.spec.ts` (first test)

- [ ] **Step 1: Extend the browser test**

In the first test of `e2e/lists.spec.ts`, insert right after `await expectToast(page, "Sent to 2 clients.");`:

```ts
  // The dashboard's search filters both tabs and their counts.
  await expect(page.getByRole("tab", { name: "Waiting on clients (2)" })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search the dashboard" }).fill("nora");
  await expect(page.getByRole("tab", { name: "Waiting on clients (1)" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Annual tax return (starter)" })).toHaveCount(1);
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx playwright test e2e/lists.spec.ts -g "Requests page"`
Expected: FAIL. The searchbox "Search the dashboard" is not found.

- [ ] **Step 3: Add the search**

In `app/app/dashboard-tabs.tsx`, add `import { useState } from "react";` and `import { Input } from "@/components/ui/input";`, then replace the `DashboardTabs` function with:

```tsx
export function DashboardTabs({ waiting, ready }: { waiting: WaitingRow[]; ready: ReadyRow[] }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const hit = (...fields: string[]) => needle === "" || fields.some((field) => field.toLowerCase().includes(needle));
  const shownWaiting = waiting.filter((row) => hit(row.client, row.title));
  const shownReady = ready.filter((row) => hit(row.client, row.request, row.item));

  return (
    <div className="flex flex-col gap-4">
      <Input
        type="search"
        aria-label="Search the dashboard"
        placeholder="Search clients, requests, and items"
        className="max-w-sm"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <Tabs defaultValue="waiting">
        <TabsList>
          <TabsTrigger value="waiting">Waiting on clients ({shownWaiting.length})</TabsTrigger>
          <TabsTrigger value="ready">Ready for review ({shownReady.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="waiting">
          <DataTable columns={waitingColumns} data={shownWaiting} emptyMessage="No client is holding up a request." />
        </TabsContent>
        <TabsContent value="ready">
          <DataTable columns={readyColumns} data={shownReady} emptyMessage="Nothing to review." />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 4: Run all of Phase 1's checks**

Run each command and confirm:

| Command | Expected |
|---|---|
| `npm run test:db` | PASS, 276 tests |
| `npm test` | PASS, 70 tests |
| `npm run test:integration` | PASS, 3 tests |
| `npm run typecheck` | passes |
| `npm run lint` | passes |
| `npm run build` | passes |
| `npm run test:e2e` | PASS, 7 tests |

- [ ] **Step 5: Commit**

```bash
git add app/app/dashboard-tabs.tsx e2e/lists.spec.ts
git commit -m "feat: search the dashboard tabs"
```

---

# Phase 2: Activity timeline

### Task 7: `request_events` and its triggers

**Files:**
- Create: `supabase/migrations/20260925001700_request_events.sql`
- Create: `supabase/tests/request_events_test.sql`
- Modify: `lib/database.types.ts` (generated)

**Interfaces:**
- Produces: table `public.request_events (id bigint, firm_id uuid, request_id uuid, item_id uuid null, actor_id uuid null, kind text, detail jsonb, created_at timestamptz)`, readable by staff of the firm.
- Kinds and their `detail`:

  | Kind | `detail` |
  |---|---|
  | `sent` | `{}` |
  | `details_changed` | `{title?: [old, new], due_date?: [old, new]}` |
  | `item_added`, `item_removed` | `{title}` |
  | `file_added`, `file_removed` | `{filename, by_staff}` |
  | `submitted`, `accepted` | `{}` |
  | `returned` | `{note}` |
  | `reminder_sent` | `{manual: boolean}` |
  | `archived`, `unarchived`, `completed`, `reopened` | `{}` |

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/request_events_test.sql`:

```sql
-- request_events: what each change records, who can read it, and that nobody can change it.
begin;
select plan(31);
\ir fixtures/seed.psql

-- The fixture's own inserts recorded events; start from none.
delete from public.request_events;

-- Kinds recorded for a request, oldest first.
create function pg_temp.kinds(request uuid) returns text[] language sql as $$
  select coalesce(array_agg(e.kind order by e.id), '{}') from public.request_events e where e.request_id = request
$$;

-- Staff edit the details of a sent request.
select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$ update public.requests set title = 'A1 renamed', due_date = due_date + 1
  where id = 'd0000000-0000-0000-0000-0000000000a1' $$, 'staff edit a sent request');
reset role;
select is(pg_temp.kinds('d0000000-0000-0000-0000-0000000000a1'), array['details_changed'], 'one event for both fields');
select is((select detail -> 'title' from public.request_events where kind = 'details_changed'),
  '["A1 open", "A1 renamed"]'::jsonb, 'with the old and new title');
select is((select actor_id from public.request_events where kind = 'details_changed'),
  '00000000-0000-0000-0000-0000000000a2'::uuid, 'and who made it');

-- The contact adds a file and submits; staff accept both required items, which completes the request.
insert into storage.objects (bucket_id, name, metadata, owner_id) values ('documents',
  'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a4/receipt.pdf',
  '{"size": 10, "mimetype": "application/pdf"}', '00000000-0000-0000-0000-0000000000c1');
select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$ select public.register_file('10000000-0000-0000-0000-0000000000a4',
  'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a4/receipt.pdf',
  'receipt.pdf') $$, 'the contact adds a file');
select lives_ok($$ select public.submit_item('10000000-0000-0000-0000-0000000000a1') $$, 'and submits the file item');
select lives_ok($$ select public.submit_item('10000000-0000-0000-0000-0000000000a3', 'No changes') $$, 'and the text item');
-- One statement per item, as the app does. One statement for both would fire the
-- completion from the first row's trigger, between the two accepted events.
select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$ update public.request_items set status = 'accepted' where id = '10000000-0000-0000-0000-0000000000a1' $$,
  'staff accept the file item');
select lives_ok($$ update public.request_items set status = 'accepted' where id = '10000000-0000-0000-0000-0000000000a3' $$,
  'and the text item, which completes the request');
reset role;
select is(pg_temp.kinds('d0000000-0000-0000-0000-0000000000a1'),
  array['details_changed', 'file_added', 'submitted', 'submitted', 'accepted', 'accepted', 'completed'],
  'each change is an event, and item events come before the completion they cause');
select is((select detail from public.request_events where kind = 'file_added'),
  '{"filename": "receipt.pdf", "by_staff": false}'::jsonb, 'a file event keeps the name and who added it');

-- Returning an item reopens the request.
select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$ update public.request_items set status = 'needs_changes', review_note = 'Wrong year'
  where id = '10000000-0000-0000-0000-0000000000a3' $$, 'staff return an item');
reset role;
select is((select array_agg(kind order by id) from (select id, kind from public.request_events
  where request_id = 'd0000000-0000-0000-0000-0000000000a1' order by id desc limit 2) last_two),
  array['returned', 'reopened'], 'the return, then the request reopens');
select is((select detail ->> 'note' from public.request_events where kind = 'returned'), 'Wrong year',
  'a return keeps its note');

-- Reminders by staff and by the daily job, which has no user.
select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$ select public.claim_reminder('d0000000-0000-0000-0000-0000000000a1') $$, 'staff send a reminder');
reset role;
set local request.jwt.claims = '{}';
insert into public.notifications_sent (kind, target_id, sent_on)
values ('reminder', 'd0000000-0000-0000-0000-0000000000a1', current_date + 1);
select results_eq(
  $$ select actor_id, detail ->> 'manual' from public.request_events where kind = 'reminder_sent' order by id $$,
  $$ values ('00000000-0000-0000-0000-0000000000a2'::uuid, 'true'), (null::uuid, 'false') $$,
  'reminders record who sent them');

-- Archive and unarchive.
select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$ update public.requests set status = 'archived' where id = 'd0000000-0000-0000-0000-0000000000a2' $$,
  'staff archive a request');
select lives_ok($$ update public.requests set status = 'open' where id = 'd0000000-0000-0000-0000-0000000000a2' $$,
  'and unarchive it');
reset role;
select is(pg_temp.kinds('d0000000-0000-0000-0000-0000000000a2'), array['archived', 'unarchived'],
  'archive and unarchive are events');

-- Items added to and removed from a sent request.
select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$ insert into public.request_items (id, request_id, firm_id, position, title, kind, required)
  values ('10000000-0000-0000-0000-0000000000a8', 'd0000000-0000-0000-0000-0000000000a2',
          'f0000000-0000-0000-0000-00000000000a', 2, 'Late item', 'text', false) $$, 'staff add an item');
select lives_ok($$ select public.remove_item('10000000-0000-0000-0000-0000000000a8') $$, 'and remove it');
reset role;
select results_eq(
  $$ select kind, detail ->> 'title' from public.request_events
     where request_id = 'd0000000-0000-0000-0000-0000000000a2' and kind like 'item_%' order by id $$,
  $$ values ('item_added'::text, 'Late item'::text), ('item_removed', 'Late item') $$,
  'item events keep the title');

-- A draft records nothing until it is sent.
select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$ update public.requests set title = 'Draft renamed' where id = 'd0000000-0000-0000-0000-0000000000a9' $$,
  'staff edit a draft');
select lives_ok($$ update public.requests set status = 'open', sent_at = now()
  where id = 'd0000000-0000-0000-0000-0000000000a9' $$, 'then send it');
reset role;
select is(pg_temp.kinds('d0000000-0000-0000-0000-0000000000a9'), array['sent'], 'only the send is recorded');

-- Who can read and write.
select tests.login_as('00000000-0000-0000-0000-0000000000b1');
select is_empty($$ select 1 from public.request_events where request_id = 'd0000000-0000-0000-0000-0000000000a1' $$,
  'another firm reads nothing');
select tests.login_as('00000000-0000-0000-0000-0000000000c1');
select is_empty($$ select 1 from public.request_events $$, 'contacts read nothing');
select tests.login_as('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$ insert into public.request_events (firm_id, request_id, kind)
  values ('f0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-0000000000a1', 'sent') $$,
  '42501', null, 'staff cannot write events');
select throws_ok($$ update public.request_events set kind = 'sent' $$, '42501', null, 'or change them');
select throws_ok($$ delete from public.request_events $$, '42501', null, 'or delete them');

-- A cascading delete (a client removed by hand) never fails on its events.
reset role;
select lives_ok($$ delete from public.clients where id = 'c0000000-0000-0000-0000-0000000000a2' $$,
  'deleting a client removes its requests, their files, and their events');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run test:db`
Expected: `request_events_test.sql` fails with `relation "public.request_events" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260925001700_request_events.sql`:

```sql
-- Staff-only activity timeline for sent requests. Triggers write every event;
-- no app role can insert, change, or delete one. Drafts record nothing.

create table public.request_events (
  id bigint generated always as identity primary key,
  firm_id uuid not null,
  request_id uuid not null,
  -- No foreign keys: an event outlives a removed item or user.
  item_id uuid,
  actor_id uuid,
  kind text not null check (kind in (
    'sent', 'details_changed', 'item_added', 'item_removed', 'file_added', 'file_removed',
    'submitted', 'accepted', 'returned', 'reminder_sent', 'archived', 'unarchived', 'completed', 'reopened'
  )),
  detail jsonb not null default '{}',
  created_at timestamptz not null default now(),
  foreign key (request_id, firm_id) references public.requests (id, firm_id) on delete cascade
);
create index request_events_request_id_id_idx on public.request_events (request_id, id);

alter table public.request_events enable row level security;
revoke insert, update, delete, truncate on public.request_events from anon, authenticated;

create policy "Staff can read events"
  on public.request_events for select to authenticated
  using (public.is_firm_member(firm_id));

-- Writes one event for a sent request. A draft, or a request already removed by a
-- cascading delete, records nothing. auth.uid() is null for the daily job.
create function public.log_request_event(request_id uuid, item_id uuid, kind text, detail jsonb default '{}')
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.request_events (firm_id, request_id, item_id, actor_id, kind, detail)
  select r.firm_id, r.id, log_request_event.item_id, (select auth.uid()), log_request_event.kind, log_request_event.detail
  from public.requests r
  where r.id = log_request_event.request_id
    and r.status <> 'draft';
$$;

create function public.requests_log_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes jsonb := '{}';
begin
  if new.status is distinct from old.status then
    if old.status = 'draft' and new.status = 'open' then
      perform public.log_request_event(new.id, null, 'sent');
    elsif new.status = 'archived' then
      perform public.log_request_event(new.id, null, 'archived');
    elsif old.status = 'archived' then
      perform public.log_request_event(new.id, null, 'unarchived');
    elsif old.status = 'open' and new.status = 'completed' then
      perform public.log_request_event(new.id, null, 'completed');
    elsif old.status = 'completed' and new.status = 'open' then
      perform public.log_request_event(new.id, null, 'reopened');
    end if;
  end if;
  if old.status <> 'draft' then
    if new.title is distinct from old.title then
      v_changes := v_changes || jsonb_build_object('title', jsonb_build_array(old.title, new.title));
    end if;
    if new.due_date is distinct from old.due_date then
      v_changes := v_changes || jsonb_build_object('due_date', jsonb_build_array(old.due_date, new.due_date));
    end if;
    if v_changes <> '{}' then
      perform public.log_request_event(new.id, null, 'details_changed', v_changes);
    end if;
  end if;
  return null;
end;
$$;

create trigger requests_log_events
  after update of status, title, due_date on public.requests
  for each row execute function public.requests_log_events();

create function public.request_items_log_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_request_event(new.request_id, new.id, 'item_added', jsonb_build_object('title', new.title));
  elsif tg_op = 'DELETE' then
    perform public.log_request_event(old.request_id, old.id, 'item_removed', jsonb_build_object('title', old.title));
  elsif new.status is distinct from old.status then
    if new.status = 'submitted' then
      perform public.log_request_event(new.request_id, new.id, 'submitted');
    elsif new.status = 'accepted' then
      perform public.log_request_event(new.request_id, new.id, 'accepted');
    elsif new.status = 'needs_changes' then
      perform public.log_request_event(new.request_id, new.id, 'returned', jsonb_build_object('note', new.review_note));
    end if;
  end if;
  return null;
end;
$$;

-- The name sorts before request_items_refresh_status, and Postgres fires a row's
-- triggers in name order: an item's event comes before the completed or reopened
-- event it causes.
create trigger request_items_log_events
  after insert or delete or update of status on public.request_items
  for each row execute function public.request_items_log_events();

create function public.item_files_log_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.log_request_event(i.request_id, old.item_id, 'file_removed',
      jsonb_build_object('filename', old.filename, 'by_staff', old.by_staff))
    from public.request_items i
    where i.id = old.item_id;
  else
    perform public.log_request_event(i.request_id, new.item_id, 'file_added',
      jsonb_build_object('filename', new.filename, 'by_staff', new.by_staff))
    from public.request_items i
    where i.id = new.item_id;
  end if;
  return null;
end;
$$;

create trigger item_files_log_events
  after insert or delete on public.item_files
  for each row execute function public.item_files_log_events();

create function public.notifications_sent_log_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'reminder' then
    perform public.log_request_event(new.target_id, null, 'reminder_sent',
      jsonb_build_object('manual', (select auth.uid()) is not null));
  end if;
  return null;
end;
$$;

create trigger notifications_sent_log_events
  after insert on public.notifications_sent
  for each row execute function public.notifications_sent_log_events();

revoke execute on function public.log_request_event(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.requests_log_events() from public, anon, authenticated;
revoke execute on function public.request_items_log_events() from public, anon, authenticated;
revoke execute on function public.item_files_log_events() from public, anon, authenticated;
revoke execute on function public.notifications_sent_log_events() from public, anon, authenticated;
```

- [ ] **Step 4: Apply it, run the tests, and regenerate types**

Run: `npx supabase migration up --local`, then `npm run test:db`.
Expected: `Files=22, Tests=307`, `Result: PASS`. The catalog guard in `access_rules_test.sql` stays green, because every new definer function pins `search_path` and is closed to anon.
Run: `npm run db:types`, then `npm run typecheck` and `npm run test:integration`.
Expected: types include `request_events`; typecheck and integration pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260925001700_request_events.sql supabase/tests/request_events_test.sql lib/database.types.ts
git commit -m "feat(db): record each request's activity with triggers"
```

### Task 8: The Activity section

**Files:**
- Create: `lib/activity.ts`, `lib/activity.test.ts`
- Create: `app/app/requests/[id]/activity.tsx`
- Modify: `app/app/requests/[id]/page.tsx`
- Test: `e2e/activity.spec.ts`

**Interfaces:**
- Consumes: `request_events` (Task 7).
- Produces:
  - `actorName(actorId: string | null, names: ReadonlyMap<string, string>): string`
  - `itemLabel(itemId: string | null, detail: Record<string, unknown>, titles: ReadonlyMap<string, string>): string`
  - `describeEvent(kind: string, detail: Record<string, unknown>, item: string): string`

- [ ] **Step 1: Write the failing unit test**

Create `lib/activity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { actorName, describeEvent, itemLabel } from "@/lib/activity";

describe("describeEvent", () => {
  it.each([
    ["sent", {}, "sent the request"],
    ["submitted", {}, "submitted Photo ID"],
    ["accepted", {}, "accepted Photo ID"],
    ["file_added", { filename: "scan.pdf", by_staff: false }, "added “scan.pdf” to Photo ID"],
    ["file_removed", { filename: "scan.pdf", by_staff: true }, "removed “scan.pdf” from Photo ID"],
    ["returned", { note: "Wrong year" }, "returned Photo ID: “Wrong year”"],
    ["item_added", { title: "Photo ID" }, "added the item “Photo ID”"],
    ["item_removed", { title: "Photo ID" }, "removed the item “Photo ID”"],
    ["reminder_sent", { manual: true }, "sent a reminder"],
    ["reminder_sent", { manual: false }, "sent the daily reminder"],
    ["archived", {}, "archived the request"],
    ["unarchived", {}, "unarchived the request"],
    ["completed", {}, "completed the request"],
    ["reopened", {}, "reopened the request"],
  ])("%s %o", (kind, detail, text) => {
    expect(describeEvent(kind, detail, "Photo ID")).toBe(text);
  });

  it("names each changed detail", () => {
    expect(
      describeEvent("details_changed", { title: ["2026 taxes", "2027 taxes"], due_date: ["2027-03-05", "2027-03-12"] }, ""),
    ).toBe("changed the title from “2026 taxes” to “2027 taxes” and changed the due date from Mar 5, 2027 to Mar 12, 2027");
  });
});

describe("itemLabel", () => {
  const titles = new Map([["i1", "Photo ID"]]);

  it("uses the item's current title, then the title the event kept", () => {
    expect(itemLabel("i1", {}, titles)).toBe("Photo ID");
    expect(itemLabel("gone", { title: "Old item" }, titles)).toBe("Old item");
  });

  it("falls back for an item since removed whose event kept no title", () => {
    expect(itemLabel("gone", {}, titles)).toBe("an item");
  });
});

describe("actorName", () => {
  const names = new Map([["u1", "Maria Santos"]]);

  it("names people, the daily job, and removed users", () => {
    expect(actorName("u1", names)).toBe("Maria Santos");
    expect(actorName(null, names)).toBe("PaperLine");
    expect(actorName("u2", names)).toBe("Former user");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run lib/activity.test.ts`
Expected: FAIL, the module is not found.

- [ ] **Step 3: Write `lib/activity.ts`**

```ts
import { formatDate } from "@/lib/dates";

type Detail = Record<string, unknown>;

const quoted = (value: unknown) => `“${String(value)}”`;

/** Who did it: a staff member or contact by name, "PaperLine" for the daily job, or "Former user". */
export function actorName(actorId: string | null, names: ReadonlyMap<string, string>): string {
  if (actorId === null) return "PaperLine";
  return names.get(actorId) ?? "Former user";
}

/** The item's current title, else the title the event kept, else "an item" for one since removed. */
export function itemLabel(itemId: string | null, detail: Detail, titles: ReadonlyMap<string, string>): string {
  return (itemId && titles.get(itemId)) || (typeof detail.title === "string" ? detail.title : "an item");
}

/** What happened, after the actor's name: "accepted Photo ID". */
export function describeEvent(kind: string, detail: Detail, item: string): string {
  switch (kind) {
    case "sent":
      return "sent the request";
    case "details_changed": {
      const changes: string[] = [];
      const title = detail.title as [string, string] | undefined;
      const due = detail.due_date as [string, string] | undefined;
      if (title) changes.push(`changed the title from ${quoted(title[0])} to ${quoted(title[1])}`);
      if (due) changes.push(`changed the due date from ${formatDate(due[0])} to ${formatDate(due[1])}`);
      return changes.join(" and ") || "changed the request";
    }
    case "item_added":
      return `added the item ${quoted(item)}`;
    case "item_removed":
      return `removed the item ${quoted(item)}`;
    case "file_added":
      return `added ${quoted(detail.filename)} to ${item}`;
    case "file_removed":
      return `removed ${quoted(detail.filename)} from ${item}`;
    case "submitted":
      return `submitted ${item}`;
    case "accepted":
      return `accepted ${item}`;
    case "returned":
      return `returned ${item}: ${quoted(detail.note)}`;
    case "reminder_sent":
      return detail.manual ? "sent a reminder" : "sent the daily reminder";
    case "archived":
      return "archived the request";
    case "unarchived":
      return "unarchived the request";
    case "completed":
      return "completed the request";
    case "reopened":
      return "reopened the request";
    default:
      return kind;
  }
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run lib/activity.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Write the failing browser test**

Create `e2e/activity.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { addClientWithContact, expectToast, fillRequest, signIn, signUpWithFirm, uniqueEmail } from "./helpers";

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

test("the Activity section shows who did what, newest first", async ({ browser }) => {
  const staff = await (await browser.newContext()).newPage();
  await signUpWithFirm(staff, uniqueEmail("activity"), "Timeline Firm", "Tia Staff");
  const contactEmail = uniqueEmail("remy");
  await addClientWithContact(staff, "Remy Client", contactEmail);
  await staff.getByRole("link", { name: "New request" }).click();
  await fillRequest(staff, "Year-end", "Bank letter");
  await staff.getByRole("button", { name: "Send", exact: true }).click();
  await expectToast(staff, "Request sent.");
  const activity = staff.getByRole("region", { name: "Activity" });
  await expect(activity.getByRole("listitem")).toHaveText([/^Tia Staff sent the request · /]);

  const contact = await (await browser.newContext()).newPage();
  await signIn(contact, contactEmail);
  await contact.getByRole("link", { name: /Year-end/ }).click();
  await contact.locator('input[type="file"]').setInputFiles({ name: "letter.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(contact.getByRole("button", { name: "Remove letter.pdf" })).toBeVisible();
  await contact.getByRole("button", { name: "Submit Bank letter" }).click();
  await expectToast(contact, /Submitted/);

  await staff.reload();
  await staff.getByRole("button", { name: "Bank letter" }).click();
  await staff.getByRole("dialog", { name: "Bank letter" }).getByRole("button", { name: "Accept" }).click();
  await expectToast(staff, "Item accepted.");
  await staff.keyboard.press("Escape");
  await staff.reload();
  await expect(activity.getByRole("listitem")).toHaveText([
    /^Tia Staff completed the request · /,
    /^Tia Staff accepted Bank letter · /,
    /^Remy Client submitted Bank letter · /,
    /^Remy Client added “letter\.pdf” to Bank letter · /,
    /^Tia Staff sent the request · /,
  ]);
});
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `npx playwright test e2e/activity.spec.ts`
Expected: FAIL. The region "Activity" is not found.

- [ ] **Step 7: Write the section and load the events**

Create `app/app/requests/[id]/activity.tsx`:

```tsx
/** A request's timeline, newest first. Staff only. */
export function Activity({ events }: { events: { id: number; actor: string; text: string; at: string }[] }) {
  return (
    <section aria-labelledby="activity-heading" className="flex flex-col gap-3">
      <h2 id="activity-heading" className="text-lg font-semibold">
        Activity
      </h2>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
      ) : (
        <ol className="flex flex-col gap-2 text-sm">
          {events.map((event) => (
            <li key={event.id}>
              <span className="font-medium">{event.actor}</span> {event.text}
              <span className="text-muted-foreground"> · {event.at}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
```

In `app/app/requests/[id]/page.tsx`:
- Add `import { actorName, describeEvent, itemLabel } from "@/lib/activity";` and `import { Activity } from "./activity";`.
- Insert this block after the `if (request.status === "draft") { … }` branch, before the final `return`:

```tsx
  const [events, members, contacts] = await Promise.all([
    supabase
      .from("request_events")
      .select("id, kind, item_id, actor_id, detail, created_at")
      .eq("request_id", request.id)
      .order("id", { ascending: false }),
    supabase.from("firm_members").select("user_id, full_name").eq("firm_id", staff.firmId),
    supabase.from("client_contacts").select("user_id, full_name").eq("client_id", request.client_id),
  ]);
  if (events.error) throw events.error;
  if (members.error) throw members.error;
  if (contacts.error) throw contacts.error;
  // Staff names win for a user who is also this client's contact.
  const names = new Map([
    ...contacts.data.map((contact) => [contact.user_id, contact.full_name] as const),
    ...members.data.map((member) => [member.user_id, member.full_name] as const),
  ]);
  const titles = new Map(request.request_items.map((item) => [item.id, item.title]));
  const activity = events.data.map((event) => {
    const detail = (event.detail ?? {}) as Record<string, unknown>;
    return {
      id: event.id,
      actor: actorName(event.actor_id, names),
      text: describeEvent(event.kind, detail, itemLabel(event.item_id, detail, titles)),
      at: formatDateTime(event.created_at, staff.timeZone),
    };
  });
```

- Render `<Activity events={activity} />` right after the closing `/>` of `<ReviewItems … />`.

- [ ] **Step 8: Run the checks**

Run: `npm run typecheck`, `npm run lint`, `npm test`, and `npx playwright test e2e/activity.spec.ts e2e/happy-path.spec.ts e2e/portal-and-review.spec.ts`.
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add lib/activity.ts lib/activity.test.ts "app/app/requests/[id]/activity.tsx" "app/app/requests/[id]/page.tsx" e2e/activity.spec.ts
git commit -m "feat: Activity section on the staff request page"
```

---

# Phase 3: CSV import

### Task 9: CSV reader

**Files:**
- Create: `lib/csv.ts`
- Test: `lib/csv.test.ts`

**Interfaces:**
- Produces: `parseCsv(text: string): string[][]`. Every line becomes a record, and an empty line becomes `[""]`. A final newline adds nothing, and a leading byte-order mark is dropped.

- [ ] **Step 1: Write the failing test**

Create `lib/csv.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv";

describe("parseCsv", () => {
  it("splits records and fields", () => {
    expect(parseCsv("a,b\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("reads quoted fields with commas, escaped quotes, and line breaks", () => {
    expect(parseCsv('"Rivera, Alex","say ""hi""","two\nlines"')).toEqual([["Rivera, Alex", 'say "hi"', "two\nlines"]]);
  });

  it("handles CRLF, a byte-order mark, a blank line, and a final newline", () => {
    expect(parseCsv("﻿a,b\r\n\r\nc,d\r\n")).toEqual([["a", "b"], [""], ["c", "d"]]);
  });

  it("keeps empty fields", () => {
    expect(parseCsv('a,,c\n,,\nx,y,""')).toEqual([
      ["a", "", "c"],
      ["", "", ""],
      ["x", "y", ""],
    ]);
  });

  it("keeps accented and non-Latin text", () => {
    expect(parseCsv("José Núñez,李明")).toEqual([["José Núñez", "李明"]]);
  });

  it("reads nothing from an empty file", () => {
    expect(parseCsv("")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run lib/csv.test.ts`
Expected: FAIL, the module is not found.

- [ ] **Step 3: Write `lib/csv.ts`**

```ts
/**
 * Records and fields of CSV text: quoted fields with "" escapes, commas and line
 * breaks inside quotes, CRLF or LF, and a leading byte-order mark. An empty line
 * is a record with one empty field, so record numbers match spreadsheet rows.
 */
export function parseCsv(text: string): string[][] {
  const input = text.startsWith("﻿") ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char !== '"') field += char;
      else if (input[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run lib/csv.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/csv.ts lib/csv.test.ts
git commit -m "feat: read CSV files"
```

### Task 10: Import rows, checks, and plan

**Files:**
- Create: `lib/client-import.ts`
- Test: `lib/client-import.test.ts`

**Interfaces:**
- Consumes: `emailSchema`, `personNameSchema` from `@/lib/validation`, and `LIMITS` from `@/lib/constants`.
- Produces:
  - `MAX_IMPORT_ROWS = 500`, `MAX_IMPORT_BYTES = 1024 * 1024`, `IMPORT_TEMPLATE: string`.
  - `type ImportRow = { row: number; clientName: string; clientType: string; contactName: string; contactEmail: string }`.
  - `readImportRows(records: string[][]): { ok: true; rows: ImportRow[] } | { ok: false; error: string }`.
  - `type ExistingClient = { id: string; name: string; archived: boolean; contactEmails: string[] }`.
  - `type RowOutcome = { row: number; clientName: string; contactEmail: string; outcome: "create" | "add" | "skip" | "error"; message: string }`.
  - `type ImportPlan = { outcomes: RowOutcome[]; newClients: { key: string; name: string; kind: "individual" | "business"; rows: number[] }[]; contacts: { row: number; clientId: string | null; clientKey: string; fullName: string; email: string }[] }`.
  - `planImport(rows: ImportRow[], existing: ExistingClient[]): ImportPlan`.

- [ ] **Step 1: Write the failing test**

Create `lib/client-import.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MAX_IMPORT_ROWS, planImport, readImportRows, type ExistingClient, type ImportRow } from "@/lib/client-import";

const row = (n: number, clientName: string, contactName = "", contactEmail = "", clientType = ""): ImportRow => ({
  row: n,
  clientName,
  clientType,
  contactName,
  contactEmail,
});

describe("readImportRows", () => {
  it("finds the columns by name, in any order, ignoring extra ones and blank rows", () => {
    expect(
      readImportRows([
        ["Contact_Email", "notes", " CLIENT_NAME ", "contact_name"],
        ["jo@example.com", "vip", "Acme", "Jo"],
        ["", "", "", ""],
        ["", "", "Birch", ""],
      ]),
    ).toEqual({
      ok: true,
      rows: [
        { row: 2, clientName: "Acme", clientType: "", contactName: "Jo", contactEmail: "jo@example.com" },
        { row: 4, clientName: "Birch", clientType: "", contactName: "", contactEmail: "" },
      ],
    });
  });

  it("refuses a file without the required columns, without rows, or with too many", () => {
    expect(readImportRows([["name", "email"], ["Acme", "jo@example.com"]])).toMatchObject({ ok: false });
    expect(readImportRows([["client_name", "contact_name", "contact_email"]])).toEqual({
      ok: false,
      error: "The file has no rows after the header.",
    });
    const header = ["client_name", "contact_name", "contact_email"];
    const many = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => [`Client ${i}`, "", ""]);
    expect(readImportRows([header, ...many])).toEqual({ ok: false, error: "A file can have at most 500 rows." });
  });
});

describe("planImport", () => {
  const existing: ExistingClient[] = [
    { id: "c1", name: "Rivera Household", archived: false, contactEmails: ["alex@example.com"] },
    { id: "c2", name: "Old Co", archived: true, contactEmails: [] },
    { id: "c3", name: "Twin", archived: false, contactEmails: [] },
    { id: "c4", name: "twin", archived: false, contactEmails: [] },
  ];

  it("creates each new client once, adds contacts to existing ones, and skips what is there", () => {
    const plan = planImport(
      [
        row(2, "Acme Bakery", "Jo Baker", "jo@example.com", "business"),
        row(3, "acme bakery", "Lee Baker", "lee@example.com", "individual"),
        row(4, "RIVERA HOUSEHOLD", "Sam Rivera", "Sam@Example.com"),
        row(5, "Rivera Household", "Alex Rivera", "ALEX@example.com"),
        row(6, "Rivera Household"),
        row(7, "Acme Bakery"),
      ],
      existing,
    );
    expect(plan.outcomes.map((o) => [o.row, o.outcome])).toEqual([
      [2, "create"],
      [3, "add"],
      [4, "add"],
      [5, "skip"],
      [6, "skip"],
      [7, "skip"],
    ]);
    expect(plan.newClients).toEqual([{ key: "acme bakery", name: "Acme Bakery", kind: "business", rows: [2, 3, 7] }]);
    expect(plan.contacts.map((c) => [c.row, c.clientId, c.clientKey, c.email])).toEqual([
      [2, null, "acme bakery", "jo@example.com"],
      [3, null, "acme bakery", "lee@example.com"],
      [4, "c1", "rivera household", "sam@example.com"],
    ]);
  });

  it("reports the rows it cannot import", () => {
    const plan = planImport(
      [
        row(2, "", "No Client", "x@example.com"),
        row(3, "Acme", "Jo", "not-an-email"),
        row(4, "Acme", "", "jo@example.com"),
        row(5, "Acme", "Jo", "jo@example.com", "robot"),
        row(6, "Old Co", "Pat", "pat@example.com"),
        row(7, "Twin", "Kim", "kim@example.com"),
        row(8, "New Co", "Kim", "kim@example.com"),
        row(9, "new co", "Kim", "KIM@example.com"),
      ],
      existing,
    );
    expect(plan.outcomes.map((o) => [o.row, o.outcome, o.message])).toEqual([
      [2, "error", "The client name is missing."],
      [3, "error", "Enter a valid email address."],
      [4, "error", "The contact's name is missing."],
      [5, "error", "The type must be individual or business."],
      [6, "error", "Old Co is archived. Unarchive it first."],
      [7, "error", "More than one client is named Twin. Add this contact by hand."],
      [8, "create", "New client, with kim@example.com."],
      [9, "error", "Same as row 8."],
    ]);
    expect(plan.contacts.map((c) => c.row)).toEqual([8]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run lib/client-import.test.ts`
Expected: FAIL, the module is not found.

- [ ] **Step 3: Write `lib/client-import.ts`**

```ts
import { LIMITS } from "@/lib/constants";
import { emailSchema, personNameSchema } from "@/lib/validation";

export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_BYTES = 1024 * 1024;

/** The file staff can download from the import page. */
export const IMPORT_TEMPLATE = [
  "client_name,client_type,contact_name,contact_email",
  "Rivera Household,individual,Alex Rivera,alex@example.com",
  "Rivera Household,individual,Sam Rivera,sam@example.com",
  "Acme Bakery,business,Jo Baker,jo@example.com",
  "",
].join("\n");

/** A data row as read from the file. `row` is its spreadsheet row; the header is row 1. */
export type ImportRow = {
  row: number;
  clientName: string;
  clientType: string;
  contactName: string;
  contactEmail: string;
};

type Kind = "individual" | "business";

/** A firm's client as the import sees it. `contactEmails` are lowercase. */
export type ExistingClient = { id: string; name: string; archived: boolean; contactEmails: string[] };

export type RowOutcome = {
  row: number;
  clientName: string;
  contactEmail: string;
  outcome: "create" | "add" | "skip" | "error";
  message: string;
};

export type ImportPlan = {
  outcomes: RowOutcome[];
  /** Clients to create, keyed by lowercase name, with every row that names them. */
  newClients: { key: string; name: string; kind: Kind; rows: number[] }[];
  /** Contacts to add: to an existing client (`clientId`), or to a new one (`clientKey`). */
  contacts: { row: number; clientId: string | null; clientKey: string; fullName: string; email: string }[];
};

/** The data rows of a parsed file, found by column name, or why the file cannot be used. */
export function readImportRows(records: string[][]): { ok: true; rows: ImportRow[] } | { ok: false; error: string } {
  const header = (records[0] ?? []).map((name) => name.trim().toLowerCase());
  const [client, type, contact, email] = ["client_name", "client_type", "contact_name", "contact_email"].map((name) =>
    header.indexOf(name),
  );
  if (client < 0 || contact < 0 || email < 0) {
    return {
      ok: false,
      error: "The first row must name the columns client_name, client_type, contact_name, and contact_email.",
    };
  }
  const cell = (record: string[], index: number) => (index < 0 ? "" : (record[index] ?? ""));
  const rows = records
    .map((record, index) => ({
      row: index + 1,
      clientName: cell(record, client),
      clientType: cell(record, type),
      contactName: cell(record, contact),
      contactEmail: cell(record, email),
    }))
    .slice(1)
    .filter((row) => [row.clientName, row.clientType, row.contactName, row.contactEmail].some((v) => v.trim() !== ""));
  if (rows.length === 0) return { ok: false, error: "The file has no rows after the header." };
  if (rows.length > MAX_IMPORT_ROWS) return { ok: false, error: `A file can have at most ${MAX_IMPORT_ROWS} rows.` };
  return { ok: true, rows };
}

type Checked = { clientName: string; kind: Kind; contact: { fullName: string; email: string } | null };

/** One row's client and optional contact, or what is wrong with it. */
function checkRow(input: ImportRow): { ok: true; value: Checked } | { ok: false; error: string } {
  const clientName = input.clientName.trim();
  if (clientName === "") return { ok: false, error: "The client name is missing." };
  if (clientName.length > LIMITS.name) {
    return { ok: false, error: `Client names must be ${LIMITS.name} characters or fewer.` };
  }
  const type = input.clientType.trim().toLowerCase();
  if (type !== "" && type !== "individual" && type !== "business") {
    return { ok: false, error: "The type must be individual or business." };
  }
  const kind: Kind = type === "business" ? "business" : "individual";
  const name = input.contactName.trim();
  const email = input.contactEmail.trim();
  if (name === "" && email === "") return { ok: true, value: { clientName, kind, contact: null } };
  if (email === "") return { ok: false, error: "The contact's email is missing." };
  if (name === "") return { ok: false, error: "The contact's name is missing." };
  const fullName = personNameSchema.safeParse(name);
  if (!fullName.success) return { ok: false, error: fullName.error.issues[0].message };
  const address = emailSchema.safeParse(email);
  if (!address.success) return { ok: false, error: address.error.issues[0].message };
  return { ok: true, value: { clientName, kind, contact: { fullName: fullName.data, email: address.data } } };
}

/**
 * What importing `rows` would do for a firm with `existing` clients. Pure: the
 * preview and the import both call it, the import against fresh data.
 */
export function planImport(rows: ImportRow[], existing: ExistingClient[]): ImportPlan {
  const byName = Map.groupBy(existing, (client) => client.name.trim().toLowerCase());
  const plan: ImportPlan = { outcomes: [], newClients: [], contacts: [] };
  const firstRow = new Map<string, number>(); // "client|email" → the row that used it first

  for (const input of rows) {
    const base = { row: input.row, clientName: input.clientName.trim(), contactEmail: input.contactEmail.trim() };
    const outcome = (kind: RowOutcome["outcome"], message: string) => plan.outcomes.push({ ...base, outcome: kind, message });
    const checked = checkRow(input);
    if (!checked.ok) {
      outcome("error", checked.error);
      continue;
    }
    const { clientName, kind, contact } = checked.value;
    const key = clientName.toLowerCase();
    const rowKey = `${key}|${contact?.email ?? ""}`;
    const earlier = firstRow.get(rowKey);
    if (earlier !== undefined) {
      outcome("error", `Same as row ${earlier}.`);
      continue;
    }
    firstRow.set(rowKey, input.row);

    const matches = byName.get(key) ?? [];
    const active = matches.filter((client) => !client.archived);
    if (active.length > 1) {
      outcome("error", `More than one client is named ${clientName}. Add this contact by hand.`);
    } else if (active.length === 0 && matches.length > 0) {
      outcome("error", `${matches[0].name} is archived. Unarchive it first.`);
    } else if (active.length === 1) {
      const client = active[0];
      if (!contact) outcome("skip", "Client already exists.");
      else if (client.contactEmails.includes(contact.email)) outcome("skip", "Contact already on this client.");
      else {
        outcome("add", `Adds a contact to ${client.name}.`);
        plan.contacts.push({ row: input.row, clientId: client.id, clientKey: key, ...contact });
      }
    } else {
      // New to the firm: the first row creates the client, and its type wins.
      let created = plan.newClients.find((client) => client.key === key);
      if (!created) {
        created = { key, name: clientName, kind, rows: [] };
        plan.newClients.push(created);
        outcome("create", contact ? `New client, with ${contact.email}.` : "New client.");
      } else if (contact) {
        outcome("add", `Adds a contact to ${created.name}.`);
      } else {
        outcome("skip", "Client listed in an earlier row.");
      }
      created.rows.push(input.row);
      if (contact) plan.contacts.push({ row: input.row, clientId: null, clientKey: key, ...contact });
    }
  }
  return plan;
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run lib/client-import.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/client-import.ts lib/client-import.test.ts
git commit -m "feat: plan a client import from CSV rows"
```

### Task 11: Import page and actions

**Files:**
- Create: `app/app/clients/import/actions.ts`, `app/app/clients/import/page.tsx`, `app/app/clients/import/import-form.tsx`
- Modify: `app/app/clients/page.tsx` (an "Import CSV" button)
- Test: `e2e/client-import.spec.ts`

**Interfaces:**
- Consumes: `planImport`, `readImportRows`, `MAX_IMPORT_ROWS`, `MAX_IMPORT_BYTES`, `IMPORT_TEMPLATE` (Task 10); `parseCsv` (Task 9); `readAll`, `NIL_UUID`, `PAGE_SIZE` (Task 2); `ensureUser` (`lib/supabase/admin.ts`).
- Produces:
  - `previewImport(rows: ImportRow[]): Promise<ActionResult<RowOutcome[]>>`
  - `importClients(rows: ImportRow[]): Promise<ActionResult<ImportResult>>`, where `ImportResult = { clientsCreated: number; contactsAdded: number; skipped: number; failed: { row: number; message: string }[] }`.

- [ ] **Step 1: Write the failing browser test**

Create `e2e/client-import.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { addClientWithContact, signUpWithFirm, uniqueEmail } from "./helpers";

test("importing clients previews each row, then adds only what is new", async ({ page }) => {
  await signUpWithFirm(page, uniqueEmail("import"), "Import Firm", "Ivy Staff");
  const known = uniqueEmail("known");
  await addClientWithContact(page, "Rivera Household", known);

  const jo = uniqueEmail("jo");
  const sam = uniqueEmail("sam");
  const file = {
    name: "clients.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      [
        "client_name,client_type,contact_name,contact_email",
        `Acme Bakery,business,Jo Baker,${jo}`,
        "Acme Bakery,business,,",
        `rivera household,,Sam Rivera,${sam}`,
        `Rivera Household,,Known Person,${known.toUpperCase()}`,
        "Broken Co,,Bad Email,not-an-email",
      ].join("\n"),
    ),
  };
  const result = (row: number) =>
    page.getByRole("row").filter({ has: page.getByRole("cell", { name: String(row), exact: true }) });

  await page.getByRole("link", { name: "Clients", exact: true }).click();
  await page.getByRole("link", { name: "Import CSV" }).click();
  await page.getByLabel("CSV file").setInputFiles(file);
  await expect(result(2)).toContainText("New client");
  await expect(result(3)).toContainText("Client listed in an earlier row.");
  await expect(result(4)).toContainText("Adds a contact to Rivera Household.");
  await expect(result(5)).toContainText("Contact already on this client.");
  await expect(result(6)).toContainText("Enter a valid email address.");

  await page.getByRole("button", { name: "Import 2 rows" }).click();
  await expect(page.getByText("1 client created, 2 contacts added, 2 rows skipped, 1 row failed.")).toBeVisible();
  await expect(page.getByText("Row 6: Enter a valid email address.")).toBeVisible();

  await page.getByRole("link", { name: "Back to clients" }).click();
  const search = page.getByRole("searchbox", { name: "Search", exact: true });
  await search.fill(sam);
  await search.press("Enter");
  await expect(page.getByRole("link", { name: "Rivera Household" })).toBeVisible();

  // The same file again changes nothing.
  await page.getByRole("link", { name: "Import CSV" }).click();
  await page.getByLabel("CSV file").setInputFiles(file);
  await expect(result(2)).toContainText("Contact already on this client.");
  await expect(page.getByRole("button", { name: "Import 0 rows" })).toBeDisabled();
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx playwright test e2e/client-import.spec.ts`
Expected: FAIL. The link "Import CSV" is not found.

- [ ] **Step 3: Write the actions**

Create `app/app/clients/import/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { MAX_IMPORT_ROWS, planImport, type ExistingClient, type ImportRow, type RowOutcome } from "@/lib/client-import";
import { errorMessage, type ActionResult } from "@/lib/errors";
import { ensureUser } from "@/lib/supabase/admin";
import { NIL_UUID, PAGE_SIZE, readAll } from "@/lib/supabase/read-all";
import { createClient } from "@/lib/supabase/server";

// The browser sends what it read from the file; planImport decides which rows are valid.
const rowsSchema = z
  .array(
    z.object({
      row: z.number().int().min(2),
      clientName: z.string().max(1000),
      clientType: z.string().max(100),
      contactName: z.string().max(1000),
      contactEmail: z.string().max(1000),
    }),
  )
  .min(1)
  .max(MAX_IMPORT_ROWS);

const badRows = { ok: false as const, error: `A file must have between 1 and ${MAX_IMPORT_ROWS} rows.` };

export type ImportResult = {
  clientsCreated: number;
  contactsAdded: number;
  skipped: number;
  failed: { row: number; message: string }[];
};

/** Every client of the firm with its contacts' emails, in pages. */
async function existingClients(firmId: string): Promise<ExistingClient[]> {
  const supabase = await createClient();
  const clients = await readAll((last?: { id: string }) =>
    supabase
      .from("clients")
      .select("id, name, archived_at, client_contacts(email)")
      .eq("firm_id", firmId)
      .gt("id", last?.id ?? NIL_UUID)
      .order("id")
      .limit(PAGE_SIZE),
  );
  return clients.map((client) => ({
    id: client.id,
    name: client.name,
    archived: client.archived_at !== null,
    contactEmails: client.client_contacts.map((contact) => contact.email.toLowerCase()),
  }));
}

/** What importing the rows would do. Saves nothing. */
export async function previewImport(input: ImportRow[]): Promise<ActionResult<RowOutcome[]>> {
  const staff = await requireStaff();
  const rows = rowsSchema.safeParse(input);
  if (!rows.success) return badRows;
  return { ok: true, data: planImport(rows.data, await existingClients(staff.firmId)).outcomes };
}

/**
 * Plans again against current data, then creates the clients and adds the
 * contacts the way addContact does. No emails are sent. Running the same file
 * twice adds nothing the second time.
 */
export async function importClients(input: ImportRow[]): Promise<ActionResult<ImportResult>> {
  const staff = await requireStaff();
  const rows = rowsSchema.safeParse(input);
  if (!rows.success) return badRows;
  const plan = planImport(rows.data, await existingClients(staff.firmId));
  const failed = plan.outcomes.filter((o) => o.outcome === "error").map((o) => ({ row: o.row, message: o.message }));

  const supabase = await createClient();
  const createdIds = new Map<string, string>();
  for (const client of plan.newClients) {
    const { data, error } = await supabase
      .from("clients")
      .insert({ firm_id: staff.firmId, name: client.name, kind: client.kind })
      .select("id")
      .single();
    if (error) failed.push(...client.rows.map((row) => ({ row, message: errorMessage(error) })));
    else createdIds.set(client.key, data.id);
  }

  let contactsAdded = 0;
  let skipped = plan.outcomes.filter((o) => o.outcome === "skip").length;
  for (const contact of plan.contacts) {
    const clientId = contact.clientId ?? createdIds.get(contact.clientKey);
    if (!clientId) continue; // Its new client failed, and that row is already reported.
    try {
      const userId = await ensureUser(contact.email);
      const { error } = await supabase.from("client_contacts").insert({
        client_id: clientId,
        firm_id: staff.firmId,
        user_id: userId,
        full_name: contact.fullName,
        email: contact.email,
      });
      // 23505: this person is already a contact of the client under another address.
      if (!error) contactsAdded++;
      else if (error.code === "23505") skipped++;
      else failed.push({ row: contact.row, message: errorMessage(error) });
    } catch (error) {
      console.error("[import] contact failed", contact.row, error);
      failed.push({ row: contact.row, message: "This contact could not be added. Run the import again." });
    }
  }

  revalidatePath("/app/clients");
  return {
    ok: true,
    data: {
      clientsCreated: createdIds.size,
      contactsAdded,
      skipped,
      failed: failed.sort((a, b) => a.row - b.row),
    },
  };
}
```

- [ ] **Step 4: Write the page and the form**

Create `app/app/clients/import/page.tsx`:

```tsx
import { Suspense } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { requireStaff } from "@/lib/auth";
import { IMPORT_TEMPLATE, MAX_IMPORT_ROWS } from "@/lib/client-import";
import { ImportForm } from "./import-form";

// This page's Server Actions create an account per contact, which takes a while for 500 rows.
export const maxDuration = 300;

export default function ImportClientsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <ImportClients />
    </Suspense>
  );
}

async function ImportClients() {
  await requireStaff();
  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href="/app/clients" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          ← All clients
        </Link>
        <h1 className="text-2xl font-semibold">Import clients</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Upload a CSV file with the columns client_name, client_type, contact_name, and contact_email: one row per
          contact, up to {MAX_IMPORT_ROWS} rows. Leave the contact columns empty for a client without contacts. Nothing is
          saved until you check the preview and click Import, and no emails are sent.{" "}
          <a
            className="underline"
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(IMPORT_TEMPLATE)}`}
            download="clients-template.csv"
          >
            Download the template
          </a>
        </p>
      </div>
      <ImportForm />
    </>
  );
}
```

Create `app/app/clients/import/import-form.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MAX_IMPORT_BYTES, readImportRows, type ImportRow, type RowOutcome } from "@/lib/client-import";
import { parseCsv } from "@/lib/csv";
import { importClients, previewImport, type ImportResult } from "./actions";

const LABEL: Record<RowOutcome["outcome"], [string, "default" | "secondary" | "outline" | "destructive"]> = {
  create: ["New client", "default"],
  add: ["Adds contact", "secondary"],
  skip: ["Skipped", "outline"],
  error: ["Error", "destructive"],
};

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** Reads the file in the browser, previews it on the server, then imports on request. */
export function ImportForm() {
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [outcomes, setOutcomes] = useState<RowOutcome[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(file: File | undefined) {
    setRows(null);
    setOutcomes([]);
    setResult(null);
    setProblem(null);
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setProblem("The file must be 1 MB or smaller.");
      return;
    }
    startTransition(async () => {
      const read = readImportRows(parseCsv(await file.text()));
      if (!read.ok) {
        setProblem(read.error);
        return;
      }
      const preview = await previewImport(read.rows);
      if (!preview.ok) {
        setProblem(preview.error);
        return;
      }
      setRows(read.rows);
      setOutcomes(preview.data!);
    });
  }

  function runImport() {
    if (!rows) return;
    startTransition(async () => {
      const done = await importClients(rows);
      if (!done.ok) {
        toast.error(done.error);
        return;
      }
      setResult(done.data!);
      setRows(null);
    });
  }

  const importable = outcomes.filter((o) => o.outcome === "create" || o.outcome === "add").length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="import-file">CSV file</Label>
        <Input
          id="import-file"
          type="file"
          accept=".csv,text/csv"
          className="max-w-sm"
          disabled={pending}
          onChange={(event) => choose(event.target.files?.[0])}
        />
      </div>
      {pending && <p className="text-sm text-muted-foreground">Working…</p>}
      {problem && (
        <Alert variant="destructive">
          <AlertTitle>This file cannot be imported</AlertTitle>
          <AlertDescription>{problem}</AlertDescription>
        </Alert>
      )}
      {result && (
        <Alert>
          <AlertTitle>Import finished</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <p>
              {plural(result.clientsCreated, "client")} created, {plural(result.contactsAdded, "contact")} added,{" "}
              {plural(result.skipped, "row")} skipped, {plural(result.failed.length, "row")} failed.
            </p>
            {result.failed.length > 0 && (
              <ul className="list-disc pl-5">
                {result.failed.map((failure) => (
                  <li key={failure.row}>
                    Row {failure.row}: {failure.message}
                  </li>
                ))}
              </ul>
            )}
            <Link className="underline" href="/app/clients">
              Back to clients
            </Link>
          </AlertDescription>
        </Alert>
      )}
      {rows && outcomes.length > 0 && (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Row</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {outcomes.map((o) => {
                  const [label, variant] = LABEL[o.outcome];
                  return (
                    <TableRow key={o.row}>
                      <TableCell>{o.row}</TableCell>
                      <TableCell>{o.clientName}</TableCell>
                      <TableCell>{o.contactEmail}</TableCell>
                      <TableCell>
                        <span className="flex flex-wrap items-center gap-2">
                          <Badge variant={variant}>{label}</Badge>
                          <span className="text-sm text-muted-foreground">{o.message}</span>
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <Button className="self-start" disabled={pending || importable === 0} onClick={runImport}>
            Import {plural(importable, "row")}
          </Button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Add the button on the clients page**

In `app/app/clients/page.tsx`, add `import Link from "next/link";` and change the lucide import to `import { Plus, Upload } from "lucide-react";`. Then wrap the `ClientFormDialog` in the header like this:

```tsx
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/app/clients/import">
              <Upload />
              Import CSV
            </Link>
          </Button>
          <ClientFormDialog
            title="New client"
            members={memberList}
            action={addClient}
            openAfterSave
            trigger={
              <Button>
                <Plus />
                New client
              </Button>
            }
          />
        </div>
```

- [ ] **Step 6: Run the checks**

Run: `npm run typecheck`, `npm run lint`, and `npx playwright test e2e/client-import.spec.ts e2e/lists.spec.ts`.
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add app/app/clients/import app/app/clients/page.tsx e2e/client-import.spec.ts
git commit -m "feat: import clients and contacts from a CSV file"
```

---

# Phase 4: Orphaned-file cleanup

### Task 12: `orphaned_documents`

**Files:**
- Create: `supabase/migrations/20260925001800_orphaned_documents.sql`
- Create: `supabase/tests/orphaned_documents_test.sql`
- Modify: `lib/database.types.ts` (generated)

**Interfaces:**
- Produces: `public.orphaned_documents(older_than interval default '24 hours', max_rows int default 1000) returns setof text`, executable by `service_role` only. It is called as `admin.rpc("orphaned_documents", { older_than, max_rows })` and returns `string[]`.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/orphaned_documents_test.sql`:

```sql
-- orphaned_documents: stored files no item points to, older than the cutoff.
-- Results are filtered to the fixture's firm, so older files in a local database do not interfere.
begin;
select plan(5);
\ir fixtures/seed.psql

insert into storage.objects (bucket_id, name, created_at) values
  ('documents', 'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a4/older.pdf', now() - interval '3 days'),
  ('documents', 'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a4/old.pdf', now() - interval '2 days'),
  ('documents', 'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a4/recent.pdf', now() - interval '1 hour');
-- A registered file that is also old.
update storage.objects set created_at = now() - interval '2 days'
where name = 'f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a1/seed-a1.pdf';

-- max_rows is raised where a local database's own orphans could push the fixture's past the cap.
set local role service_role;
select results_eq(
  $$ select o from public.orphaned_documents(max_rows => 100000) o where o like 'f0000000-0000-0000-0000-00000000000a/%' $$,
  $$ values ('f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a4/older.pdf'),
            ('f0000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a4/old.pdf') $$,
  'unregistered files older than a day, oldest first');
select is((select count(*)::int from public.orphaned_documents(max_rows => 1)), 1, 'at most max_rows');
select is((select count(*)::int from public.orphaned_documents(older_than => '30 minutes', max_rows => 100000) o
  where o like 'f0000000-0000-0000-0000-00000000000a/%'), 3, 'a shorter cutoff includes newer orphans');

reset role;
select tests.login_as('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.orphaned_documents() $$, '42501', null, 'signed-in users cannot list orphans');
reset role;
set local role anon;
select throws_ok($$ select public.orphaned_documents() $$, '42501', null, 'nor can anon');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run test:db`
Expected: `orphaned_documents_test.sql` fails with `function public.orphaned_documents() does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260925001800_orphaned_documents.sql`:

```sql
-- Files in the documents bucket that no item_files row points to, older than the
-- cutoff, oldest first. Uploads in progress are safe: signed upload URLs expire
-- after 2 hours. The cleanup job (/api/cron/cleanup) deletes them through the
-- Storage API, so the stored bytes go too.
create function public.orphaned_documents(older_than interval default '24 hours', max_rows int default 1000)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'documents'
    and o.created_at < now() - orphaned_documents.older_than
    and not exists (select 1 from public.item_files f where f.storage_path = o.name)
  order by o.created_at
  limit orphaned_documents.max_rows;
$$;

revoke execute on function public.orphaned_documents(interval, int) from public, anon, authenticated;
grant execute on function public.orphaned_documents(interval, int) to service_role;
```

- [ ] **Step 4: Apply it, run the tests, and regenerate types**

Run: `npx supabase migration up --local`, `npm run test:db`, `npm run db:types`, and `npm run typecheck`.
Expected: `Files=23, Tests=312`, `Result: PASS`; types include `orphaned_documents`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260925001800_orphaned_documents.sql supabase/tests/orphaned_documents_test.sql lib/database.types.ts
git commit -m "feat(db): find stored files no item points to"
```

### Task 13: The cleanup job

**Files:**
- Create: `lib/cron.ts`, `lib/cleanup.ts`, `app/api/cron/cleanup/route.ts`
- Modify: `app/api/cron/daily/route.ts` (use `lib/cron.ts`), `vercel.json`
- Modify: `lib/supabase/admin.ts` (doc comment), `app/portal/requests/[id]/upload.ts` and `app/portal/requests/[id]/actions.ts` (the two `ponytail:` comments about orphans)
- Test: `integration/cleanup.test.ts`

**Interfaces:**
- Consumes: `orphaned_documents` (Task 12).
- Produces:
  - `refuseUnlessCron(request: NextRequest): NextResponse | null`
  - `runCleanup(admin, { olderThan = "24 hours", maxRows = 1000 } = {}): Promise<{ found: number; deleted: number; failed: number }>`

- [ ] **Step 1: Write the failing integration test**

Create `integration/cleanup.test.ts`:

```ts
// Runs the orphaned-file cleanup against local Supabase. The test moves the cutoff
// instead of backdating files, since storage.objects is not reachable through the API.
// It deletes every orphan in the local bucket, so do not run it during a browser test.
import { createClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { runCleanup } from "@/lib/cleanup";
import type { Database } from "@/lib/database.types";

vi.mock("server-only", () => ({}));

process.loadEnvFile(".env.local");
const admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false },
});

// throwOnError() types each row as present; a generic { data, error } helper infers null into .single() rows.
it("deletes stored files that no item points to, and keeps registered ones", async () => {
  const tag = Math.random().toString(36).slice(2, 8);
  const { data: firm } = await admin
    .from("firms")
    .insert({ name: `Cleanup ${tag}` })
    .select("id")
    .single()
    .throwOnError();
  const { data: client } = await admin
    .from("clients")
    .insert({ firm_id: firm.id, name: "Cleanup client" })
    .select("id")
    .single()
    .throwOnError();
  const { data: request } = await admin
    .from("requests")
    .insert({ firm_id: firm.id, client_id: client.id, title: "Cleanup", due_date: "2031-01-01", status: "open" })
    .select("id")
    .single()
    .throwOnError();
  const { data: item } = await admin
    .from("request_items")
    .insert({ request_id: request.id, firm_id: firm.id, position: 1, title: "File", kind: "file" })
    .select("id")
    .single()
    .throwOnError();
  const folder = `${firm.id}/${client.id}/${item.id}`;
  for (const name of ["kept.pdf", "orphan.pdf"]) {
    const { error } = await admin.storage
      .from("documents")
      .upload(`${folder}/${name}`, new Blob(["%PDF-1.4"], { type: "application/pdf" }), { contentType: "application/pdf" });
    if (error) throw error;
  }
  await admin
    .from("item_files")
    .insert({
      item_id: item.id,
      firm_id: firm.id,
      storage_path: `${folder}/kept.pdf`,
      filename: "kept.pdf",
      size_bytes: 8,
      mime: "application/pdf",
    })
    .throwOnError();

  const summary = await runCleanup(admin, { olderThan: "0 seconds", maxRows: 100_000 });

  expect(summary.failed).toBe(0);
  expect(summary.deleted).toBeGreaterThanOrEqual(1);
  const { data: left, error } = await admin.storage.from("documents").list(folder);
  if (error) throw error;
  expect(left.map((file) => file.name)).toEqual(["kept.pdf"]);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run test:integration`
Expected: FAIL. `@/lib/cleanup` cannot be resolved; the daily-jobs tests still pass.

- [ ] **Step 3: Write `lib/cron.ts` and `lib/cleanup.ts`**

Create `lib/cron.ts`:

```ts
import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

// Equal-length digests, as timingSafeEqual requires.
const sha256 = (value: string) => createHash("sha256").update(value).digest();

/** A 401 unless the request carries Authorization: Bearer ${CRON_SECRET}, as Vercel Cron sends; otherwise null. */
export function refuseUnlessCron(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron] CRON_SECRET is not set, so every call is refused");
    return new NextResponse("Unauthorized", { status: 401 });
  }
  if (!timingSafeEqual(sha256(request.headers.get("authorization") ?? ""), sha256(`Bearer ${secret}`))) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  return null;
}
```

Create `lib/cleanup.ts`:

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

const CHUNK = 100;

export type CleanupSummary = { found: number; deleted: number; failed: number };

/**
 * Deletes stored documents that no item_files row points to, through the Storage
 * API so the bytes go too. At most `maxRows` per run; the next run continues.
 */
export async function runCleanup(
  admin: SupabaseClient<Database>,
  { olderThan = "24 hours", maxRows = 1000 }: { olderThan?: string; maxRows?: number } = {},
): Promise<CleanupSummary> {
  const { data: names, error } = await admin.rpc("orphaned_documents", { older_than: olderThan, max_rows: maxRows });
  if (error) throw error;
  let deleted = 0;
  for (let i = 0; i < names.length; i += CHUNK) {
    const { data, error: removeError } = await admin.storage.from("documents").remove(names.slice(i, i + CHUNK));
    if (removeError) console.error("[cleanup] delete failed", removeError);
    else deleted += data.length;
  }
  return { found: names.length, deleted, failed: names.length - deleted };
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npm run test:integration`
Expected: PASS, 4 tests.

- [ ] **Step 5: Add the route, share the secret check, and schedule it**

Create `app/api/cron/cleanup/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { runCleanup } from "@/lib/cleanup";
import { refuseUnlessCron } from "@/lib/cron";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

/** Vercel Cron calls this once a day, an hour after the daily job. */
export async function GET(request: NextRequest) {
  const refused = refuseUnlessCron(request);
  if (refused) return refused;

  const summary = await runCleanup(createAdminClient());
  console.log(JSON.stringify({ job: "cleanup", ...summary }));
  // An error status marks the run as failed in Vercel's cron logs.
  return NextResponse.json(summary, { status: summary.failed === 0 ? 200 : 500 });
}
```

Replace `app/api/cron/daily/route.ts` with:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { refuseUnlessCron } from "@/lib/cron";
import { runDailyJobs } from "@/lib/daily-jobs";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

/** Vercel Cron calls this once a day with Authorization: Bearer ${CRON_SECRET}. */
export async function GET(request: NextRequest) {
  const refused = refuseUnlessCron(request);
  if (refused) return refused;

  const summary = await runDailyJobs(createAdminClient());
  console.log(JSON.stringify({ job: "daily", ...summary }));
  // An error status marks the run as failed in Vercel's cron logs.
  const ok = summary.failedFirms === 0 && summary.failed === 0;
  return NextResponse.json(summary, { status: ok ? 200 : 500 });
}
```

Replace `vercel.json` with:

```json
{
  "regions": ["hnd1"],
  "crons": [
    { "path": "/api/cron/daily", "schedule": "0 1 * * *" },
    { "path": "/api/cron/cleanup", "schedule": "0 2 * * *" }
  ]
}
```

- [ ] **Step 6: Update the comments that named the old limit**

In `lib/supabase/admin.ts`, replace the `createAdminClient` doc comment with:

```ts
/**
 * Service-role client. It bypasses RLS, so only three callers may use it:
 * the two cron routes and ensureUser() below.
 */
```

In `app/portal/requests/[id]/upload.ts`, replace the two lines

```ts
    // ponytail: the object is orphaned if this delete fails too. Upgrade path: a nightly
    // cleanup of objects that have no item_files row.
```

with:

```ts
    // If this delete fails too, the nightly cleanup (/api/cron/cleanup) removes the object.
```

In `app/portal/requests/[id]/actions.ts`, replace

```ts
    // ponytail: the object is orphaned when this delete fails after remove_file.
    // Upgrade path: a nightly cleanup of objects that have no item_files row.
```

with:

```ts
    // The nightly cleanup (/api/cron/cleanup) removes the object a day later.
```

- [ ] **Step 7: Run the checks**

Run: `npm run typecheck`, `npm run lint`, `npm run build`, and `npx playwright test e2e/portal-and-review.spec.ts`. That browser test calls the daily cron route and checks the 401.
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add lib/cron.ts lib/cleanup.ts app/api/cron/cleanup/route.ts app/api/cron/daily/route.ts vercel.json lib/supabase/admin.ts "app/portal/requests/[id]/upload.ts" "app/portal/requests/[id]/actions.ts" integration/cleanup.test.ts
git commit -m "feat: daily cleanup of stored files no item points to"
```

---

# Phase 5: Drag-and-drop ordering

### Task 14: `moveItem` and drag-and-drop in the item editor

**Files:**
- Modify: `lib/editor-items.ts`
- Test: `lib/editor-items.test.ts`
- Modify: `components/item-editor.tsx`
- Test: `e2e/drag-and-drop.spec.ts`

**Interfaces:**
- Produces: `moveItem<T>(items: T[], from: number, to: number): T[]`. It returns a new list with the item at `from` moved to index `to`, clamped to the list.

- [ ] **Step 1: Write the failing unit test**

Create `lib/editor-items.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { moveItem } from "@/lib/editor-items";

describe("moveItem", () => {
  const items = ["a", "b", "c", "d"];

  it("moves an item down or up", () => {
    expect(moveItem(items, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(items, 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("keeps the order when an item is dropped on its own place", () => {
    expect(moveItem(items, 2, 2)).toEqual(items);
  });

  it("clamps a target past either end", () => {
    expect(moveItem(items, 1, 9)).toEqual(["a", "c", "d", "b"]);
    expect(moveItem(items, 2, -3)).toEqual(["c", "a", "b", "d"]);
  });

  it("returns a new list and leaves the old one alone", () => {
    const moved = moveItem(items, 0, 1);
    expect(moved).not.toBe(items);
    expect(items).toEqual(["a", "b", "c", "d"]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run lib/editor-items.test.ts`
Expected: FAIL, `moveItem` is not exported.

- [ ] **Step 3: Add `moveItem`**

Append to `lib/editor-items.ts`:

```ts
/** A new list with the item at `from` moved to index `to`, clamped to the list. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}
```

Run: `npx vitest run lib/editor-items.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 4: Write the failing browser test**

Create `e2e/drag-and-drop.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { addClient, expectToast, signUpWithFirm, uniqueEmail } from "./helpers";

// Item 3's handle and item 1 must both be on screen: otherwise Playwright scrolls
// between pressing the mouse and moving it, and Chromium starts no drag.
test.use({ viewport: { width: 1280, height: 1200 } });

test("items in a draft can be dragged into a new order", async ({ page }) => {
  await signUpWithFirm(page, uniqueEmail("drag"), "Drag Firm", "Dee Staff");
  await addClient(page, "Drag Client");
  await page.getByRole("link", { name: "New request" }).click();
  await page.getByRole("combobox", { name: "Start from" }).click();
  await page.getByRole("option", { name: "Annual tax return (starter)" }).click();
  await page.getByRole("button", { name: "Due date" }).click();
  await page.getByRole("button", { name: "Go to the Next Month" }).click();
  await page.getByRole("button", { name: /15th/ }).click();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expectToast(page, "Draft saved.");
  await expect(page).toHaveURL(/\/app\/requests\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("textbox", { name: "Item 3 title" })).toHaveValue("Bank and investment statements");
  // Let the first toast close (4 seconds), so the next "Draft saved." belongs to the second save.
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 10_000 });

  // Drop item 3 on the top edge of item 1.
  await page
    .getByTitle("Drag item 3")
    .dragTo(page.getByRole("textbox", { name: "Item 1 title" }), { targetPosition: { x: 20, y: 2 } });
  await expect(page.getByRole("textbox", { name: "Item 1 title" })).toHaveValue("Bank and investment statements");
  await expect(page.getByRole("textbox", { name: "Item 2 title" })).toHaveValue("Government-issued photo ID");

  await page.getByRole("button", { name: "Save draft" }).click();
  await expectToast(page, "Draft saved.");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Item 1 title" })).toHaveValue("Bank and investment statements");
});
```

- [ ] **Step 5: Run it and confirm it fails**

Run: `npx playwright test e2e/drag-and-drop.spec.ts`
Expected: FAIL. `getByTitle('Drag item 3')` is not found.

- [ ] **Step 6: Add drag-and-drop to the editor**

Replace `components/item-editor.tsx` with:

```tsx
"use client";

import { useState, type DragEvent } from "react";
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { LIMITS, MAX_ITEMS_PER_REQUEST } from "@/lib/constants";
import { moveItem, newEditorItem, type EditorItem } from "@/lib/editor-items";

/**
 * Ordered list of checklist items. Shared by the request and template editors.
 * Items move with the up and down buttons, or by dragging the handle with a
 * mouse; touch screens fire no drag events, so the buttons stay.
 */
export function ItemEditor({ items, onChange }: { items: EditorItem[]; onChange: (items: EditorItem[]) => void }) {
  const [dragging, setDragging] = useState<number | null>(null);
  // The gap the dragged item would drop into: 0 is above the first item, items.length below the last.
  const [dropAt, setDropAt] = useState<number | null>(null);

  function update(index: number, patch: Partial<EditorItem>) {
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  // The gap above or below item `index`, whichever half the pointer is over.
  function gapAt(event: DragEvent<HTMLDivElement>, index: number) {
    const box = event.currentTarget.getBoundingClientRect();
    return event.clientY < box.top + box.height / 2 ? index : index + 1;
  }

  function dragOver(event: DragEvent<HTMLDivElement>, index: number) {
    if (dragging === null) return;
    event.preventDefault(); // allows the drop
    setDropAt(gapAt(event, index));
  }

  // Measured again here: React may not have rendered the last dragover's state yet.
  function drop(event: DragEvent<HTMLDivElement>, index: number) {
    event.preventDefault(); // also stops the browser typing the drag data into an input
    if (dragging !== null) {
      const gap = gapAt(event, index);
      onChange(moveItem(items, dragging, gap > dragging ? gap - 1 : gap));
    }
    setDragging(null);
    setDropAt(null);
  }

  const indicator = <div aria-hidden="true" className="h-0.5 rounded bg-primary" />;

  return (
    <div className="flex flex-col gap-3">
      {items.map((item, index) => (
        <div
          key={item.key}
          onDragOver={(event) => dragOver(event, index)}
          onDrop={(event) => drop(event, index)}
          className="flex flex-col gap-3"
        >
          {dragging !== null && dropAt === index && indicator}
          <Card className={dragging === index ? "opacity-50" : undefined}>
            <CardContent className="flex gap-3">
              <div className="flex flex-col items-center gap-1 pt-2 text-sm text-muted-foreground">
                <span
                  draggable
                  title={`Drag item ${index + 1}`}
                  aria-hidden="true"
                  className="cursor-grab active:cursor-grabbing"
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", String(index)); // Firefox starts a drag only with data
                    const card = event.currentTarget.closest("[data-slot=card]");
                    if (card) event.dataTransfer.setDragImage(card, 16, 16);
                    setDragging(index);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setDropAt(null);
                  }}
                >
                  <GripVertical className="size-4" />
                </span>
                <span>{index + 1}.</span>
              </div>
              <div className="flex flex-1 flex-col gap-2">
                <Input
                  aria-label={`Item ${index + 1} title`}
                  placeholder="What do you need?"
                  value={item.title}
                  maxLength={LIMITS.name}
                  onChange={(e) => update(index, { title: e.target.value })}
                />
                <Textarea
                  aria-label={`Item ${index + 1} description`}
                  placeholder="Details for the client (optional)"
                  value={item.description}
                  maxLength={LIMITS.description}
                  rows={2}
                  onChange={(e) => update(index, { description: e.target.value })}
                />
                <div className="flex flex-wrap items-center gap-4">
                  <Select value={item.kind} onValueChange={(kind) => update(index, { kind: kind as EditorItem["kind"] })}>
                    <SelectTrigger aria-label={`Item ${index + 1} type`} className="w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="file">File upload</SelectItem>
                      <SelectItem value="text">Written answer</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`required-${item.key}`}
                      checked={item.required}
                      onCheckedChange={(checked) => update(index, { required: checked === true })}
                    />
                    <Label htmlFor={`required-${item.key}`}>Required</Label>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move item ${index + 1} up`}
                  disabled={index === 0}
                  onClick={() => onChange(moveItem(items, index, index - 1))}
                >
                  <ArrowUp />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move item ${index + 1} down`}
                  disabled={index === items.length - 1}
                  onClick={() => onChange(moveItem(items, index, index + 1))}
                >
                  <ArrowDown />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove item ${index + 1}`}
                  onClick={() => onChange(items.filter((_, i) => i !== index))}
                >
                  <Trash2 />
                </Button>
              </div>
            </CardContent>
          </Card>
          {dragging !== null && dropAt === items.length && index === items.length - 1 && indicator}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        className="self-start"
        disabled={items.length >= MAX_ITEMS_PER_REQUEST}
        onClick={() => onChange([...items, newEditorItem()])}
      >
        <Plus />
        Add item
      </Button>
    </div>
  );
}
```

- [ ] **Step 7: Run the checks**

Run: `npm test`, `npm run typecheck`, `npm run lint`, and `npx playwright test e2e/drag-and-drop.spec.ts e2e/staff-workflows.spec.ts`.
Expected: all pass. `staff-workflows` still reorders with "Move item 2 up".

- [ ] **Step 8: Commit**

```bash
git add lib/editor-items.ts lib/editor-items.test.ts components/item-editor.tsx e2e/drag-and-drop.spec.ts
git commit -m "feat: drag checklist items into order"
```

---

### Task 15: Docs and full verification

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-09-24-client-portal-design.md` (§6 and §18)
- Modify: `docs/superpowers/reports/2026-09-24-client-portal-execution-report.md`

- [ ] **Step 1: README**

- In the first paragraph, after "…a daily digest tells staff what arrived.", add: "Staff can search and filter requests and clients, see each request's activity, and import clients from a CSV file."
- In Deploying step 4, after the sentence about `/api/cron/daily`, add: "`vercel.json` also runs `/api/cron/cleanup` at 02:00 UTC, which deletes stored files that no item points to once they are a day old."

- [ ] **Step 2: v1 spec**

- In §6, replace "**The service-role client has two uses.** It lives in `lib/supabase/admin.ts`, which imports `server-only`. Only the cron route and `ensureUser()` may call it (section 10.1)." with "**The service-role client has three uses.** It lives in `lib/supabase/admin.ts`, which imports `server-only`. Only the two cron routes and `ensureUser()` may call it (section 10.1)."
- In §18, delete the row that begins "An object is orphaned when an upload succeeds but `register_file` fails".

- [ ] **Step 3: Execution report**

- Add a "Backlog (third session)" bullet under "Additions beyond the plan". Summarize the five features, name the commits from Tasks 1–14, and list the new test counts.
- Update "Final state":
  - pgTAP: 312 tests in 23 files.
  - Vitest: 102 unit tests.
  - Integration: 4 tests.
  - Browser: 10 tests in 9 spec files.
- Replace "Next steps" item 2 (the backlog) with "None left."

- [ ] **Step 4: Run every check**

Run each command and confirm:

| Command | Expected |
|---|---|
| `npm run test:db` | PASS, 312 tests |
| `npm test` | PASS, 102 tests |
| `npm run test:integration` | PASS, 4 tests |
| `npm run typecheck` | passes |
| `npm run lint` | passes |
| `npm run build` | passes |
| `npm run test:e2e` | PASS, 10 tests |

- [ ] **Step 5: Commit**

```bash
git add README.md docs/superpowers/specs/2026-09-24-client-portal-design.md docs/superpowers/reports/2026-09-24-client-portal-execution-report.md
git commit -m "docs: record the backlog features"
```

Do not push. Tell the user the work is ready and ask whether to push, which deploys to staging.
