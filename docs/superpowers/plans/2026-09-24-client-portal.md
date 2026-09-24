# Client Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Client Portal v1 as specified in [`docs/superpowers/specs/2026-09-24-client-portal-design.md`](../specs/2026-09-24-client-portal-design.md).

**Architecture:** A Next.js 16 App Router monolith on Vercel with Supabase. RLS is the security boundary: user-facing code uses the user-scoped Supabase client, clients change data only through `security definer` RPCs, and the service-role client is limited to the daily cron and `ensureUser()`. Files go from the browser straight to Supabase Storage through signed upload URLs.

**Tech Stack:** Next.js 16.3 (React 19, Cache Components, `proxy.ts`), TypeScript strict, Supabase (Postgres 17 with RLS, Auth email OTP, Storage) through `@supabase/ssr` 0.12 and `@supabase/supabase-js` 2.117, Tailwind CSS v4, shadcn/ui (Radix base), TanStack Table v9, zod 4, Resend 6, client-zip 2, Vitest 5, Playwright 1.63, pgTAP.

---

## Phases

Run the phase plans in order. Each ends with the app building and every test written so far passing.

| # | Plan | Builds | Ends with |
|---|---|---|---|
| 1 | [Foundation](2026-09-24-client-portal-1-foundation.md) | Next.js scaffold, shadcn/ui, pure libraries (dates, reminders, redirect paths, files, validation, errors, email) | 46 Vitest tests pass; build passes |
| 2 | [Database](2026-09-24-client-portal-2-database.md) | Local Supabase; migrations for tables, RLS, completion trigger, storage, RPCs, hardening; generated types | 173 pgTAP tests pass |
| 3 | [Auth and staff shell](2026-09-24-client-portal-3-auth-and-shell.md) | Supabase clients, `proxy.ts`, code sign-in, onboarding, sign-out, staff layout, dashboard | End-to-end step 1 passes |
| 4 | [Clients, templates, and team](2026-09-24-client-portal-4-clients-templates-team.md) | Clients, contacts, templates, firm settings, team | End-to-end steps 1–2 pass |
| 5 | [Requests and review](2026-09-24-client-portal-5-requests-and-review.md) | Request editor, send, review Sheet, open-request edits, archive | End-to-end steps 1–3 pass |
| 6 | [Client portal and files](2026-09-24-client-portal-6-portal-and-files.md) | Portal pages, direct uploads, submit, signed downloads | The complete end-to-end test passes |
| 7 | [Zip, daily jobs, and deployment](2026-09-24-client-portal-7-zip-cron-deploy.md) | Zip download, reminder and digest cron, README | Cron and zip checks pass; all suites green |

## How this plan was checked

