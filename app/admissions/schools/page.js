'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { CURRICULA, errorText } from '../../../lib/admissions';

// The schools applicants come from (migration 256), one row per school so
// feeder schools can be counted. Duplicates (the same school spelt two ways)
// are merged with merge_previous_schools(), which moves the applicants
// across and removes the duplicate. A school can only be deleted once no
// applicant points at it; the foreign key refuses otherwise.

const FIELDS = ['name', 'town', 'state', 'country', 'curriculum'];
const EMPTY_NEW = { name: '', town: '', state: '', country: 'Nigeria', curriculum: '' };

function toEdit(s) {
  return { name: s.name ?? '', town: s.town ?? '', state: s.state ?? '', country: s.country ?? '', curriculum: s.curriculum ?? '' };
}

function toRow(e) {
  return {
    name: e.name.trim(),
    town: e.town.trim() || null,
    state: e.state.trim() || null,
    country: e.country.trim() || 'Nigeria',
    curriculum: e.curriculum || null,
  };
}

function SchoolsInner() {
  const [schools, setSchools] = useState([]);
  const [counts, setCounts] = useState({});
  const [edits, setEdits] = useState({});
  const [mergeInto, setMergeInto] = useState({}); // school_id -> target id
  const [rowStatus, setRowStatus] = useState({});
  const [newSchool, setNewSchool] = useState(EMPTY_NEW);
  const [addStatus, setAddStatus] = useState(null);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  async function load() {
    const [{ data, error }, { data: apps, error: appsError }] = await Promise.all([
      supabase.from('previous_schools').select('school_id, name, town, state, country, curriculum').order('name'),
      supabase.from('applicants').select('previous_school_id').not('previous_school_id', 'is', null),
    ]);
    if (error || appsError) {
      setLoadError(errorText(error || appsError));
      setLoading(false);
      return;
    }
    const c = {};
    for (const a of apps || []) c[a.previous_school_id] = (c[a.previous_school_id] || 0) + 1;
    const e = {};
    for (const s of data || []) e[s.school_id] = toEdit(s);
    setSchools(data || []);
    setCounts(c);
    setEdits(e);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function edit(id, field, value) {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
    setRowStatus((prev) => ({ ...prev, [id]: null }));
  }

  function isChanged(s) {
    const e = edits[s.school_id];
    const o = toEdit(s);
    return e && FIELDS.some((f) => e[f].trim() !== o[f]);
  }

  function say(id, text, error = false) {
    setRowStatus((prev) => ({ ...prev, [id]: { text, error } }));
  }

  async function save(s) {
    const e = edits[s.school_id];
    if (!e.name.trim()) { say(s.school_id, 'The school needs a name.', true); return; }
    say(s.school_id, 'Saving...');
    const { error } = await supabase.from('previous_schools').update(toRow(e)).eq('school_id', s.school_id);
    if (error) { say(s.school_id, `Not saved: ${errorText(error)}`, true); return; }
    await load();
    say(s.school_id, 'Saved.');
  }

  async function remove(s) {
    if (!window.confirm(`Delete ${s.name}?`)) return;
    const { error } = await supabase.from('previous_schools').delete().eq('school_id', s.school_id);
    if (error) { say(s.school_id, `Not deleted: ${errorText(error)}`, true); return; }
    await load();
  }

  async function merge(s) {
    const target = schools.find((x) => x.school_id === Number(mergeInto[s.school_id]));
    if (!target) return;
    const n = counts[s.school_id] || 0;
    const ok = window.confirm(
      `Merge "${s.name}${s.town ? `, ${s.town}` : ''}" into "${target.name}${target.town ? `, ${target.town}` : ''}"?\n\n`
      + `${n} applicant${n === 1 ? '' : 's'} will be moved to ${target.name}, and "${s.name}" will be deleted. This can't be undone.`,
    );
    if (!ok) return;
    say(s.school_id, 'Merging...');
    const { error } = await supabase.rpc('merge_previous_schools', { p_from: s.school_id, p_into: target.school_id });
    if (error) { say(s.school_id, `Not merged: ${errorText(error)}`, true); return; }
    setMergeInto((prev) => ({ ...prev, [s.school_id]: '' }));
    await load();
    say(target.school_id, `Merged "${s.name}" into this school.`);
  }

  async function add(ev) {
    ev.preventDefault();
    if (!newSchool.name.trim()) { setAddStatus({ error: true, text: 'Give the school\'s name.' }); return; }
    setAddStatus({ text: 'Adding...' });
    const { error } = await supabase.from('previous_schools').insert(toRow(newSchool));
    if (error) { setAddStatus({ error: true, text: `Not added: ${errorText(error)}` }); return; }
    setNewSchool(EMPTY_NEW);
    setAddStatus({ text: 'Added.' });
    await load();
  }

  if (loading) return <div><h1>Previous Schools</h1><p>Loading...</p></div>;
  if (loadError) return <div><h1>Previous Schools</h1><p style={{ color: '#a3232c' }}>Could not load: {loadError}</p></div>;

  const q = filter.trim().toLowerCase();
  const shown = q
    ? schools.filter((s) => [s.name, s.town, s.state, s.country].some((v) => (v || '').toLowerCase().includes(q)))
    : schools;
  const cellInput = { padding: '0.35rem 0.5rem', fontSize: '0.95rem' };

  return (
    <div>
      <h1>Previous Schools</h1>
      <p>
        The schools applicants come from, kept as one list so each school is counted once however it&apos;s spelt on
        the form. If the same school appears twice, use <strong>Merge into…</strong> to move its applicants to the
        right entry. A school can only be deleted once no applicant is linked to it.
      </p>

      <form onSubmit={add}>
        <label style={{ flex: '2 1 14rem' }}>
          School name
          <input value={newSchool.name} onChange={(ev) => setNewSchool({ ...newSchool, name: ev.target.value })} />
        </label>
        <label>
          Town
          <input value={newSchool.town} onChange={(ev) => setNewSchool({ ...newSchool, town: ev.target.value })} />
        </label>
        <label>
          State
          <input value={newSchool.state} onChange={(ev) => setNewSchool({ ...newSchool, state: ev.target.value })} />
        </label>
        <label>
          Country
          <input value={newSchool.country} onChange={(ev) => setNewSchool({ ...newSchool, country: ev.target.value })} />
        </label>
        <label>
          Curriculum
          <select value={newSchool.curriculum} onChange={(ev) => setNewSchool({ ...newSchool, curriculum: ev.target.value })}>
            <option value="">Not known</option>
            {CURRICULA.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <button type="submit">Add school</button>
        {addStatus && <span style={{ color: addStatus.error ? '#a3232c' : undefined, alignSelf: 'center' }}>{addStatus.text}</span>}
      </form>

      <label style={{ maxWidth: '20rem' }}>
        Search
        <input value={filter} onChange={(ev) => setFilter(ev.target.value)} placeholder="Name, town or state" />
      </label>

      {!schools.length ? <p>No schools yet. They are added here or when an application is entered.</p> : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Town</th>
                <th>State</th>
                <th>Country</th>
                <th>Curriculum</th>
                <th>Applicants</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => {
                const e = edits[s.school_id];
                const n = counts[s.school_id] || 0;
                const st = rowStatus[s.school_id];
                return (
                  <tr key={s.school_id}>
                    <td><input style={{ ...cellInput, minWidth: '12rem' }} value={e.name} aria-label="School name" onChange={(ev) => edit(s.school_id, 'name', ev.target.value)} /></td>
                    <td><input style={{ ...cellInput, minWidth: '7rem' }} value={e.town} aria-label="Town" onChange={(ev) => edit(s.school_id, 'town', ev.target.value)} /></td>
                    <td><input style={{ ...cellInput, minWidth: '7rem' }} value={e.state} aria-label="State" onChange={(ev) => edit(s.school_id, 'state', ev.target.value)} /></td>
                    <td><input style={{ ...cellInput, minWidth: '6rem' }} value={e.country} aria-label="Country" onChange={(ev) => edit(s.school_id, 'country', ev.target.value)} /></td>
                    <td>
                      <select style={cellInput} value={e.curriculum} aria-label="Curriculum" onChange={(ev) => edit(s.school_id, 'curriculum', ev.target.value)}>
                        <option value="">Not known</option>
                        {CURRICULA.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                    <td style={{ textAlign: 'center' }}>{n}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button style={cellInput} onClick={() => save(s)} disabled={!isChanged(s)}>Save</button>{' '}
                      {n === 0 && (
                        <button type="button" className="secondary" style={cellInput} onClick={() => remove(s)}>Delete</button>
                      )}{' '}
                      <select
                        style={{ ...cellInput, width: 'auto', maxWidth: '12rem' }}
                        value={mergeInto[s.school_id] ?? ''}
                        aria-label={`Merge ${s.name} into another school`}
                        onChange={(ev) => setMergeInto((prev) => ({ ...prev, [s.school_id]: ev.target.value }))}
                      >
                        <option value="">Merge into…</option>
                        {schools.filter((x) => x.school_id !== s.school_id).map((x) => (
                          <option key={x.school_id} value={x.school_id}>{x.name}{x.town ? `, ${x.town}` : ''}</option>
                        ))}
                      </select>
                      {mergeInto[s.school_id] && (
                        <>{' '}<button type="button" style={cellInput} onClick={() => merge(s)}>Merge</button></>
                      )}
                      {st && <div style={{ fontSize: '0.85em', color: st.error ? '#a3232c' : '#1a7a3d', whiteSpace: 'normal' }}>{st.text}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function PreviousSchoolsPage() {
  return (
    <RequireAuth>
      <RequireResource resourceKey="/admissions/schools">
        <SchoolsInner />
      </RequireResource>
    </RequireAuth>
  );
}
