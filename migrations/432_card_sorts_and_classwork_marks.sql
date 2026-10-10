-- Migration 432: on-screen card sorts, and classwork columns in the mark sheet.
--
-- Why: the principal, 10 Oct 2026. The Maths department's Lesson 2 card sorts
-- (Word files, docs/card-sort-format.md) are to be done on screen, and every
-- worksheet uploaded for a lesson becomes a column in the teacher's mark
-- sheet. The principal's decisions:
--   * Students work in pairs on one laptop. The signed-in student picks their
--     partner from the class (or works alone); both get the same mark, and
--     neither can do it again.
--   * Check is pressed once. It gives a count ("6 of 8 sets right") and that
--     count is the mark. Students see only that count; marks teachers type
--     in for other worksheets are staff-only.
--   * Classwork marks are not homework: the report's Homework grade, prep
--     time and "not handed in" negatives never read them. They are shown in
--     the mark sheet as Classwork columns.
--
-- Now:
--   * lesson_worksheets.kind: 'file' (428) or 'card_sort'. A card sort keeps
--     its Word file for staff, but students can't open that file (it holds
--     the answer key): the bucket's read rule lets students through only for
--     kind 'file'.
--   * card_sorts (one per card-sort worksheet: headers or sets, instruction,
--     support and extension text, discussion questions, the cards placed by
--     "Help me start"), card_sort_cards (letter, text, picture) and
--     card_sort_key (letter -> header or set). Read the first two wherever the
--     worksheet row is readable, so a student only once their lesson has
--     started. card_sort_key has a staff-only read policy: students never
--     receive the answer key, and checking happens in submit_card_sort().
--     Pictures are in the lesson-worksheets bucket next to the Word file and
--     readable through their card_sort_cards row.
--   * Written once, at upload, by whoever can add the worksheet
--     (can_manage_lesson_worksheet()); removed with the worksheet (cascade).
--   * classwork_marks: one row per (worksheet, student). Card-sort rows are
--     written only by submit_card_sort() (source 'card_sort', with the
--     partner). For other worksheets the teacher types the mark (source
--     'teacher') against lesson_worksheets.max_mark, set with
--     set_worksheet_max_mark(). Read by SMT and whoever teaches or leads the
--     class (as homework marks); a student reads only their own card-sort
--     rows. Teachers can delete a card-sort row so a pair can try again.
--     Logged in grade_history (table 'classwork_marks'; SMT only there, like
--     homework).
--   * class_worksheet_columns() gives the mark sheet its columns: every
--     worksheet on a class's lessons in the dates, with the lesson it falls on.

set local formwork.change_note = 'Principal (direct)';

-- 1. Kinds of worksheet ------------------------------------------------------------------

alter table public.lesson_worksheets
  add column kind text not null default 'file' check (kind in ('file', 'card_sort')),
  add column max_mark numeric check (max_mark is null or max_mark > 0);

-- May the signed-in user manage this worksheet (add its card sort, set its
-- out-of mark)? The same rule as adding and removing it.
create or replace function public.can_manage_lesson_worksheet(p_worksheet_id bigint)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce((
    select case when w.class_id is not null then can_add_lesson_worksheet(w.class_id)
                else can_add_year_worksheet(w.subject_id, w.year_group) end
    from lesson_worksheets w where w.worksheet_id = p_worksheet_id), false);
$$;

revoke execute on function public.can_manage_lesson_worksheet(bigint) from public, anon;
grant execute on function public.can_manage_lesson_worksheet(bigint) to authenticated;

-- 2. Card sorts -----------------------------------------------------------------------------

create table public.card_sorts (
  worksheet_id bigint primary key references public.lesson_worksheets(worksheet_id) on delete cascade,
  sort_type text not null check (sort_type in ('headers', 'sets')),
  title text not null,
  instruction text,
  support_text text,
  extension_text text,
  discuss text[] not null default '{}',
  headers text[],            -- header sorts: the headers, in order
  set_count integer,         -- set sorts: how many sets
  support jsonb not null default '[]'::jsonb,
  -- headers: [{"letter": "N", "header": "Direct proportion"}, …]
  -- sets: [["C", "I", "Q", "T"]] (one set, placed together)
  created_at timestamptz not null default now(),
  check ((sort_type = 'headers' and headers is not null and cardinality(headers) between 2 and 8)
      or (sort_type = 'sets' and set_count between 2 and 30))
);

