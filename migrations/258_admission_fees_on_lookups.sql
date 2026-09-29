-- Migration 258: admission form fee and deposit editable from Lookups.
--
-- Why: the principal asked (29 Sept 2026) for the admission form price and
-- the deposit to be editable in the Lookups page (/admin/lookups), next to
-- the school's other fixed values. The form price isn't settled yet; the
-- deposit is ₦100,000 for now. Until this, only the bursar could set them
-- (set_admission_fee_amounts(), migration 256), from Admission Payments.
--
-- Changes:
--   * set_admission_fee_amounts() also accepts anyone with the Lookups page
--     (admin, SMT and HR as granted at 29 Sept 2026; /admin/permissions
--     decides), as well as the bursar. Still checked from auth.uid().
--   * Every change to an academic year's amounts or pass mark is logged in
--     change_history under 'fees', like the other fee lookups (fee_items,
--     fee_discount_types).
--   * The deposit is set to ₦100,000 for 2026/27 (in-year entry) and
--     2027/28. The form fee is left unset until the school decides it; the
--     bursar can't record a form payment until it is set.

set local formwork.change_note = 'Principal (direct)';

create or replace function public.set_admission_fee_amounts(p_academic_year_id integer, p_form_fee numeric, p_deposit numeric)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not (user_has_staff_role(array['bursar']) or has_resource_access('/admin/lookups')) then
    raise exception 'Only the bursar, or staff with the Lookups page, can set admission fees.';
  end if;
  if p_form_fee < 0 or p_deposit < 0 then
    raise exception 'Amounts can''t be negative.';
  end if;
  update academic_years
     set admission_form_fee = p_form_fee, admission_deposit = p_deposit
   where academic_year_id = p_academic_year_id;
end;
$$;

drop trigger if exists trg_log_change on public.academic_years;
create trigger trg_log_change after update or delete on public.academic_years
  for each row execute function public.log_change('fees', 'academic_year_id');

update public.academic_years
   set admission_deposit = 100000
 where label in ('2026/27', '2027/28');
