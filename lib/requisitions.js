import { supabase } from './supabaseClient';

// Requisitions for a term (practice or real), with items, timeline, cost
// centre and supplier, plus the requesters' names (migration 346). Reads go
// through the normal rules: the budget sees every requisition, anyone else
// only their own.
export async function loadRequisitions(termId, practice, { mineOnly = false } = {}) {
  let q = supabase.from('requisitions')
    .select('*, requisition_items(*), requisition_events(*), cost_centres(name), suppliers(name)')
    .eq('term_id', termId).eq('practice', practice)
    .order('raised_at', { ascending: false });
  if (mineOnly) {
    const { data: u } = await supabase.auth.getUser();
    q = q.eq('requested_by', u?.user?.id);
  }
  const { data, error } = await q;
  if (error) return { error, rows: [], names: {} };
  const ids = [...new Set((data || []).map((r) => r.requester_staff_id).filter(Boolean))];
  const names = {};
  if (ids.length) {
    const { data: staff } = await supabase.from('staff').select('staff_id, first_name, last_name').in('staff_id', ids);
    (staff || []).forEach((s) => { names[s.staff_id] = `${s.first_name} ${s.last_name}`; });
  }
  return { rows: data || [], names };
}

export async function loadBudgetableCentres() {
  const { data } = await supabase.from('cost_centres').select('id, name, kind, active, sort_order')
    .eq('active', true).in('kind', ['allocated', 'ring_fenced']).order('sort_order');
  return data || [];
}
