-- Migration 341: the Budget tile's pages.
--
-- Why: the principal, 3 Oct 2026: "The budget process needs a big tile and
-- not the top button. Different parts need to be in the big tile. Call the
-- big tile Budget." The single /finance/budget page is split into the
-- tile's links: Term forecast (/finance/forecast), Fee income by fund
-- (/finance/budget, as before) and Funds & cost centres (/finance/funds).
-- Like the rest of the budget, the new pages are granted to the principal
-- only while it is being built; the data behind them is still checked by
-- can_view_budget() and is_budget_approver(), so nothing here widens who
-- can see or change anything.

set local formwork.change_note = 'Principal (direct)';

update public.resources set label = 'Fee income by fund', section = 'Budget', sort_order = 2
where resource_key = '/finance/budget';

insert into public.resources (resource_key, label, section, sort_order) values
  ('/finance/forecast', 'Term forecast', 'Budget', 1),
  ('/finance/funds', 'Funds & cost centres', 'Budget', 3)
on conflict (resource_key) do nothing;

insert into public.role_permissions (role_name, resource_key) values
  ('principal', '/finance/forecast'),
  ('principal', '/finance/funds')
on conflict do nothing;
