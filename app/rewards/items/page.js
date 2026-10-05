'use client';

// Rewards & Prices (migration 370): what students can buy with merit points.
// Prices, limits, dates and approvers are all data, edited here by whoever has
// the Add / Edit ticks on reward_items at /admin/permissions (SMT, pastoral
// and admin to begin with). Rewards are never deleted, only retired, and a new
// price applies only to purchases made after it. Changes are logged in
// Change History under "rewards".

import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { DATE_RULES, LIMIT_PERIODS, limitText } from '../../../lib/rewards';

const soft = { fontSize: '0.85em', color: 'var(--ink-soft)' };
const YEARS = [7, 8, 9, 10, 11, 12, 13];

const BLANK = {
  name: '', icon: '🎁', description: '', cost: 20, date_rule: '', days_ahead: 28,
  year_groups: null, per_student_limit: 1, limit_period: 'term', per_day_capacity: '',
  approver_roles: ['smt'], needs_staff: false, position: 0,
};

function roleTitle(r) {
  if (r === 'smt') return 'SMT';
  const words = r.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function ItemForm({ initial, roles, onSave, onCancel, saving }) {
  const [f, setF] = useState({ ...initial, date_rule: initial.date_rule || '', per_day_capacity: initial.per_day_capacity ?? '', per_student_limit: initial.per_student_limit ?? '' });
  const set = (k, v) => setF((prev) => ({ ...prev, [k]: v }));
  const toggle = (k, v) => setF((prev) => {
    const list = prev[k] || [];
    return { ...prev, [k]: list.includes(v) ? list.filter((x) => x !== v) : [...list, v] };
  });

  function submit(e) {
    e.preventDefault();
    onSave({
      name: f.name.trim(),
      icon: f.icon.trim() || null,
      description: f.description.trim() || null,
      cost: Number(f.cost),
      date_rule: f.date_rule || null,
      days_ahead: Number(f.days_ahead) || 28,
      year_groups: f.year_groups && f.year_groups.length ? [...f.year_groups].sort((a, b) => a - b) : null,
      per_student_limit: f.per_student_limit === '' ? null : Number(f.per_student_limit),
      limit_period: f.limit_period,
      per_day_capacity: f.per_day_capacity === '' || !f.date_rule ? null : Number(f.per_day_capacity),
      approver_roles: f.approver_roles,
      needs_staff: f.needs_staff,
      position: Number(f.position) || 0,
    });
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '0.5rem' }}>
      <label style={{ flex: '0 0 4rem' }}>Icon<input value={f.icon || ''} maxLength={8} onChange={(e) => set('icon', e.target.value)} /></label>
      <label style={{ flex: '1 1 14rem' }}>Name<input value={f.name} maxLength={60} required onChange={(e) => set('name', e.target.value)} /></label>
      <label style={{ flex: '0 0 7rem' }}>Points<input type="number" min="1" value={f.cost} required onChange={(e) => set('cost', e.target.value)} /></label>
      <label style={{ flex: '0 0 6rem' }}>Order<input type="number" value={f.position} onChange={(e) => set('position', e.target.value)} /></label>
      <label style={{ flex: '1 1 100%' }}>
        What it involves (students see this)
        <textarea rows={2} maxLength={600} value={f.description || ''} onChange={(e) => set('description', e.target.value)} />
      </label>
      <label style={{ flex: '1 1 14rem' }}>
        Day
        <select value={f.date_rule} onChange={(e) => set('date_rule', e.target.value)}>
          {Object.entries(DATE_RULES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      {f.date_rule && (
        <>
          <label style={{ flex: '0 0 9rem' }}>Days ahead<input type="number" min="1" max="120" value={f.days_ahead} onChange={(e) => set('days_ahead', e.target.value)} /></label>
          <label style={{ flex: '0 0 11rem' }}>Students per day<input type="number" min="1" placeholder="No limit" value={f.per_day_capacity} onChange={(e) => set('per_day_capacity', e.target.value)} /></label>
        </>
      )}
      <label style={{ flex: '0 0 9rem' }}>Times per student<input type="number" min="1" placeholder="No limit" value={f.per_student_limit} onChange={(e) => set('per_student_limit', e.target.value)} /></label>
      <label style={{ flex: '0 0 10rem' }}>
        Per
        <select value={f.limit_period} onChange={(e) => set('limit_period', e.target.value)}>
          {Object.entries(LIMIT_PERIODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <fieldset style={{ flex: '1 1 100%', border: 'none', padding: 0, margin: 0 }}>
        <legend style={soft}>Year groups (none ticked = every year)</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
          {YEARS.map((y) => (
            <label key={y} style={{ flex: 'none', flexDirection: 'row', alignItems: 'center', gap: '0.3rem' }}>
              <input type="checkbox" checked={(f.year_groups || []).includes(y)} onChange={() => toggle('year_groups', y)} /> Year {y}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset style={{ flex: '1 1 100%', border: 'none', padding: 0, margin: 0 }}>
        <legend style={soft}>Who approves it (admins always can)</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
          {roles.map((r) => (
            <label key={r} style={{ flex: 'none', flexDirection: 'row', alignItems: 'center', gap: '0.3rem' }}>
              <input type="checkbox" checked={f.approver_roles.includes(r)} onChange={() => toggle('approver_roles', r)} /> {roleTitle(r)}
            </label>
          ))}
        </div>
      </fieldset>
      <label style={{ flex: '1 1 100%', flexDirection: 'row', alignItems: 'center', gap: '0.4rem' }}>
        <input type="checkbox" checked={f.needs_staff} onChange={(e) => set('needs_staff', e.target.checked)} />
        The approver names a member of staff (e.g. assistant for a day)
      </label>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button type="submit" disabled={saving || f.approver_roles.length === 0}>{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function RewardItemsInner() {
  const [items, setItems] = useState([]);
  const [roles, setRoles] = useState([]);
  const [settings, setSettings] = useState(null);
  const [editing, setEditing] = useState(null); // item_id or 'new'
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);

  async function load() {
    const [{ data: it }, { data: ro }, { data: se }] = await Promise.all([
      supabase.from('reward_items').select('*').order('active', { ascending: false }).order('position').order('item_id'),
      supabase.from('roles').select('role_name').order('role_name'),
      supabase.from('reward_settings').select('*').maybeSingle(),
    ]);
    setItems(it || []);
    setRoles((ro || []).map((r) => r.role_name).filter((r) => !['student', 'parent'].includes(r)));
    setSettings(se || null);
  }

  useEffect(() => { load(); }, []);

  async function save(itemId, values) {
    setSaving(true);
    setStatus(null);
    const { data, error } = itemId === 'new'
      ? await supabase.from('reward_items').insert(values).select('item_id')
      : await supabase.from('reward_items').update(values).eq('item_id', itemId).select('item_id');
    setSaving(false);
    if (error) { setStatus(`Error: ${error.message}`); return; }
    if (!data?.length) { setStatus("That wasn't saved: you don't have permission to change rewards."); return; }
    setStatus('Saved.');
    setEditing(null);
    load();
  }

  async function setActive(item, active) {
    if (!active && !window.confirm(`Retire ${item.name}? Students can't buy it any more; requests already made stay as they are.`)) return;
    const { data, error } = await supabase.from('reward_items').update({ active }).eq('item_id', item.item_id).select('item_id');
    if (error) { setStatus(`Error: ${error.message}`); return; }
    if (!data?.length) { setStatus("That wasn't saved: you don't have permission to change rewards."); return; }
    load();
  }

  async function saveSettings(values) {
    const { data, error } = await supabase.from('reward_settings').update({ ...values, updated_at: new Date().toISOString() }).eq('id', true).select('*');
    if (error) { setStatus(`Error: ${error.message}`); return; }
    if (!data?.length) { setStatus("That wasn't saved: you don't have permission to change the store."); return; }
    setSettings(data[0]);
    setStatus('Saved.');
  }

  return (
    <div>
      <h1>Rewards &amp; Prices</h1>
      <p style={soft}>
        What students can buy with merit points, from the Reward Store tile on their portal. Spending never changes a
        student's merit total. A new price applies only to purchases made after it. Requests are handled on
        the <a href="/rewards">Reward Store</a> page.
      </p>
      {status && <p>{status}</p>}

      {settings && (
        <div className="card">
          <h2>The store</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end' }}>
            <label style={{ flex: 'none', flexDirection: 'row', alignItems: 'center', gap: '0.4rem' }}>
              <input type="checkbox" checked={settings.store_open} onChange={(e) => saveSettings({ store_open: e.target.checked })} />
              Open: students can buy rewards
            </label>
            <label style={{ flex: 'none' }}>
              Merits count from
              <input type="date" value={settings.points_count_from} onChange={(e) => e.target.value && saveSettings({ points_count_from: e.target.value })} />
            </label>
          </div>
          <p style={soft}>Points to spend start again each school year: only this year's merits, from the date above, count.</p>
        </div>
      )}

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h2 style={{ margin: 0, flex: 1 }}>Rewards</h2>
          {editing !== 'new' && <button onClick={() => setEditing('new')}>Add a reward</button>}
        </div>
        {editing === 'new' && (
          <ItemForm initial={BLANK} roles={roles} saving={saving} onSave={(v) => save('new', v)} onCancel={() => setEditing(null)} />
        )}
        <div className="table-scroll" style={{ marginTop: '0.75rem' }}><table>
          <thead><tr><th>Reward</th><th>Points</th><th>Day</th><th>Limits</th><th>Years</th><th>Approved by</th><th></th></tr></thead>
          <tbody>
            {items.map((item) => (
              editing === item.item_id ? (
                <tr key={item.item_id}><td colSpan={7}>
                  <ItemForm initial={item} roles={roles} saving={saving} onSave={(v) => save(item.item_id, v)} onCancel={() => setEditing(null)} />
                </td></tr>
              ) : (
                <tr key={item.item_id} style={item.active ? undefined : { opacity: 0.55 }}>
                  <td>
                    <strong>{item.icon} {item.name}</strong>{!item.active && ' (retired)'}
                    {item.description && <div style={soft}>{item.description}</div>}
                  </td>
                  <td>{item.cost}</td>
                  <td>{DATE_RULES[item.date_rule || '']}{item.date_rule && <div style={soft}>up to {item.days_ahead} days ahead</div>}</td>
                  <td>
                    {limitText(item) || 'No limit'}
                    {item.per_day_capacity && <div style={soft}>{item.per_day_capacity} student{item.per_day_capacity === 1 ? '' : 's'} a day</div>}
                  </td>
                  <td>{item.year_groups ? item.year_groups.join(', ') : 'All'}</td>
                  <td>
                    {item.approver_roles.map(roleTitle).join(', ')}
                    {item.needs_staff && <div style={soft}>names a member of staff</div>}
                  </td>
                  <td>
                    <div className="appeal-form-buttons">
                      <button className="secondary" onClick={() => setEditing(item.item_id)}>Edit</button>
                      <button className="secondary" onClick={() => setActive(item, !item.active)}>{item.active ? 'Retire' : 'Bring back'}</button>
                    </div>
                  </td>
                </tr>
              )
            ))}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}

export default function RewardItemsPage() {
  return <RequireAuth><RequireResource resourceKey="/rewards/items"><RewardItemsInner /></RequireResource></RequireAuth>;
}
