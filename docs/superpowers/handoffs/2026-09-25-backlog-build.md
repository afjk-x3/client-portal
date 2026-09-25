# Handoff: Building the PaperLine Backlog

- **Date:** 2026-09-25
- **From:** the desktop session that designed the backlog, wrote its plan, and checked the plan
- **For:** the next session (Claude Code in the cloud), which continues from here

## 1. First, before any build work

The user will open the next session by asking **what other features could be added to PaperLine**. Answer that first.

- Do not start the plan until the user says to start.
- Ground the answer in what exists:
  - The README's feature summary.
  - The v1 spec's scope.
  - Backlog spec §9, which lists work already deferred on purpose:
    - Clients seeing the timeline.
    - Backfilling events.
    - An owner column in the CSV.
    - Updating contact names from the CSV.
    - Exporting clients to CSV.
    - Sortable columns.
    - Reordering the items of sent requests.
    - Full-text search.
  - v1 spec §18, "Known ceilings".
  - The execution report's "Next steps", which covers what must happen before real customers.
- The product is aimed at small firms that collect documents from clients. The customers are in UTC+8, and the budget is zero for now.
- A feature the user picks goes through the same process as the backlog:
  1. Brainstorm it.
  2. Write a spec that the user approves.
  3. Write a plan, or new tasks, that the user approves.
- Ask whether the new work comes before the current plan, after it, or in place of part of it.

## 2. Read these, in order

1. `AGENTS.md`: this Next.js 16 differs from training data. Read the guide in `node_modules/next/dist/docs/` before writing Next.js code.
2. `README.md`: setup, tests, environment variables, and deployment.
3. [`docs/superpowers/specs/2026-09-25-paperline-backlog-design.md`](../specs/2026-09-25-paperline-backlog-design.md): the approved backlog spec.
4. [`docs/superpowers/plans/2026-09-25-paperline-backlog.md`](../plans/2026-09-25-paperline-backlog.md): the plan to execute, with 15 tasks in 5 phases and complete code for each step.
5. For background:
   - The v1 spec: [`docs/superpowers/specs/2026-09-24-client-portal-design.md`](../specs/2026-09-24-client-portal-design.md).
   - The execution report: [`docs/superpowers/reports/2026-09-24-client-portal-execution-report.md`](../reports/2026-09-24-client-portal-execution-report.md).

## 3. Where things stand

- **v1:** built, reviewed, and deployed to staging.
- **Email retries:** shipped in commit `9f6d823`. This was the sixth backlog item.
- **Backlog spec:** approved and committed.
- **Backlog plan:** written and checked. Nothing in it is built yet.
- **Execution method:** Native, chosen by the user on 2026-09-25.
  - One session implements Tasks 1–15 in order, following each step as written. Use `superpowers:executing-plans` if the plugin is available.
  - Each task follows the steps as written, in test-driven order: write the failing test, watch it fail, write the code, watch it pass, then commit.
  - After Task 15, one fresh reviewer (a subagent on the most capable model) reviews the whole branch. The user agreed to this reviewer as part of choosing Native. It is the only subagent they have agreed to.

### How the plan was checked

- The three new migrations and all 23 pgTAP files ran against a local database, each inside a transaction that rolls back. All 312 tests pass.
- Every task was applied to a scratch worktree. There:
  - All 102 unit tests pass.
  - `tsc`, ESLint, and `next build --webpack` are clean.
  - Turbopack could not build only because `node_modules` was a junction there. This is not a code problem.
- The check found these problems, and the plan already contains the fixes:
  - When two items changed in one statement, the "completed" event landed between the two "accepted" events.
  - The drop could read a drag position that React had not rendered yet.
  - Duplicate contacts counted as neither added nor skipped.
  - `.single()` rows were typed as possibly null through a generic helper.
  - An ESLint error, and wrong test totals.
- **Not yet run:** the browser tests and `integration/cleanup.test.ts`. They need the new migrations in a running local Supabase.

### Test counts

| Suite | Before Task 1 | After Task 15 |
|---|---|---|
| pgTAP | 254 tests in 20 files | 312 tests in 23 files |
| Unit (Vitest) | 63 | 102 |
| Integration | 3 | 4 |
| Browser (Playwright) | 5 | 10 |

## 4. Environment

### In the cloud session

- Unit tests, typecheck, lint, and build need only `npm ci`.
- The database, integration, and browser tests need local Supabase, and local Supabase needs Docker. Run `docker info` first.
- **If Docker works:**
  1. `npx supabase start`. It pulls images from `public.ecr.aws`. If that is blocked, set `SUPABASE_INTERNAL_IMAGE_REGISTRY=ghcr.io`.
  2. Create `.env.local`: copy `.env.example`, then fill in the publishable and secret keys from `npx supabase status`. The CI step "Point the app at local Supabase" in `.github/workflows/ci.yml` does exactly this.
  3. `npx playwright install --with-deps chromium`.
