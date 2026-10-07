-- Migration 392: the wellbeing check-in (Worry Box stage 2).
--
-- Why (the principal, 7 Oct 2026): "need more questions - we are a boarding
-- school - lots of pressure to succeed"; a low answer alerts both the DSL
-- (cs@) and the principal (the ADSL), as worries do; "a pop up for students
-- every 2 months, we would start now ... students could hide the pop up ...
-- till Thursday - big tests on Friday". Parents see nothing.
--
-- How it works:
--   * wellbeing_rounds: when a check-in is open (opens_at to the end of
--     closes_on, school time). The first opens now and closes at the end of
--     Thursday 8 Oct 2026, before Friday's tests. The DSL and the principal
--     add later rounds (about every 2 months) on /wellbeing.
--   * wellbeing_questions: data. 'scale' questions are 1 to 5 with words at
--     each end; good_high says whether 5 is the good end (false for "How much
--     pressure do you feel?"). 'yesno' questions have good_answer (or null).
--     alert_at: for a scale, alert when the answer, turned so 5 is good, is
--     at or below it; alert_answer: for yes/no, alert on that answer. Wording
--     is fixed once answered (retire and add instead), as lesson feedback.
--   * A student answers once a round, through give_wellbeing_check_in(); the
--     answers are kept in wellbeing_answers. An optional comment is allowed.
--   * "Not now" (snooze_wellbeing_check_in()) hides the pop-up until the next
--     morning, so it comes back the next day while the round is open.
--   * A check-in with any alert answer, or a comment, is flagged. The DSL and
--     the principal get an inbox message for each one, and an email at most
--     once an hour, carrying no names or answers (like the Worry Box).
--   * Only the DSL and the principal read check-ins, with names
--     (can_read_worries()). Students see nothing back but "thank you".
--     Nothing is deleted.

set local formwork.change_note = 'Principal (direct)';

-- ---- Rounds -----------------------------------------------------------------

create table public.wellbeing_rounds (
  round_id serial primary key,
  name text not null check (btrim(name) <> '' and length(name) <= 80),
  opens_at timestamptz not null,
  closes_on date not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id),
  check ((opens_at at time zone 'Africa/Lagos')::date <= closes_on)
);

alter table public.wellbeing_rounds enable row level security;
grant select on public.wellbeing_rounds to authenticated;

-- Everyone signed in may see when rounds run (it says nothing about anyone).
create policy wellbeing_rounds_read on public.wellbeing_rounds
  for select to authenticated using (true);

-- ---- Questions --------------------------------------------------------------

create table public.wellbeing_questions (
  question_id serial primary key,
  position integer not null default 0,
  kind text not null check (kind in ('scale', 'yesno')),
  question text not null check (btrim(question) <> '' and length(question) <= 160),
  low_label text,
  high_label text,
  good_high boolean not null default true,
  alert_at integer check (alert_at between 1 and 4),
  good_answer boolean,
  alert_answer boolean,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (kind = 'yesno' or (low_label is not null and high_label is not null)),
  check (kind = 'scale' or alert_at is null)
);

alter table public.wellbeing_questions enable row level security;
grant select on public.wellbeing_questions to authenticated;

create policy wellbeing_questions_read on public.wellbeing_questions
  for select to authenticated using (true);

