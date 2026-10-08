-- Migration 407: the Worry Box split into Facilities and Other.
--
-- Why (the principal, 8 Oct 2026): "Can the worry box be sorted into
-- facilities and other. If entries in future can make a choice to show".
-- Of the first 58 worries, 18 were about equipment, rooms, food or
-- facilities, mixed in with bullying, feelings and home; some of the 15
-- "something else" ones are facilities too.
--
--   * Facilities is the existing category 'equipment' (no new column, no
--     change to the check constraint); every other category is Other. The
--     page sorts on that (lib/worries.js, worryArea()).
--   * Students choose first: Facilities, or something else (and then which
--     kind). That is the page; send_worry() is unchanged.
--   * Worries filed under the wrong heading are moved by whoever reads the
--     Worry Box (can_see_worry_box(): DSL, principal, guidance) with
--     set_worry_category(), which records a status note saying who moved it
--     from what to what. Nothing else about the worry changes; the student's
--     own view shows the new heading.

set local formwork.change_note = 'Principal (direct)';

create or replace function public.set_worry_category(p_worry_id bigint, p_category text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_old text;
  v_label constant jsonb := jsonb_build_object(
    'bullying', 'Bullying / friends', 'staff', 'A member of staff', 'feelings', 'Feelings',
    'home', 'Home / family', 'boarding', 'Boarding', 'equipment', 'Facilities', 'other', 'Something else');
begin
  if not can_see_worry_box() then
    raise exception 'Only the DSL, the principal and guidance staff can change a worry.';
  end if;
  if p_category is null or p_category not in ('bullying', 'staff', 'feelings', 'home', 'boarding', 'equipment', 'other') then
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
  values (p_worry_id, 'status', 'Moved from ' || (v_label ->> v_old) || ' to ' || (v_label ->> p_category),
          auth.uid(), profile_display_name(auth.uid()));
end;
$$;

revoke execute on function public.set_worry_category(bigint, text) from public, anon;
grant execute on function public.set_worry_category(bigint, text) to authenticated;