create table public.card_sort_cards (
  card_id bigint generated always as identity primary key,
  worksheet_id bigint not null references public.card_sorts(worksheet_id) on delete cascade,
  letter text not null check (letter ~ '^[A-Z]{1,2}$'),
  body text,
  image_path text unique,
  image_width integer check (image_width is null or image_width between 1 and 2000), -- px, as on the printed sheet
  position integer not null default 0
);
create unique index card_sort_cards_letter on public.card_sort_cards (worksheet_id, letter);

create table public.card_sort_key (
  key_id bigint generated always as identity primary key,
  worksheet_id bigint not null references public.card_sorts(worksheet_id) on delete cascade,
  letter text not null,
  group_label text not null
);
create unique index card_sort_key_letter on public.card_sort_key (worksheet_id, letter);

alter table public.card_sorts enable row level security;
alter table public.card_sort_cards enable row level security;
alter table public.card_sort_key enable row level security;
grant select, insert on public.card_sorts to authenticated;
grant select, insert on public.card_sort_cards to authenticated;
grant select, insert on public.card_sort_key to authenticated;

-- Readable wherever the worksheet row is (its own policies decide: staff
-- always, students in the class once their lesson has started).
create policy card_sorts_read on public.card_sorts for select to authenticated
  using (exists (select 1 from lesson_worksheets w where w.worksheet_id = card_sorts.worksheet_id));
create policy card_sort_cards_read on public.card_sort_cards for select to authenticated
  using (exists (select 1 from lesson_worksheets w where w.worksheet_id = card_sort_cards.worksheet_id));
-- The answer key: staff only. Students never receive it.
create policy card_sort_key_staff_read on public.card_sort_key for select to authenticated
  using ((select is_staff_or_admin()));

create policy card_sorts_add on public.card_sorts for insert to authenticated
  with check (can_manage_lesson_worksheet(worksheet_id)
    and exists (select 1 from lesson_worksheets w where w.worksheet_id = card_sorts.worksheet_id and w.kind = 'card_sort'));
create policy card_sort_cards_add on public.card_sort_cards for insert to authenticated
  with check (can_manage_lesson_worksheet(worksheet_id));
create policy card_sort_key_add on public.card_sort_key for insert to authenticated
  with check (can_manage_lesson_worksheet(worksheet_id));

-- 3. Files: students can't open a card sort's Word file; card pictures are
-- readable through their card row ---------------------------------------------------------

alter policy lesson_worksheet_files_read on storage.objects
  using (bucket_id = 'lesson-worksheets' and (
    exists (select 1 from lesson_worksheets w
            where w.storage_path = storage.objects.name
              and (w.kind = 'file' or is_staff_or_admin()))
    or exists (select 1 from card_sort_cards c where c.image_path = storage.objects.name)));

-- 4. Classwork marks -------------------------------------------------------------------------

create table public.classwork_marks (
  mark_id bigint generated always as identity primary key,
  worksheet_id bigint not null references public.lesson_worksheets(worksheet_id) on delete cascade,
  class_id integer not null references public.classes(class_id),
  subject_id integer references public.subjects(subject_id),
  student_id integer not null references public.students(student_id),
  score numeric not null check (score >= 0),
  out_of numeric check (out_of is null or out_of > 0),
  source text not null check (source in ('card_sort', 'teacher')),
  partner_student_id integer references public.students(student_id),
  used_help boolean not null default false,
  recorded_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (out_of is null or score <= out_of)
);
create unique index classwork_marks_once on public.classwork_marks (worksheet_id, student_id);
create index classwork_marks_class on public.classwork_marks (class_id);

alter table public.classwork_marks enable row level security;
grant select, insert, update, delete on public.classwork_marks to authenticated;

create policy classwork_marks_staff_read on public.classwork_marks for select to authenticated
  using ((select user_has_staff_role(array['smt'])) or teaches_or_leads_class(class_id, subject_id));
