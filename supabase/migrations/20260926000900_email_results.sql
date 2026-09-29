-- Claiming and recording: the service role leases due rows an hour forward,
-- and record_email_result applies one outcome — keeping what may still retry,
-- dropping what is done, and writing PaperLine's own events for request emails.

alter table public.request_events drop constraint request_events_kind_check;
alter table public.request_events add constraint request_events_kind_check check (kind in (
  'sent', 'details_changed', 'item_added', 'item_removed', 'file_added', 'file_removed',
  'submitted', 'accepted', 'returned', 'reminder_sent', 'archived', 'unarchived', 'completed', 'reopened',
  'email_failed', 'email_sent_late'
));

-- Leases the oldest due rows for one hour so no two runs send the same row.
create function public.claim_due_emails(max_rows int default 100)
returns setof public.email_outbox
language sql
security definer
set search_path = ''
as $$
  update public.email_outbox
  set send_after = now() + interval '1 hour'
  where id in (
    select id from public.email_outbox
    where send_after <= now()
    order by id
    limit max_rows
    for update skip locked
  )
  returning *;
$$;
revoke execute on function public.claim_due_emails(int) from public, anon, authenticated;
grant execute on function public.claim_due_emails(int) to service_role;

-- Applies one send outcome. Sent (no reason) deletes the row; a retryable
-- failure counts up to the fourth attempt and waits an hour; anything else
-- deletes it. The service role records any row; staff only their firm's. A
-- request email's outcome becomes an Activity event with no actor.
create function public.record_email_result(email_id bigint, reason text default null, retry boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.email_outbox%rowtype;
  v_outcome text;
begin
  select * into v_row from public.email_outbox
  where id = record_email_result.email_id
  for update;
  if not found then
    return;
  end if;
  if (select auth.uid()) is not null and not public.is_firm_member(v_row.firm_id) then
    return;
  end if;

  if reason is null then
    delete from public.email_outbox where id = v_row.id;
    if v_row.failures > 0 then
      insert into public.request_events (firm_id, request_id, item_id, actor_id, kind, detail)
      select r.firm_id, v_row.request_id, v_row.item_id, null, 'email_sent_late',
             jsonb_build_object('email', v_row.kind, 'to', v_row.recipient)
      from public.requests r
      where v_row.request_id is not null
        and r.id = v_row.request_id
        and r.status <> 'draft';
    end if;
    return;
  end if;

  if retry and v_row.failures < 3 then
    update public.email_outbox
    set failures = failures + 1, send_after = now() + interval '1 hour'
    where id = v_row.id;
    v_outcome := 'retrying';
  else
    delete from public.email_outbox where id = v_row.id;
    v_outcome := case when retry then 'gave_up' else 'failed' end;
  end if;

  insert into public.request_events (firm_id, request_id, item_id, actor_id, kind, detail)
  select r.firm_id, v_row.request_id, v_row.item_id, null, 'email_failed',
         jsonb_build_object('email', v_row.kind, 'to', v_row.recipient,
                            'reason', left(reason, 200), 'outcome', v_outcome)
  from public.requests r
  where v_row.request_id is not null
    and r.id = v_row.request_id
    and r.status <> 'draft';
end;
$$;
revoke execute on function public.record_email_result(bigint, text, boolean) from public, anon;
