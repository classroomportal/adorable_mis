-- Migration 336: SMT can review a Stage 5 that has no picture.
--
-- Why (the principal, 3 Oct 2026): "my PA (Maryanne) and SMT are the only
-- people who review stage 5". Until now a serious event without a picture
-- could be sent to parents (review_behaviour_for_parents(),
-- review_serious_behaviour_event()) or returned to the teacher
-- (return_behaviour_event_to_teacher(), migration 335) only by the school
-- office or admin, so SMT were refused. Maryanne (pa2@) reviews through her
-- school_office role and reaches /behaviour/review through hr; the other
-- school office staff can't open the page, which is as the principal wants.
--
-- Each function's no-picture check now accepts school_office or smt. Events
-- with a picture stay SMT and admin only. Applied through the connector by
-- editing the live definitions in place (the one line each), so nothing
-- else in them changes; it refuses to run if that line isn't found.

set local formwork.change_note = 'Principal (direct)';

do $$
declare f text; d text; n text;
begin
  foreach f in array array[
    'review_serious_behaviour_event(integer,boolean,boolean)',
    'review_behaviour_for_parents(integer[],boolean,boolean,boolean)',
    'return_behaviour_event_to_teacher(integer,text)'] loop
    d := pg_get_functiondef(('public.' || f)::regprocedure);
    n := replace(d, 'has_staff_role(array[''school_office''])) then',
                    'has_staff_role(array[''school_office'', ''smt''])) then');
    n := replace(n, 'Only school office staff or admin', 'Only the school office, SMT or admin');
    if n = d then
      raise exception 'Migration 336: the school-office check was not found in %', f;
    end if;
    execute n;
  end loop;
end $$;
