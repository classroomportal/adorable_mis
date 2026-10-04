'use client';

// Sell one tuckshop item to a group (migration 350). She loads a form, year,
// restaurant or student group, ticks the students who are getting the item,
// and only the ticked students are charged, one ordinary purchase each.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

function naira(n) {
  return `₦${Number(n || 0).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;
}

const GROUP_TYPES = [
  { value: 'form_class', label: 'Form' },
  { value: 'year_group', label: 'Year group' },
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'student_group', label: 'Student group' },
];

function byName(a, b) {
  return (a.last_name || '').localeCompare(b.last_name || '') || (a.first_name || '').localeCompare(b.first_name || '');
}

export default function TuckshopGroupSale({ items }) {
  const [students, setStudents] = useState([]);
  const [groups, setGroups] = useState([]);
  const [balances, setBalances] = useState({});

  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [groupType, setGroupType] = useState('form_class');
  const [groupValue, setGroupValue] = useState('');

  const [loaded, setLoaded] = useState(null); // { label, students }
  const [ticked, setTicked] = useState(new Set());
  const [charged, setCharged] = useState(new Set());
  const [filter, setFilter] = useState('');
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: s }, { data: g }] = await Promise.all([
        supabase
          .from('students')
          .select('student_id, first_name, last_name, form_class, year_group, restaurant')
          .eq('status', 'active'),
        supabase.from('student_groups').select('group_id, name').is('archived_at', null).order('name'),
      ]);
      setStudents(s ?? []);
      setGroups(g ?? []);
    })();
    loadBalances();
  }, []);

  async function loadBalances() {
    // Not every role that can sell may read balances; the list works without them.
    const { data, error } = await supabase.rpc('get_tuckshop_balances');
    if (error) return;
    const map = {};
    (data ?? []).forEach((r) => { map[r.student_id] = Number(r.balance); });
    setBalances(map);
  }

  const valueOptions = useMemo(() => {
    if (groupType === 'student_group') {
      return groups.map((g) => ({ value: String(g.group_id), label: g.name }));
    }
    const vals = Array.from(new Set(students.map((s) => s[groupType]).filter((v) => v !== null && v !== '')));
    vals.sort((a, b) => (groupType === 'year_group' ? a - b : String(a).localeCompare(String(b), 'en', { numeric: true })));
    return vals.map((v) => ({ value: String(v), label: groupType === 'year_group' ? `Year ${v}` : String(v) }));
  }, [groupType, students, groups]);

  const item = items.find((i) => String(i.id) === itemId);
  const qty = Math.max(0, Number(quantity) || 0);
  const unitTotal = item ? Number(item.price) * qty : 0;

  async function loadGroup() {
    if (!groupValue) return;
    setLoading(true);
    setStatus(null);
    let list;
    if (groupType === 'student_group') {
      const { data, error } = await supabase
        .from('student_group_members')
        .select('student_id')
        .eq('group_id', Number(groupValue));
      if (error) {
        setStatus(`Error: ${error.message}`);
        setLoading(false);
        return;
      }
      const ids = new Set((data ?? []).map((r) => r.student_id));
      list = students.filter((s) => ids.has(s.student_id));
    } else {
      list = students.filter((s) => String(s[groupType]) === groupValue);
    }
    const label = valueOptions.find((o) => o.value === groupValue)?.label ?? groupValue;
    setLoaded({ label, students: [...list].sort(byName) });
    setTicked(new Set());
    setCharged(new Set());
    setFilter('');
    setLoading(false);
  }

  function toggle(id) {
    if (charged.has(id)) return;
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const shown = useMemo(() => {
    if (!loaded) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return loaded.students;
    return loaded.students.filter((s) => `${s.first_name} ${s.last_name}`.toLowerCase().includes(q));
  }, [loaded, filter]);

  function tickAllShown() {
    setTicked((prev) => {
      const next = new Set(prev);
      shown.forEach((s) => { if (!charged.has(s.student_id)) next.add(s.student_id); });
      return next;
    });
  }

  async function charge() {
    if (!item || qty < 1 || ticked.size === 0) return;
    const total = unitTotal * ticked.size;
    const ok = window.confirm(
      `Charge ${qty} × ${item.name} (${naira(unitTotal)} each) to ${ticked.size} student${ticked.size === 1 ? '' : 's'}?\n\nTotal ${naira(total)}.`
    );
    if (!ok) return;
    setSubmitting(true);
    setStatus(null);
    const ids = Array.from(ticked);
    const { data, error } = await supabase.rpc('sell_tuckshop_item_to_students', {
      p_item_id: item.id,
      p_quantity: qty,
      p_student_ids: ids,
    });
    if (error) {
      setStatus(`Error: ${error.message}`);
    } else {
      const done = (data ?? []).map((r) => r.student_id);
      const sum = (data ?? []).reduce((a, r) => a + Number(r.amount), 0);
      setCharged((prev) => new Set([...prev, ...done]));
      setTicked(new Set());
      setStatus(`Charged ${naira(sum)} — ${qty} × ${item.name} to ${done.length} student${done.length === 1 ? '' : 's'}.`);
      await loadBalances();
    }
    setSubmitting(false);
  }

  return (
    <>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <label>
          Item
          <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">Choose an item…</option>
            {items.map((i) => <option key={i.id} value={i.id}>{i.name} — {naira(i.price)}</option>)}
          </select>
        </label>
        <label>
          Quantity each
          <input type="number" min="1" max="50" value={quantity} onChange={(e) => setQuantity(e.target.value)} style={{ width: '5rem' }} />
        </label>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label>
            Group
            <select value={groupType} onChange={(e) => { setGroupType(e.target.value); setGroupValue(''); }}>
              {GROUP_TYPES.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
            </select>
          </label>
          <label>
            Which
            <select value={groupValue} onChange={(e) => setGroupValue(e.target.value)}>
              <option value="">Choose…</option>
              {valueOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <button onClick={loadGroup} disabled={!groupValue || loading}>
            {loading ? 'Loading…' : 'Load group'}
          </button>
        </div>
      </div>

      {loaded && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
            <strong>{loaded.label} — {loaded.students.length} student{loaded.students.length === 1 ? '' : 's'}</strong>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a name" style={{ width: '10rem' }} />
              <button type="button" className="secondary" onClick={tickAllShown}>Tick all</button>
              <button type="button" className="secondary" onClick={() => setTicked(new Set())}>Untick all</button>
            </div>
          </div>
          <p style={{ color: '#666', fontSize: '0.9rem', margin: '0.4rem 0' }}>
            Tick each student who is getting the item. Only ticked students are charged.
          </p>

          {loaded.students.length === 0 ? (
            <p>No current students in this group.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead><tr><th></th><th>Student</th><th>Form</th><th>Balance</th></tr></thead>
                <tbody>
                  {shown.map((s) => {
                    const done = charged.has(s.student_id);
                    const bal = balances[s.student_id];
                    return (
                      <tr key={s.student_id} onClick={() => toggle(s.student_id)} style={{ cursor: done ? 'default' : 'pointer', opacity: done ? 0.6 : 1 }}>
                        <td>
                          {done ? '✓' : (
                            <input
                              type="checkbox"
                              checked={ticked.has(s.student_id)}
                              onChange={() => toggle(s.student_id)}
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`Tick ${s.first_name} ${s.last_name}`}
                            />
                          )}
                        </td>
                        <td>{s.first_name} {s.last_name}{done && <span style={{ marginLeft: '0.4rem', color: '#1a7a3d', fontSize: '0.85rem' }}>Charged</span>}</td>
                        <td>{s.form_class}</td>
                        <td style={{ color: bal < 0 ? '#a3232c' : undefined }}>{bal === undefined ? '' : naira(bal)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ marginTop: '0.6rem', fontWeight: 700 }}>
            {ticked.size} ticked{item ? ` · ${naira(unitTotal * ticked.size)}` : ''}
          </div>
          <button onClick={charge} disabled={submitting || !item || qty < 1 || ticked.size === 0} style={{ marginTop: '0.5rem' }}>
            {submitting ? 'Charging…' : !item ? 'Choose an item first' : `Charge ${ticked.size} ticked student${ticked.size === 1 ? '' : 's'}`}
          </button>
        </div>
      )}

      {status && <div className="card"><p style={{ margin: 0 }}>{status}</p></div>}
    </>
  );
}
