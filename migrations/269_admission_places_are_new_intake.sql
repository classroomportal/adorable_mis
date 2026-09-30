-- Migration 269: admission_places counts new intake, not the whole year.
--
-- Why: the principal set the places for 2027/28 as the new boys and girls
-- to admit into each year (11 + 11 into Year 7, none elsewhere), and
-- Next Year's Numbers read them as each year group's total size, taking
-- off the students moving up and showing large negative "places free"
-- (30 Sept 2026). The principal confirmed the places are the new intake;
-- /admissions/projections now reads them that way. No data changes, only
-- the descriptions.

set local formwork.change_note = 'Principal (direct)';

comment on table public.admission_places is
  'New intake places per year group and gender for an academic year (migrations 266, 269): how many NEW boys and girls the school will admit, not the whole year group. Read by /admissions/projections; set by /admissions/places holders.';
comment on column public.admission_places.boys_allowed is 'New boys to admit into this year group (not counting students moving up). NULL = not set.';
comment on column public.admission_places.girls_allowed is 'New girls to admit into this year group (not counting students moving up). NULL = not set.';
