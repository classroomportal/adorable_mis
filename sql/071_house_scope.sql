-- Migration 071: Houseparent house-scoping (mirrors Head of Department pattern).
--
-- Only my_house_scope() is created here. my_department_scope() already exists
-- live and works — NOT touching it with a guessed create-or-replace, since a
-- wrong reconstruction could silently change working behaviour. See the
-- separate query below to pull its real definition for filing verbatim later.

create or replace function my_house_scope()
returns text
language sql stable security definer as $$
  select sr.scope_value
  from profiles p
  join staff_roles sr on sr.staff_id = p.staff_id
  where p.id = auth.uid()
    and sr.role_name = 'houseparent'
    and sr.scope_type = 'house'
  limit 1;
$$;
