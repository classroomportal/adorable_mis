'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { loadSpecialSessions, longDate, momentLabel } from '../../../lib/tuckshopSchedule';

// Special pre-order sessions (tuckshop_special_sessions, migration 241): a
// one-off ordering window for one delivery date, selling only the items
// picked here. It replaces the weekly rota for that date and isn't stopped
// by "Close ordering". Orders are kept under the delivery date, so they get
// their own order sheet and hand-out list, separate from any other day's.
// Tuckshop, bursar and admin staff can edit; RLS backs that up.

function naira(n) {
  return `₦${Number(n || 0).toLocaleString()}`;
}

function lagosToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
}

// Lagos is UTC+1 all year.
function lagosMoment(date, time) {
  return new Date(`${date}T${time}:00+01:00`);
}

function lagosParts(ts) {
  const d = new Date(ts);
  return {
    date: d.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' }),
    time: d.toLocaleTimeString('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit', hour12: false }),
  };
}

const blank = () => {
  const today = lagosToday();
  return {
    id: null, name: '', for_date: today,
    opens_date: today, opens_time: '19:00', closes_date: today, closes_time: '22:00',
    itemIds: new Set(),
    max_per_item: 2, max_food: 2, max_other: '',
  };
};

function problem(f) {
  if (!f.name.trim()) return 'Give the session a name.';
  if (!f.for_date || !f.opens_date || !f.opens_time || !f.closes_date || !f.closes_time) return 'Fill in every date and time.';
  if (lagosMoment(f.opens_date, f.opens_time) >= lagosMoment(f.closes_date, f.closes_time)) return 'Ordering must open before it closes.';
  if (f.for_date < f.opens_date) return 'The delivery date can’t be before ordering opens.';
  if (f.itemIds.size === 0) return 'Pick at least one item to sell.';
  if (!(Number(f.max_per_item) >= 1)) return 'Each item needs a limit of at least 1.';
  if (f.max_food === '' || Number(f.max_food) < 0) return 'Set the snacks and drinks limit (0 for none).';
  if (f.max_other !== '' && Number(f.max_other) < 0) return 'The other items limit can’t be negative.';
  return null;
}

