# Client Portal: Execution Report

- **Branch:** `claude/quirky-davinci-jna28e`
- **Plan:** [`docs/superpowers/plans/2026-09-24-client-portal.md`](../plans/2026-09-24-client-portal.md)
- **Method:** subagent-driven. A fresh implementer subagent runs each task's test-first steps and commits. The controller then checks that every file matches the code validated during planning byte for byte and re-runs the task's checks. Each phase ends with a review subagent.
- **Last updated:** 2026-09-24, all phases implemented and Phase 3–6 review fixes applied; Phase 7 review in progress

This report is updated and pushed after every phase, so it stays current if the session ends.

## Status

| Phase | Status | Result |
|---|---|---|
| 1 Foundation | Done | 46 Vitest tests pass; typecheck, lint, build pass. Review findings fixed. Task 2 used hand-written components (see Deviations). |
| 2 Database | Done | 173 pgTAP tests pass; `db lint` clean. Security review found two Important issues and an account takeover; all fixed in Task 8, which was added to the plan. |
| 3 Auth and staff shell | Done | End-to-end step 1 passes. Review: two Important issues and several Minor ones, fixed in `e865b32`. |
| 4 Clients, templates, team | Done | End-to-end steps 1–2 pass. Review: one Important (template save not atomic) and several Minor, fixed in `d5477f7`. |
| 5 Requests and review | Done | End-to-end steps 1–3 pass. Review: three Important (draft save not atomic, New request form carried to another client, review actions on archived requests) and several Minor, fixed in `d5477f7`. pgTAP now 193. |
| 6 Client portal and files | Done | The complete end-to-end test passes. Review: four Important (upload queue froze, garbled download names, contacts could choose the saved extension, phone layout) and several Minor, fixed in `eb8372c`. pgTAP now 198. |
| 7 Zip, daily jobs, deployment | Done | Zip download; cron (401 without the secret, one reminder, nothing sent twice); README. Final checks: pgTAP 193/193, Vitest 46/46, typecheck, lint, build, end-to-end test, and 8 `ponytail:` ceiling markers. Advisors report only the intended `multiple_permissive_policies`. Review in progress. |

## Commits so far

| Commit | Task |
|---|---|
| `71ea6c7` | Phase 1 Task 1: scaffold Next.js 16 with Cache Components |
| `2b1a8fd` | Phase 1 Task 3: UTC dates and `reminderDue` |
| `cbdde8e` | Phase 1 Task 4: `safeNextPath` |
| `dcca377` | Phase 1 Task 5: file helpers |
| `15a152a` | Phase 1 Task 6: constants, errors, validation |
| `e4b6c0d` | Phase 1 Task 7: email templates and sender |
| `f0b906d` | Phase 2 Task 1: local Supabase with code-only sign-in emails |
| `4930222` | Phase 2 Task 2: tables, composite tenant keys, documents bucket |
| `ab47656` | Phase 2 Task 3: RLS helpers and policies |
| `980aa6b` | Phase 2 Task 4: request status trigger |
| `f0d07c6` | Phase 2 Task 5: storage path helpers and policies |
| `28573e4` | Phase 2 Task 6: RPCs |
| `42aab82` | Phase 2 Task 7: generated database types |
| `d935f5a` | Phase 1 review fixes |
| `312ecf9` | Plan updated for the Phase 1 review fixes |
| `57e5a86` | Phase 1 Task 2: UI components and TanStack Table |
| `579f303` | Phase 3 Task 1: Supabase clients, auth helpers, proxy |
| `43da241` | Plan: Phase 2 Task 8 added, mobile sidebar note |
| `9ccede8` | Phase 2 Task 8: hardening |
| `4eea6e0` | Phase 3 Tasks 2–3: Playwright, landing, code sign-in, sign-out, onboarding |
| `66964c1` | Phase 3 Task 4: staff shell, sidebar, dashboard |
| `903c8ce` | Phase 4 Tasks 1–2: clients, contacts, client archive |
| `76cb18c` | Phase 4 Task 3: templates |
| `b2c1a00` | Phase 4 Task 4: firm settings and team |
| `317286c` | Phase 5 Tasks 1–3: request editor, sending, item review |
| `9a16264` | Phase 6 Tasks 1–3: client portal, direct uploads, submit, downloads |
| `e865b32` | Phase 3 review fixes |
| `a70f83f` | Plan updated for the Phase 3 review fixes |
| `71b13b5` | Phase 7 Task 1: zip download |
| `1be7bd5` | Phase 7 Task 2: daily reminders and staff digest cron |
| `d5477f7` | Phase 4 and 5 review fixes |
| `cff0fb0` | Phase 7 Task 3: README (setup, testing, deployment) |
| `eb8372c` | Phase 6 review fixes |

## Deviations from the plan

