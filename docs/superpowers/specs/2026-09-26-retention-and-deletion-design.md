# Retention and Deletion: Design Spec

- **Date:** 2026-09-26
- **Status:** Design approved in conversation, section by section, on 2026-09-26
- **Builds on:** [`2026-09-24-client-portal-design.md`](2026-09-24-client-portal-design.md) (the v1 spec) and [`2026-09-25-paperline-backlog-design.md`](2026-09-25-paperline-backlog-design.md) (the backlog spec, including the orphaned-file cleanup and the activity timeline)

## 1. Summary

Firms hold clients' IDs and financial records and need control over how long they keep them. Two features give admins that control:

- **Delete a client:** an admin permanently deletes an archived client with everything about them.
- **File retention:** an admin sets how long files from archived requests are kept, and the daily cleanup job deletes older ones.

Both support the privacy policy needed before launch, and retention helps keep storage under the free plan's 1 GB.

Deletion is permanent. The free Supabase plan has no backups.

### Success criteria

- An admin deletes a client after a clear, typed confirmation. The client, their contacts, requests, answers, files, and timeline disappear from the app at once, and the daily cleanup removes the stored files within a day.
- An admin sets a retention period for files from archived requests; the default keeps them forever. The daily cleanup deletes files past that period, the Activity section records each removal, and staff can see why the files are gone.
- Nothing is deleted without an admin's deliberate choice, and a shorter retention period says what it will delete before it is saved.

## 2. Decisions

| Topic | Decision |
|---|---|
| Who | Admins only, for both features |
| Before deleting a client | The client must be archived, and the admin types the client's name |
| Where the deleting happens | Database rules decide; the existing daily cleanup job deletes stored files. No new cron and no new service-role caller. |
| What retention removes | Files only. The request, its checklist, statuses, written answers, and timeline stay. |
| Retention clock | From the date the request was archived |
| Retention periods | Never (the default), 1, 2, 3, 5, 7, or 10 years |
| Shortening the period | A dialog first says how many archived requests will lose files, when the count is above zero |

## 3. Deleting a client

### 3.1 Rule

A new RLS policy, "Admins can delete archived clients": `on public.clients for delete to authenticated using (public.is_firm_admin(firm_id) and archived_at is not null)`. `authenticated` already holds the delete privilege; until now no policy allowed it.

Deleting a client cascades, through the existing foreign keys, to its contacts, requests, request items, file records, and request events.

### 3.2 Screen

- On an archived client's page, admins see a destructive "Delete client" button next to Unarchive. Staff who are not admins do not see it.
- It opens an AlertDialog: "Delete {name}?" and "This permanently deletes {name}, their contacts, every request with its answers and files, and its Activity history. It can't be undone."
- A text box labeled "Type {name} to confirm" enables the destructive "Delete client" button only when the trimmed text equals the client's name.

### 3.3 Action

`deleteClient(clientId, confirmation)`:

1. Calls `requireStaff()` and requires the admin role.
2. Checks the id with `isId`, reads the client's name, and requires the trimmed confirmation to equal it.
3. Deletes the client through the user-scoped client, so the policy applies: `delete ... where id = $1 and firm_id = $2 and archived_at is not null`, returning the id.
4. Redirects to `/app/clients`.

The stored files are left with no `item_files` row, so the next daily cleanup (02:00 UTC, 10 am in UTC+8) deletes them. Contacts keep their sign-in accounts, which may belong to other clients or firms; they lose access to this firm at once.

## 4. File retention

### 4.1 Columns

- `firms.file_retention_years int`: null means Never, the default. A check allows only 1, 2, 3, 5, 7, and 10.
- `requests.archived_at timestamptz`: a `before update of status` trigger sets it to `now()` when the status becomes `archived` and clears it when the status leaves `archived`. This covers `unarchive_request`. The migration sets it to `now()` for requests already archived, so their clock starts at deployment.
- `requests.files_deleted_at timestamptz`: set by `expire_files` (4.4) when it deletes a request's files.

### 4.2 Settings