create policy classwork_marks_student_read on public.classwork_marks for select to authenticated
  using (source = 'card_sort' and student_id = (select my_student_id()));

-- Teachers type marks for ordinary worksheets only, on a class the
-- worksheet belongs to; card-sort marks come from submit_card_sort().
create or replace function public.classwork_mark_allowed(p_worksheet_id bigint, p_class_id integer)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select can_add_lesson_worksheet(p_class_id) and exists (
    select 1 from lesson_worksheets w
    join classes c on c.class_id = p_class_id
    where w.worksheet_id = p_worksheet_id
      and (w.class_id = c.class_id
           or (w.class_id is null and w.subject_id = c.subject_id and w.year_group = c.year_group)));
$$;

revoke execute on function public.classwork_mark_allowed(bigint, integer) from public, anon;
grant execute on function public.classwork_mark_allowed(bigint, integer) to authenticated;

create policy classwork_marks_teacher_add on public.classwork_marks for insert to authenticated
  with check (source = 'teacher' and partner_student_id is null and not used_help
    and classwork_mark_allowed(worksheet_id, class_id)
    and exists (select 1 from lesson_worksheets w where w.worksheet_id = classwork_marks.worksheet_id and w.kind = 'file'));
create policy classwork_marks_teacher_edit on public.classwork_marks for update to authenticated
  using (source = 'teacher' and classwork_mark_allowed(worksheet_id, class_id))
  with check (source = 'teacher' and partner_student_id is null and not used_help
    and classwork_mark_allowed(worksheet_id, class_id));
-- Removing a card-sort mark lets that pair do it again.
create policy classwork_marks_teacher_remove on public.classwork_marks for delete to authenticated
  using (classwork_mark_allowed(worksheet_id, class_id));

-- A teacher's mark: subject and out-of come from the worksheet and class,
-- never the request.
create or replace function public.classwork_marks_prepare()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_max numeric;
begin
  if tg_op = 'UPDATE' then
    new.worksheet_id := old.worksheet_id;
    new.class_id := old.class_id;
    new.student_id := old.student_id;
    new.source := old.source;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  select c.subject_id into new.subject_id from classes c where c.class_id = new.class_id;
  if new.source = 'teacher' then
    select w.max_mark into v_max from lesson_worksheets w where w.worksheet_id = new.worksheet_id;
    if v_max is null then
      raise exception 'Set what this worksheet is marked out of before entering marks.';
    end if;
    new.out_of := v_max;
    if new.score > v_max then
      raise exception 'A mark can''t be more than %.', v_max;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.classwork_marks_prepare() from public, anon, authenticated;

create trigger trg_classwork_marks_prepare before insert or update on public.classwork_marks
  for each row execute function public.classwork_marks_prepare();
create trigger trg_stamp_recorded_by before insert or update on public.classwork_marks
  for each row execute function public.stamp_actor('recorded_by');

-- Grade history: classwork marks are logged like homework marks.
alter table public.grade_history drop constraint grade_history_table_name_check;
alter table public.grade_history add constraint grade_history_table_name_check check (table_name = any (array[
  'results', 'target_grades', 'transcript_grades', 'homework_marks', 'student_group_marks', 'classwork_marks']));

create or replace function public.log_grade_change()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_grade_col text := case tg_table_name when 'target_grades' then 'target_grade' else 'grade' end;
  v_key jsonb;
  v_staff_id integer;
  v_role text;
