-- Migration 304: parents must never see the names of the other students in a
-- behaviour event.
--
-- Why (the principal, 1 Oct 2026, on migration 303): "Parents must not see
-- these names". behaviour_event_students itself has no parent or student
-- policy, so the list never reaches a portal. The way a name could still
-- reach a parent is the event's explanation: a serious event's text is
-- released to the student's parents once reviewed (review_serious_behaviour_
-- event(), review_behaviour_for_parents()), and staff_update_behaviour lets
-- staff write behaviour_events directly. So the rule is enforced on the data,
-- whichever way it is reached:
--   1. behaviour_text_names_other_student(event_id, text) returns the first
--      name word of a linked student that appears in the text as a whole word
--      (first, last, preferred, legal first and legal last names, words of
--      3+ letters, any case). Words that are also in the event's own
--      student's names are ignored, so a sibling's shared surname doesn't
--      block the student's own name.
--   2. An event that parents can see (visible_to_parents) can't have its
--      explanation changed to, or be released with, such a name.
--   3. A student can't be linked to an event parents can already see if the
--      explanation names them.
-- The refusal names the word so the reviewer or teacher can reword it.

set local formwork.change_note = 'Principal (direct)';

create or replace function public.behaviour_text_names_other_student(p_event_id integer, p_text text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with own as (
    select lower(w) as w
    from behaviour_events e
    join students s on s.student_id = e.student_id,
    lateral regexp_split_to_table(
      concat_ws(' ', s.first_name, s.last_name, s.preferred_name, s.legal_first_name, s.legal_last_name), '[^[:alpha:]]+') w
    where e.event_id = p_event_id
  ),
  words as (
    select distinct lower(w) as w
    from behaviour_event_students l
    join students s on s.student_id = l.student_id,
    lateral regexp_split_to_table(
      concat_ws(' ', s.first_name, s.last_name, s.preferred_name, s.legal_first_name, s.legal_last_name), '[^[:alpha:]]+') w
    where l.event_id = p_event_id
      and length(w) >= 3
  )
  select w.w
  from words w
  where p_text is not null
    and not exists (select 1 from own o where o.w = w.w)
    and lower(p_text) ~ ('\m' || w.w || '\M')
  order by w.w
  limit 1;
$$;

revoke execute on function public.behaviour_text_names_other_student(integer, text) from public, anon;
grant execute on function public.behaviour_text_names_other_student(integer, text) to authenticated;

-- 2. Releasing or editing an event parents can see -------------------------------------

create or replace function public.behaviour_event_no_other_names_for_parents()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_word text;
begin
  if new.visible_to_parents then
    v_word := behaviour_text_names_other_student(new.event_id, new.description);
    if v_word is not null then
      raise exception 'Parents can see this event, and its explanation names another student in it ("%"). Reword the explanation without naming them.', v_word
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.behaviour_event_no_other_names_for_parents() from public, anon, authenticated;

create trigger behaviour_event_no_other_names_for_parents
  before update of visible_to_parents, description on public.behaviour_events
  for each row execute function public.behaviour_event_no_other_names_for_parents();

-- 3. Linking a student to an event parents can already see -------------------------------

create or replace function public.behaviour_event_students_not_named_for_parents()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event behaviour_events%rowtype;
  v_word text;
begin
  select * into v_event from behaviour_events where event_id = new.event_id;
  if v_event.visible_to_parents then
    v_word := behaviour_text_names_other_student(new.event_id, v_event.description);
    if v_word is not null then
      raise exception 'Parents can see this event, and its explanation names this student ("%"). Reword the explanation first.', v_word
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.behaviour_event_students_not_named_for_parents() from public, anon, authenticated;

-- AFTER, so the new link is visible to behaviour_text_names_other_student().
create trigger behaviour_event_students_not_named_for_parents
  after insert on public.behaviour_event_students
  for each row execute function public.behaviour_event_students_not_named_for_parents();
