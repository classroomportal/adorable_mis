-- Migration 314: remove the Electronics subject.
--
-- Why (the principal, 1 Oct 2026): "Electronics is not a subject we do." It
-- was one of the subjects the original Nova-T import invented by guessing
-- what codes stood for (see migrations 117–118, where the school's Literature
-- code had been expanded to "Electronics"). Before removing it, every table
-- that refers to subjects was checked: no classes, planned classes, results,
-- targets, transcript grades, report comments, homework, key stages, aliases
-- or target fallbacks use it. Only its 50 rows of grade boundaries (filled in
-- for every subject) remain, and they go with it.

set local formwork.change_note = 'Principal (direct)';

delete from public.subject_grade_boundaries
 where subject_id = (select subject_id from public.subjects where subject_name = 'Electronics');
delete from public.subjects where subject_name = 'Electronics';