begin
  if tg_op = 'UPDATE'
     and (v_old - 'updated_at' - 'updated_by') = (v_new - 'updated_at' - 'updated_by') then
    return new;
  end if;

  v_key := case tg_table_name
    when 'results' then jsonb_build_object('result_id', v_row->'result_id')
    when 'transcript_grades' then jsonb_build_object(
      'student_id', v_row->'student_id', 'subject_id', v_row->'subject_id',
      'year_group', v_row->'year_group', 'term_number', v_row->'term_number')
    when 'homework_marks' then jsonb_build_object(
      'homework_id', v_row->'homework_id', 'student_id', v_row->'student_id')
    when 'student_group_marks' then jsonb_build_object(
      'sheet_id', v_row->'sheet_id', 'student_id', v_row->'student_id')
    when 'classwork_marks' then jsonb_build_object(
      'worksheet_id', v_row->'worksheet_id', 'student_id', v_row->'student_id')
    else jsonb_build_object('student_id', v_row->'student_id', 'subject_id', v_row->'subject_id')
  end;

  select p.staff_id, p.role into v_staff_id, v_role from profiles p where p.id = auth.uid();

  insert into grade_history (
    table_name, action, student_id, subject_id, record_key,
    old_grade, new_grade, old_score, new_score, old_row, new_row,
    changed_by, changed_by_staff_id, changed_by_role, changed_by_name, note
  ) values (
    tg_table_name, tg_op,
    (v_row->>'student_id')::integer, (v_row->>'subject_id')::integer, v_key,
    v_old->>v_grade_col, v_new->>v_grade_col,
    (v_old->>'score')::numeric, (v_new->>'score')::numeric,
    v_old, v_new,
    auth.uid(), v_staff_id, v_role, profile_display_name(auth.uid()),
    case when auth.uid() is null then nullif(current_setting('formwork.change_note', true), '') end
  );

  return coalesce(new, old);
end;
$function$;

create trigger trg_log_grade_change after insert or update or delete on public.classwork_marks
  for each row execute function public.log_grade_change();

alter policy grade_history_read on public.grade_history
  using (user_has_staff_role(array['smt', 'assessment_manager'])
    and (table_name <> all (array['homework_marks', 'student_group_marks', 'classwork_marks'])
         or user_has_staff_role(array['smt'])));

-- What an ordinary worksheet is marked out of (null = not marked). Changing
-- it updates the out-of on marks already typed, and can't go below one.
create or replace function public.set_worksheet_max_mark(p_worksheet_id bigint, p_max numeric)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not can_manage_lesson_worksheet(p_worksheet_id) then
    raise exception 'Only the class''s teachers, the Head of Department or an admin can do that.';
  end if;
  if not exists (select 1 from lesson_worksheets w where w.worksheet_id = p_worksheet_id and w.kind = 'file') then
    raise exception 'A card sort is marked by its own check.';
  end if;
  if p_max is not null and p_max <= 0 then
    raise exception 'The out-of mark must be more than 0.';
  end if;
  if p_max is not null and exists (select 1 from classwork_marks m where m.worksheet_id = p_worksheet_id and m.score > p_max) then
    raise exception 'Some marks are already higher than %.', p_max;
  end if;
  if p_max is null and exists (select 1 from classwork_marks m where m.worksheet_id = p_worksheet_id) then
    raise exception 'Remove the marks before clearing the out-of mark.';
  end if;
  update lesson_worksheets set max_mark = p_max where worksheet_id = p_worksheet_id;
  update classwork_marks set out_of = p_max where worksheet_id = p_worksheet_id and source = 'teacher';
end;
$$;

revoke execute on function public.set_worksheet_max_mark(bigint, numeric) from public, anon;
grant execute on function public.set_worksheet_max_mark(bigint, numeric) to authenticated;

-- 5. Doing a card sort -----------------------------------------------------------------------

-- The class through which the signed-in student (or p_student) has this
-- worksheet open now, or null: the worksheet's class, or for a year
-- worksheet their class of that subject and year; joined by the lesson
-- date, and the lesson has started.
create or replace function public.card_sort_class_for(p_worksheet_id bigint, p_student integer)
returns integer
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select c.class_id
  from lesson_worksheets w
  join student_class sc on sc.student_id = p_student
  join classes c on c.class_id = sc.class_id
  cross join lateral (
    select case when w.class_id is not null then w.lesson_date else l.lesson_date end as lesson_date,
           case when w.class_id is not null then class_lesson_start(w.class_id, w.lesson_date, w.period_number)
                else l.starts_at end as starts_at
    from (select null) x
    left join lateral class_nth_lesson(c.class_id, w.week_start, w.lesson_number) l on w.class_id is null
  ) lesson
  where w.worksheet_id = p_worksheet_id
    and (w.class_id = c.class_id
         or (w.class_id is null and c.subject_id = w.subject_id and c.year_group = w.year_group))
    and lesson.starts_at is not null
    and lesson.starts_at <= school_now()
    and coalesce(sc.joined_on, lesson.lesson_date) <= lesson.lesson_date
  limit 1;
