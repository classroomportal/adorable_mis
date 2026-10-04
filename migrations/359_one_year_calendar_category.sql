-- Migration 359: special result sets are made with the "One Year" calendar
-- category.
--
-- Why (the principal, 4 Oct 2026, looking at the Add event form on a phone):
-- "There should be a choice here: One Year." Migration 358 hid the special
-- option behind the Result set tick, where it was easy to miss. Now the
-- category is the way in: choosing One Year shows the year-group ticks and
-- makes the event a result set.
--
-- The category and the year list mean the same thing, so the database keeps
-- them together: an event is 'one_year' exactly when it has
-- special_year_groups (migration 358's check still requires such an event
-- to be a result set and never an exam set). No event had either when this
-- was written, so nothing needs moving. calendar_events_one_year_check was
-- applied through the connector first; the category list in the SQL editor.

set local formwork.change_note = 'Principal (direct)';

-- The category list is a check constraint; one_year joins it. (Run in the
-- SQL editor: the connector holds back any statement with drop.)
alter table public.calendar_events drop constraint calendar_events_category_check;
alter table public.calendar_events add constraint calendar_events_category_check
  check (category = any (array['term_boundary', 'relp', 'exam', 'one_year', 'teacher_assessment', 'consult_day',
                               'awareness_day', 'holiday', 'other', 'report_period']));

alter table public.calendar_events add constraint calendar_events_one_year_check
  check ((category = 'one_year') = (special_year_groups is not null));

comment on column public.calendar_events.special_year_groups is
  'Set on a One Year event (category one_year), a special result set such as Year 12 mocks (migrations 358-359): the '
  'year groups it is for. Its marks take the place of their week''s column on the Termly Grade Report, are on the '
  'written report and never on a transcript. Null on every other event.';
