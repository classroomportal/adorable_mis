-- Migration 412: only the DSL and the principal edit the Worry Box categories.
--
-- Why (the principal, 8 Oct 2026, after migration 411): "Osione no edit".
-- Migration 411 let every Worry Box reader (can_see_worry_box(): DSL,
-- principal and guidance) save categories. Guidance staff still read and work
-- every worry; they just don't change the list. save_worry_category() now
-- checks can_read_worries() (holders of dsl or principal, so admin is not
-- enough), and the Lookups section shows only to those two. Nothing else in
-- 411 changes.

do $$
declare
  v_def text := pg_get_functiondef(
    'public.save_worry_category(text, text, text, text, boolean, integer, boolean)'::regprocedure);
  v_old text := 'if not can_see_worry_box() then
    raise exception ''Only the DSL, the principal and guidance staff can change the Worry Box categories.'';';
begin
  if position(v_old in v_def) = 0 then
    raise exception 'save_worry_category() is not as expected; not changed';
  end if;
  execute replace(v_def, v_old, 'if not can_read_worries() then
    raise exception ''Only the DSL and the principal can change the Worry Box categories.'';');
end;
$$;
