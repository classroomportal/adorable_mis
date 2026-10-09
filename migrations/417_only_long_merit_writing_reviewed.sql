-- Migration 417: only a merit with long writing waits for approval.
--
-- Why (the principal, 9 Oct 2026): "Too many merits to approve. I should
-- only review ones with extra written long comments." Since 387 every merit
-- with any writing waited under "Writing to approve": 1,090 in 7-9 Oct,
-- nearly all short notes such as "Good use of prep time" (half were 7 words
-- or fewer; none was over 20).
--
-- The principal's choices:
--   * a merit waits only when its writing is longer than 12 words (about 80
--     of those 1,090, some 27 a day); a shorter one goes home at once, as a
--     merit with no writing does;
--   * the number is editable on /admin/lookups (behaviour_rules.
--     merit_review_words, through set_merit_review_words()); 0 means every
--     merit with writing waits, as under 387.
-- Negative events are unchanged: any writing on a Stage 1-4 event is still
-- approved before it goes home, and Stage 5 is reviewed as before.
--
-- What changes:
--   1. behaviour_word_count() and behaviour_writing_needs_review(type, text):
--      the one rule, used by the three below.
--   2. set_behaviour_event_default_visibility(): a new merit is shown to
--      parents unless its writing needs review.
--   3. behaviour_event_text_needs_review(): editing a merit's writing sends
--      it back only when the new writing is long; short new writing keeps
--      what the event had (a merit not yet reviewed goes home).
--   4. behaviour_event_release_guard(): a merit with short writing may be
--      logged visible (the default trigger sets it, the app can't).
--   5. Merits already waiting with 12 words or fewer, not reviewed, are
--      sent home now (5 when this was written).
-- review_behaviour_for_parents() is unchanged: it can still send or keep
-- back a short merit if one is ever put to it.

set local formwork.change_note = 'Principal (direct)';

alter table public.behaviour_rules
  add column merit_review_words integer not null default 12
    constraint behaviour_rules_merit_review_words_check check (merit_review_words between 0 and 500);

comment on column public.behaviour_rules.merit_review_words is
  'Migration 417: a merit whose writing has more words than this waits for approval before parents see it; 0 = any writing waits.';

-- 1. The rule.
create or replace function public.behaviour_word_count(p_text text)
returns integer
language sql
immutable
as $$
  select case when behaviour_has_writing(p_text)
    then cardinality(regexp_split_to_array(btrim(p_text, E' \t\r\n '), E'[\\s ]+'))
    else 0 end;
$$;

create or replace function public.behaviour_writing_needs_review(p_type text, p_text text)
returns boolean
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select case
    when not behaviour_has_writing(p_text) then false
    when p_type = 'positive' then
      behaviour_word_count(p_text) > coalesce((select merit_review_words from behaviour_rules where id), 12)
    else true
  end;
$$;

-- 2. New events.
create or replace function public.set_behaviour_event_default_visibility()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  -- Migrations 387 and 417: a merit with long writing waits for the review.
  if new.type = 'positive' then
    new.visible_to_parents := not behaviour_writing_needs_review(new.type, new.description);
  end if;
  return new;
end;
$function$;

-- 3. Edited writing.
create or replace function public.behaviour_event_text_needs_review()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.description is not distinct from old.description then
    return new;
  end if;

  if behaviour_writing_needs_review(new.type, new.description) then
    new.visible_to_parents := false;
    new.protocol_reviewed_by := null;
    new.protocol_reviewed_at := null;
  else
    new.visible_to_parents := old.visible_to_parents
      or (new.type = 'positive' and old.protocol_reviewed_at is null);
    new.protocol_reviewed_by := old.protocol_reviewed_by;
    new.protocol_reviewed_at := old.protocol_reviewed_at;
  end if;
  return new;
end;
$function$;

revoke execute on function public.behaviour_event_text_needs_review() from public, anon, authenticated;

-- 4. The guard.
create or replace function public.behaviour_event_release_guard()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  -- The review and edit functions run as their owner, and the SQL editor as
  -- postgres; only requests from the app arrive as 'authenticated'.
  if current_user <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.type = 'negative'
       and (new.visible_to_parents or new.protocol_reviewed_by is not null or new.protocol_reviewed_at is not null) then
      raise exception 'A negative behaviour event starts hidden from parents; it is released through the review.'
        using errcode = 'insufficient_privilege';
    end if;
    -- Migrations 387 and 417: writing that needs approval is approved before
    -- it goes home (for a merit, only long writing). The app can't log an
    -- event as already reviewed.
    if (behaviour_writing_needs_review(new.type, new.description) and new.visible_to_parents)
       or (behaviour_has_writing(new.description)
           and (new.protocol_reviewed_by is not null or new.protocol_reviewed_at is not null)) then
      raise exception 'A behaviour event with writing starts hidden from parents; it is released through the review.'
        using errcode = 'insufficient_privilege';
    end if;
    if new.voided_at is not null or new.voided_points is not null then
      raise exception 'A behaviour event can''t be logged as withdrawn.'
        using errcode = 'insufficient_privilege';
    end if;
    if new.returned_at is not null or new.returned_by is not null or new.return_note is not null then
      raise exception 'A behaviour event can''t be logged as returned to the teacher.'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  -- Migration 387: when the writing changes, behaviour_event_a_text_needs_review
  -- has already set who sees it, from the old row, not the request.
  if (new.description is not distinct from old.description
      and (new.visible_to_parents is distinct from old.visible_to_parents
           or new.protocol_reviewed_by is distinct from old.protocol_reviewed_by
           or new.protocol_reviewed_at is distinct from old.protocol_reviewed_at))
     or new.type is distinct from old.type then
    raise exception 'Whether parents see a behaviour event is decided through the review at /behaviour/review, and an event''s type can''t be changed.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Migration 319: removing an event is SMT's (delete), or an upheld appeal's.
  if new.voided_at is distinct from old.voided_at
     or new.voided_points is distinct from old.voided_points
     or new.student_id is distinct from old.student_id then
    raise exception 'A behaviour event can''t be withdrawn or moved to another student here. Only SMT can remove one.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Migration 335: returning an event is the reviewer's, through the review.
  if new.returned_at is distinct from old.returned_at
     or new.returned_by is distinct from old.returned_by
     or new.return_note is distinct from old.return_note then
    raise exception 'An event is returned to the teacher only from Behaviour Review.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$function$;

-- The setter, for /admin/lookups.
create or replace function public.set_merit_review_words(p_words integer)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not has_resource_access('/admin/lookups') then
    raise exception 'Only staff with the Lookups page can change behaviour rules.';
  end if;
  if p_words is null or p_words < 0 or p_words > 500 then
    raise exception 'Give a number of words from 0 to 500.';
  end if;
  update behaviour_rules set
    merit_review_words = p_words,
    updated_by = auth.uid(),
    updated_at = now()
  where id;
end;
$function$;

revoke execute on function public.set_merit_review_words(integer) from public, anon;
grant execute on function public.set_merit_review_words(integer) to authenticated;

-- 5. Short merits already waiting go home.
update public.behaviour_events
set visible_to_parents = true
where type = 'positive'
  and voided_at is null
  and returned_at is null
  and not visible_to_parents
  and protocol_reviewed_at is null
  and behaviour_has_writing(description)
  and not behaviour_writing_needs_review(type, description);
