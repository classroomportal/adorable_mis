-- Heads of Department need to allocate students to classes/sets within their
-- subject's curriculum blocks (the /admin/block-allocation UI), but
-- student_class's only write policy was admin-only, so any attempt by a HoD
-- silently failed at the RLS layer regardless of what the UI showed them.
-- Read access already worked for real (non-demo) staff via read_all_student_class's
-- is_demo = is_demo_account() check, so only the write side needed widening.
--
-- Mirrors the existing is_assessment_manager()-style "admin OR this specific
-- role" helper pattern rather than inlining has_staff_role() directly, so any
-- future policy that should also trust HoDs can reuse it.
CREATE OR REPLACE FUNCTION is_head_of_department()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT is_admin() OR has_staff_role(ARRAY['head_of_department']);
$$;

ALTER POLICY admin_write_student_class ON student_class
  USING (is_head_of_department())
  WITH CHECK (is_head_of_department());
