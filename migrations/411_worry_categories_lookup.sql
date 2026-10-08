-- Migration 411: Worry Box categories become a list the Worry Box readers
-- edit, instead of seven fixed in the code.
--
-- Why (the principal, 8 Oct 2026): "Could we have worry box categories as a
-- lookup". Until now the seven categories were fixed by a check constraint
-- on worries.category, in send_worry(), record_paper_worry() and
-- set_worry_category(), and their wording in lib/worries.js, so changing one
-- needed a developer.
--
--   * worry_categories holds them: a fixed key (what worries.category stores,
--     now a foreign key instead of the check constraint), the wording students
--     choose from (label), a short name for staff screens and the daily emails
--     (short_label), its heading (area: 'facilities' or 'other', migration
--     407), whether its open worries are on the 4.15 pm daily list to the DSL
--     (daily_to_dsl, migration 410), the order, and retired.
--   * The seven existing ones are seeded as they were: 'equipment' is the
--     Facilities heading, 'staff' ("A member of staff") is on the DSL list.
--     The two daily emails now follow the flags (area = 'facilities',
--     daily_to_dsl) rather than the keys 'equipment' and 'staff'.
--   * Who edits: only the Worry Box readers (can_see_worry_box(): DSL,
--     principal, guidance), through save_worry_category(). Not admins, though
--     the editor sits on Lookups: putting a category under Facilities sends
--     what students write in it to the admin manager every day (without
--     names), and daily_to_dsl decides what the DSL is emailed, so it is the
--     readers' decision. The Lookups section only shows to them.
--   * Everyone signed in can read the list (students choose from it). There
--     are no write grants; the table changes only through the function.
--   * Never deleted: a category in use can't be removed, so it is retired
--     instead. A retired one is no longer offered to students or for paper
--     slips or moving a worry, and its old worries keep it. There must always
--     be at least one category in use under each heading, so a student can
--     always send a worry under Facilities and under Something else.
--   * Renaming is allowed (the readers decide); old worries show the new
--     wording, and the "Moved from … to …" notes keep the wording of the day.
--   * Changes are logged in change_history under a new area 'worry_box'. That
--     log is read by SMT and admins, which is fine for category names: no
--     worry, student or text is ever in this table.
--
-- send_staff_worry_list() is changed only in its where clause, by rewriting
-- its live definition. Live, it emails holders of 'dsl' and 'principal'
-- (migration 410's file says 'dsl' only; the principal role was added on
-- the live database after 410). That is kept as it is.

-- 1. The list -------------------------------------------------------------------------------

