-- Pastoral staff also need to allocate students to classes (same
-- /admin/block-allocation UI as heads of department, migration 104).
-- is_head_of_department() was named for a single role, so rather than stuff
-- an unrelated role into a narrowly-named helper, replace it with a
-- purpose-named one that lists every role allowed to write student_class.
CREATE OR REPLACE FUNCTION can_allocate_classes()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT is_admin() OR has_staff_role(ARRAY['head_of_department', 'pastoral']);
$$;

ALTER POLICY admin_write_student_class ON student_class
  USING (can_allocate_classes())
  WITH CHECK (can_allocate_classes());

-- Now unreferenced by any policy, safe to drop.
DROP FUNCTION is_head_of_department();
