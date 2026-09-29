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

// Detention and behaviour-alert rules (migration 262). Read by the database
// triggers that create detentions and send alerts; saved through
// set_behaviour_rules(), which checks the caller. Changes are logged in
// Change History under Behaviour.
function DetentionRules() {
  const [d, setD] = useState(null);
  const [status, setStatus] = useState(null);

  async function load() {
    const [{ data: r }, { data: ss }] = await Promise.all([
      supabase.from('behaviour_rules').select('*').maybeSingle(),
      supabase.from('system_settings').select('detention_room, detention_time').maybeSingle(),
    ]);
    setD({
      single: r?.detention_single_event_points ?? -5,
      weekly: r?.detention_weekly_total_points ?? -10,
      alert: r?.alert_weekly_total_points ?? -8,
      serious: r?.serious_event_points ?? -5,
      room: ss?.detention_room ?? '',
      time: ss?.detention_time ?? '',
    });
  }
  useEffect(() => { load(); }, []);

  async function save(e) {
    e.preventDefault();
    const nums = [d.single, d.weekly, d.alert, d.serious].map((v) => parseInt(v, 10));
    if (nums.some((n) => !Number.isFinite(n) || n >= 0)) { setStatus('Error: each threshold is a negative number of points, e.g. -5.'); return; }
    const { error } = await supabase.rpc('set_behaviour_rules', {
      p_detention_single_event_points: nums[0], p_detention_weekly_total_points: nums[1],
      p_alert_weekly_total_points: nums[2], p_detention_room: d.room, p_detention_time: d.time,
      p_serious_event_points: nums[3],
    });
    if (error) setStatus(`Error: ${error.message}`);
    else { setStatus('Saved. New behaviour events follow these rules from now on.'); load(); }
  }

  if (!d) return null;
  const field = (k) => ({ value: d[k], onChange: (e) => { setD({ ...d, [k]: e.target.value }); setStatus(null); } });
  return (
    <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <h2>Detentions and serious events</h2>
      <p style={{ marginTop: 0 }}>
        A student gets a Friday detention when one negative event is worth this many points or more, or when their
        negative points from Saturday to Friday add up to this much. Enter them as negative points, as they are logged (e.g. −5).
      </p>
      {status && <p style={{ color: status.startsWith('Error') ? 'red' : 'green' }}>{status}</p>}
      <form onSubmit={save} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label>Detention for one event of (points)<input type="number" max="-1" {...field('single')} style={{ width: '7rem' }} /></label>
        <label>Detention for a weekly total of (points)<input type="number" max="-1" {...field('weekly')} style={{ width: '7rem' }} /></label>
        <label>Email alert to SMT at a weekly total of (points)<input type="number" max="-1" {...field('alert')} style={{ width: '7rem' }} /></label>
        <label>Serious event at (points): explanation required, reviewed before parents see it<input type="number" max="-1" {...field('serious')} style={{ width: '7rem' }} /></label>
        <label>Detention room<input {...field('room')} placeholder="CG4" style={{ width: '8rem' }} /></label>
        <label>Detention time<input {...field('time')} placeholder="after lesson 7" style={{ width: '10rem' }} /></label>
        <button type="submit">Save</button>
      </form>
      <p style={{ fontSize: '0.85em', color: '#666' }}>
        A single event at the detention level also sends the SMT email alert. Detentions already given are not changed.
        A serious event must have a written explanation, and the school office (SMT when it has a picture) reviews it at
        Behaviour Review before parents can see it.
      </p>
    </div>
  );
}