insert into public.wellbeing_questions (position, kind, question, low_label, high_label, good_high, alert_at, good_answer, alert_answer) values
  (1,  'scale', 'How have you been feeling in general over the last few weeks?', 'Very low', 'Very good', true, 2, null, null),
  (2,  'scale', 'How well have you been sleeping?', 'Very badly', 'Very well', true, 1, null, null),
  (3,  'scale', 'How well are you eating?', 'Very badly', 'Very well', true, 1, null, null),
  (4,  'scale', 'How are you coping with schoolwork, homework and tests?', 'Not coping', 'Coping well', true, 2, null, null),
  (5,  'scale', 'How much pressure do you feel to get good results?', 'None', 'Far too much', false, 1, null, null),
  (6,  'scale', 'How much time do you get to rest and relax?', 'None', 'Plenty', true, 1, null, null),
  (7,  'scale', 'How are you coping with being away from home?', 'Very badly', 'Very well', true, 1, null, null),
  (8,  'scale', 'How are you getting on in your boarding house?', 'Very badly', 'Very well', true, 2, null, null),
  (9,  'scale', 'How are you getting on with your friends?', 'Very badly', 'Very well', true, 2, null, null),
  (10, 'yesno', 'Do you feel safe at school and in the boarding house?', null, null, true, null, true, false),
  (11, 'yesno', 'Is there an adult at school you could talk to if something was wrong?', null, null, true, null, true, false),
  (12, 'yesno', 'Has anyone been unkind to you or left you out this half term?', null, null, true, null, false, true),
  (13, 'yesno', 'Do you worry about letting your family down with your results?', null, null, true, null, false, null),
  (14, 'yesno', 'Have you felt so low that you stopped enjoying things you usually enjoy?', null, null, true, null, false, true),
  (15, 'yesno', 'Would you like someone to talk to?', null, null, true, null, null, true);

create or replace function public.wellbeing_question_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if (new.question is distinct from old.question or new.kind is distinct from old.kind
      or new.low_label is distinct from old.low_label or new.high_label is distinct from old.high_label
      or new.good_high is distinct from old.good_high)
     and exists (select 1 from wellbeing_answers a where a.question_id = old.question_id) then
    raise exception 'Students have already answered this question, so its wording can''t change. Retire it and add a new one.';
  end if;
  return new;
end;
$$;

-- ---- Check-ins --------------------------------------------------------------

create table public.wellbeing_check_ins (
  check_in_id bigserial primary key,
  round_id integer not null references public.wellbeing_rounds(round_id),
  student_id integer not null references public.students(student_id),
  year_group integer,
  boarding_house text,
  comment text check (comment is null or length(comment) <= 2000),
  flagged boolean not null default false,
  created_at timestamptz not null default now(),
  followed_up_at timestamptz,
  followed_up_by uuid references auth.users(id),
  follow_up_note text
);

create unique index wellbeing_check_ins_once on public.wellbeing_check_ins (round_id, student_id);

create table public.wellbeing_answers (
  answer_id bigserial primary key,
  check_in_id bigint not null references public.wellbeing_check_ins(check_in_id),
  question_id integer not null references public.wellbeing_questions(question_id),
  score integer check (score between 1 and 5),
  answer boolean,
  alert boolean not null default false,
  check ((score is null) <> (answer is null))
);

create unique index wellbeing_answers_once on public.wellbeing_answers (check_in_id, question_id);

create table public.wellbeing_snoozes (
  round_id integer not null references public.wellbeing_rounds(round_id),
  student_id integer not null references public.students(student_id),
  snoozed_until timestamptz not null,
  primary key (round_id, student_id)
);

alter table public.wellbeing_check_ins enable row level security;
alter table public.wellbeing_answers enable row level security;
alter table public.wellbeing_snoozes enable row level security;
grant select on public.wellbeing_check_ins to authenticated;
grant select on public.wellbeing_answers to authenticated;
-- wellbeing_snoozes: no grant; only the functions below use it.

create policy wellbeing_check_ins_dsl_read on public.wellbeing_check_ins
  for select to authenticated using ((select can_read_worries()));
create policy wellbeing_answers_dsl_read on public.wellbeing_answers
  for select to authenticated using ((select can_read_worries()));

create trigger trg_wellbeing_question_guard
  before update on public.wellbeing_questions
  for each row execute function public.wellbeing_question_guard();
revoke execute on function public.wellbeing_question_guard() from public, anon, authenticated;

-- Answers are never changed or deleted; check-ins are never deleted (only
-- their follow-up is recorded, through mark_wellbeing_followed_up()).
create trigger trg_wellbeing_answers_keep_forever
  before update or delete on public.wellbeing_answers
  for each row execute function public.worry_keep_forever();
create trigger trg_wellbeing_check_ins_keep_forever
  before delete on public.wellbeing_check_ins
  for each row execute function public.worry_keep_forever();

-- ---- The open round, for the signed-in student ------------------------------