$$;

revoke execute on function public.card_sort_class_for(bigint, integer) from public, anon, authenticated;

-- Classmates the signed-in student can pick as their partner: in the same
-- class for this card sort, active, and without a mark for it yet.
create or replace function public.card_sort_partners(p_worksheet_id bigint)
returns table (student_id integer, name text)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  with me as (select my_student_id() as id),
  cls as (select card_sort_class_for(p_worksheet_id, me.id) as class_id from me)
  select s.student_id, s.first_name || ' ' || s.last_name
  from cls
  join student_class sc on sc.class_id = cls.class_id
  join students s on s.student_id = sc.student_id
  cross join me
  where cls.class_id is not null
    and s.status = 'active'
    and s.student_id <> me.id
    and card_sort_class_for(p_worksheet_id, s.student_id) = cls.class_id
    and not exists (select 1 from classwork_marks m where m.worksheet_id = p_worksheet_id and m.student_id = s.student_id)
  order by s.first_name, s.last_name;
$$;

revoke execute on function public.card_sort_partners(bigint) from public, anon;
grant execute on function public.card_sort_partners(bigint) to authenticated;

-- Check a card sort, once. p_answer for a header sort:
--   {"A": "Direct proportion", "B": "Neither", …}
-- and for a set sort: [["A", "C", "F"], ["B", "D", "E"], …].
-- The mark is the number of cards under the right header, or the number of
-- sets exactly right. Both students get it. Returns score and out_of.
create or replace function public.submit_card_sort(
  p_worksheet_id bigint, p_partner_id integer, p_answer jsonb, p_used_help boolean)
returns table (score integer, out_of integer)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_me integer := my_student_id();
  v_class integer;
  v_sort card_sorts%rowtype;
  v_score integer := 0;
  v_out integer;
  v_set jsonb;
begin
  if v_me is null then
    raise exception 'Only students can do a card sort.';
  end if;
  select * into v_sort from card_sorts where worksheet_id = p_worksheet_id;
  if not found then
    raise exception 'That card sort wasn''t found.';
  end if;
  v_class := card_sort_class_for(p_worksheet_id, v_me);
  if v_class is null then
    raise exception 'This card sort isn''t open for you yet.';
  end if;
  if exists (select 1 from classwork_marks m where m.worksheet_id = p_worksheet_id and m.student_id = v_me) then
    raise exception 'You have already checked this card sort.';
  end if;
  if p_partner_id is not null then
    if p_partner_id = v_me then
      raise exception 'Choose someone else as your partner.';
    end if;
    if card_sort_class_for(p_worksheet_id, p_partner_id) is distinct from v_class
       or not exists (select 1 from students s where s.student_id = p_partner_id and s.status = 'active') then
      raise exception 'Your partner must be in this class.';
    end if;
    if exists (select 1 from classwork_marks m where m.worksheet_id = p_worksheet_id and m.student_id = p_partner_id) then
      raise exception 'Your partner has already done this card sort.';
    end if;
  end if;

  if v_sort.sort_type = 'headers' then
    if jsonb_typeof(p_answer) <> 'object' then
      raise exception 'The answer wasn''t in the right form.';
    end if;
    select count(*) into v_out from card_sort_key k where k.worksheet_id = p_worksheet_id;
    select count(*) into v_score
    from card_sort_key k
    where k.worksheet_id = p_worksheet_id and p_answer ->> k.letter = k.group_label;
  else
    if jsonb_typeof(p_answer) <> 'array' then
      raise exception 'The answer wasn''t in the right form.';
    end if;
    select count(distinct group_label) into v_out from card_sort_key k where k.worksheet_id = p_worksheet_id;
    -- A set is right when its cards are exactly one set of the answer key.
    for v_set in select value from jsonb_array_elements(p_answer) loop
      if jsonb_typeof(v_set) = 'array' and jsonb_array_length(v_set) > 0 and exists (
        select 1 from card_sort_key k
        where k.worksheet_id = p_worksheet_id
        group by k.group_label
        having array_agg(k.letter order by k.letter) =
          (select array_agg(distinct e order by e) from jsonb_array_elements_text(v_set) e)
           and count(*) = jsonb_array_length(v_set)) then
        v_score := v_score + 1;
      end if;
    end loop;
    v_score := least(v_score, v_out);
  end if;

  insert into classwork_marks (worksheet_id, class_id, student_id, score, out_of, source, partner_student_id, used_help)
  values (p_worksheet_id, v_class, v_me, v_score, v_out, 'card_sort', p_partner_id, coalesce(p_used_help, false));
  if p_partner_id is not null then
    insert into classwork_marks (worksheet_id, class_id, student_id, score, out_of, source, partner_student_id, used_help)
    values (p_worksheet_id, v_class, p_partner_id, v_score, v_out, 'card_sort', v_me, coalesce(p_used_help, false));
  end if;

  return query select v_score, v_out;
