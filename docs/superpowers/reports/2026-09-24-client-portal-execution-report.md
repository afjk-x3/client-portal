# Client Portal: Execution Report

- **Branch:** `claude/quirky-davinci-jna28e`
- **Plan:** [`docs/superpowers/plans/2026-09-24-client-portal.md`](../plans/2026-09-24-client-portal.md)
- **Method:** subagent-driven. A fresh implementer subagent runs each task's test-first steps and commits. The controller then checks that every file matches the code validated during planning byte for byte and re-runs the task's checks. Each phase ends with a review subagent.
- **Last updated:** 2026-09-24, after Phase 2 and Phase 1 Task 2

This report is updated and pushed after every phase, so it stays current if the session ends.

## Status

| Phase | Status | Result |
|---|---|---|
| 1 Foundation | Done | 46 Vitest tests pass; typecheck, lint, build pass. Review findings fixed. Task 2 used hand-written components (see Deviations). |
| 2 Database | Done | 130 pgTAP tests pass; `db lint` clean. Security review in progress. |
| 3 Auth and staff shell | Not started | |
| 4 Clients, templates, team | Not started | |
| 5 Requests and review | Not started | |
| 6 Client portal and files | Not started | |
| 7 Zip, daily jobs, deployment | Not started | |

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

## Deviations from the plan

- **Phase 1 Task 2: UI components written by hand.** `ui.shadcn.com` stayed blocked, so `components/ui/` was written to match shadcn's new-york v4 components: same file names, exports, props, and `data-slot` attributes, built on the `radix-ui` package with the same dependencies the CLI installs. The sidebar is a subset (no tooltip, rail, or menu sub-items, which the app does not use) and does not write the `sidebar_state` cookie, since nothing reads it. `npx shadcn@latest add <name> --overwrite` replaces any component with the generated one.
- **`useIsMobile`** uses `useSyncExternalStore` instead of shadcn's effect, which the React Compiler lint rule `react-hooks/set-state-in-effect` rejects.

## Review findings

- **Phase 1** (code review): one Important and several Minor issues, all fixed in `d935f5a`: Resend batches now use permissive validation so one bad address no longer drops the batch; email configuration errors are reported instead of producing broken headers; truncated file names keep their extension; zip entries never use `.` or `..`; `safeNextPath` resolves dot segments; MIME lookup uses own keys only; shared `LIMITS` for text lengths; `filenameSchema`. Later-phase code was fixed in the validated copy at the same time (emails built before state changes, a 20-file cap per item enforced before signing an upload URL).
- **Phase 2** (security review of the SQL): in progress.

## Blockers

- **`ui.shadcn.com` is denied by the session's network policy** (proxy answers 403 to CONNECT; last checked 18:28 UTC). Worked around with hand-written components (above). A new session may pick up the changed setting.
- **Playwright's browser CDN is denied.** Worked around: the preinstalled Chromium is used through a local, uncommitted Playwright config. The committed config is unchanged.
- **Docker images from `public.ecr.aws` are denied.** Worked around: `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io`.

## Notes from execution

- Commit trailers: commits from Tasks 1, 3, and 4 carry `Co-Authored-By: Claude Opus 5.5`. From Task 5 on, subagents use their own environment's attribution (`Claude Sonnet 5`), which is the accurate author.
- All copied files matched the validated versions byte for byte.

## How to resume

1. Check out `claude/quirky-davinci-jna28e`.
2. Continue with the first phase in the status table that is not Done, following the phase plan linked from the plan index.
3. Local stack: `npx supabase start` (with Docker running), `cp .env.example .env.local`, keys from `npx supabase status`.
