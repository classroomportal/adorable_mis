'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { formatUKDate } from '../../../lib/formatDate';
import { formatTimeRange } from '../../../lib/formatTime';
import {
  OH_DAYS, OH_DAY_NAMES, formatYearGroups, loadOtherHalfSlots, loadCurrentOtherHalfTermId,
  staffByActivity, staffNames,
} from '../../../lib/otherHalf';

const EMPTY_FORM = {
  activity_id: null,
  day_of_week: 'Mon',
  activity_name: '',
  description: '',
  room: '',
  capacity: '',
  year_groups: [],
  staff_ids: [],
};

// <input type="datetime-local"> works in the device's zone; the school is on
// Lagos time (UTC+1, no DST), so convert explicitly rather than trusting it.
function toLagosLocalInput(ts) {
  if (!ts) return '';
  const d = new Date(new Date(ts).getTime() + 60 * 60 * 1000);
  return d.toISOString().slice(0, 16);
}
function fromLagosLocalInput(v) {
  if (!v) return null;
  return new Date(`${v}:00+01:00`).toISOString();
}

function ActivitiesInner() {
  const [terms, setTerms] = useState([]);
  const [termId, setTermId] = useState(null);
  const [slots, setSlots] = useState({ days: [], byDay: {} });
  const [staff, setStaff] = useState([]);
  const [yearOptions, setYearOptions] = useState([]);
  const [activities, setActivities] = useState([]);
  const [staffMap, setStaffMap] = useState({});
  const [taken, setTaken] = useState({});
  const [window_, setWindow] = useState({ choices_open: false, choices_close_at: '' });
  const [form, setForm] = useState(null);
  const [staffFilter, setStaffFilter] = useState('');
  const [status, setStatus] = useState(null);
  const [windowStatus, setWindowStatus] = useState(null);
  const [copyFrom, setCopyFrom] = useState('');

  useEffect(() => {
    async function loadStatic() {
      const [{ data: t }, s, { data: st }, { data: yrs }, currentTerm] = await Promise.all([
        supabase.from('terms').select('*').order('start_date'),
        loadOtherHalfSlots(),
        supabase.from('staff').select('staff_id, first_name, last_name, staff_code').order('last_name'),
        supabase.from('students').select('year_group').eq('status', 'active'),
        loadCurrentOtherHalfTermId(),
      ]);
      setTerms(t || []);
      setSlots(s);
      setStaff(st || []);
      setYearOptions([...new Set((yrs || []).map((r) => r.year_group).filter((y) => y != null))].sort((a, b) => a - b));
      setTermId(currentTerm ?? t?.[0]?.term_id ?? null);
    }
    loadStatic();
  }, []);

  async function loadTerm() {
    if (!termId) return;
    const { data: acts } = await supabase
      .from('other_half_activities')
      .select('*')
      .eq('term_id', termId)
      .order('activity_name');
    const ids = (acts || []).map((a) => a.activity_id);
    const [{ data: st }, { data: counts }, { data: w }] = await Promise.all([
      ids.length
        ? supabase.from('other_half_activity_staff').select('activity_id, staff_id, staff(staff_id, first_name, last_name)').in('activity_id', ids)
        : Promise.resolve({ data: [] }),
      supabase.rpc('other_half_places_taken', { p_term_id: termId }),
      supabase.from('other_half_terms').select('*').eq('term_id', termId).maybeSingle(),
    ]);
    setActivities(acts || []);
    setStaffMap(staffByActivity(st));
    setTaken(Object.fromEntries((counts || []).map((c) => [c.activity_id, c.taken])));
    setWindow({ choices_open: !!w?.choices_open, choices_close_at: toLagosLocalInput(w?.choices_close_at) });
  }

  useEffect(() => { loadTerm(); setForm(null); setStatus(null); setWindowStatus(null); }, [termId]);

  async function saveWindow(next) {
    const row = {
      term_id: termId,
      choices_open: next.choices_open,
      choices_close_at: fromLagosLocalInput(next.choices_close_at),
    };
    setWindowStatus('Saving...');
    const { error } = await supabase.from('other_half_terms').upsert(row, { onConflict: 'term_id' });
    if (error) { setWindowStatus(`Error: ${error.message}`); return; }
    setWindow(next);
    setWindowStatus(next.choices_open ? 'Choices are open to students.' : 'Choices are closed.');
  }

  function startNew(day) {
    setForm({ ...EMPTY_FORM, day_of_week: day || slots.days[0] || 'Mon', year_groups: [...yearOptions] });
    setStaffFilter('');
    setStatus(null);
  }

  function startEdit(a) {
    setForm({
      activity_id: a.activity_id,
      day_of_week: a.day_of_week,
      activity_name: a.activity_name,
      description: a.description || '',
      room: a.room || '',
      capacity: a.capacity == null ? '' : String(a.capacity),
      year_groups: [...a.year_groups],
      staff_ids: (staffMap[a.activity_id] || []).map((s) => s.staff_id),
    });
    setStaffFilter('');
    setStatus(null);
  }

  function toggleIn(list, value) {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  async function saveActivity(e) {
    e.preventDefault();
    if (!form.activity_name.trim()) { setStatus('Give the activity a name.'); return; }
    if (form.year_groups.length === 0) { setStatus('Tick at least one year group.'); return; }
    const capacity = form.capacity.trim() === '' ? null : Number(form.capacity);
    if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1)) { setStatus('Places must be a whole number above 0, or blank for no limit.'); return; }

    const row = {
      term_id: termId,
      day_of_week: form.day_of_week,
      activity_name: form.activity_name.trim(),
      description: form.description.trim() || null,
      room: form.room.trim() || null,
      capacity,
      year_groups: [...form.year_groups].sort((a, b) => a - b),
    };
    if (form.activity_id && form.day_of_week !== activities.find((a) => a.activity_id === form.activity_id)?.day_of_week && (taken[form.activity_id] || 0) > 0) {
      setStatus('Students have already chosen this activity for its current day. Add a new activity on the other day instead.');
      return;
    }
    setStatus('Saving...');
    let activityId = form.activity_id;
    if (activityId) {
      const { error } = await supabase.from('other_half_activities').update(row).eq('activity_id', activityId);
      if (error) { setStatus(`Error: ${error.message}`); return; }
    } else {
      const { data, error } = await supabase.from('other_half_activities').insert(row).select('activity_id').single();
      if (error) { setStatus(`Error: ${error.message}`); return; }
      activityId = data.activity_id;
    }

    const before = new Set((staffMap[activityId] || []).map((s) => s.staff_id));
    const after = new Set(form.staff_ids);
    const toAdd = [...after].filter((id) => !before.has(id)).map((staff_id) => ({ activity_id: activityId, staff_id }));
    const toRemove = [...before].filter((id) => !after.has(id));
    if (toAdd.length) {
      const { error } = await supabase.from('other_half_activity_staff').insert(toAdd);
      if (error) { setStatus(`Saved the activity, but not its staff: ${error.message}`); loadTerm(); return; }
    }
    if (toRemove.length) {
      const { error } = await supabase.from('other_half_activity_staff').delete().eq('activity_id', activityId).in('staff_id', toRemove);
      if (error) { setStatus(`Saved the activity, but not its staff: ${error.message}`); loadTerm(); return; }
    }
    setStatus(`Saved ${row.activity_name}.`);
    setForm(null);
    loadTerm();
  }

  async function setActive(a, isActive) {
    const { error } = await supabase.from('other_half_activities').update({ is_active: isActive }).eq('activity_id', a.activity_id);
    if (error) setStatus(`Error: ${error.message}`);
    else loadTerm();
  }

  async function deleteActivity(a) {
    if ((taken[a.activity_id] || 0) > 0) {
      setStatus(`${a.activity_name} has students on it, so it can't be deleted — move them first on Student Choices, or retire it instead.`);
      return;
    }
    if (!window.confirm(`Delete ${a.activity_name} (${OH_DAY_NAMES[a.day_of_week]})?`)) return;
    const { error } = await supabase.from('other_half_activities').delete().eq('activity_id', a.activity_id);
    // 23503: an OH register was taken in it — attendance points at it.
    if (error) setStatus(error.code === '23503' ? `${a.activity_name} is in use, so retire it instead of deleting it.` : `Error: ${error.message}`);
    else { setStatus(`Deleted ${a.activity_name}.`); loadTerm(); }
  }

  // Terms usually repeat the programme, so start a term from another one:
  // activities and staff are copied; student choices are not.
  async function copyProgramme() {
    if (!copyFrom) return;
    const fromTerm = terms.find((t) => String(t.term_id) === String(copyFrom));
    if (!window.confirm(`Copy every active activity from ${fromTerm?.term_name} into this term? Nothing already here is changed.`)) return;
    setStatus('Copying...');
    const { data: src, error } = await supabase
      .from('other_half_activities')
      .select('*, other_half_activity_staff(staff_id)')
      .eq('term_id', copyFrom)
      .eq('is_active', true);
    if (error) { setStatus(`Error: ${error.message}`); return; }
    let copied = 0;
    for (const a of src || []) {
      const { data: ins, error: insErr } = await supabase
        .from('other_half_activities')
        .insert({
          term_id: termId, day_of_week: a.day_of_week, activity_name: a.activity_name,
          description: a.description, room: a.room, capacity: a.capacity, year_groups: a.year_groups,
        })
        .select('activity_id')
        .single();
      if (insErr) { setStatus(`Copied ${copied}, then: ${insErr.message}`); loadTerm(); return; }
      const staffRows = (a.other_half_activity_staff || []).map((s) => ({ activity_id: ins.activity_id, staff_id: s.staff_id }));
      if (staffRows.length) await supabase.from('other_half_activity_staff').insert(staffRows);
      copied += 1;
    }
    setStatus(`Copied ${copied} activit${copied === 1 ? 'y' : 'ies'}.`);
    setCopyFrom('');
    loadTerm();
  }

  const term = terms.find((t) => t.term_id === termId);
  const days = slots.days.length ? slots.days : OH_DAYS;
  const byDay = Object.fromEntries(days.map((d) => [d, activities.filter((a) => a.day_of_week === d)]));
  const offDay = activities.filter((a) => !days.includes(a.day_of_week));
  const filteredStaff = staff.filter((s) =>
    !staffFilter.trim() || `${s.first_name} ${s.last_name} ${s.staff_code || ''}`.toLowerCase().includes(staffFilter.trim().toLowerCase()));

  function renderActivityRow(a) {
    const n = taken[a.activity_id] || 0;
    const full = a.capacity != null && n >= a.capacity;
    return (
      <tr key={a.activity_id} style={a.is_active ? undefined : { opacity: 0.55 }}>
        <td>
          <strong>{a.activity_name}</strong>{!a.is_active && ' (retired)'}
          {a.description && <div style={{ fontSize: '0.85em', color: '#666' }}>{a.description}</div>}
        </td>
        <td>{a.room || '—'}</td>
        <td>{staffNames(staffMap[a.activity_id]) || <span style={{ color: '#b45309' }}>No staff yet</span>}</td>
        <td>{formatYearGroups(a.year_groups)}</td>
        <td style={full ? { color: '#b91c1c', fontWeight: 600 } : undefined}>{n}{a.capacity != null ? ` / ${a.capacity}` : ''}</td>
        <td style={{ whiteSpace: 'nowrap' }}>
          <button type="button" className="secondary" onClick={() => startEdit(a)}>Edit</button>{' '}
          {a.is_active
            ? <button type="button" className="secondary" onClick={() => setActive(a, false)}>Retire</button>
            : <button type="button" className="secondary" onClick={() => setActive(a, true)}>Restore</button>}{' '}
          <button type="button" className="secondary" onClick={() => deleteActivity(a)}>Delete</button>
        </td>
      </tr>
    );
  }

  return (
    <div>
      <h1>Other Half — Activity Programme</h1>
      <p style={{ color: '#666', marginTop: 0 }}>
        Each activity runs every week of the term on its day, in the Other Half slot. Students choose one activity per day from
        those open to their year. This programme lives in Formwork — importing the Nova-T timetable never changes it.
      </p>

      <div className="card">
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label>
            Term
            <select value={termId ?? ''} onChange={(e) => setTermId(Number(e.target.value))}>
              {terms.map((t) => <option key={t.term_id} value={t.term_id}>{t.term_name}</option>)}
            </select>
            {term && <span style={{ display: 'block', fontSize: '0.75rem', color: '#666', marginTop: '0.2rem' }}>{formatUKDate(term.start_date)} – {formatUKDate(term.end_date)}</span>}
          </label>
          <label>
            <span style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={window_.choices_open}
                onChange={(e) => saveWindow({ ...window_, choices_open: e.target.checked })}
                style={{ width: 'auto' }}
              />
              Students can choose
            </span>
          </label>
          <label>
            Choices close (school time, optional)
            <input
              type="datetime-local"
              value={window_.choices_close_at}
              onChange={(e) => setWindow({ ...window_, choices_close_at: e.target.value })}
              onBlur={() => saveWindow(window_)}
            />
          </label>
        </div>
        {windowStatus && <p style={{ marginBottom: 0 }}>{windowStatus}</p>}
      </div>

      {activities.length === 0 && terms.length > 1 && (
        <div className="card">
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label>
              Start this term from another term&apos;s programme
              <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
                <option value="">Choose a term...</option>
                {terms.filter((t) => t.term_id !== termId).map((t) => <option key={t.term_id} value={t.term_id}>{t.term_name}</option>)}
              </select>
            </label>
            <button type="button" onClick={copyProgramme} disabled={!copyFrom}>Copy activities</button>
          </div>
        </div>
      )}

      {status && <p><strong>{status}</strong></p>}

      {form && (
        <form onSubmit={saveActivity} className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <h2 style={{ marginTop: 0 }}>{form.activity_id ? `Edit ${form.activity_name || 'activity'}` : 'New activity'}</h2>
          <div className="form-grid">
            <label>
              Day
              <select value={form.day_of_week} onChange={(e) => setForm({ ...form, day_of_week: e.target.value })}>
                {days.map((d) => <option key={d} value={d}>{OH_DAY_NAMES[d]}</option>)}
              </select>
            </label>
            <label>
              Activity
              <input value={form.activity_name} onChange={(e) => setForm({ ...form, activity_name: e.target.value })} placeholder="e.g. Chess Club" required />
            </label>
            <label>
              Room / venue
              <input value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} placeholder="e.g. Sports Hall" />
            </label>
            <label>
              Places (blank = no limit)
              <input type="number" min="1" step="1" inputMode="numeric" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
            </label>
          </div>
          <label style={{ marginTop: '0.75rem' }}>
            Description (students see this when choosing)
            <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </label>

          <fieldset style={{ marginTop: '0.75rem', border: '1px solid #ddd', borderRadius: 6, padding: '0.5rem 0.75rem' }}>
            <legend>Open to</legend>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              {yearOptions.map((y) => (
                <label key={y} style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={form.year_groups.includes(y)} onChange={() => setForm({ ...form, year_groups: toggleIn(form.year_groups, y) })} />
                  Year {y}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset style={{ marginTop: '0.75rem', border: '1px solid #ddd', borderRadius: 6, padding: '0.5rem 0.75rem' }}>
            <legend>Staff running it{form.staff_ids.length ? ` (${form.staff_ids.length})` : ''}</legend>
            {form.staff_ids.length > 0 && (
              <p style={{ margin: '0 0 0.5rem' }}>
                {form.staff_ids.map((id) => staff.find((s) => s.staff_id === id)).filter(Boolean).map((s) => (
                  <span key={s.staff_id} className="badge" style={{ marginRight: '0.35rem' }}>
                    {s.first_name} {s.last_name}{' '}
                    <button type="button" className="secondary" style={{ padding: '0 0.3rem' }} aria-label={`Remove ${s.first_name} ${s.last_name}`} onClick={() => setForm({ ...form, staff_ids: form.staff_ids.filter((x) => x !== s.staff_id) })}>×</button>
                  </span>
                ))}
              </p>
            )}
            <input placeholder="Search staff by name or code" value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)} />
            <div style={{ maxHeight: '12rem', overflowY: 'auto', marginTop: '0.4rem' }}>
              {filteredStaff.map((s) => (
                <label key={s.staff_id} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', padding: '0.1rem 0' }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={form.staff_ids.includes(s.staff_id)} onChange={() => setForm({ ...form, staff_ids: toggleIn(form.staff_ids, s.staff_id) })} />
                  {s.first_name} {s.last_name}{s.staff_code ? <span style={{ color: '#888' }}> · {s.staff_code}</span> : ''}
                </label>
              ))}
            </div>
          </fieldset>

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            <button type="submit">Save activity</button>
            <button type="button" className="secondary" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      )}

      {days.map((d) => (
        <div key={d} className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
            <h2 style={{ margin: 0 }}>
              {OH_DAY_NAMES[d]}
              {slots.byDay[d] && <span style={{ fontWeight: 400, fontSize: '0.8em', color: '#666' }}> · {formatTimeRange(slots.byDay[d].start_time, slots.byDay[d].end_time)}</span>}
            </h2>
            <button type="button" className="secondary" onClick={() => startNew(d)}>+ Add activity</button>
          </div>
          {byDay[d].length === 0 ? (
            <p style={{ color: '#666' }}>No activities yet.</p>
          ) : (
            <div className="table-scroll"><table>
              <thead><tr><th>Activity</th><th>Room</th><th>Staff</th><th>Open to</th><th>Chosen</th><th></th></tr></thead>
              <tbody>{byDay[d].map(renderActivityRow)}</tbody>
            </table></div>
          )}
        </div>
      ))}

      {offDay.length > 0 && (
        <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch', borderColor: '#b45309' }}>
          <h2 style={{ marginTop: 0 }}>On a day with no Other Half</h2>
          <p style={{ color: '#666' }}>Bell Times has no Other Half on these days, so they won&apos;t appear on anyone&apos;s timetable.</p>
          <div className="table-scroll"><table>
            <thead><tr><th>Activity</th><th>Room</th><th>Staff</th><th>Open to</th><th>Chosen</th><th></th></tr></thead>
            <tbody>{offDay.map(renderActivityRow)}</tbody>
          </table></div>
        </div>
      )}
    </div>
  );
}

export default function OtherHalfActivitiesPage() {
  return (
    <RequireAuth><RequireResource resourceKey="/other-half/activities">
      <ActivitiesInner />
    </RequireResource></RequireAuth>
  );
}
