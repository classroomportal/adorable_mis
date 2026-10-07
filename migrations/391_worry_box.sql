-- Migration 391: the Worry Box, stage 1.
--
-- Why (the principal, 7 Oct 2026): the school has a paper worry box where
-- students write about things that worry them: bullying, problems with
-- staff, broken equipment. It moves into Formwork (the paper box stays, and
-- its slips can be typed in here so everything is in one place). The
-- principal's decisions:
--   * Every worry, with the student's name, is seen by the DSL and the
--     principal only, "to start with". Nobody else: not SMT, not pastoral,
--     not admins. Checked on the roles themselves (holds_staff_role), so
--     being admin is not enough, as with the budget (migration 369).
--   * Parents see nothing.
--   * A half-termly wellbeing check-in and a school rating follow as stages
--     2 and 3 (not built here). Design notes: docs/worry-box-design.md.
--
-- How it works:
--   * worries: one row per worry. From the portal (source 'portal', the
--     signed-in student, from my_student_id()) or typed in from a paper slip
--     by the DSL or principal (source 'paper', student optional, since paper
--     slips can be unsigned). A student can tick "urgent" ("I don't feel
--     safe, or I need to talk to someone soon").
--   * worry_notes: what staff do about it. Internal notes, replies to the
--     student (to_student, shown on their portal), and status changes.
--     Append-only.
--   * Status: new (nobody has opened it), open (being looked at), closed.
--   * The tables have select policies only; every write goes through the
--     functions below. Nothing is deleted or edited afterwards (a trigger
--     refuses it), like finance and grade history.
--   * The inbox notices and emails about a new worry carry no detail at all:
--     not the student, not the category, not the text. They say a worry has
--     come in (and whether it is urgent) and link to the page. Inbox
--     messages and the email outbox are kept in tables other people can
--     reach, so the worry itself stays in the worry tables.
--   * Worries are not logged in change_history: SMT and admins read that,
--     and would see them. worry_notes is the record instead.
--   * A student can send at most 5 worries a day, so a prank can't flood the
--     DSL's inbox.

set local formwork.change_note = 'Principal (direct)';

-- ---- Who reads worries ------------------------------------------------------

create or replace function public.can_read_worries()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select holds_staff_role('dsl') or holds_staff_role('principal');
$$;

revoke execute on function public.can_read_worries() from public, anon;
grant execute on function public.can_read_worries() to authenticated;

-- ---- Tables -----------------------------------------------------------------

create table public.worries (
  worry_id bigserial primary key,
  student_id integer references public.students(student_id),
  category text not null check (category in
    ('bullying', 'staff', 'feelings', 'home', 'boarding', 'equipment', 'other')),
  details text not null check (btrim(details) <> '' and length(details) <= 2000),
  urgent boolean not null default false,
  source text not null default 'portal' check (source in ('portal', 'paper')),
  received_on date not null default school_today(),
  status text not null default 'new' check (status in ('new', 'open', 'closed')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  read_at timestamptz,
  read_by uuid references auth.users(id),
  closed_at timestamptz,
  closed_by uuid references auth.users(id),
  check (source = 'paper' or student_id is not null)
);

create index worries_status on public.worries (status, created_at desc);
create index worries_student on public.worries (student_id, created_at desc);

create table public.worry_notes (
  note_id bigserial primary key,
  worry_id bigint not null references public.worries(worry_id),
  kind text not null check (kind in ('note', 'reply', 'status')),
  note text not null check (btrim(note) <> '' and length(note) <= 4000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  created_by_name text
);

create index worry_notes_worry on public.worry_notes (worry_id, created_at);

alter table public.worries enable row level security;
alter table public.worry_notes enable row level security;
grant select on public.worries to authenticated;
grant select on public.worry_notes to authenticated;

-- The DSL and the principal read everything.
create policy worries_dsl_read on public.worries
  for select to authenticated using ((select can_read_worries()));
create policy worry_notes_dsl_read on public.worry_notes
  for select to authenticated using ((select can_read_worries()));

-- A student reads the worries they sent from the portal, and the replies to
-- them (never the internal notes or status entries). A paper slip typed in
-- by staff doesn't appear on the student's portal.
create policy worries_student_read on public.worries
  for select to authenticated
  using (source = 'portal' and student_id = (select my_student_id()));
create policy worry_notes_student_read on public.worry_notes
  for select to authenticated
  using (kind = 'reply' and exists (
    select 1 from worries w
    where w.worry_id = worry_notes.worry_id
      and w.source = 'portal' and w.student_id = (select my_student_id())));

-- Nothing is deleted, and notes are never changed. Worries change only
-- through the functions below (status, read and closed stamps).
create or replace function public.worry_keep_forever()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  raise exception 'Worry Box records are kept permanently and can''t be deleted or changed.';
end;
$$;

revoke execute on function public.worry_keep_forever() from public, anon, authenticated;

create trigger trg_worries_keep_forever
  before delete on public.worries
  for each row execute function public.worry_keep_forever();
create trigger trg_worry_notes_keep_forever
  before update or delete on public.worry_notes
  for each row execute function public.worry_keep_forever();

-- ---- Telling the DSL and the principal --------------------------------------

insert into public.email_reply_routes
  (email_kind, label, description, sender_label, sort_order, reply_to_sender, reply_to_smt, addresses)
values
  ('worry_box', 'Worry Box', 'The email to the DSL and the principal when a new worry arrives. It carries no detail of the worry.',
   null, 58, false, false, array['cs@abc.sch.ng'])
on conflict (email_kind) do nothing;

-- Internal: called by send_worry(). No detail of the worry goes out.
create or replace function public.notify_new_worry(p_urgent boolean)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_profiles uuid[];
  v_emails text[];
  v_subject text := case when p_urgent then 'URGENT: new worry in the Worry Box' else 'New worry in the Worry Box' end;
  v_text text := case when p_urgent
    then 'A student has sent a worry to the Worry Box and marked it urgent (they don''t feel safe, or need to talk to someone soon). Please read it as soon as you can.'
    else 'A student has sent a worry to the Worry Box.' end;
begin
  select array_agg(distinct p.id) into v_profiles
  from staff_roles sr join profiles p on p.staff_id = sr.staff_id
  where sr.role_name in ('dsl', 'principal');

  select array_agg(distinct lower(btrim(s.email))) into v_emails
  from staff_roles sr join staff s on s.staff_id = sr.staff_id
  where sr.role_name in ('dsl', 'principal') and is_plain_email(lower(btrim(s.email)));

  perform post_inbox_notice(v_profiles, v_subject,
    '<p>' || v_text || '</p><p>Open it in Formwork: https://misform.work/worry-box</p>',
    'worry_box');

  if v_emails is not null then
    perform queue_workspace_email(jsonb_build_object(
      'to', to_jsonb(v_emails),
      'subject', v_subject,
      'html', '<p>' || v_text || '</p><p>For the student''s privacy this email says nothing more. '
        || 'Open it in Formwork: <a href="https://misform.work/worry-box">https://misform.work/worry-box</a></p>',
      'reply_to', email_reply_to('worry_box')));
  end if;
end;
$$;

revoke execute on function public.notify_new_worry(boolean) from public, anon, authenticated;

-- ---- Students ---------------------------------------------------------------

create or replace function public.send_worry(p_category text, p_details text, p_urgent boolean)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_student integer := my_student_id();
  v_details text := btrim(coalesce(p_details, ''));
  v_id bigint;
begin
  if v_student is null then
    raise exception 'Only students can send a worry from the portal.';
  end if;
  if p_category is null or p_category not in ('bullying', 'staff', 'feelings', 'home', 'boarding', 'equipment', 'other') then
    raise exception 'Please choose what your worry is about.';
  end if;
  if v_details = '' then
    raise exception 'Please write what is worrying you.';
  end if;
  if length(v_details) > 2000 then
    raise exception 'Please keep it under 2000 characters. You can send another worry for the rest.';
  end if;

  perform pg_advisory_xact_lock(hashtext('worry_box'), v_student);
  if (select count(*) from worries
      where student_id = v_student and source = 'portal'
        and (created_at at time zone 'Africa/Lagos')::date = school_today()) >= 5 then
    raise exception 'You have sent 5 worries today, which is the most for one day. If you need help now, please speak to any member of staff.';
  end if;

  insert into worries (student_id, category, details, urgent, source, created_by)
  values (v_student, p_category, v_details, coalesce(p_urgent, false), 'portal', auth.uid())
  returning worry_id into v_id;

  perform notify_new_worry(coalesce(p_urgent, false));
  return v_id;
end;
$$;

revoke execute on function public.send_worry(text, text, boolean) from public, anon;
grant execute on function public.send_worry(text, text, boolean) to authenticated;

-- ---- The DSL and the principal ----------------------------------------------

-- A paper slip typed in. p_student_id null for an unsigned slip. Nobody is
-- notified: the person typing it in already has it.
create or replace function public.record_paper_worry(
  p_student_id integer, p_category text, p_details text, p_urgent boolean, p_received_on date)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_details text := btrim(coalesce(p_details, ''));
  v_id bigint;
begin
  if not can_read_worries() then
    raise exception 'Only the DSL and the principal can record worries.';
  end if;
  if p_category is null or p_category not in ('bullying', 'staff', 'feelings', 'home', 'boarding', 'equipment', 'other') then
    raise exception 'Please choose what the worry is about.';
  end if;
  if v_details = '' then
    raise exception 'Please type what the slip says.';
  end if;
  if p_received_on is null or p_received_on > school_today() then
    raise exception 'The date the slip was found can''t be in the future.';
  end if;
  if p_student_id is not null and not exists (select 1 from students where student_id = p_student_id) then
    raise exception 'That student was not found.';
  end if;

  insert into worries (student_id, category, details, urgent, source, received_on, status,
                       created_by, read_at, read_by)
  values (p_student_id, p_category, v_details, coalesce(p_urgent, false), 'paper', p_received_on, 'open',
          auth.uid(), now(), auth.uid())
  returning worry_id into v_id;

  insert into worry_notes (worry_id, kind, note, created_by, created_by_name)
  values (v_id, 'status', 'Typed in from a paper slip', auth.uid(), profile_display_name(auth.uid()));

  return v_id;
end;
$$;

revoke execute on function public.record_paper_worry(integer, text, text, boolean, date) from public, anon;
grant execute on function public.record_paper_worry(integer, text, text, boolean, date) to authenticated;

-- Opening a new worry marks it read (status open), so the other reader can
-- see someone has it.
create or replace function public.open_worry(p_worry_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not can_read_worries() then
    raise exception 'Only the DSL and the principal can open worries.';
  end if;
  update worries set status = 'open', read_at = now(), read_by = auth.uid()
  where worry_id = p_worry_id and status = 'new';
  if found then
    insert into worry_notes (worry_id, kind, note, created_by, created_by_name)
    values (p_worry_id, 'status', 'Opened', auth.uid(), profile_display_name(auth.uid()));
  end if;
end;
$$;

revoke execute on function public.open_worry(bigint) from public, anon;
grant execute on function public.open_worry(bigint) to authenticated;

-- A note (staff only) or a reply (shown to the student on their portal;
-- portal worries only). The student is told in their inbox that there is a
-- reply, without its text.
create or replace function public.add_worry_note(p_worry_id bigint, p_note text, p_to_student boolean)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_worry worries%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
  v_id bigint;
  v_student_login uuid[];
begin
  if not can_read_worries() then
    raise exception 'Only the DSL and the principal can add notes to worries.';
  end if;
  select * into v_worry from worries where worry_id = p_worry_id;
  if not found then
    raise exception 'That worry was not found.';
  end if;
  if v_note = '' then
    raise exception 'Please write the note.';
  end if;
  if coalesce(p_to_student, false) and (v_worry.source <> 'portal' or v_worry.student_id is null) then
    raise exception 'Only worries sent from the portal can be replied to there. Speak to the student instead.';
  end if;

  if v_worry.status = 'new' then
    perform open_worry(p_worry_id);
  end if;

  insert into worry_notes (worry_id, kind, note, created_by, created_by_name)
  values (p_worry_id, case when coalesce(p_to_student, false) then 'reply' else 'note' end,
          v_note, auth.uid(), profile_display_name(auth.uid()))
  returning note_id into v_id;

  if coalesce(p_to_student, false) then
    select array_agg(p.id) into v_student_login from profiles p where p.student_id = v_worry.student_id;
    perform post_inbox_notice(v_student_login, 'A reply to your worry',
      '<p>A member of staff has replied to the worry you sent. Open the Worry Box on your portal to read it: https://misform.work/portal#worries</p>',
      'worry_box');
  end if;

  return v_id;
end;
$$;

revoke execute on function public.add_worry_note(bigint, text, boolean) from public, anon;
grant execute on function public.add_worry_note(bigint, text, boolean) to authenticated;

-- Close or reopen, with an optional note saying why.
create or replace function public.set_worry_status(p_worry_id bigint, p_status text, p_note text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not can_read_worries() then
    raise exception 'Only the DSL and the principal can change a worry.';
  end if;
  if p_status not in ('open', 'closed') then
    raise exception 'A worry can only be open or closed.';
  end if;

  update worries set
    status = p_status,
    read_at = coalesce(read_at, now()),
    read_by = coalesce(read_by, auth.uid()),
    closed_at = case when p_status = 'closed' then now() end,
    closed_by = case when p_status = 'closed' then auth.uid() end
  where worry_id = p_worry_id and status <> p_status;
  if not found then
    return;
  end if;

  insert into worry_notes (worry_id, kind, note, created_by, created_by_name)
  values (p_worry_id, 'status',
          case when p_status = 'closed' then 'Closed' else 'Reopened' end || coalesce(': ' || v_note, ''),
          auth.uid(), profile_display_name(auth.uid()));
end;
$$;

revoke execute on function public.set_worry_status(bigint, text, text) from public, anon;
grant execute on function public.set_worry_status(bigint, text, text) to authenticated;

-- For the dashboard tile: null for anyone who can't read worries, so the
-- tile shows only for the DSL and the principal.
create or replace function public.worry_box_counts()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select case when can_read_worries() then jsonb_build_object(
    'new', (select count(*) from worries where status = 'new'),
    'urgent', (select count(*) from worries where status <> 'closed' and urgent),
    'open', (select count(*) from worries where status <> 'closed'))
  end;
$$;

revoke execute on function public.worry_box_counts() from public, anon;
grant execute on function public.worry_box_counts() to authenticated;

-- ---- The staff page ---------------------------------------------------------

insert into public.resources (resource_key, label, section, sort_order)
values ('/worry-box', 'Worry Box', 'Pastoral', 27)
on conflict (resource_key) do nothing;

insert into public.role_permissions (role_name, resource_key) values
  ('dsl', '/worry-box'),
  ('principal', '/worry-box')
on conflict do nothing;