All code in the phase plans was run in a scratch copy of this repository before it was written down:
- `supabase test db`: 193 pgTAP tests pass, and each database task was replayed in order to confirm its tests fail before its migration and pass after.
- The races and bypasses that Phase 2 Task 8 closes were reproduced against the local stack before its migration and shown fixed after it: both completion-trigger races and the admin race (two concurrent sessions), replacing an accepted file through a signed upload URL (the real Storage API), and signing in with a password pre-registered for someone else's address (the real Auth API).
- `supabase db lint` finds no errors. `supabase db advisors` reports no security issues, only `multiple_permissive_policies` (see decision 1).
- Vitest: 46 tests pass. `tsc`, ESLint, and `next build` with Cache Components all pass.
- The Playwright test passes in full, and each per-phase version of it passes.
- A broader throwaway Playwright run covered what the one spec test does not: zip contents, signed download redirects, role redirects, signed-out redirects, cron auth and once-a-day claims, needs-changes, file removal, settings and team (including `ensureUser()`'s existing-email path), templates, drafts, open-request edits, archive, and sign-out.
- The cron was also driven by hand to send exactly one reminder, then none on the rerun.

Not verified:
- The real shadcn/ui components. `ui.shadcn.com` was blocked where the plan was checked, so hand-written components matching shadcn's new-york v4 files (same names, exports, and props, on the same Radix primitives) were used for compiling and the browser runs. If a generated component's props differ, fix the call site.
- Sending through Resend (the runs used log mode), Vercel Cron, and hosted Supabase settings.

## Before you start

- Node.js 22 or later, npm, and Docker (for `npx supabase start`).
- Network access to `registry.npmjs.org`, `ui.shadcn.com` (shadcn CLI), Docker image registries (Supabase images), and `fonts.googleapis.com` (`next/font` at build time).
- In a Claude Code cloud session: start Docker with `dockerd &` if `docker info` fails. If image pulls from `public.ecr.aws` are refused, run `npx supabase start` with `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io`. If `npx playwright install chromium` cannot download, point Playwright at an installed Chromium.

## Conventions for every phase

- **RLS decides access.** Staff pages still filter by the caller's `firm_id`, and portal pages by the caller's own `client_contacts` rows. RLS ORs the staff and contact policies, so a user who is both would otherwise see the other role's rows in the wrong place.
- **Server Actions** live in each route segment's `actions.ts`. They validate with zod, use the user-scoped client, return `ActionResult` (`{ ok: true, data? }` or `{ ok: false, error }`), and revalidate the affected path. Guarded updates (`.eq("status", …)` plus `.select().maybeSingle()`) turn stale pages and double clicks into an `invalid_state` message.
- **Forms** use `useActionState` and Sonner toasts, and submit through `submitKeepingValues()` (`lib/forms.ts`), so a server-side error keeps what the user typed. The two editors (request and template) send structured item lists, so they call their actions inside `useTransition`.
- **Ids from the browser** go through `isId()`; a malformed one reads as not found. **Query errors throw** to the error boundary; they never read as empty data or "not found".
- **Session reads happen inside `<Suspense>`** (Cache Components). A record hidden by RLS renders `notFound()`.
- **Typed queries:** pass `select()` one string literal. Template literals are fine; `"a" + "b"` loses the types.
- **Client modules:** a function exported from a `'use client'` file cannot be called from a Server Component. Shared helpers go in `lib/`.
- **Pages stay mounted.** Cache Components keeps visited pages in the DOM, hidden, with their state (React `<Activity>`), keyed without search params. So: forms take ids from `useId()`, the new-request form clears itself after saving and is keyed by client, dialogs close before navigating and when their page is hidden, sign-out is a full page load, and Playwright tests use role locators.
- **Ceilings** from spec section 18 are marked in code with `ponytail:` comments that name the upgrade path.

## Decisions made while planning

These fill gaps in the spec or adjust it. Everything else follows the spec as written.

1. **Contacts can read their own `client_contacts` rows.** The portal needs the list of clients a user belongs to, including when the user is also staff and so sees the whole firm through the staff policies. The spec's table gives contacts no access to `client_contacts`. The added policy exposes only the caller's own rows, and the pgTAP test asserts that a contact sees exactly their own row and no other contacts. Staff and contact read rules stay separate policies, one per actor, to mirror spec section 8.2; that is what the advisor's `multiple_permissive_policies` notes are about.
2. **Contact RPCs treat an item in a draft request as not found** (`not_allowed`), matching the rule that contacts never see drafts.
3. **Users cannot change `firms.plan`.** Admins get column-level update on `firms.name` only, so the future billing field cannot be edited from the app.
4. **No react-hook-form.** shadcn's `Form` component is built on react-hook-form, which conflicts with `useActionState` and would be a new runtime dependency. Forms use plain inputs whose `maxLength` comes from the same `LIMITS` constant as the zod schemas, and the Server Action validates with zod.
5. **Sign-out** is added (a `POST /auth/sign-out` route that ends in a full page load). The spec has no sign-out, but users who are both staff and contact, and shared computers, need it.
6. **`safeNextPath` also rejects backslashes and control characters**, because browsers turn `/\host` and `/<tab>/host` into `//host`.
7. **Both sign-in email templates show the code.** With "Confirm email" on, a brand-new user receives the "Confirm signup" template, not "Magic Link".
8. **Post-sign-in destination** comes from a small Server Action after `verifyOtp` in the browser. Running the OTP calls in the browser keeps Supabase's per-IP rate limits per person rather than per server.
9. **File layout:** `safeNextPath` is in `lib/safe-next-path.ts` (Vitest cannot import `lib/auth.ts`, which is `server-only`), cron logic is in `lib/daily-jobs.ts` with a thin route, and editor item helpers are in `lib/editor-items.ts`.
10. **Extra unit tests** beyond spec section 14: storage paths, MIME fallback, zip entry names, and email escaping. They are cheap and cover security-relevant behavior.
11. **Resend batches** are sent in permissive mode, so one rejected address never drops the rest, and spaced 600 ms apart to stay under Resend's default 2 requests per second. Every email is built before the state change or cron claim it belongs to, so a configuration error changes nothing.
12. **Dashboard order:** "Waiting on clients" by due date, oldest first; "Ready for review" by submission time, oldest first.
13. **Uploads fall back to the file extension** for the MIME type when the browser reports none (common for HEIC and CSV), since the bucket rejects anything outside its allowed list.
14. **Code-only sign-in is enforced, not just offered.** A trigger strips passwords from `auth.users`, and "Confirm email" stays on, so nobody can register someone else's address with a password and later reach the account a firm links to it.
15. **Uploaded documents are immutable.** Signed upload URLs bypass the storage policies at upload time, so a trigger refuses a new version of an existing document. Contacts can delete only uploads that are not yet registered as files.
16. **Multi-step writes are database functions.** Saving a template or a draft replaces rows in several statements, and removing an item must see a file registered at the same moment, so `save_template`, `save_draft`, and `remove_item` run as one transaction under the caller's RLS.

## Runtime dependencies

The spec asks the plan to justify any runtime dependency beyond its stack list.

| Package | Why |
|---|---|
| `radix-ui`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `tw-animate-css` | Installed by shadcn/ui for its components |
| `next-themes` | Installed by shadcn's Sonner component |
| `react-day-picker` | Installed by shadcn's Calendar component |
| `@tanstack/react-table` | DataTable (named in the spec) |
| `server-only` | Keeps the service-role client and the auth helpers out of client bundles (named in the spec) |

Dev only: `supabase` (CLI), `vitest`, `@playwright/test`, `@types/node@^22`.

## Spec coverage

| Spec section | Where |
|---|---|
| 3 Stack; the `APP_NAME` constant | Phase 1 Tasks 1–2, 6 |
| 7.1–7.2 Data model | Phase 2 Task 2 |
| 7.3 Status rules and editing rules | Phase 2 Tasks 4 and 8 (trigger, locks); Phase 5 Task 1 (actions) |
| 8.1–8.2 Helpers and table policies | Phase 2 Task 3 |
| 8.3 RPCs | Phase 2 Task 6 |
| 8.4 Storage and downloads | Phase 2 Tasks 5 and 8; Phase 6 Task 3 |
| 9.1 Landing, login, onboarding, proxy | Phase 3 Tasks 1, 3 |
| 9.2 Staff area | Phase 3 Task 4 (layout, dashboard); Phase 4 (clients, templates, settings); Phase 5 (requests) |
| 9.3 Client area | Phase 6 |
| 9.4 Rendering and actions | Conventions above; every UI phase |
| 10.1–10.3 `ensureUser`, add staff, add contact | Phase 3 Task 1; Phase 4 Tasks 2, 4 |
| 10.4 Send | Phase 5 Task 1 |
| 10.5–10.6 Upload and submit | Phase 6 Task 3 |
| 10.7 Review | Phase 5 Tasks 1, 3 |
| 10.8 Zip | Phase 7 Task 1 |
| 11 Email and daily jobs | Phase 1 Task 7; Phase 7 Task 2 |
| 12 Error handling | `lib/errors.ts` (Phase 1); `error.tsx` (Phases 3, 6) |
| 13 Security | Phases 1–3; Phase 2 Task 8; decisions 1–6, 14, 15 |
| 14 Testing | pgTAP (Phase 2), Vitest (Phase 1), Playwright (Phases 3–6) |
| 15–16 Layout and configuration | All phases; README (Phase 7) |
| 17 Starter template | Phase 2 Task 6 (`create_firm`) |
| 18 Known ceilings | `ponytail:` comments; checked in Phase 7 Task 3 |