// Certificate levels (migration 262): the cumulative behaviour points that
// earn each certificate on /certificates.
function CertificateLevels() {
  const [levels, setLevels] = useState([]);
  const [edits, setEdits] = useState({});
  const [newLevel, setNewLevel] = useState({ name: '', points: '' });
  const [status, setStatus] = useState(null);

  async function load() {
    const { data } = await supabase.from('certificate_levels').select('*').order('points');
    setLevels(data || []);
    setEdits({});
  }
  useEffect(() => { load(); }, []);

  async function run(promise, ok) {
    const { error } = await promise;
    if (error) setStatus(`Error: ${error.message}`);
    else { setStatus(ok); load(); }
  }

  function saveRow(l) {
    const e = edits[l.level_id] || {};
    const points = parseInt(e.points ?? l.points, 10);
    const name = (e.name ?? l.name).trim();
    if (!name || !(points > 0)) { setStatus('Error: give a name and a number of points above 0.'); return; }
    run(supabase.from('certificate_levels').update({ name, points }).eq('level_id', l.level_id), 'Saved.');
  }

  function add(ev) {
    ev.preventDefault();
    const points = parseInt(newLevel.points, 10);
    if (!newLevel.name.trim() || !(points > 0)) { setStatus('Error: give a name and a number of points above 0.'); return; }
    run(supabase.from('certificate_levels').insert({ name: newLevel.name.trim(), points }), 'Level added.');
    setNewLevel({ name: '', points: '' });
  }

  function remove(l) {
    if (!window.confirm(`Remove the ${l.name} certificate level? Certificates already given stay on record.`)) return;
    run(supabase.from('certificate_levels').delete().eq('level_id', l.level_id), 'Removed.');
  }

  return (
    <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <h2>Certificates</h2>
      <p style={{ marginTop: 0 }}>The cumulative behaviour points (positive and negative combined) that earn each certificate.</p>
      {status && <p style={{ color: status.startsWith('Error') ? 'red' : 'green' }}>{status}</p>}
      <table>
        <thead><tr><th>Certificate</th><th>Points</th><th></th></tr></thead>
        <tbody>
          {levels.map((l) => {
            const e = edits[l.level_id] || {};
            const set = (k) => (ev) => setEdits({ ...edits, [l.level_id]: { ...e, [k]: ev.target.value } });
            return (
              <tr key={l.level_id}>
                <td><input value={e.name ?? l.name} onChange={set('name')} style={{ width: '9rem' }} /></td>
                <td><input type="number" min="1" value={e.points ?? l.points} onChange={set('points')} style={{ width: '7rem' }} /></td>
                <td>
                  {edits[l.level_id] && <><button onClick={() => saveRow(l)}>Save</button>{' '}</>}
                  <button className="secondary" onClick={() => remove(l)} style={{ fontSize: '0.8rem' }}>Remove</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <form onSubmit={add} style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
        <input value={newLevel.name} onChange={(e) => setNewLevel({ ...newLevel, name: e.target.value })} placeholder="New level, e.g. Platinum" />
        <input type="number" min="1" value={newLevel.points} onChange={(e) => setNewLevel({ ...newLevel, points: e.target.value })} placeholder="Points" style={{ width: '7rem' }} />
        <button type="submit">Add</button>
      </form>
    </div>
  );
}

// Academic years (migrations 256, 264). Holders of Lookups can add the next
// year, correct dates and remove a planning year nothing uses yet, all
// through functions that check the caller. Which year is current changes
// only at the year switch, not here.
const YEAR_STATUS = { current: 'This year', planning: 'Next year (planning)', closed: 'Closed' };

function AcademicYears() {
  const [years, setYears] = useState([]);
  const [edits, setEdits] = useState({});
  const [status, setStatus] = useState(null);

  async function load() {
    const { data } = await supabase.from('academic_years').select('academic_year_id, label, start_date, end_date, status').order('start_date');
    setYears(data || []);
    setEdits({});
  }
  useEffect(() => { load(); }, []);

  async function run(fn, args, ok) {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) setStatus(`Error: ${error.message}`);
    else { setStatus(typeof ok === 'function' ? ok(data) : ok); load(); }
  }

  function saveDates(y) {
    const e = edits[y.academic_year_id] || {};
    run('set_academic_year_dates', {
      p_academic_year_id: y.academic_year_id,
      p_start: e.start_date ?? y.start_date, p_end: e.end_date ?? y.end_date,
    }, `Dates saved for ${y.label}.`);
  }

  function remove(y) {
    if (!window.confirm(`Remove ${y.label}? This only works while nothing has been set up for it.`)) return;
    run('delete_academic_year', { p_academic_year_id: y.academic_year_id }, `${y.label} removed.`);
  }

  return (
    <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <h2>Academic years</h2>
      <p style={{ marginTop: 0 }}>
        Admissions, admission fees and term dates are filed under these years. Add terms for a year on the
        <a href="/calendar"> Calendar</a> page: a term belongs to the year its start date falls in. The current year
        changes only when the school moves up at the start of the new year.
      </p>
      {status && <p style={{ color: status.startsWith('Error') ? 'red' : 'green' }}>{status}</p>}
      <table>
        <thead><tr><th>Year</th><th>Starts</th><th>Ends</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {years.map((y) => {
            const e = edits[y.academic_year_id] || {};
            const closed = y.status === 'closed';
            const set = (k) => (ev) => setEdits({ ...edits, [y.academic_year_id]: { ...e, [k]: ev.target.value } });
            return (
              <tr key={y.academic_year_id}>
                <td><strong>{y.label}</strong></td>
                <td><input type="date" value={e.start_date ?? y.start_date} onChange={set('start_date')} disabled={closed} /></td>
                <td><input type="date" value={e.end_date ?? y.end_date} onChange={set('end_date')} disabled={closed} /></td>
                <td>{YEAR_STATUS[y.status] || y.status}</td>
                <td>
                  {edits[y.academic_year_id] && <><button onClick={() => saveDates(y)}>Save</button>{' '}</>}
                  {y.status === 'planning' && <button className="secondary" style={{ fontSize: '0.8rem' }} onClick={() => remove(y)}>Remove</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ marginTop: '0.75rem' }}>
        <button onClick={() => run('add_next_academic_year', {}, (label) => `${label} added.`)}>Add the next academic year</button>
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
      <DetentionRules />
      <CertificateLevels />
      <AcademicYears />
      <AdmissionFees />
    </div>
  );
}

export default function LookupsPage() {
  return <RequireAuth><RequireResource resourceKey="/admin/lookups"><LookupsInner /></RequireResource></RequireAuth>;
}