- **Phase 1 Task 2: UI components written by hand.** `ui.shadcn.com` stayed blocked, so `components/ui/` was written to match shadcn's new-york v4 components: same file names, exports, props, and `data-slot` attributes, built on the `radix-ui` package with the same dependencies the CLI installs. The sidebar is a subset (no tooltip, rail, or menu sub-items, which the app does not use) and does not write the `sidebar_state` cookie, since nothing reads it. `npx shadcn@latest add <name> --overwrite` replaces any component with the generated one.
- **`useIsMobile`** uses `useSyncExternalStore` instead of shadcn's effect, which the React Compiler lint rule `react-hooks/set-state-in-effect` rejects.
- **Phase 2 Task 8** was added to the plan for the security review's findings, as a new migration and new test files; the committed Phase 2 migrations are unchanged.
- **Mobile sidebar:** links in the staff sidebar close it on phones, where it is a Sheet that would otherwise stay open over the new page (Phase 3 Task 4 file; checked at 390 px).
- **Local email confirmation is on** (`supabase/config.toml`), matching hosted projects. New users get the "Confirm signup" email, which shows the same code.

## Review findings

- **Phase 1** (code review): one Important and several Minor issues, all fixed in `d935f5a`: Resend batches now use permissive validation so one bad address no longer drops the batch; email configuration errors are reported instead of producing broken headers; truncated file names keep their extension; zip entries never use `.` or `..`; `safeNextPath` resolves dot segments; MIME lookup uses own keys only; shared `LIMITS` for text lengths; `filenameSchema`. Later-phase code was fixed in the validated copy at the same time (emails built before state changes, a 20-file cap per item enforced before signing an upload URL).
- **Phase 2** (security review of the SQL, with live probes, mutation tests, and two-session race tests). Tenant and client isolation held in every probe. Fixed in Phase 2 Task 8, which was added to the plan:
  - **Completion race (Important).** Two reviews on one request could leave it open with every required item accepted, or completed with an item just returned, which stopped the client from resubmitting. The trigger now locks the request row first. Both races were reproduced without the lock and pass with it.
  - **Overwritable documents (Important).** A contact could create their own signed upload URL with `upsert: true` and replace a file after staff accepted it. Reproduced against the real Storage API; a trigger now refuses a new version of an existing document.
  - **Account pre-registration (found while checking a review note; the most serious issue).** Auth accepted password sign-ups, so anyone could register another person's address with a password. When a firm later added that address as staff or a contact, the attacker had access, at once when email confirmation is off, and after the real owner's first code sign-in when it is on. Reproduced against the real Auth API. Passwords are now never stored, and "Confirm email" is on locally and required in production (README).
  - **Minor:** contacts can delete only unregistered uploads (no dangling file rows); a sent request cannot go back to draft (which made it deletable); requests keep their client and items their request; a trigger keeps an admin in every firm under concurrency; contact document reads also check the firm segment.
  - **New tests:** 43 (pgTAP now 173), including the reviewer's coverage gaps: contacts writing their own `client_contacts` row, the firm segment on uploads, uploads to closed items, file RPCs on drafts and archived requests, a catalog guard for definer functions and policies, users with both roles, and anon.
  - **Not changed:** a submission racing an archive ends in the same state as submitting just before the archive, so it is not a bug; the reminder reply-to lookup is already limited to the firm's own members.
  - **Deferred:** anyone can add any email as staff, and that person cannot leave or create their own firm. A "Leave firm" action for non-admin staff is planned after Phase 7.
- **Phase 3** (code review with live probes of the proxy, cookies, sign-out, and Server Actions). No Critical issues. Fixed:
  - **Auth lookups swallowed query errors (Important).** A failed `firm_members` or `client_contacts` query read as "no membership", so during a database hiccup staff were sent to onboarding. They now throw, and a new root error boundary catches errors from the staff shell's layout, which `app/app/error.tsx` does not cover.
  - **Shared email limit (Important, deployment).** Supabase Auth has one email-sending limit for the whole project, so sign-in codes for every firm share it. The README's deployment steps now say to raise it, and to consider CAPTCHA if sign-in emails are abused.
  - **Minor:** the proxy redirects only page loads, so a Server Action whose session expired no longer fails with "An unexpected response was received from the server"; sign-out is per device, clears the cookies itself when Auth is unreachable, and redirects with a relative URL; "Ready for review" leaves out archived requests; sidebar accessibility (`aria-current`, an `inert` collapsed sidebar, `aria-expanded` on the trigger).
  - **Not changed:** `ensureUser()` keeps a documented contract rather than taking the caller as a parameter, since passing a `Staff` object would not prove the admin role that adding staff needs. A full page load after sign-in (to drop pages kept mounted from an earlier session in the tab) was tried and reverted: it made the first clicks after sign-in race React hydration, and the case it guards against needs a session revoked from elsewhere, now that sign-out is per device and always a full page load.

