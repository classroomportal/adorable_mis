-- Migration 393: a wellbeing check-in must be done by the end of the week.
--
-- Why (the principal, 7 Oct 2026, on merging 392): "it must be done by the
-- end of the week", after "students could hide the pop up ... till Thursday
-- - big tests on Friday". So a round can say from which day the pop-up can
-- no longer be put off:
--   * wellbeing_rounds.must_answer_from (null = "Not now" is always allowed).
--     From that day the pop-up has no "Not now", and
--     snooze_wellbeing_check_in() refuses.
--   * my_wellbeing_prompt() replaces my_wellbeing_check_in() for the pop-up
--     (it adds can_snooze; a function's columns can't change in place).
--   * set_wellbeing_round_must_answer() for the DSL and the principal on
--     /wellbeing.
--   * The first round now closes at the end of Friday 9 Oct 2026, and can be
--     put off only until Thursday 8 Oct.

set local formwork.change_note = 'Principal (direct)';

alter table public.wellbeing_rounds add column must_answer_from date;

create or replace function public.my_wellbeing_prompt()
returns table (round_id integer, round_name text, closes_on date, show_now boolean, can_snooze boolean)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select r.round_id, r.name, r.closes_on,
         (r.must_answer_from is not null and school_today() >= r.must_answer_from)
         or not exists (select 1 from wellbeing_snoozes z
                        where z.round_id = r.round_id and z.student_id = my_student_id()
                          and z.snoozed_until > now()),
         not (r.must_answer_from is not null and school_today() >= r.must_answer_from)
  from wellbeing_rounds r
  join students s on s.student_id = my_student_id() and s.status = 'active'
  where r.round_id = wellbeing_open_round()
    and not exists (select 1 from wellbeing_check_ins c
                    where c.round_id = r.round_id and c.student_id = s.student_id);
$$;

revoke execute on function public.my_wellbeing_prompt() from public, anon;
grant execute on function public.my_wellbeing_prompt() to authenticated;

create or replace function public.snooze_wellbeing_check_in()
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_student integer := my_student_id();
  v_round wellbeing_rounds%rowtype;
begin
  select * into v_round from wellbeing_rounds where round_id = wellbeing_open_round();
  if v_student is null or not found then
    return;
  end if;
  if v_round.must_answer_from is not null and school_today() >= v_round.must_answer_from then
    raise exception 'The check-in can''t be put off any longer: please answer it now. It closes at the end of %.', to_char(v_round.closes_on, 'FMDay DD/MM');
  end if;
  insert into wellbeing_snoozes (round_id, student_id, snoozed_until)
  values (v_round.round_id, v_student, ((school_today() + 1)::timestamp at time zone 'Africa/Lagos'))
  on conflict (round_id, student_id) do update set snoozed_until = excluded.snoozed_until;
end;
$$;

create or replace function public.set_wellbeing_round_must_answer(p_round_id integer, p_must_answer_from date)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not can_read_worries() then
    raise exception 'Only the DSL and the principal can set check-in dates.';
  end if;
  update wellbeing_rounds set must_answer_from = p_must_answer_from
  where round_id = p_round_id and cancelled_at is null;
end;
$$;

revoke execute on function public.set_wellbeing_round_must_answer(integer, date) from public, anon;
grant execute on function public.set_wellbeing_round_must_answer(integer, date) to authenticated;

update public.wellbeing_rounds set closes_on = date '2026-10-09', must_answer_from = date '2026-10-08'
where round_id = 1;