create table public.worry_categories (
  category_key text primary key check (category_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label        text not null check (btrim(label) <> '' and length(label) <= 120),
  short_label  text not null check (btrim(short_label) <> '' and length(short_label) <= 40),
  area         text not null check (area in ('facilities', 'other')),
  daily_to_dsl boolean not null default false,
  sort_order   integer not null default 0,
  retired      boolean not null default false,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  updated_at   timestamptz not null default now(),
  updated_by   uuid
);

alter table public.worry_categories enable row level security;
grant select on public.worry_categories to authenticated;

create policy worry_categories_read on public.worry_categories
  for select to authenticated using (true);

insert into public.worry_categories (category_key, label, short_label, area, daily_to_dsl, sort_order) values
  ('bullying',  'Bullying, unkindness or friendship problems',          'Bullying / friends', 'other',      false, 10),
  ('staff',     'Something a member of staff said or did',              'A member of staff',  'other',      true,  20),
  ('feelings',  'How I am feeling',                                     'Feelings',           'other',      false, 30),
  ('home',      'Home or family',                                       'Home / family',      'other',      false, 40),
  ('boarding',  'The boarding house',                                   'Boarding',           'other',      false, 50),
  ('equipment', 'Facilities: equipment, rooms, food, water or toilets', 'Facilities',         'facilities', false, 60),
  ('other',     'Something else',                                       'Something else',     'other',      false, 70);

alter table public.worries drop constraint worries_category_check;
alter table public.worries add constraint worries_category_fkey
  foreign key (category) references public.worry_categories (category_key);

alter table public.change_history drop constraint change_history_area_check;
alter table public.change_history add constraint change_history_area_check
  check (area = any (array['registers', 'fees', 'behaviour', 'access', 'parent_links', 'email', 'admissions',
                           'groups', 'students', 'reading_ages', 'finance', 'prep', 'rewards', 'other_half',
                           'exclusions', 'worry_box']));

create trigger trg_log_change
  after insert or update or delete on public.worry_categories
  for each row execute function public.log_change('worry_box', 'category_key');

-- 2. Adding and changing a category ---------------------------------------------------------

-- p_key null adds a new category; its key is made from the short name. Returns the key.
create or replace function public.save_worry_category(
  p_key text, p_label text, p_short_label text, p_area text, p_daily_to_dsl boolean,
  p_sort_order integer, p_retired boolean)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_label text := regexp_replace(btrim(coalesce(p_label, '')), '\s+', ' ', 'g');
  v_short text := regexp_replace(btrim(coalesce(p_short_label, '')), '\s+', ' ', 'g');
  v_key text := p_key;
  v_base text;
  v_n integer := 1;
begin
  if not can_see_worry_box() then
    raise exception 'Only the DSL, the principal and guidance staff can change the Worry Box categories.';
  end if;
  if v_label = '' or length(v_label) > 120 then
    raise exception 'Please give the wording students see (up to 120 characters).';
  end if;
  if v_short = '' or length(v_short) > 40 then
    raise exception 'Please give a short name for staff (up to 40 characters).';
  end if;
  if p_area is null or p_area not in ('facilities', 'other') then
    raise exception 'Please choose Facilities or Other.';
  end if;

  if v_key is null then
    v_base := left(trim(both '_' from regexp_replace(lower(v_short), '[^a-z0-9]+', '_', 'g')), 36);
    if v_base !~ '^[a-z]' then
      v_base := 'c_' || v_base;
    end if;
    v_base := rtrim(v_base, '_');
    v_key := v_base;
    while exists (select 1 from worry_categories where category_key = v_key) loop
      v_n := v_n + 1;
      v_key := v_base || '_' || v_n;
    end loop;
    insert into worry_categories (category_key, label, short_label, area, daily_to_dsl, sort_order, retired,
                                  created_by, updated_by)
    values (v_key, v_label, v_short, p_area, coalesce(p_daily_to_dsl, false),
            coalesce(p_sort_order, (select coalesce(max(sort_order), 0) + 10 from worry_categories)),
            coalesce(p_retired, false), auth.uid(), auth.uid());
  else
    update worry_categories
       set label = v_label, short_label = v_short, area = p_area,
           daily_to_dsl = coalesce(p_daily_to_dsl, false),
           sort_order = coalesce(p_sort_order, sort_order),
           retired = coalesce(p_retired, false),
           updated_at = now(), updated_by = auth.uid()
     where category_key = v_key;
    if not found then
      raise exception 'That category was not found.';
    end if;
  end if;

  if not exists (select 1 from worry_categories where area = 'facilities' and not retired)
     or not exists (select 1 from worry_categories where area = 'other' and not retired) then
    raise exception 'There must always be at least one category in use under Facilities and one under Other, so students can always send a worry.';
  end if;

  return v_key;
end;
$function$;

revoke execute on function public.save_worry_category(text, text, text, text, boolean, integer, boolean) from public, anon;
grant execute on function public.save_worry_category(text, text, text, text, boolean, integer, boolean) to authenticated;

-- 3. Sending, typing in and moving worries check the list ------------------------------------

create or replace function public.send_worry(p_category text, p_details text, p_urgent boolean)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_student integer := my_student_id();
  v_details text := btrim(coalesce(p_details, ''));
  v_id bigint;
begin
  if v_student is null then
    raise exception 'Only students can send a worry from the portal.';
  end if;
  if p_category is null or not exists (select 1 from worry_categories where category_key = p_category and not retired) then
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
$function$;

create or replace function public.record_paper_worry(
  p_student_id integer, p_category text, p_details text, p_urgent boolean, p_received_on date)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_details text := btrim(coalesce(p_details, ''));
  v_id bigint;
begin
  if not can_see_worry_box() then
    raise exception 'Only the DSL, the principal and guidance staff can record worries.';
  end if;
  if p_category is null or not exists (select 1 from worry_categories where category_key = p_category and not retired) then
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
$function$;

create or replace function public.set_worry_category(p_worry_id bigint, p_category text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_old text;
begin
  if not can_see_worry_box() then
    raise exception 'Only the DSL, the principal and guidance staff can change a worry.';
  end if;
  if p_category is null or not exists (select 1 from worry_categories where category_key = p_category and not retired) then
    raise exception 'Please choose what the worry is about.';
  end if;

  select category into v_old from worries where worry_id = p_worry_id for update;
  if not found then
    raise exception 'That worry was not found.';
  end if;
  if v_old = p_category then
    return;
  end if;

  update worries set category = p_category where worry_id = p_worry_id;

  insert into worry_notes (worry_id, kind, note, created_by, created_by_name)
  values (p_worry_id, 'status',
          'Moved from ' || (select short_label from worry_categories where category_key = v_old)
            || ' to ' || (select short_label from worry_categories where category_key = p_category),
          auth.uid(), profile_display_name(auth.uid()));
end;
$function$;

-- 4. The daily emails follow the flags, not the keys ----------------------------------------

do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.send_facilities_worry_list()'::regprocedure);
  if position('where category = ''equipment'' and status <> ''closed''' in v_def) = 0 then
    raise exception 'send_facilities_worry_list() is not as expected; not changed';
  end if;
  execute replace(v_def, 'where category = ''equipment'' and status <> ''closed''',
    'where category in (select category_key from worry_categories where area = ''facilities'') and status <> ''closed''');

  v_def := pg_get_functiondef('public.send_staff_worry_list()'::regprocedure);
  if position('where w.category = ''staff'' and w.status <> ''closed''' in v_def) = 0 then
    raise exception 'send_staff_worry_list() is not as expected; not changed';
  end if;
  execute replace(v_def, 'where w.category = ''staff'' and w.status <> ''closed''',
    'where w.category in (select category_key from worry_categories where daily_to_dsl) and w.status <> ''closed''');
end;
$$;
