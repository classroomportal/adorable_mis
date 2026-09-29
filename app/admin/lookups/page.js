'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';

function LookupList({ title, table, idField }) {
  const [items, setItems] = useState([]);
  const [newName, setNewName] = useState('');
  const [status, setStatus] = useState(null);

  async function load() {
    const { data } = await supabase.from(table).select('*').order('name');
    setItems(data || []);
  }
  useEffect(() => { load(); }, []);

  async function add() {
    const name = newName.trim();
    if (!name) return;
    const { error } = await supabase.from(table).insert({ name });
    if (error) setStatus(`Error: ${error.message}`);
    else { setStatus(null); setNewName(''); load(); }
  }

  async function remove(id) {
    if (!window.confirm('Remove this from the list? Existing students keep whatever value they already have.')) return;
    const { error } = await supabase.from(table).delete().eq(idField, id);
    if (error) setStatus(`Error: ${error.message}`);
    else load();
  }

  return (
    <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <h2>{title}</h2>
      {status && <p style={{ color: 'red' }}>{status}</p>}
      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 0.75rem' }}>
        {items.map((item) => (
          <li key={item[idField]} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.3rem 0', borderBottom: '1px solid var(--slate-200)' }}>
            {item.name}
            <button className="secondary" onClick={() => remove(item[idField])} style={{ fontSize: '0.8rem' }}>Remove</button>
          </li>
        ))}
        {items.length === 0 && <li style={{ color: '#999' }}>None yet.</li>}
      </ul>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New name" />
        <button onClick={add}>Add</button>
      </div>
    </div>
  );
}

function BehaviourCategories() {
  const [categories, setCategories] = useState([]);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('positive');
  const [newPoints, setNewPoints] = useState('');
  const [status, setStatus] = useState(null);

  async function load() {
    const { data } = await supabase.from('behaviour_categories').select('*').order('type').order('name');
    setCategories(data || []);
  }
  useEffect(() => { load(); }, []);

  async function updatePoints(category_id, default_points) {
    const { error } = await supabase.from('behaviour_categories').update({ default_points: default_points === '' ? null : Number(default_points) }).eq('category_id', category_id);
    if (error) setStatus(`Error: ${error.message}`);
    else { setStatus(null); load(); }
  }

  async function rename(category_id, name) {
    if (!name.trim()) return;
    const { error } = await supabase.from('behaviour_categories').update({ name: name.trim() }).eq('category_id', category_id);
    if (error) setStatus(`Error: ${error.message}`);
    else { setStatus(null); load(); }
  }

  async function remove(category_id) {
    if (!window.confirm('Remove this category? Past behaviour events keep whatever category text they already have.')) return;
    const { error } = await supabase.from('behaviour_categories').delete().eq('category_id', category_id);
    if (error) setStatus(`Error: ${error.message}`);
    else load();
  }

  async function add() {
    const name = newName.trim();
    if (!name) return;
    const { error } = await supabase.from('behaviour_categories').insert({
      name, type: newType, default_points: newPoints === '' ? null : Number(newPoints),
    });
    if (error) setStatus(`Error: ${error.message}`);
    else { setStatus(null); setNewName(''); setNewPoints(''); load(); }
  }

  function CategoryRow({ c }) {
    const [name, setName] = useState(c.name);
    const [points, setPoints] = useState(c.default_points ?? '');
    return (
      <tr>
        <td><input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== c.name && rename(c.category_id, name)} /></td>
        <td style={{ width: '7rem' }}>
          <input type="number" value={points} onChange={(e) => setPoints(e.target.value)} onBlur={() => Number(points || 0) !== (c.default_points ?? 0) && updatePoints(c.category_id, points)} />
        </td>
        <td><button className="secondary" onClick={() => remove(c.category_id)} style={{ fontSize: '0.8rem' }}>Remove</button></td>
      </tr>
    );
  }

  const positive = categories.filter((c) => c.type === 'positive');
  const negative = categories.filter((c) => c.type === 'negative');

  return (
    <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <h2>Behaviour categories</h2>
      <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>
        Default points pre-fill the points field on the Behaviour Events page when a category is picked — staff can still override the number per event.
      </p>
      {status && <p style={{ color: 'red' }}>{status}</p>}

      <h3 style={{ marginTop: '0.5rem' }}>Positive</h3>
      <div className="table-scroll"><table>
        <thead><tr><th>Category</th><th>Default points</th><th></th></tr></thead>
        <tbody>{positive.map((c) => <CategoryRow key={c.category_id} c={c} />)}</tbody>
      </table></div>

      <h3 style={{ marginTop: '1rem' }}>Negative</h3>
      <div className="table-scroll"><table>
        <thead><tr><th>Category</th><th>Default points</th><th></th></tr></thead>
        <tbody>{negative.map((c) => <CategoryRow key={c.category_id} c={c} />)}</tbody>
      </table></div>

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ flex: '1 1 160px' }}>
          New category
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Category name" />
        </label>
        <label style={{ flex: '0 0 120px' }}>
          Type
          <select value={newType} onChange={(e) => setNewType(e.target.value)}>
            <option value="positive">Positive</option>
            <option value="negative">Negative</option>
          </select>
        </label>
        <label style={{ flex: '0 0 100px' }}>
          Points
          <input type="number" value={newPoints} onChange={(e) => setNewPoints(e.target.value)} />
        </label>
        <button onClick={add}>Add</button>
      </div>
    </div>
  );
}