create or replace function public.wellbeing_open_round()
returns integer
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select r.round_id from wellbeing_rounds r
  where r.cancelled_at is null and r.opens_at <= now() and school_today() <= r.closes_on
  order by r.opens_at desc
  limit 1;
$$;

revoke execute on function public.wellbeing_open_round() from public, anon, authenticated;

-- Whether the pop-up should show now: a round is open, the student hasn't
-- answered it, and hasn't hidden it until later.
create or replace function public.my_wellbeing_check_in()
returns table (round_id integer, round_name text, closes_on date, show_now boolean)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select r.round_id, r.name, r.closes_on,
         not exists (select 1 from wellbeing_snoozes z
                     where z.round_id = r.round_id and z.student_id = my_student_id()
                       and z.snoozed_until > now())
  from wellbeing_rounds r
  join students s on s.student_id = my_student_id() and s.status = 'active'
  where r.round_id = wellbeing_open_round()
    and not exists (select 1 from wellbeing_check_ins c
                    where c.round_id = r.round_id and c.student_id = s.student_id);
$$;

revoke execute on function public.my_wellbeing_check_in() from public, anon;
grant execute on function public.my_wellbeing_check_in() to authenticated;

-- "Not now": hidden until the start of the next school day.
create or replace function public.snooze_wellbeing_check_in()
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_student integer := my_student_id();
  v_round integer := wellbeing_open_round();
begin
  if v_student is null or v_round is null then
    return;
  end if;
  insert into wellbeing_snoozes (round_id, student_id, snoozed_until)
  values (v_round, v_student, ((school_today() + 1)::timestamp at time zone 'Africa/Lagos'))
  on conflict (round_id, student_id) do update set snoozed_until = excluded.snoozed_until;
end;
$$;

revoke execute on function public.snooze_wellbeing_check_in() from public, anon;
grant execute on function public.snooze_wellbeing_check_in() to authenticated;

-- ---- Telling the DSL and the principal --------------------------------------

insert into public.email_reply_routes
  (email_kind, label, description, sender_label, sort_order, reply_to_sender, reply_to_smt, addresses)
values
  ('wellbeing', 'Wellbeing check-in', 'The email to the DSL and the principal when students'' check-ins need a look (at most one an hour). It carries no names or answers.',
   null, 59, false, false, array['cs@abc.sch.ng'])
on conflict (email_kind) do nothing;

create table public.wellbeing_email_log (
  sent_at timestamptz primary key default now()
);
alter table public.wellbeing_email_log enable row level security;
-- No grant: only notify_wellbeing_flag() uses it.

create or replace function public.notify_wellbeing_flag()
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_profiles uuid[];
  v_emails text[];
begin
  select array_agg(distinct p.id) into v_profiles
  from staff_roles sr join profiles p on p.staff_id = sr.staff_id
  where sr.role_name in ('dsl', 'principal');

  perform post_inbox_notice(v_profiles, 'Wellbeing check-in needs a look',
    '<p>A student''s wellbeing check-in has an answer that needs a look.</p><p>Open it in Formwork: https://misform.work/wellbeing</p>',
    'wellbeing');

  perform pg_advisory_xact_lock(hashtext('wellbeing_email'));
  if exists (select 1 from wellbeing_email_log where sent_at > now() - interval '1 hour') then
    return;
  end if;

  select array_agg(distinct lower(btrim(s.email))) into v_emails
  from staff_roles sr join staff s on s.staff_id = sr.staff_id
  where sr.role_name in ('dsl', 'principal') and is_plain_email(lower(btrim(s.email)));

  if v_emails is not null then
    perform queue_workspace_email(jsonb_build_object(
      'to', to_jsonb(v_emails),
      'subject', 'Wellbeing check-ins need a look',
      'html', '<p>One or more students'' wellbeing check-ins have answers that need a look. '
        || 'For their privacy this email says nothing more, and you won''t get another for an hour.</p>'
        || '<p>Open them in Formwork: <a href="https://misform.work/wellbeing">https://misform.work/wellbeing</a></p>',
      'reply_to', email_reply_to('wellbeing')));
    insert into wellbeing_email_log default values;
  end if;
end;
$$;

revoke execute on function public.notify_wellbeing_flag() from public, anon, authenticated;

