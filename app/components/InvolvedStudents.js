'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

// Other students in a serious (Stage 5) behaviour event: witnesses, others
// involved and targets (behaviour_event_students, migration 303). Staff only:
// students and parents never see these links, which is why the explanation
// still mustn't name anyone. Adding, changing and removing them is allowed to
// whoever can edit the event; the database checks that.

export const INVOLVEMENTS = [
  { value: 'witness', label: 'Witness' },
  { value: 'involved', label: 'Involved' },
  { value: 'target', label: 'Target' },
];
const involvementLabel = (v) => INVOLVEMENTS.find((i) => i.value === v)?.label || v;
const fullName = (s) => `${s.first_name} ${s.last_name}`;
const MAX_MATCHES = 30;

// Active students, for the filter, fetched once per page.
let studentsPromise = null;
function loadActiveStudents() {
  if (!studentsPromise) {
    studentsPromise = supabase
      .from('students')
      .select('student_id, first_name, last_name, year_group, boarding_house')
      .eq('status', 'active')
      .order('last_name')
      .then(({ data }) => data || []);
  }
  return studentsPromise;
}

// The filter: narrow by name, year group and house, then add a match as a
// witness, involved or target. `chosen` is [{ student_id, involvement }];
// `excludeIds` are the students the event itself is about.
export function InvolvedStudentsPicker({ chosen, onChange, excludeIds = [], students: given, disabled }) {
  const [loaded, setLoaded] = useState(given || []);
  const [filter, setFilter] = useState({ name: '', year: '', house: '' });
  useEffect(() => {
    if (given) setLoaded(given); else loadActiveStudents().then(setLoaded);
  }, [given]);

  const students = loaded;
  const byId = Object.fromEntries(students.map((s) => [s.student_id, s]));
  const years = [...new Set(students.map((s) => s.year_group).filter(Boolean))].sort((a, b) => a - b);
  const houses = [...new Set(students.map((s) => s.boarding_house).filter(Boolean))].sort();
  const taken = new Set([...excludeIds.map(Number), ...chosen.map((c) => c.student_id)]);

  const name = filter.name.trim().toLowerCase();
  const filtering = name || filter.year || filter.house;
  const matches = filtering
    ? students.filter((s) => !taken.has(s.student_id)
        && (!name || fullName(s).toLowerCase().includes(name))
        && (!filter.year || String(s.year_group) === filter.year)
        && (!filter.house || s.boarding_house === filter.house))
    : [];

  const set = (k) => (e) => setFilter((f) => ({ ...f, [k]: e.target.value }));
  const add = (student_id, involvement) => onChange([...chosen, { student_id, involvement }]);
  const change = (student_id, involvement) => onChange(chosen.map((c) => (c.student_id === student_id ? { ...c, involvement } : c)));
  const remove = (student_id) => onChange(chosen.filter((c) => c.student_id !== student_id));

  return (
    <div className="bl-involved">
      {chosen.length > 0 && (
        <ul className="bl-involved-list">
          {chosen.map((c) => (
            <li key={c.student_id}>
              <span>{byId[c.student_id] ? fullName(byId[c.student_id]) : c.name || `Student #${c.student_id}`}</span>
              <select value={c.involvement} onChange={(e) => change(c.student_id, e.target.value)} disabled={disabled} aria-label="Part in the event">
                {INVOLVEMENTS.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
              </select>
              <button type="button" className="secondary bl-small" onClick={() => remove(c.student_id)} disabled={disabled}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <div className="bl-row bl-filters">
        <label>
          Find a student
          <input type="search" value={filter.name} onChange={set('name')} placeholder="Name…" disabled={disabled} />
        </label>
        <label>
          Year group
          <select value={filter.year} onChange={set('year')} disabled={disabled}>
            <option value="">All years</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label>
          House
          <select value={filter.house} onChange={set('house')} disabled={disabled}>
            <option value="">All houses</option>
            {houses.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
        </label>
      </div>
      {filtering && (
        matches.length === 0 ? <p className="bl-hint" style={{ margin: 0 }}>No students match.</p> : (
          <div className="bl-involved-matches">
            {matches.slice(0, MAX_MATCHES).map((s) => (
              <div key={s.student_id}>
                <span>{fullName(s)}<span className="bl-hint"> · Y{s.year_group ?? '?'}{s.boarding_house ? ` · ${s.boarding_house}` : ''}</span></span>
                <span className="bl-involved-add">
                  {INVOLVEMENTS.map((i) => (
                    <button key={i.value} type="button" className="secondary bl-small" onClick={() => add(s.student_id, i.value)} disabled={disabled}>
                      {i.label}
                    </button>
                  ))}
                </span>
              </div>
            ))}
            {matches.length > MAX_MATCHES && (
              <p className="bl-hint" style={{ margin: '0.3rem 0 0' }}>
                {matches.length - MAX_MATCHES} more — narrow the filter.
              </p>
            )}
          </div>
        )
      )}
    </div>
  );
}

// Save links for newly logged events: every event gets the same students.
export async function saveInvolvedStudents(eventIds, chosen) {
  if (!eventIds.length || !chosen.length) return { error: null };
  const rows = eventIds.flatMap((event_id) => chosen.map((c) => ({ event_id, student_id: c.student_id, involvement: c.involvement })));
  return supabase.from('behaviour_event_students').insert(rows);
}

// The links on one existing event, shown under its comment, with the picker
// for those allowed to edit the event.
export function EventInvolvedStudents({ event, canEdit }) {
  const [links, setLinks] = useState(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data, error: err } = await supabase
      .from('behaviour_event_students')
      .select('student_id, involvement, students(first_name, last_name)')
      .eq('event_id', event.event_id)
      .order('added_at');
    if (err) { setError(err.message); setLinks([]); return; }
    setLinks((data || []).map((r) => ({
      student_id: r.student_id,
      involvement: r.involvement,
      name: r.students ? fullName(r.students) : null,
    })));
  }
  useEffect(() => { load(); }, [event.event_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Each change in the picker is saved straight away.
  async function handleChange(next) {
    setBusy(true);
    setError(null);
    const before = new Map(links.map((l) => [l.student_id, l]));
    const after = new Map(next.map((l) => [l.student_id, l]));
    let err = null;
    for (const [id, l] of after) {
      const old = before.get(id);
      if (!old) ({ error: err } = await supabase.from('behaviour_event_students').insert({ event_id: event.event_id, student_id: id, involvement: l.involvement }));
      else if (old.involvement !== l.involvement) ({ error: err } = await supabase.from('behaviour_event_students').update({ involvement: l.involvement }).eq('event_id', event.event_id).eq('student_id', id));
      if (err) break;
    }
    if (!err) {
      for (const id of before.keys()) {
        if (!after.has(id)) ({ error: err } = await supabase.from('behaviour_event_students').delete().eq('event_id', event.event_id).eq('student_id', id));
        if (err) break;
      }
    }
    if (err) setError(`Couldn't save: ${err.message}`);
    await load();
    setBusy(false);
  }

  if (links === null) return null;
  if (links.length === 0 && !canEdit) return null;

  return (
    <div className="bl-involved-event" onClick={(e) => e.stopPropagation()}>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: '0.85rem' }}>Other students</strong>
        <span className="bl-hint" style={{ margin: 0 }}>staff only</span>
        {canEdit && (
          <button type="button" className="secondary no-print bl-small" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Done' : links.length ? 'Change' : 'Add'}
          </button>
        )}
      </div>
      {editing ? (
        <InvolvedStudentsPicker chosen={links} onChange={handleChange} excludeIds={[event.students?.student_id ?? event.student_id]} disabled={busy} />
      ) : links.length === 0 ? (
        <span className="bl-hint" style={{ margin: 0 }}>None recorded.</span>
      ) : (
        <span style={{ fontSize: '0.9rem' }}>
          {links.map((l, i) => (
            <span key={l.student_id}>
              {i > 0 && '; '}
              <a href={`/students/${l.student_id}`}>{l.name || `Student #${l.student_id}`}</a> ({involvementLabel(l.involvement).toLowerCase()})
            </span>
          ))}
        </span>
      )}
      {error && <span style={{ color: 'var(--red-700)', fontSize: '0.85rem' }}>{error}</span>}
    </div>
  );
}
