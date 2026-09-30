-- Migration 290: a homework title is at most 10 characters.
--
-- Why: the principal asked (30 Sept 2026) for titles short enough to read as
-- column headings on the class mark sheet, and chose to limit the title
-- itself rather than add a separate short name. Students see the same short
-- title; the instructions carry the detail.
--
-- Now: a new homework, or a change to a title, is refused if the title is
-- longer than 10 characters (after trimming spaces). Titles saved before
-- this (two, both longer) stay as they are until someone edits them; the
-- mark sheet cuts them to 10. The table's existing check (1-200) stays, so
-- no saved row is touched.

set local formwork.change_note = 'Principal (direct)';

create or replace function public.homework_title_length()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if (tg_op = 'INSERT' or new.title is distinct from old.title)
     and char_length(btrim(new.title)) > 10 then
    raise exception 'A homework title can be at most 10 characters (this one has %). Put the detail in the instructions.',
      char_length(btrim(new.title));
  end if;
  return new;
end;
$$;

create trigger trg_homework_title_length before insert or update of title on public.homework
  for each row execute function public.homework_title_length();