// Admission form price and deposit for each entry year (migrations 256,
// 258, 259). A change is only proposed here, through propose_admission_fees();
// it takes effect once the principal and the college secretary have both
// approved it at /bursar/fee-approvals. Everything is logged under Fees.
function AdmissionFees() {
  const [years, setYears] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [status, setStatus] = useState(null);

  async function load() {
    const { data } = await supabase.from('academic_years')
      .select('academic_year_id, label, status, admission_form_fee, admission_deposit')
      .neq('status', 'closed').order('start_date');
    setYears(data || []);
    setDrafts(Object.fromEntries((data || []).map((y) => [y.academic_year_id, {
      form_fee: y.admission_form_fee ?? '', deposit: y.admission_deposit ?? '', reason: '',
    }])));
  }
  useEffect(() => { load(); }, []);

  function amount(v) {
    const t = String(v).replace(/[,₦\s]/g, '');
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  }

  async function save(y) {
    const d = drafts[y.academic_year_id];
    const formFee = amount(d.form_fee);
    const deposit = amount(d.deposit);
    if (Number.isNaN(formFee) || Number.isNaN(deposit)) { setStatus('Amounts must be numbers, 0 or more.'); return; }
    const { error } = await supabase.rpc('propose_admission_fees', {
      p_academic_year_id: y.academic_year_id, p_form_fee: formFee, p_deposit: deposit, p_reason: d.reason,
    });
    if (error) setStatus(`Error: ${error.message}`);
    else { setStatus(`Sent for approval for ${y.label}. The amounts change once the principal and the college secretary have both approved.`); load(); }
  }

  return (
    <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <h2>Admission fees</h2>
      <p style={{ marginTop: 0 }}>
        What a family pays for the admission form, and the deposit paid after accepting an offer, for each entry year.
        Leave the form price blank until it is decided; the bursar can&apos;t record form payments until it is set.
        These amounts also appear in the standard letters as {'{{form_fee}}'} and {'{{deposit}}'}.
      </p>
      <p style={{ marginTop: 0 }}>
        <strong>Fees are set and approved by the principal and the college secretary together.</strong>{' '}
        A change entered here is only a proposal until both have approved it at <a href="/bursar/fee-approvals">Fee Approvals</a>.
      </p>
      {status && <p style={{ color: status.startsWith('Error') || status.startsWith('Amounts') ? 'red' : 'green' }}>{status}</p>}
      <div className="table-scroll">
        <table>
          <thead><tr><th>Entry year</th><th>Admission form (₦)</th><th>Deposit (₦)</th><th>Reason</th><th></th></tr></thead>
          <tbody>
            {years.map((y) => {
              const d = drafts[y.academic_year_id] || { form_fee: '', deposit: '' };
              const set = (k) => (e) => setDrafts({ ...drafts, [y.academic_year_id]: { ...d, [k]: e.target.value } });
              return (
                <tr key={y.academic_year_id}>
                  <td>{y.label}{y.status === 'current' ? ' (this year)' : ''}</td>
                  <td><input inputMode="decimal" value={d.form_fee} onChange={set('form_fee')} placeholder="Not set" style={{ width: '9rem' }} /></td>
                  <td><input inputMode="decimal" value={d.deposit} onChange={set('deposit')} placeholder="Not set" style={{ width: '9rem' }} /></td>
                  <td><input value={d.reason} onChange={set('reason')} placeholder="Why" style={{ width: '12rem' }} /></td>
                  <td><button onClick={() => save(y)}>Propose</button></td>
                </tr>
              );
            })}
            {years.length === 0 && <tr><td colSpan={5} style={{ color: '#999' }}>No academic years.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LookupsInner() {
  return (
    <div>
      <h1>Lookups</h1>
      <p>Manage the fixed lists used for student core data and behaviour groups, and the admission fees. Add new houses here as they're created — they'll show up everywhere a boarding or sports house is selected.</p>
      <LookupList title="Boarding houses" table="boarding_houses" idField="house_id" />
      <LookupList title="Sports houses" table="sports_houses" idField="house_id" />
      <BehaviourCategories />
      <AdmissionFees />
    </div>
  );
}

export default function LookupsPage() {
  return <RequireAuth><RequireResource resourceKey="/admin/lookups"><LookupsInner /></RequireResource></RequireAuth>;
}