- The Settings page gets a "File retention" form: "Keep files from archived requests: Never / 1 year / 2 years / 3 years / 5 years / 7 years / 10 years after archiving". Admins can change it; other staff see it read-only.
- The Server Action validates the choice with zod and saves it through the user-scoped client; the existing admin-only update policy on `firms` applies.
- Saving a shorter period than the current one (including any period when the current one is Never) first calls `retention_preview`. When the count is above zero, a dialog asks: "Files from {n} archived requests will be deleted at the next daily cleanup ({time in the firm's time zone}). Save anyway?" When it is zero, the form saves at once.

### 4.3 `retention_preview(years int) returns int`

`security invoker`, `stable`, `set search_path = ''`, `execute` revoked from `public` and `anon`. It counts the caller's firm's archived requests that have at least one file and were archived before `now() - make_interval(years => years)`. It returns 0 for a caller who is not staff.

### 4.4 `expire_files(max_rows int default 1000) returns int`

`security definer`, `set search_path = ''`. `execute` is revoked from `public`, `anon`, and `authenticated`, and granted to `service_role`.

1. It selects up to `max_rows` file records whose request is `archived` with `archived_at` before `now() - make_interval(years => f.file_retention_years)` for its firm, where the firm has a period set.
2. It deletes those `item_files` rows. The existing trigger records each one as a `file_removed` event with no actor, which the Activity section shows as "PaperLine removed “scan.pdf” from Bank statements".
3. It sets `files_deleted_at = now()` on the requests it touched and returns the number of file records deleted.

More than `max_rows` eligible files wait for the next run.

### 4.5 Cleanup job

`runCleanup` calls `expire_files` first, then its existing orphan step. The expired files' stored objects are far older than 24 hours, so the same run deletes them from Storage. The log line becomes `{"job":"cleanup","expired":n,"found":n,"deleted":n,"failed":n}`.

### 4.6 Screens

- The staff request page shows, under the items, "Files were deleted on {date} under the firm's file retention setting." when `files_deleted_at` is set.
- In the portal, clients see the archived request with no files.

## 5. Errors

- **`deleteClient`:**
  - A caller who is not an admin gets "Only admins can delete clients."
  - A confirmation that does not match gets "Type the client's name exactly to confirm."
  - A client that is not archived or no longer exists gets the existing `invalid_state` message: "This has changed since the page loaded. Refresh and try again."
  - Database errors map through `lib/errors.ts`.
- **Retention form:** zod accepts only the listed periods. The `firms` update policy refuses anyone but an admin, and the preview action checks for an admin too.
- **Cleanup job:** an error in `expire_files` fails the run with a 500 status, so it shows as failed in Vercel's cron logs.

## 6. Tests

- **pgTAP**, in a new file:
  - The delete policy: an admin deletes an archived client, and its contacts, requests, items, file records, and events go with it; staff who are not admins cannot; an admin cannot delete an active client; another firm's admin cannot.
  - `archived_at`: set on archive; cleared on unarchive, directly and through `unarchive_request`.
  - The retention check refuses 4.
  - `retention_preview` counts only the firm's archived requests with files archived before the cutoff.
  - `expire_files` deletes only file records past their firm's period; leaves firms set to Never, recent archives, and requests that are not archived; sets `files_deleted_at`; logs `file_removed` with no actor; stops at `max_rows`; and only `service_role` can call it.
- **Integration:** in one cleanup run, an archived request dated past its firm's period loses its stored files, and a recent one keeps them.
- **Browser:**
  - An admin archives a client, types its name, deletes it, and the client is gone from the list.
  - Staff who are not admins see no Delete button on an archived client.
  - An admin sets retention to 1 year; with nothing eligible, it saves without the dialog, and the setting persists after a reload.

## 7. Other changes

- Regenerate `lib/database.types.ts` after the migration.
- v1 spec: move data retention into scope in §5, note that account and firm deletion stay manual, add the client delete rule to §8.2, and add `expire_files` and `retention_preview` to §8.3.
- README: the feature description, and in Deploying, that the cleanup job also applies each firm's file retention.

## 8. Out of scope

- Deleting a whole firm, which stays manual.
- Deleting contacts' sign-in accounts.
- A storage usage display.
- A lasting record that a client was deleted; the client's timeline goes with it.
- Retention for written answers or whole requests.
- A retention period per client.