function ItemPicker({ items, selected, onToggle }) {
  const [filter, setFilter] = useState('');
  const shown = items.filter((i) => i.name.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div>
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Search items"
        style={{ width: '100%', maxWidth: '20rem', marginBottom: '0.5rem' }}
      />
      <div style={{ maxHeight: '18rem', overflowY: 'auto', border: '1px solid #ddd', borderRadius: 4, padding: '0.25rem 0.5rem' }}>
        {shown.map((i) => (
          <label key={i.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', padding: '0.2rem 0' }}>
            <input type="checkbox" checked={selected.has(i.id)} onChange={() => onToggle(i.id)} />
            <span style={{ flex: 1 }}>
              {i.name}
              {!i.active && <span style={{ color: '#555', fontSize: '0.85rem' }}> (not in normal ordering)</span>}
            </span>
            <span style={{ color: '#555' }}>{naira(i.price)}</span>
          </label>
        ))}
        {shown.length === 0 && <p style={{ color: '#555' }}>No items match.</p>}
      </div>
      <p style={{ color: '#555', fontSize: '0.9rem' }}>{selected.size} item{selected.size === 1 ? '' : 's'} chosen.</p>
    </div>
  );
}

export default function SpecialSessions() {
  const [sessions, setSessions] = useState([]);
  const [items, setItems] = useState([]);
  const [orderCounts, setOrderCounts] = useState({});
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    const list = await loadSpecialSessions(supabase);
    // Current and upcoming sessions, plus the last week's for reference.
    const cutoff = new Date(Date.now() - 7 * 86400000).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
    const recent = list.filter((s) => s.for_date >= cutoff).sort((a, b) => (a.for_date < b.for_date ? -1 : 1));
    setSessions(recent);
    const { data: it } = await supabase
      .from('tuckshop_items')
      .select('id, name, price, active')
      .order('active', { ascending: false })
      .order('name');
    setItems(it || []);
    if (recent.length > 0) {
      const { data: orders } = await supabase
        .from('tuckshop_preorders')
        .select('for_date')
        .in('for_date', recent.map((s) => s.for_date))
        .neq('status', 'cancelled');
      const counts = {};
      (orders || []).forEach((o) => { counts[o.for_date] = (counts[o.for_date] || 0) + 1; });
      setOrderCounts(counts);
    } else {
      setOrderCounts({});
    }
  }

  function edit(s) {
    const o = lagosParts(s.opens_at);
    const c = lagosParts(s.closes_at);
    setForm({
      id: s.id, name: s.name, for_date: s.for_date,
      opens_date: o.date, opens_time: o.time, closes_date: c.date, closes_time: c.time,
      itemIds: new Set(s.itemIds),
      max_per_item: s.max_per_item, max_food: s.max_food, max_other: s.max_other ?? '',
    });
    setStatus(null);
  }

  function toggle(id) {
    setForm((f) => {
      const next = new Set(f.itemIds);
      if (next.has(id)) next.delete(id); else next.add(id);
      return { ...f, itemIds: next };
    });
  }

  async function save(e) {
    e.preventDefault();
    const bad = problem(form);
    if (bad) { setStatus(bad); return; }
    setSaving(true);
    setStatus(null);
    const row = {
      name: form.name.trim(),
      for_date: form.for_date,
      opens_at: lagosMoment(form.opens_date, form.opens_time).toISOString(),
      closes_at: lagosMoment(form.closes_date, form.closes_time).toISOString(),
      max_per_item: Number(form.max_per_item),
      max_food: Number(form.max_food),
      max_other: form.max_other === '' ? null : Number(form.max_other),
    };
    let id = form.id;
    if (id) {
      const { error } = await supabase.from('tuckshop_special_sessions').update(row).eq('id', id);
      if (error) { setSaving(false); setStatus(`Error: ${error.message}`); return; }
    } else {
      const { data, error } = await supabase.from('tuckshop_special_sessions').insert(row).select('id').single();
      if (error) {
        setSaving(false);
        setStatus(error.code === '23505'
          ? `There is already a special session for ${longDate(form.for_date)} — edit that one instead.`
          : `Error: ${error.message}`);
        return;
      }
      id = data.id;
    }
    // Replace the item list with what's ticked.
    const { error: delErr } = await supabase
      .from('tuckshop_special_session_items')
      .delete()
      .eq('session_id', id);
    if (delErr) { setSaving(false); setStatus(`Error: ${delErr.message}`); return; }
    const { error: insErr } = await supabase
      .from('tuckshop_special_session_items')
      .insert([...form.itemIds].map((itemId) => ({ session_id: id, tuckshop_item_id: itemId })));
    setSaving(false);
    if (insErr) { setStatus(`Error: ${insErr.message}`); return; }
    setStatus(`Saved "${row.name}": ordering opens at ${momentLabel(row.opens_at)} and closes at ${momentLabel(row.closes_at)}.`);
    setForm(null);
    load();
  }

  async function remove(s) {
    const n = orderCounts[s.for_date] || 0;
    const msg = n > 0
      ? `Delete "${s.name}"? ${n} order${n === 1 ? ' has' : 's have'} already been placed for ${longDate(s.for_date)}. They stay on record and on the order sheet, but students will no longer be able to change them.`
      : `Delete "${s.name}"?`;
    if (!window.confirm(msg)) return;
    const { error } = await supabase.from('tuckshop_special_sessions').delete().eq('id', s.id);
    setStatus(error ? `Error: ${error.message}` : `Deleted "${s.name}".`);
    load();
  }

  const itemName = Object.fromEntries(items.map((i) => [i.id, i.name]));
  const now = Date.now();

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Special pre-order sessions</h3>
      <p>
        A one-off ordering window that sells only the items you choose. Orders are kept under the
        delivery date, with their own order sheet and hand-out list, so they never mix with another
        tuckshop day&apos;s. A special session opens even while ordering is closed above, and replaces
        the weekly schedule for its delivery date.
      </p>

      {sessions.length > 0 && (
        <div className="table-scroll">
          <table style={{ minWidth: 0 }}>
            <thead>
              <tr><th>Session</th><th>Ordering</th><th>Items on sale</th><th>Limits per student</th><th>Orders</th><th /></tr>
            </thead>
            <tbody>
              {sessions.map((s) => {
                const open = now >= new Date(s.opens_at).getTime() && now < new Date(s.closes_at).getTime();
                const over = now >= new Date(s.closes_at).getTime();
                return (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.name}</strong>
                      <div style={{ color: '#555', fontSize: '0.85rem' }}>For {longDate(s.for_date)}</div>
                      <span className={`badge ${open ? 'badge-positive' : 'badge-negative'}`}>
                        {open ? 'Open now' : over ? 'Closed' : 'Not open yet'}
                      </span>
                    </td>
                    <td>
                      Opens {momentLabel(s.opens_at)}
                      <br />Closes {momentLabel(s.closes_at)}
                    </td>
                    <td>{s.itemIds.map((id) => itemName[id] || `#${id}`).join(', ')}</td>
                    <td>
                      {s.max_per_item} of each item
                      <br />{s.max_food} snack{s.max_food === 1 ? '' : 's'}/drink{s.max_food === 1 ? '' : 's'} in total
                      <br />{s.max_other == null ? 'Other items: no limit' : `${s.max_other} other item${s.max_other === 1 ? '' : 's'} in total`}
                    </td>
                    <td>{orderCounts[s.for_date] || 0}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="secondary" onClick={() => edit(s)}>Edit</button>{' '}
                      <button className="secondary" onClick={() => remove(s)}>Delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!form && (
        <button onClick={() => { setForm(blank()); setStatus(null); }}>New special session</button>
      )}

      {form && (
        <form onSubmit={save} style={{ marginTop: '1rem' }}>
          <h4 style={{ marginTop: 0 }}>{form.id ? 'Edit special session' : 'New special session'}</h4>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ flex: '1 1 14rem' }}>
              Name (shown to students)<br />
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Special pre-order"
                style={{ width: '100%' }}
                required
              />
            </label>
            <label>
              Delivery date (orders are for)<br />
              <input type="date" value={form.for_date} onChange={(e) => setForm({ ...form, for_date: e.target.value })} required />
            </label>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: '0.5rem' }}>
            <label>
              Ordering opens (Lagos time)<br />
              <input type="date" value={form.opens_date} onChange={(e) => setForm({ ...form, opens_date: e.target.value })} required />{' '}
              <input type="time" value={form.opens_time} onChange={(e) => setForm({ ...form, opens_time: e.target.value })} required />
            </label>
            <label>
              Ordering closes (Lagos time)<br />
              <input type="date" value={form.closes_date} onChange={(e) => setForm({ ...form, closes_date: e.target.value })} required />{' '}
              <input type="time" value={form.closes_time} onChange={(e) => setForm({ ...form, closes_time: e.target.value })} required />
            </label>
          </div>
          <h4>Items on sale</h4>
          <p style={{ color: '#555', fontSize: '0.9rem', marginTop: 0 }}>
            Only these can be ordered for this session. Items switched off for normal ordering can be
            chosen too.
          </p>
          <ItemPicker items={items} selected={form.itemIds} onToggle={toggle} />
          <h4>Limits per student</h4>
          <p style={{ color: '#555', fontSize: '0.9rem', marginTop: 0 }}>
            Snacks and drinks are the items marked as food on Items &amp; Prices; everything else
            counts as an other item. Leave the other items limit blank for no limit.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.75rem' }}>
            <label>
              Most of any one item<br />
              <input type="number" min="1" value={form.max_per_item} onChange={(e) => setForm({ ...form, max_per_item: e.target.value })} style={{ width: '6rem' }} required />
            </label>
            <label>
              Snacks and drinks in total<br />
              <input type="number" min="0" value={form.max_food} onChange={(e) => setForm({ ...form, max_food: e.target.value })} style={{ width: '6rem' }} required />
            </label>
            <label>
              Other items in total<br />
              <input type="number" min="0" value={form.max_other} onChange={(e) => setForm({ ...form, max_other: e.target.value })} placeholder="no limit" style={{ width: '6rem' }} />
            </label>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save session'}</button>
            <button type="button" className="secondary" onClick={() => setForm(null)} disabled={saving}>Cancel</button>
          </div>
        </form>
      )}

      {status && <p>{status}</p>}
    </div>
  );
}
