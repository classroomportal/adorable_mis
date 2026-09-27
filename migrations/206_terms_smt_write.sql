-- SMT can add and edit terms (follows 205, which did the same for calendar
-- events).
--
-- Only is_admin() could write to terms, and the Academic Calendar page had no
-- way to change them at all. SMT now get insert and update through
-- user_has_staff_role(array['smt']) (which also passes the admin login).
--
-- Delete deliberately stays admin-only via the existing admin_write_terms
-- policy: other_half_activities and other_half_terms reference terms with
-- ON DELETE CASCADE, so removing a term would silently wipe that term's Other
-- Half activities and students' choices. A wrong term is fixed by editing it.

create policy smt_insert_terms on public.terms
  for insert
  with check (user_has_staff_role(array['smt']));

create policy smt_update_terms on public.terms
  for update
  using (user_has_staff_role(array['smt']))
  with check (user_has_staff_role(array['smt']));

grant select, insert, update, delete on public.terms to authenticated;
