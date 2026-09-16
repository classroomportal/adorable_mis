-- Migration 087: let a checker see their own report_checkers assignment
--
-- report_subject_comments/report_pastoral_comments' SELECT and UPDATE policies both
-- grant access to a comment via "EXISTS (SELECT 1 FROM report_checkers rc WHERE
-- rc.staff_id = <me>...)". That subquery is itself subject to report_checkers' own
-- RLS — and the only policy on report_checkers was "report_checkers_admin", scoped to
-- admin/smt only. So a non-admin checker's own assignment row was invisible to that
-- subquery, and the EXISTS always evaluated false for them: a real English-department
-- checker could be assigned in report_checkers and still see zero comments to check.
-- This adds the missing "read your own assignment" policy.

create policy "report_checkers_read_own" on report_checkers for select using (
  staff_id = (select profiles.staff_id from profiles where profiles.id = auth.uid())
);
