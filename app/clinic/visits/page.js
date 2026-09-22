'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { Chip, Field } from '../../components/MedicalChips';
import { formatUKDate } from '../../../lib/formatDate';
import {
  VISIT_CATEGORIES, VISIT_OUTCOMES, labelFor, formatDateTime,
  localDateTimeValue, isoDateOffset, isoToday, studentName,
} from '../../../lib/medical';

// The sick bay log across the whole school, and the quickest way to add to
// it: a visit gets recorded while the student is standing there, so the
// form takes a student rather than making the nurse navigate to them first.

const STUDENT_COLS = 'students(student_id, first_name, last_name, year_group, form_class, boarding_house)';

const EMPTY_VISIT = {
  student_id: '', visited_at: '', category: 'illness', reason: '', temperature_c: '',
  observations: '', treatment: '', medication_given: '', dose_given: '',
  outcome: 'returned_to_class', parent_notified: false, follow_up_needed: false,
};

function VisitsInner() {
  const [from, setFrom] = useState(isoDateOffset(-7));
  const [to, setTo] = useState(isoToday());
  const [category, setCategory] = useState('');
  const [visits, setVisits] = useState([]);
  const [students, setStudents] = useState([]);
  const [studentFilter, setStudentFilter] = useState('');
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase.from('student_clinic_visits')
      .select(`visit_id, visited_at, category, reason, temperature_c, treatment, medication_given, dose_given, outcome, parent_notified, follow_up_needed, ${STUDENT_COLS}`)
      .gte('visited_at', new Date(`${from}T00:00:00`).toISOString())
      .lte('visited_at', new Date(`${to}T23:59:59.999`).toISOString())
      .order('visited_at', { ascending: false })
      .limit(500);
    if (category) query = query.eq('category', category);

    const { data, error: err } = await query;
    if (err) setError(err.message); else setError(null);
    setVisits(data || []);
    setLoading(false);
  }, [from, to, category]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('students')
        .select('student_id, first_name, last_name, year_group, form_class')
        .eq('status', 'active')
        .order('last_name');
      setStudents(data || []);
    })();
  }, []);

  async function save(e) {
    e.preventDefault();
    if (!draft.student_id) { setStatus('Pick a student.'); return; }
    if (!draft.reason.trim()) { setStatus('Record what the student came in with.'); return; }
    setStatus('Saving...');
    const { data: userData } = await supabase.auth.getUser();
    const { error: err } = await supabase.from('student_clinic_visits').insert({
      student_id: Number(draft.student_id),
      visited_at: new Date(draft.visited_at).toISOString(),
      category: draft.category || null,
      reason: draft.reason.trim(),
      temperature_c: draft.temperature_c ? Number(draft.temperature_c) : null,
      observations: draft.observations || null,
      treatment: draft.treatment || null,
      medication_given: draft.medication_given || null,
      dose_given: draft.dose_given || null,
      outcome: draft.outcome || null,
      parent_notified: draft.parent_notified,
      parent_notified_at: draft.parent_notified ? new Date().toISOString() : null,
      follow_up_needed: draft.follow_up_needed,
      recorded_by: userData?.user?.id ?? null,
    });
    if (err) { setStatus(`Could not save: ${err.message}`); return; }
    setStatus('Visit recorded.');
    setDraft(null);
    setStudentFilter('');
    load();
  }

  // Marking the parent as told is a one-click job that happens after the
  // fact, so it does not need the whole form reopened.
  async function markNotified(visitId) {
    const { error: err } = await supabase.from('student_clinic_visits')
      .update({ parent_notified: true, parent_notified_at: new Date().toISOString() })
      .eq('visit_id', visitId);
    if (err) { setStatus(`Could not update: ${err.message}`); return; }
    setStatus('Marked as notified.');
    load();
  }

  async function clearFollowUp(visitId) {
    const { error: err } = await supabase.from('student_clinic_visits')
      .update({ follow_up_needed: false }).eq('visit_id', visitId);
    if (err) { setStatus(`Could not update: ${err.message}`); return; }
    setStatus('Follow-up closed.');
    load();
  }

  const matchingStudents = students.filter((s) =>
    studentName(s).toLowerCase().includes(studentFilter.toLowerCase())
  ).slice(0, 50);

  return (
    <main style={{ padding: '1.25rem', maxWidth: 1100, margin: '0 auto' }}>
      <a className="dashboard-back" href="/clinic">← Clinic</a>
      <h1>Sick bay log</h1>

      <div className="card">
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ maxWidth: '10rem' }}>From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label style={{ maxWidth: '10rem' }}>To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label style={{ maxWidth: '12rem' }}>Type
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All</option>
              {VISIT_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </label>
          {!draft && (
            <button type="button" onClick={() => { setDraft({ ...EMPTY_VISIT, visited_at: localDateTimeValue() }); setStatus(null); }}>
              Record a visit
            </button>
          )}
        </div>
        {status && <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginBottom: 0 }}>{status}</p>}
      </div>

      {draft && (
        <div className="card">
          <h2>Record a visit</h2>
          <form onSubmit={save}>
            <Field label="Student">
              <input
                placeholder="Type a name to search..."
                value={studentFilter}
                onChange={(e) => { setStudentFilter(e.target.value); setDraft({ ...draft, student_id: '' }); }}
              />
              <select
                value={draft.student_id}
                onChange={(e) => setDraft({ ...draft, student_id: e.target.value })}
                size={studentFilter && !draft.student_id ? Math.min(6, matchingStudents.length || 1) : undefined}
                style={{ marginTop: '0.3rem' }}
              >
                <option value="">— pick a student —</option>
                {matchingStudents.map((s) => (
                  <option key={s.student_id} value={s.student_id}>
                    {studentName(s)} ({s.form_class || `Y${s.year_group}`})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="When">
              <input type="datetime-local" value={draft.visited_at} onChange={(e) => setDraft({ ...draft, visited_at: e.target.value })} />
            </Field>
            <Field label="Type">
              <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
                {VISIT_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Presenting complaint">
              <input value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} />
            </Field>
            <Field label="Temperature (°C)">
              <input type="number" step="0.1" min="30" max="45" value={draft.temperature_c} onChange={(e) => setDraft({ ...draft, temperature_c: e.target.value })} />
            </Field>
            <Field label="Observations">
              <textarea rows={2} style={{ width: '100%' }} value={draft.observations} onChange={(e) => setDraft({ ...draft, observations: e.target.value })} />
            </Field>
            <Field label="Treatment given">
              <textarea rows={2} style={{ width: '100%' }} value={draft.treatment} onChange={(e) => setDraft({ ...draft, treatment: e.target.value })} />
            </Field>
            <Field label="Medication given">
              <input value={draft.medication_given} onChange={(e) => setDraft({ ...draft, medication_given: e.target.value })} />
            </Field>
            <Field label="Dose given">
              <input value={draft.dose_given} onChange={(e) => setDraft({ ...draft, dose_given: e.target.value })} />
            </Field>
            <Field label="Outcome">
              <select value={draft.outcome} onChange={(e) => setDraft({ ...draft, outcome: e.target.value })}>
                {VISIT_OUTCOMES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.85rem', marginBottom: '0.3rem' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={draft.parent_notified} onChange={(e) => setDraft({ ...draft, parent_notified: e.target.checked })} />
              Parent / guardian notified
            </label>
            <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={draft.follow_up_needed} onChange={(e) => setDraft({ ...draft, follow_up_needed: e.target.checked })} />
              Follow-up needed
            </label>
            <button type="submit">Save visit</button>{' '}
            <button type="button" onClick={() => { setDraft(null); setStatus(null); }}>Cancel</button>
          </form>
        </div>
      )}

      {loading && <p>Loading...</p>}
      {error && (
        <div className="card" style={{ borderColor: '#f3bcbc' }}>
          <p style={{ color: '#a3232c', margin: 0 }}>{error}</p>
          <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginBottom: 0 }}>
            If this says a relation does not exist, migration 128 has not been run against the database yet.
          </p>
        </div>
      )}

      {!loading && !error && (
        <div className="card">
          <h2>{visits.length} visit{visits.length === 1 ? '' : 's'} · {formatUKDate(from)} to {formatUKDate(to)}</h2>
          {visits.length === 0 ? (
            <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>No visits in this range.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr><th>When</th><th>Student</th><th>Type</th><th>Reason</th><th>Temp</th><th>Treatment / medication</th><th>Outcome</th><th>Parent told</th><th></th></tr>
                </thead>
                <tbody>
                  {visits.map((v) => (
                    <tr key={v.visit_id}>
                      <td>{formatDateTime(v.visited_at)}</td>
                      <td>
                        {v.students
                          ? <a href={`/students/${v.students.student_id}`}>{studentName(v.students)}</a>
                          : 'Unknown student'}
                        <div style={{ fontSize: '0.75rem', color: 'var(--ink-soft)' }}>
                          {v.students?.form_class || (v.students ? `Y${v.students.year_group}` : '')}
                          {v.students?.boarding_house ? ` · ${v.students.boarding_house}` : ''}
                        </div>
                      </td>
                      <td>{labelFor(VISIT_CATEGORIES, v.category) || '—'}</td>
                      <td>{v.reason}{v.follow_up_needed && <> <Chip tone="warn">follow-up</Chip></>}</td>
                      <td>{v.temperature_c ? `${v.temperature_c}°C` : '—'}</td>
                      <td>{[v.treatment, v.medication_given, v.dose_given].filter(Boolean).join(' · ') || '—'}</td>
                      <td>{labelFor(VISIT_OUTCOMES, v.outcome) || '—'}</td>
                      <td>{v.parent_notified ? <Chip tone="good">Yes</Chip> : <Chip tone="bad">No</Chip>}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {!v.parent_notified && <button type="button" onClick={() => markNotified(v.visit_id)}>Parent told</button>}
                        {v.follow_up_needed && <> <button type="button" onClick={() => clearFollowUp(v.visit_id)}>Close</button></>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </main>
  );
}

export default function ClinicVisitsPage() {
  return (
    <RequireAuth>
      <RequireResource resourceKey="/clinic/visits">
        <VisitsInner />
      </RequireResource>
    </RequireAuth>
  );
}