- **If Docker does not work:**
  - Build each task, and run the checks that can run: unit tests, typecheck, lint, and build.
  - Tell the user which checks did not run.
  - CI runs every check on every push and pull request: local Supabase, pgTAP, the type-drift check, integration tests, and Playwright. With the user's OK, push the work branch and read the CI results.
  - Never report a task as verified when its checks did not run.
- `.env.local` holds local keys only. Never bring staging keys, the database password, the SMTP app password, or `CRON_SECRET` into the session or the chat.
- The plan's generated-types step (`npm run db:types`) reads the local database, so it also needs Docker. CI fails if `lib/database.types.ts` does not match the migrations.
- Task 4 runs the shadcn CLI, which needs `ui.shadcn.com`. The CLI writes `import { cn } from "cn"`, which matches this repo; there is no `lib/utils.ts`. If the network blocks the CLI, ask the user.

### On the user's Windows machine

- `SUPABASE_INTERNAL_IMAGE_REGISTRY=ghcr.io` is set as a user environment variable, because the network blocks `public.ecr.aws`.
- Start Supabase with `npx supabase start -x vector`. The vector container keeps restarting on Windows.
- Commands against hosted Supabase need `--dns-resolver https`, because the network's DNS blocks `*.pooler.supabase.com`.
- Before `npm run test:e2e`, make sure nothing else serves port 3000. Playwright reuses a running server, and a dev server pointed at staging creates junk users and sends real email.

## 5. Staging

- **Supabase:** project `paperline-staging`, ref `oxregmifljyvzklmjdkd`, in Tokyo (`ap-northeast-1`).
- **Vercel:** https://paperline-staging.vercel.app, with functions in `hnd1`. Assume that a push to `main` deploys to staging, and confirm this with the user.
- **Email:**
  - Gmail SMTP from `paperlinetest.app@gmail.com` (`smtp.gmail.com`, port 465).
  - Supabase's custom SMTP uses it for sign-in codes, and the `SMTP_*` variables in Vercel use it for app emails.
  - Without a domain, some mail lands in spam. This is expected.
- **Cron:**
  - The daily job runs at `0 1 * * *` (01:00 UTC), which is 9 am in UTC+8.
  - Task 13 adds the cleanup job at `0 2 * * *`, using the same `CRON_SECRET`.
- **After the build:**
  1. Ask the user before any staging change.
  2. The three new migrations (`20260925001600` to `20260925001800`) reach staging only through `npx supabase db push`. On the user's network this needs `--dns-resolver https`.
  3. Apply them before the code that uses them deploys, or the new pages will fail on staging.

## 6. Rules the user set

- **Secrets:** never ask for secrets, and never paste them into chat. These are the database password, Gmail app passwords, `SUPABASE_SECRET_KEY`, and `CRON_SECRET`. The user types them into terminals or dashboards. The publishable key is public.
- **Commits and pushes:**
  - Commit or push only when the user asks. They approve each time.
  - During the build, make one commit per task, as the plan says.
  - Commit messages carry no AI attribution lines. `.claude/settings.json` turns attribution off.
- **Email address:** do not send the user's email address to unrelated services.
- **System settings:** do not change system or security settings.
- **Subagents:** use none unless the user asks. The Native end-of-build reviewer is agreed.
- **InternDocs:** it is a separate project. Do not work on it.
- **Pace:** work one step at a time. Say what comes next, and ask before starting each major step.
- **Options:** when offering options, put the recommended one first and label it "(Recommended)".

## 7. Decisions already made

- **Name:** PaperLine. The repository is still named `client-portal`.
- **Email:** the budget is zero and there is no domain yet, so Gmail SMTP sends both the sign-in codes and the app emails.
- **Time zone:** customers are in UTC+8.
- **Uploads:** `.doc` and `.xls` stay allowed.
- **Backlog choices** (spec §2):
  - A new Requests page, plus a search box on the dashboard.
  - Client search also matches contact names and emails.
  - The timeline is for staff only, and database triggers record it.
  - The CSV import matches existing clients by name and adds their new contacts.
  - Drag-and-drop uses native browser events.
  - The cleanup deletes only unregistered files older than 24 hours.
- **Before real customers:**
  - Move to paid plans.
  - Verify a domain in Resend.
  - Add a privacy policy and terms.
