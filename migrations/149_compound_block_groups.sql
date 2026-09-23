-- Migration 149: explicit groups for compound blocks, and Year 12's Pathway
-- sciences linked into their block.
--
-- A compound curriculum block (Class, Pathway, Vocational) is a choice of ONE
-- group per student, where a group can be several subjects taken together —
-- choosing Pathway "101" puts the student into 101/Bi, 101/Ch, 101/Co,
-- 101/Cv and 101/Ph at once. The app has always found the group from the
-- class_code prefix before the "/", which works for Years 7–11 (7A1/..,
-- 101/.., 11D1/..) but not Year 12, where every class is "12a/..": there the
-- group is the set number across subjects (12a/Bi1 + 12a/Ch1 + 12a/Ph1, as
-- confirmed by the school), which the prefix can't express.
--
-- 1. classes.block_group names a class's group within its block when the
--    prefix isn't it. NULL (every class outside Year 12) keeps using the prefix.
--
-- 2. Year 12 Pathway only had 12a/Bi1, 12a/Bi2 and 12a/El1 linked to it;
--    12a/Ch1, Ch2, Ph1, Ph2, Gt1 and Re1 had no block at all, so a student
--    record could never show them against Pathway. Link them. Every active
--    Y12 student in a Pathway class is already in exactly Bi1+Ch1+Ph1 or
--    Bi2+Ch2+Ph2 (33 students), so no allocations change.
--    El1/Gt1/Re1 are grouped as Literature by analogy with 10LI/11LI; none of
--    the three has any students yet — check with the school before relying
--    on it.
--
-- 3. Year 12 Vocational (12a/Ca1, Mk1, Mk2) is one subject per group, so each
--    class is its own group rather than all three collapsing into "12a".
--
-- 4. student_class.block_id is a trigger-maintained copy of classes.block_id
--    that doesn't follow a class being relinked (see 073), so re-sync it for
--    the classes linked in step 2.

-- 1.
alter table classes add column if not exists block_group text;

comment on column classes.block_group is
  'Group within a compound curriculum block when the class_code prefix is not it (Year 12). NULL = use the prefix before the "/".';

-- 2.
update classes c
   set block_id = cb.block_id
  from curriculum_blocks cb
 where cb.year_group = 12 and cb.block_name = 'Pathway'
   and c.class_code in ('12a/Ch1', '12a/Ch2', '12a/Ph1', '12a/Ph2', '12a/Gt1', '12a/Re1')
   and c.block_id is null;

update classes c
   set block_group = v.block_group
  from (values
    ('12a/Bi1', 'Science 1'), ('12a/Ch1', 'Science 1'), ('12a/Ph1', 'Science 1'),
    ('12a/Bi2', 'Science 2'), ('12a/Ch2', 'Science 2'), ('12a/Ph2', 'Science 2'),
    ('12a/El1', 'Literature'), ('12a/Gt1', 'Literature'), ('12a/Re1', 'Literature')
  ) as v(class_code, block_group)
 where c.class_code = v.class_code;

-- 3.
update classes c
   set block_group = v.block_group
  from (values
    ('12a/Ca1', 'Care'), ('12a/Mk1', 'Marketing 1'), ('12a/Mk2', 'Marketing 2')
  ) as v(class_code, block_group)
 where c.class_code = v.class_code;

-- 4.
update student_class sc
   set block_id = c.block_id,
       is_compound = coalesce(cb.is_compound, false)
  from classes c
  left join curriculum_blocks cb on cb.block_id = c.block_id
 where sc.class_id = c.class_id
   and c.block_id is not null
   and (sc.block_id is distinct from c.block_id or sc.is_compound is distinct from coalesce(cb.is_compound, false));
