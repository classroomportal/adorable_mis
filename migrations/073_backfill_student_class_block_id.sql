-- Migration 073: backfill stale student_class.block_id
-- student_class.block_id is a denormalised copy of classes.block_id, set by the
-- trg_set_student_class_block_id trigger on INSERT/UPDATE OF class_id (see 017/020).
-- That trigger only fires when the student_class row itself changes — it does nothing
-- when a class is linked to a curriculum block *after* students were already allocated
-- to it (e.g. a new block created and wired up to existing classes through the app,
-- with no corresponding SQL backfill like 019/020 did). Those rows are left with
-- block_id = NULL forever, which makes the student record's "Curriculum Blocks" panel
-- show "Not allocated" even though the class allocation (and timetable) are correct,
-- since the block-allocation and timetable screens key off class_id, not this column.
-- Re-sync from the current classes/curriculum_blocks state.

update student_class sc
set block_id = c.block_id,
    is_compound = coalesce(cb.is_compound, false)
from classes c
left join curriculum_blocks cb on cb.block_id = c.block_id
where sc.class_id = c.class_id
  and c.block_id is not null
  and (sc.block_id is distinct from c.block_id or sc.is_compound is distinct from coalesce(cb.is_compound, false));