-- ---- Giving the check-in ----------------------------------------------------

-- p_answers: {"<question_id>": 1..5 for a scale, true/false for yes/no}, every
-- active question answered.
create or replace function public.give_wellbeing_check_in(p_answers jsonb, p_comment text)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_student students%rowtype;
  v_round integer := wellbeing_open_round();
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_q record;
  v_val jsonb;
  v_key text;
  v_id bigint;
  v_flag boolean;
begin
  select * into v_student from students where student_id = my_student_id() and status = 'active';
  if not found then
    raise exception 'Only students can do the wellbeing check-in.';
  end if;
  if v_round is null then
    raise exception 'The wellbeing check-in isn''t open just now.';
  end if;
  if v_comment is not null and length(v_comment) > 2000 then
    raise exception 'Please keep your comment under 2000 characters.';
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'Please answer every question.';
  end if;
  for v_q in select * from wellbeing_questions where active loop
    v_val := p_answers -> v_q.question_id::text;
    if v_q.kind = 'scale' then
      if jsonb_typeof(v_val) is distinct from 'number' or (v_val #>> '{}')::numeric not in (1, 2, 3, 4, 5) then
        raise exception 'Please answer every question.';
      end if;
    elsif jsonb_typeof(v_val) is distinct from 'boolean' then
      raise exception 'Please answer every question.';
    end if;
  end loop;
  for v_key in select jsonb_object_keys(p_answers) loop
    if not exists (select 1 from wellbeing_questions where active and question_id::text = v_key) then
      raise exception 'Unknown question in the check-in.';
    end if;
  end loop;

  insert into wellbeing_check_ins (round_id, student_id, year_group, boarding_house, comment)
  values (v_round, v_student.student_id, v_student.year_group, v_student.boarding_house, v_comment)
  returning check_in_id into v_id;

  insert into wellbeing_answers (check_in_id, question_id, score, answer, alert)
  select v_id, q.question_id,
         case when q.kind = 'scale' then (p_answers ->> q.question_id::text)::integer end,
         case when q.kind = 'yesno' then (p_answers ->> q.question_id::text)::boolean end,
         case when q.kind = 'scale' then
                q.alert_at is not null and
                (case when q.good_high then (p_answers ->> q.question_id::text)::integer
                      else 6 - (p_answers ->> q.question_id::text)::integer end) <= q.alert_at
              else q.alert_answer is not null and (p_answers ->> q.question_id::text)::boolean = q.alert_answer
         end
  from wellbeing_questions q where q.active;

  v_flag := v_comment is not null or exists (select 1 from wellbeing_answers where check_in_id = v_id and alert);
  if v_flag then
    update wellbeing_check_ins set flagged = true where check_in_id = v_id;
    perform notify_wellbeing_flag();
  end if;

  update wellbeing_snoozes set snoozed_until = now() where round_id = v_round and student_id = v_student.student_id;
  return v_id;
exception when unique_violation then
  raise exception 'You have already done this check-in. Thank you.';
end;
$$;

revoke execute on function public.give_wellbeing_check_in(jsonb, text) from public, anon;
grant execute on function public.give_wellbeing_check_in(jsonb, text) to authenticated;

-- ---- The DSL and the principal ----------------------------------------------

create or replace function public.add_wellbeing_round(p_name text, p_opens_at timestamptz, p_closes_on date)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_id integer;
begin
  if not can_read_worries() then
    raise exception 'Only the DSL and the principal can set check-in dates.';
  end if;
  if p_opens_at is null or p_closes_on is null or (p_opens_at at time zone 'Africa/Lagos')::date > p_closes_on then
    raise exception 'The check-in must close on or after the day it opens.';
  end if;
  if p_closes_on < school_today() then
    raise exception 'That check-in would already be over.';
  end if;
  if exists (select 1 from wellbeing_rounds r
             where r.cancelled_at is null
               and (r.opens_at at time zone 'Africa/Lagos')::date <= p_closes_on
               and (p_opens_at at time zone 'Africa/Lagos')::date <= r.closes_on) then
    raise exception 'Those dates overlap another check-in.';
  end if;
  insert into wellbeing_rounds (name, opens_at, closes_on, created_by)
  values (btrim(coalesce(nullif(btrim(p_name), ''), 'Wellbeing check-in')), p_opens_at, p_closes_on, auth.uid())
  returning round_id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.add_wellbeing_round(text, timestamptz, date) from public, anon;
grant execute on function public.add_wellbeing_round(text, timestamptz, date) to authenticated;

-- Change when a round closes (e.g. keep it open longer), or cancel one that
-- hasn't had any answers. Answers already given are never removed.
create or replace function public.set_wellbeing_round_close(p_round_id integer, p_closes_on date)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not can_read_worries() then
    raise exception 'Only the DSL and the principal can set check-in dates.';
  end if;
  update wellbeing_rounds set closes_on = p_closes_on
  where round_id = p_round_id and cancelled_at is null
    and (opens_at at time zone 'Africa/Lagos')::date <= p_closes_on;
  if not found then
    raise exception 'The check-in must close on or after the day it opens.';
  end if;
end;
$$;

revoke execute on function public.set_wellbeing_round_close(integer, date) from public, anon;
grant execute on function public.set_wellbeing_round_close(integer, date) to authenticated;

create or replace function public.cancel_wellbeing_round(p_round_id integer)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not can_read_worries() then
    raise exception 'Only the DSL and the principal can cancel a check-in.';
  end if;
  if exists (select 1 from wellbeing_check_ins where round_id = p_round_id) then
    raise exception 'Students have already answered this check-in. Close it early instead.';
  end if;
  update wellbeing_rounds set cancelled_at = now(), cancelled_by = auth.uid()
  where round_id = p_round_id and cancelled_at is null;
end;
$$;

revoke execute on function public.cancel_wellbeing_round(integer) from public, anon;
grant execute on function public.cancel_wellbeing_round(integer) to authenticated;

create or replace function public.mark_wellbeing_followed_up(p_check_in_id bigint, p_note text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not can_read_worries() then
    raise exception 'Only the DSL and the principal can follow up check-ins.';
  end if;
  update wellbeing_check_ins
  set followed_up_at = now(), followed_up_by = auth.uid(),
      follow_up_note = nullif(btrim(coalesce(p_note, '')), '')
  where check_in_id = p_check_in_id;
end;
$$;

revoke execute on function public.mark_wellbeing_followed_up(bigint, text) from public, anon;
grant execute on function public.mark_wellbeing_followed_up(bigint, text) to authenticated;

-- Follow-up columns are the only thing that may change on a check-in.
create or replace function public.wellbeing_check_in_guard()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if (new.round_id, new.student_id, new.year_group, new.boarding_house, new.comment, new.created_at)
     is distinct from (old.round_id, old.student_id, old.year_group, old.boarding_house, old.comment, old.created_at)
     or (new.flagged is distinct from old.flagged and not new.flagged) then
    raise exception 'A check-in can''t be changed once given.';
  end if;
  return new;
end;
$$;

revoke execute on function public.wellbeing_check_in_guard() from public, anon, authenticated;

create trigger trg_wellbeing_check_in_guard
  before update on public.wellbeing_check_ins
  for each row execute function public.wellbeing_check_in_guard();

-- Counts for the dashboard tile; null for anyone but the DSL and the principal.
create or replace function public.wellbeing_counts()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select case when can_read_worries() then jsonb_build_object(
    'to_follow_up', (select count(*) from wellbeing_check_ins where flagged and followed_up_at is null))
  end;
$$;

revoke execute on function public.wellbeing_counts() from public, anon;
grant execute on function public.wellbeing_counts() to authenticated;

-- ---- The first round --------------------------------------------------------

insert into public.wellbeing_rounds (name, opens_at, closes_on)
values ('October 2026', now(), date '2026-10-08');

-- ---- The staff page ---------------------------------------------------------

insert into public.resources (resource_key, label, section, sort_order)
values ('/wellbeing', 'Wellbeing Check-ins', 'Pastoral', 28)
on conflict (resource_key) do nothing;

insert into public.role_permissions (role_name, resource_key) values
  ('dsl', '/wellbeing'),
  ('principal', '/wellbeing')
on conflict do nothing;
