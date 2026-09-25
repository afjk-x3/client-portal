# Client Portal: Execution Report

- **Branch:** `claude/quirky-davinci-jna28e`
- **Plan:** [`docs/superpowers/plans/2026-09-24-client-portal.md`](../plans/2026-09-24-client-portal.md)
- **Method:** subagent-driven. A fresh implementer subagent runs each task's test-first steps and commits. The controller then checks that every file matches the code validated during planning byte for byte and re-runs the task's checks. Each phase ends with a review subagent.
- **Last updated:** 2026-09-25. Every phase, every review fix, and the additions beyond the plan are done, including four features the user asked for afterwards. Those four were reviewed in a second session, which fixed three findings (see Review of the four features).

This report was updated and pushed after every phase, so it stayed current if the session ended.

## Final state

- **All seven phases are done**, each phase review's findings are fixed, and a final review of everything committed after the phase reviews found nothing above Minor (below). The plan was updated in place wherever a fix changed validated code, so it still matches the repository, except for the additions beyond the plan (below).
- **Checks on the final commit:**
  - pgTAP: 254 tests in 20 files (the plan's 198, plus 6 for leaving a firm, 46 for the four new features, and 4 from their review).
  - Vitest: 63 unit tests, plus 3 integration tests that run the daily job against local Supabase.
  - Typecheck, lint, and the production build pass.
  - Playwright: 5 specs, the plan's happy path plus 4 broader suites.
  - `supabase db advisors` reports only the intended `multiple_permissive_policies`.
- **CI on GitHub:** every run passed: [run 1](https://github.com/afjk-x3/client-portal/actions/runs/36063514108) and [run 2](https://github.com/afjk-x3/client-portal/actions/runs/36063612906) for the workflow itself, and [run 3](https://github.com/afjk-x3/client-portal/actions/runs/36086359624) and [run 4](https://github.com/afjk-x3/client-portal/actions/runs/36086395404) for the Phase 7 fixes, the first with the integration test. The final push starts another run, which also checks that the generated types match the migrations.
- **Not verified here:** sending through Resend (every run used log mode), Vercel Cron, and hosted Supabase settings. The real shadcn/ui components replaced the hand-written ones in the second session, and every check passes with them.
- **No pull request was opened**, since none was asked for.

## Status

| Phase | Status | Result |
|---|---|---|
| 1 Foundation | Done | 46 Vitest tests pass; typecheck, lint, build pass. Review findings fixed. Task 2 used hand-written components (see Deviations). |
| 2 Database | Done | 173 pgTAP tests pass; `db lint` clean. Security review found two Important issues and an account takeover; all fixed in Task 8, which was added to the plan. |
| 3 Auth and staff shell | Done | End-to-end step 1 passes. Review: two Important issues and several Minor ones, fixed in `2308e55`. |
| 4 Clients, templates, team | Done | End-to-end steps 1–2 pass. Review: one Important (template save not atomic) and several Minor, fixed in `d3da5df`. |
| 5 Requests and review | Done | End-to-end steps 1–3 pass. Review: three Important (draft save not atomic, New request form carried to another client, review actions on archived requests) and several Minor, fixed in `d3da5df`. pgTAP now 193. |
| 6 Client portal and files | Done | The complete end-to-end test passes. Review: four Important (upload queue froze, garbled download names, contacts could choose the saved extension, phone layout) and several Minor, fixed in `3a39488`. pgTAP now 198. |
| 7 Zip, daily jobs, deployment | Done | Zip download; cron (401 without the secret, one reminder, nothing sent twice); README. Checks at the time: pgTAP 193/193, Vitest 46/46, typecheck, lint, build, end-to-end test, and 8 `ponytail:` ceiling markers. Advisors report only the intended `multiple_permissive_policies`. Review: four Important (a failed read still used up the day's claims, emails went out only after every firm, reads stopped at 1,000 rows, the README missed Resend's free-plan cap) and several Minor, fixed in `7e00847`. |

## Commits

| Commit | Task |
|---|---|
| `a5ea00a` | Phase 1 Task 1: scaffold Next.js 16 with Cache Components |
| `a684f56` | Phase 1 Task 3: UTC dates and `reminderDue` |
| `12e7fad` | Phase 1 Task 4: `safeNextPath` |
| `eb373ec` | Phase 1 Task 5: file helpers |
| `eac3dd3` | Phase 1 Task 6: constants, errors, validation |
| `e8f2ce0` | Phase 1 Task 7: email templates and sender |
| `157f5fb` | Phase 2 Task 1: local Supabase with code-only sign-in emails |
| `d684660` | Phase 2 Task 2: tables, composite tenant keys, documents bucket |
| `34a0bb6` | Phase 2 Task 3: RLS helpers and policies |
| `495aa3f` | Phase 2 Task 4: request status trigger |
| `176140e` | Phase 2 Task 5: storage path helpers and policies |
| `76006ae` | Phase 2 Task 6: RPCs |
| `7d2ca87` | Phase 2 Task 7: generated database types |
| `4376b9a` | Phase 1 review fixes |
| `77fe8b0` | Plan updated for the Phase 1 review fixes |
| `4cc8956` | Phase 1 Task 2: UI components and TanStack Table |
| `fe03706` | Phase 3 Task 1: Supabase clients, auth helpers, proxy |
| `c33e951` | Plan: Phase 2 Task 8 added, mobile sidebar note |
| `0b1102b` | Phase 2 Task 8: hardening |
| `a779be4` | Phase 3 Tasks 2–3: Playwright, landing, code sign-in, sign-out, onboarding |
| `a9c82ed` | Phase 3 Task 4: staff shell, sidebar, dashboard |
| `97b8b11` | Phase 4 Tasks 1–2: clients, contacts, client archive |
| `5135438` | Phase 4 Task 3: templates |
| `6c61434` | Phase 4 Task 4: firm settings and team |
| `19953a5` | Phase 5 Tasks 1–3: request editor, sending, item review |
| `5ea318a` | Phase 6 Tasks 1–3: client portal, direct uploads, submit, downloads |
| `2308e55` | Phase 3 review fixes |
| `1f83ca7` | Plan updated for the Phase 3 review fixes |
| `e630b22` | Phase 7 Task 1: zip download |
| `1e53144` | Phase 7 Task 2: daily reminders and staff digest cron |
| `d3da5df` | Phase 4 and 5 review fixes |
| `d893af8` | Phase 7 Task 3: README (setup, testing, deployment) |
| `3a39488` | Phase 6 review fixes |
| `6b55a6d` | Addition: staff can leave their firm |
| `f33ae14` | Addition: end-to-end suites for staff workflows, the portal, and editing safeguards |
| `a7ba598` | Addition: CI workflow |
| `268c881` | Report: additions beyond the plan |
| `7e00847` | Phase 7 review fixes |
| `53d13ae` | Plan updated for the Phase 7 review fixes |
| `a046fbe` | Final execution report |
| `468dceb` | Final review fixes |
| `6180c52` | Plan updated for the final review fixes |
| `353f296` | Report: final review |
| `33dbe1e` | Four features: firm time zones, sending to many clients, reminders on demand, staff uploads |
| `a6f1b6e` | Review fixes for the four features |
| `5dfe700` | Generated shadcn/ui components |

## Deviations from the plan

- **Phase 1 Task 2: UI components written by hand, since replaced.** `ui.shadcn.com` stayed blocked in the first session, so `components/ui/` was written to match shadcn's new-york v4 components. The second session ran `npx shadcn@latest add <every component> --overwrite`. The generated components import `cn` from shadcn's `cn` package instead of `lib/utils.ts`, so that file and its `clsx` and `tailwind-merge` dependencies were removed; the CLI's direct `date-fns` dependency was removed too, since only `react-day-picker` uses it. Three local changes remain on generated code: the collapsed desktop sidebar is `inert` and the trigger sets `aria-expanded` (both from the Phase 3 review), and the unused `SidebarMenuSkeleton` keeps shadcn's `Math.random()` width under a lint exception.
- **`useIsMobile`** uses `useSyncExternalStore` instead of shadcn's effect, which the React Compiler lint rule `react-hooks/set-state-in-effect` rejects. The CLI overwrites `hooks/use-mobile.ts` whenever it adds the sidebar; restore it afterwards.
- **Phase 2 Task 8** was added to the plan for the security review's findings, as a new migration and new test files; the committed Phase 2 migrations are unchanged.
- **Mobile sidebar:** links in the staff sidebar close it on phones, where it is a Sheet that would otherwise stay open over the new page (Phase 3 Task 4 file; checked at 390 px).
- **Local email confirmation is on** (`supabase/config.toml`), matching hosted projects. New users get the "Confirm signup" email, which shows the same code.

## Review findings

- **Phase 1** (code review): one Important and several Minor issues, all fixed in `4376b9a`: Resend batches now use permissive validation so one bad address no longer drops the batch; email configuration errors are reported instead of producing broken headers; truncated file names keep their extension; zip entries never use `.` or `..`; `safeNextPath` resolves dot segments; MIME lookup uses own keys only; shared `LIMITS` for text lengths; `filenameSchema`. Later-phase code was fixed in the validated copy at the same time (emails built before state changes, a 20-file cap per item enforced before signing an upload URL).
- **Phase 2** (security review of the SQL, with live probes, mutation tests, and two-session race tests). Tenant and client isolation held in every probe. Fixed in Phase 2 Task 8, which was added to the plan:
  - **Completion race (Important).** Two reviews on one request could leave it open with every required item accepted, or completed with an item just returned, which stopped the client from resubmitting. The trigger now locks the request row first. Both races were reproduced without the lock and pass with it.
  - **Overwritable documents (Important).** A contact could create their own signed upload URL with `upsert: true` and replace a file after staff accepted it. Reproduced against the real Storage API; a trigger now refuses a new version of an existing document.
  - **Account pre-registration (found while checking a review note; the most serious issue).** Auth accepted password sign-ups, so anyone could register another person's address with a password. When a firm later added that address as staff or a contact, the attacker had access, at once when email confirmation is off, and after the real owner's first code sign-in when it is on. Reproduced against the real Auth API. Passwords are now never stored, and "Confirm email" is on locally and required in production (README).
  - **Minor:** contacts can delete only unregistered uploads (no dangling file rows); a sent request cannot go back to draft (which made it deletable); requests keep their client and items their request; a trigger keeps an admin in every firm under concurrency; contact document reads also check the firm segment.
  - **New tests:** 43 (pgTAP now 173), including the reviewer's coverage gaps: contacts writing their own `client_contacts` row, the firm segment on uploads, uploads to closed items, file RPCs on drafts and archived requests, a catalog guard for definer functions and policies, users with both roles, and anon.
  - **Not changed:** a submission racing an archive ends in the same state as submitting just before the archive, so it is not a bug; the reminder reply-to lookup is already limited to the firm's own members.
  - **Deferred:** anyone can add any email as staff, and that person cannot leave or create their own firm. A "Leave firm" action for non-admin staff was added after Phase 7 (see Additions beyond the plan).
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

- **Phase 7** (code review with a local production build, a probe that ran the job against the database, and a fetch-counting probe). The zip route and the reminder rules were right. Fixed:
  - **A failed read still used up the day's claims (Important).** The contacts and previous-digest queries ignored their errors. When the contacts query failed, every due reminder was claimed, nobody was emailed, and a rerun sent nothing. Every query error is now thrown before anything is claimed.
  - **One slow run could lose a whole day (Important).** Firms were processed one at a time with several sequential queries per member, and nothing was sent until every firm was done. A run cut off at the 300-second limit had used up its claims but sent no email, and the same would have happened every day. Now each firm's emails are built first and claimed in one statement. Firms run five at a time, and emails go out in batches of 100 while the run continues. Resend calls are spaced across the whole process, so concurrent batches stay under its rate limit. The README says to put functions in the Supabase project's region.
  - **Reads stopped at 1,000 rows (Important).** PostgREST cuts responses off at `max_rows` without an error, so large firms would have silently lost reminders. Every job read is now paged, and contacts come embedded in the reminder query.
  - **Resend's free plan (Important, deployment).** It allows 100 emails a day, SMTP included, so one busy reminder run could block every sign-in code until midnight UTC. The README now says to use a paid plan or a separate account for Supabase's SMTP.
  - **Minor:**
    - A digest claim records the run's own time, so an item submitted during a run is no longer left out of both digests.
    - The job stops before claiming anything when the email settings cannot work.
    - The cron route returns 500 when any firm or email failed, logs a missing `CRON_SECRET`, and compares the secret in constant time.
    - A zip whose file cannot be signed fails before streaming starts, and zips are not cached.
    - Zip entry names avoid what Windows cannot extract (trailing dots and spaces, `CON`, `NUL`).
    - The README gives the sign-in template subjects and the Playwright browser install.
  - **Test gap closed:** `npm run test:integration` runs the daily job against local Supabase with emails captured. It covers the reminder rules, digest windows across days (a missed day, a new member), paging past 1,000 rows, same-day reruns, and failures that must not use up claims. Run against the previous `lib/daily-jobs.ts`, all 3 tests fail. It was added to the plan (Phase 7 Task 2) and to CI.

- **Final review** of everything committed after the phase reviews: the Phase 7 fixes, leaving a firm, the end-to-end suites, and CI. Verdict: ready, with no Critical or Important findings. It probed the job with a fake PostgREST, measured the pacing under concurrent callers, and confirmed from PostgREST's source that `max_rows` never limits writes. Fixed in `468dceb`:
  - **Offset paging could send a reminder twice or skip one.** When a request changed between two page reads of a firm with over 1,000 open requests, rows shifted between pages. Reads now start each page after the previous page's last row (keyset paging); digest items page by submission time and id, since many can share a timestamp.
  - **A digest after changing firms covered the whole gap.** The window started at the member's last claim at any firm. Only claims made since the member joined now count.
  - **The zip route read a failed lookup as "Not found".** It now throws; malformed ids are still a 404.
  - **Smaller items:**
    - A rate-limited Resend batch is retried once, with new unit tests for the sender (settings, batching, rejected addresses, the retry, and pacing).
    - The test server never sends real email.
    - CI runs with a read-only token and checks that `lib/database.types.ts` matches the migrations.
    - New tests cover a leaver's clients (left without an owner) and a member who rejoins (fresh digest window).
    - The README says to keep "Max rows" at 1,000 or more.
  - **Not changed:**
    - Claims can run ahead of sends at very high volume (about 50,000 emails a run at Resend's default rate), so a run cut off at 300 seconds loses what it had claimed. The existing ceiling comment now names this case.
    - CI's image pulls from `public.ecr.aws` hit a rate limit once and the retry succeeded. `actions/checkout@v4` and `actions/setup-node@v4` warn that they run on Node 20. Both are left for later; the newer action versions could not be checked from here.
    - The end-to-end cron check counts digests for every firm. Per-member digests are covered by the integration test.

- **Review of the four features** (second session, on Windows with Docker Desktop, with live probes through the real Storage API and PostgREST). Tenant isolation, the new functions' membership checks, and the caller-supplied ids held. Fixed in migration `20260925001500_upload_owner_and_time_zone_names.sql` and `app/portal/requests/[id]/upload.ts`:
  - **Either side could take over the other's upload (Important).** `register_file` found the object by name only. A contact could register a staff upload before staff did, which made it the client's file, and then remove it; staff could do the same to a contact's upload. Storage records the uploader as `owner_id`, and `register_file` now requires it to be the caller. 2 new pgTAP tests; the fixtures now set `owner_id` as Storage does.
  - **Time zones the app cannot use (Important).** The trigger accepted every `pg_timezone_names` entry, including 598 `posix/` copies and `Factory`, which `Intl.DateTimeFormat` rejects. An admin could store one through PostgREST, and any signed-in user through `create_firm`. That firm's staff pages then threw, and the daily job failed for it on every run, so the cron reported failure every day. The trigger now accepts only names that start with a capital letter, never `Factory`, and the migration moves any stored bad name to UTC. 2 new pgTAP tests.
  - **Staff "Add files" froze (Minor).** It awaited `uploadFile` without a catch, so a dropped connection or a deployment left the button disabled and skipped the remaining files. This was the Phase 6 portal bug again: the portal's catch lived in its caller. `uploadFile` now catches and returns the retry message, so both callers are safe. 1 new Vitest test.
  - **Not changed:**
    - Either side can still delete the other side's upload between its upload and its registration. The uploader sees an error, and a retry works. A `ponytail:` marker in the migration names the upgrade path.
    - A bulk send creates new request ids on every call, so resending after a lost response would create and email a second request for each client.
    - `by_staff` follows firm membership, so a firm member who is also a contact of the firm's client uploads as the firm in the portal.
    - The Send to clients page lists at most 1,000 clients (PostgREST's `max_rows`).
    - Three actions repeat the same contact email fan-out.

## Additions beyond the plan

- **Leave firm.** Admins add staff without the person's consent, and a user belongs to one firm at most, so someone added by mistake, or on purpose, could never set up their own firm (a Phase 2 review finding). Staff who are not admins can now leave from Settings; an admin must first be made staff by another admin, so every firm keeps one. A delete policy on the caller's own staff row (migration `20260925001000_leave_firm.sql`, 5 pgTAP tests) and a confirm dialog that ends in a full page load.
- **End-to-end suites.** The reviews found flows that only a browser covers. Besides the plan's happy path, `npm run test:e2e` now runs staff workflows (settings, team, leaving a firm, templates, drafts, open-request edits, archive, sign-out), the portal and review loop (uploads, review, zip, exact download names, access rules, users who are both staff and contacts, the cron), and editing safeguards (typed values survive errors; pages kept mounted stay correct). Playwright runs one worker, because the specs share a database and the cron checks count every firm.
- **Continuous integration.** `.github/workflows/ci.yml` runs two jobs on every push and pull request: Vitest, typecheck, lint, and build; then local Supabase with the pgTAP suite and the Playwright suites against a production build (`next build && next start`, chosen in `playwright.config.ts` when `CI` is set). The production-build run was checked locally: 4 passed. Both runs on GitHub passed.

- **Four features requested after the MVP** (2026-09-25), in one commit. The spec had listed two of them as out of scope for v1.
  - **Firm time zones.** Each firm has a time zone, set at signup from the browser and changed by admins in Settings. The firm's "today" decides overdue badges, reminder days, and the daily job's claims, and staff see times in that zone ("9:30 AM EDT"). The daily job still runs once at 13:00 UTC, so firms get their emails at different local hours; a ceiling marker replaces the old UTC one. Migration `20260925001100_time_zones.sql`, 8 pgTAP tests, unit tests for the date helpers, and an integration case for a firm in Auckland.
  - **Send reminder now.** A button on open requests with open items emails the open items to the client's contacts right away. It takes the same once-a-day claim as the daily reminder, keyed by the firm's date, so a request never gets two reminders in one day (`claim_reminder`, 9 pgTAP tests).
  - **Send a template to many clients.** From a template, staff pick up to 100 active clients with contacts, a title, and a due date. One transaction creates and sends a request for each client, so a send reaches all of them or none; the emails are built first (`send_requests`, 12 pgTAP tests).
  - **Staff upload files for a client**, for documents that arrive by email or on paper. Staff add files to file items of open requests that are not accepted yet, including submitted ones, and clients see them marked as added by the firm. Each side removes only its own files, enforced by the storage rules, `register_file`, and `remove_file` (`20260925001400_staff_uploads.sql`, 16 new pgTAP tests, 2 updated).
  - A new browser spec covers all four. Every check listed under Final state passes on this commit.

- **Second session (2026-09-25):**
  - **Name.** The app is called PaperLine (`APP_NAME`, the sign-in email, the README). The repository, the npm package, and the local Supabase `project_id` keep their names.
  - **App emails over SMTP.** With no budget for a domain, staging sends everything through one Gmail account. `lib/email/send.ts` uses SMTP whenever `SMTP_HOST` is set: one pooled `nodemailer` connection per call, TLS on 465 or STARTTLS on 587, and a refused message counted as failed without stopping the rest. Resend stays the path for a verified domain. Browser tests blank `SMTP_HOST` as well as `RESEND_API_KEY`. 4 new unit tests.
  - **Staging project.** `paperline-staging` in Tokyo (`ap-northeast-1`): all 15 migrations applied, the `documents` bucket, both guard triggers, and RLS on every public table checked. Advisors add warnings that signed-in users can call the security-definer helpers and RPCs, which is intended, and one for Supabase's own `rls_auto_enable` event-trigger function. Auth: 6-digit codes, "Confirm email" on, both templates, and custom SMTP through Gmail. A sign-up from the app against staging received its code and created a firm.
  - **This network's DNS** answers `::` for `public.ecr.aws` and `*.pooler.supabase.com`, and direct IPv6 is not routable. Local images come from `ghcr.io` (`SUPABASE_INTERNAL_IMAGE_REGISTRY`), and hosted database commands add `--dns-resolver https`.
  - **Staging on Vercel** (`paperline-staging.vercel.app`, functions in `hnd1`). Checked by hand: sign-in codes arrive through Gmail; a client, a contact, a sent request, a reminder, portal uploads, and review all work; the scheduled run logged its JSON summary, and a manual run sent the digest. The reminder landed in the contact's Spam folder: a new Gmail sender linking to a `vercel.app` address. The fix is a domain for the site and the email, with the paid plans.
  - **Ceiling review** (spec section 18, updated). Decided: the daily job moves to 01:00 UTC, 9 am in UTC+8 where the first customers are; failed sends are retried; `.doc` and `.xls` stay allowed. The rest stay as marked.
  - **Retries.** `sendEmails` tries a failed send up to 3 times, 2 and 8 seconds apart, when another try can succeed: an SMTP 4xx reply or a dropped connection, or a Resend rate limit, server error, or network failure. SMTP 5xx replies, refused logins, and Resend validation errors fail at once. This covers the daily job and every email sent after an action. 2 new unit tests, 1 updated.
  - **Paid plans, when there is budget** (verified 2026-09-25): Vercel Pro $20 a month per developer (Hobby is for non-commercial use), Supabase Pro $25 a month (100 GB files, daily backups, no pausing), a domain, and Resend (free for 3,000 emails a month, Pro $20 for 50,000).

## Blockers

- **`ui.shadcn.com` was denied by the first session's network policy** (proxy answered 403 to CONNECT). Worked around with hand-written components, which the second session replaced (above).
- **Playwright's browser CDN is denied.** Worked around: the preinstalled Chromium is used through a local, uncommitted Playwright config that extends the committed one. CI installs Playwright's own browser.
- **Docker images from `public.ecr.aws` are denied.** Worked around: `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io`.

## Notes from execution

- Authorship: at the user's request, every commit on `main` and on this branch is authored by the repository owner and carries no co-author or session lines. The history was rewritten on 2026-09-25 (file contents unchanged, all hashes changed), and the hashes in this report are the rewritten ones.
- All copied files matched the validated versions byte for byte.
- Some tasks end without a commit by design (Phase 3 Task 2, Phase 4 Task 1); the next task's commit includes their files.
- Implementers skip the plan's "check by hand" steps. The same flows are covered by the broader browser suites; the settings, templates, drafts, and open-request suite already passes against this repository.
- The session hit its 5-hour usage limit at about 20:00 UTC, which stopped the Phase 6 review; work resumed after the reset.
- The session was idle from about 22:00 to 02:05 UTC, and the container restarted in that time, and again at about 02:36 UTC. Each time, Docker and the local Supabase stack were started again; the repository and the validated copy were intact.
- Browser runs on the validated copy after the hardening and the new components: the full happy path, the two broader suites (settings, templates, drafts, open-request edits, zip, downloads, redirects, cron), and a phone-width sidebar check all pass.
- Subagents twice flagged `AGENTS.md` as a possible prompt injection. It is generated by Next.js 16 (`node_modules/next/dist/server/lib/generate-agent-files.js`) and is legitimate.

## Next steps

1. **Before real customers:** move to the paid plans above, then buy a domain and verify it in Resend (`RESEND_API_KEY` set, `SMTP_*` removed), and point the site at it. Add a privacy policy and terms.
2. **Backlog:** activity timeline per request, CSV import of clients and contacts, search and filters, drag-and-drop checklist order, and a nightly cleanup of orphaned files.
3. **Local setup:** `npx supabase start` (with Docker running), `cp .env.example .env.local`, then paste the keys from `npx supabase status`. The README lists every check, and notes for Windows.
