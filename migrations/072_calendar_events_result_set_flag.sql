-- Migration 072: is_result_set flag on calendar_events
-- Lets calendar events be explicitly marked as "result sets" — i.e. datasets that
-- should appear in the Subject Overview dataset picker. Without this, that dropdown
-- was pulling every calendar event regardless of category (holidays, consult days,
-- term boundaries, awareness days), which isn't meaningful as a results dataset.
-- Defaults to false so nothing existing shows up until explicitly marked.

alter table calendar_events add column if not exists is_result_set boolean not null default false;

comment on column calendar_events.is_result_set is
  'True if this calendar event represents a results dataset (exam, ReLP, etc.) that should appear in the Subject Overview dataset picker.';

-- Mark the T3 Exam event already added as a result set, since it's the one currently in use.
update calendar_events set is_result_set = true where event_name = 'T3 Exam' and event_date = '2026-07-19';