exception when unique_violation then
  raise exception 'This card sort has already been checked.';
end;
$$;

revoke execute on function public.submit_card_sort(bigint, integer, jsonb, boolean) from public, anon;
grant execute on function public.submit_card_sort(bigint, integer, jsonb, boolean) to authenticated;

-- 6. For the timetable and the mark sheet ----------------------------------------------------

-- As my_lesson_worksheets() (431), with each worksheet's kind and the
-- student's card-sort mark. A card sort's Word file path is never returned.
create or replace function public.my_timetable_worksheets(p_from date, p_to date)
returns table (worksheet_id bigint, class_id integer, lesson_date date, period_number integer,
               opens_at timestamp, is_open boolean, title text, storage_path text, size_bytes bigint,
               kind text, my_score numeric, my_out_of numeric)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select l.worksheet_id, l.class_id, l.lesson_date, l.period_number, l.opens_at, l.is_open,
         l.title,
         case when w.kind = 'file' then l.storage_path end,
         case when w.kind = 'file' then l.size_bytes end,
         w.kind, m.score, m.out_of
  from my_lesson_worksheets(p_from, p_to) l
  join lesson_worksheets w on w.worksheet_id = l.worksheet_id
  left join classwork_marks m on m.worksheet_id = l.worksheet_id and m.student_id = my_student_id();
$$;

revoke execute on function public.my_timetable_worksheets(date, date) from public, anon;
grant execute on function public.my_timetable_worksheets(date, date) to authenticated;

-- Staff: the worksheets on a class's lessons between two dates, one per
-- column of the mark sheet, with the lesson each falls on.
create or replace function public.class_worksheet_columns(p_class_id integer, p_from date, p_to date)
returns table (worksheet_id bigint, title text, kind text, lesson_date date, period_number integer,
               max_mark numeric, card_out_of integer)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select w.worksheet_id, w.title, w.kind, x.lesson_date, x.period_number, w.max_mark,
         case when w.kind = 'card_sort' then (
           select case cs.sort_type when 'headers' then (select count(*)::integer from card_sort_key k where k.worksheet_id = w.worksheet_id)
                                    else cs.set_count end
           from card_sorts cs where cs.worksheet_id = w.worksheet_id) end
  from classes c
  join lesson_worksheets w
    on w.class_id = c.class_id
    or (w.class_id is null and w.subject_id = c.subject_id and w.year_group = c.year_group)
  cross join lateral (
    select w.lesson_date, w.period_number where w.class_id is not null
    union all
    select l.lesson_date, l.period_number
    from class_nth_lesson(c.class_id, w.week_start, w.lesson_number) l
    where w.class_id is null
  ) x
  where c.class_id = p_class_id
    and is_staff_or_admin()
    and x.lesson_date between p_from and p_to
  order by x.lesson_date, x.period_number, w.worksheet_id;
$$;

revoke execute on function public.class_worksheet_columns(integer, date, date) from public, anon;
grant execute on function public.class_worksheet_columns(integer, date, date) to authenticated;