- **Phase 4** (code review with Server Actions called over HTTP and a headless browser). Authorization held everywhere, and refused calls created no auth users. Fixed:
  - **Template save was not atomic (Important).** Rename, delete items, and insert items were separate requests: a failed insert left the template empty, and two overlapping saves merged their items (14 of 21 trials). Now one database function, `save_template`.
  - **Minor:** a server-side error reset dialog forms (a failed "Add staff" snapped the role back to Staff); some actions did not revalidate, so Back showed stale lists; fixed ids collided across hidden pages; two actions reported success when nothing changed; ids and roles skipped validation; query errors showed as empty data.
- **Phase 5** (code review with races forced by row locks). Guarded updates and emails were right. Fixed:
  - **Draft save was not atomic (Important).** A stale "Save draft" could replace the checklist of a request sent a moment earlier (the client was emailed about 2 items and got 1), and a failed insert left empty drafts. Now `save_draft`, whose guarded update waits for a send in flight.
  - **New request carried over (Important).** Next keeps the New request page mounted without its search params, so an unsaved request for one client appeared, and could be sent, for the next client. The editor is keyed by client.
  - **Review actions on closed requests (Important).** Returning an item on an archived request emailed a client whose portal is read-only. Accept and Needs changes now require an open or completed request.
  - **Minor:** removing an item could delete a file registered at the same moment (now `remove_item`, under the same row lock as `register_file`); "Edit details" kept a cancelled due date; dialogs and the review Sheet stayed open on hidden pages; a thrown save error discarded the editor's work; clicking the picked day cleared the due date.
  - **Not changed:** unarchive is still two writes (reopen, then recompute); if the recompute fails, a complete request shows Open until its next item change, and it gets no reminders because it has no open items.

- **Phase 6** (code review with live probes of every portal action and the download route; the first run stopped at the usage limit and was rerun). Contact isolation, server-built upload paths, the bucket's size and type limits, and the 20-file cap all held. Fixed:
  - **Upload queue froze (Important).** A dropped connection or a deployment during an upload made the action call throw; that file stayed "Uploading…", every later file stayed "Waiting…", and Submit stayed disabled until a full reload. Errors are now caught and the queue moves on.
  - **Garbled download names (Important).** storage-js encoded the `download` name twice, so "Scan (1).pdf" saved as "Scan %281%29.pdf". The route now sets it on the signed URL itself; an end-to-end check downloads "Scan (1) résumé.pdf" and compares the name.
  - **Contacts could choose the saved extension (Important).** The bucket checks only the declared type, and `register_file` stored names as given, so a PDF registered as `statement.pdf     .js` downloaded as a script. `register_file` now keeps only an extension that matches the stored type and appends the type's own otherwise (migration `20260925000900_file_names.sql`, 5 new pgTAP tests).
  - **Phone layout (Important).** A failed upload row pushed the page wider than a 375 px screen and hid the file name; failed rows now wrap.
  - **Minor:** unusable files are refused before queueing, failed rows can be dismissed, a failed registration deletes its upload (no orphans on retry), files dropped outside the drop zone are ignored, the orphan log also catches Storage's silent refusals, the portal shows an empty state when a contact has no sent requests, and buttons name their file or item for screen readers.

## Blockers

- **`ui.shadcn.com` is denied by the session's network policy** (proxy answers 403 to CONNECT; last checked 18:28 UTC). Worked around with hand-written components (above). A new session may pick up the changed setting.
- **Playwright's browser CDN is denied.** Worked around: the preinstalled Chromium is used through a local, uncommitted Playwright config. The committed config is unchanged.
- **Docker images from `public.ecr.aws` are denied.** Worked around: `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io`.

## Notes from execution

- Commit trailers: commits from Tasks 1, 3, and 4 carry `Co-Authored-By: Claude Opus 5.5`. From Task 5 on, subagents use their own environment's attribution (`Claude Sonnet 5`), which is the accurate author.
- All copied files matched the validated versions byte for byte.
- Some tasks end without a commit by design (Phase 3 Task 2, Phase 4 Task 1); the next task's commit includes their files.
- Implementers skip the plan's "check by hand" steps. The same flows are covered by the broader browser suites; the settings, templates, drafts, and open-request suite already passes against this repository.
- The session hit its 5-hour usage limit at about 20:00 UTC, which stopped the Phase 6 review; work resumed after the reset.
- Browser runs on the validated copy after the hardening and the new components: the full happy path, the two broader suites (settings, templates, drafts, open-request edits, zip, downloads, redirects, cron), and a phone-width sidebar check all pass.
- Subagents twice flagged `AGENTS.md` as a possible prompt injection. It is generated by Next.js 16 (`node_modules/next/dist/server/lib/generate-agent-files.js`) and is legitimate.

## How to resume

1. Check out `claude/quirky-davinci-jna28e`.
2. Continue with the first phase in the status table that is not Done, following the phase plan linked from the plan index.
3. Local stack: `npx supabase start` (with Docker running), `cp .env.example .env.local`, keys from `npx supabase status`.
