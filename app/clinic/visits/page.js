'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { Chip, Field } from '../../components/MedicalChips';
import StudentFilterBar, { useStudentFilterOptions, StudentPhoto } from '../../components/StudentFilterBar';
import { formatUKDate } from '../../../lib/formatDate';
import {
  VISIT_CATEGORIES, VISIT_OUTCOMES, labelFor, formatDateTime,
  localDateTimeValue, isoDateOffset, isoToday, studentName,
  matchesStudentFilter, EMPTY_STUDENT_FILTER,
} from '../../../lib/medical';

// The sick bay log across the whole school, and the quickest way to add to
// it: a visit gets recorded while the student is standing there, so the form
// takes a student rather than making the nurse navigate to them first.
//
// Each visit is a card rather than a table row. A visit carries a dozen
// fields — observations, treatment, medication, dose, outcome, who was told
// — and as columns they were squeezed to a few characters each. A card gives
// every field a label and room, without dropping any of them.

const STUDENT_COLS =
  'students(student_id, first_name, last_name, year_group, form_class, gender, boarding_house, admission_number)';

const EMPTY_VISIT = {
  student_id: '', visited_at: '', category: 'illness', reason: '', temperature_c: '',
  observations: '', treatment: '', medication_given: '', dose_given: '',
  outcome: 'returned_to_class', parent_notified: false, follow_up_needed: false,
};

function Detail({ label, children }) {
  return (
    <div>
      <div className="visit-detail-label">{label}</div>
      <div className="visit-detail-value">{children || '—'}</div>
    </div>
  );
}

function VisitsInner() {
  const options = useStudentFilterOptions();
  // Two layers of filter, and they behave differently on purpose.
  //
  // The student filters (year, form, gender, house, name) narrow rows that
  // are already in the browser, so they apply as you type.
  //
  // The date range and visit type decide what gets fetched at all. Those sit
  // in `draft` until Load is pressed — re-querying on every change meant a
  // half-typed date like "0002-09-15" fired a pointless request, and on a
  // school connection that is the difference between usable and not.
  const [query, setQuery] = useState({ from: isoDateOffset(-7), to: isoToday(), category: '' });
  const [appliedQuery, setAppliedQuery] = useState(query);
  const { from, to, category } = appliedQuery;
  const [filter, setFilter] = useState({ ...EMPTY_STUDENT_FILTER });
  const [visits, setVisits] = useState([]);
  const [photos, setPhotos] = useState({});
  const [students, setStudents] = useState([]);
  const [studentFilter, setStudentFilter] = useState('');
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);

  const load = useCallback(async () => {
    // A date input reports partial values while being typed ("0002-09-15"),
    // which makes an out-of-range timestamp. Skip rather than send it.
    const fromDate = new Date(`${from}T00:00:00`);
    const toDate = new Date(`${to}T23:59:59.999`);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      setError('Enter a valid From and To date.');
      setLoading(false);
      return;
    }
    setLoading(true);
    let query = supabase.from('student_clinic_visits')
      .select(`visit_id, visited_at, category, reason, temperature_c, observations, treatment, medication_given, dose_given, outcome, parent_notified, parent_notified_at, follow_up_needed, ${STUDENT_COLS}`)
      .gte('visited_at', fromDate.toISOString())
      .lte('visited_at', toDate.toISOString())
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
        .eq('status', 'active').order('last_name');
      setStudents(data || []);
    })();
  }, []);

  const dirty = query.from !== appliedQuery.from || query.to !== appliedQuery.to || query.category !== appliedQuery.category;

  // The student filters run over what is already loaded, so changing them is
  // instant and does not re-query.
  const filtered = useMemo(
    () => visits.filter((v) => matchesStudentFilter(v.students, filter)),
    [visits, filter]
  );

  // Photos are ~28 kB each, so only the students actually on screen.
  useEffect(() => {
    const missing = Array.from(new Set(filtered.map((v) => v.students?.student_id).filter(Boolean)))
      .filter((id) => !(id in photos)).slice(0, 80);
    if (missing.length === 0) return;
    (async () => {
      const { data } = await supabase.from('students').select('student_id, photo_base64').in('student_id', missing);
      setPhotos((p) => ({
        ...p,
        ...Object.fromEntries(missing.map((id) => [id, null])),
        ...Object.fromEntries((data || []).map((r) => [r.student_id, r.photo_base64])),
      }));
    })();
  }, [filtered, photos]);

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

      <StudentFilterBar
        filter={filter}
        onChange={setFilter}
        options={options}
        resultCount={filtered.length}
        totalCount={visits.length}
        onLoad={() => setAppliedQuery(query)}
        loading={loading}
        dirty={dirty}
        extra={
          <>
            <div className="filter-date-pair">
              <label style={{ maxWidth: '9.5rem' }}>From
                <input type="date" value={query.from} onChange={(e) => setQuery({ ...query, from: e.target.value })} />
              </label>
              <label style={{ maxWidth: '9.5rem' }}>To
                <input type="date" value={query.to} onChange={(e) => setQuery({ ...query, to: e.target.value })} />
              </label>
            </div>
            <label style={{ maxWidth: '10rem' }}>Visit type
              <select value={query.category} onChange={(e) => setQuery({ ...query, category: e.target.value })}>
                <option value="">All</option>
                {VISIT_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </label>
          </>
        }
      />

      {!draft && (
        <div style={{ marginBottom: '1rem' }}>
          <button type="button" onClick={() => { setDraft({ ...EMPTY_VISIT, visited_at: localDateTimeValue() }); setStatus(null); }}>
            Record a visit
          </button>
          {status && <span style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginLeft: '0.6rem' }}>{status}</span>}
        </div>
      )}

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
            <div className="form-grid">
              <Field label="When">
                <input type="datetime-local" value={draft.visited_at} onChange={(e) => setDraft({ ...draft, visited_at: e.target.value })} />
              </Field>
              <Field label="Type">
                <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
                  {VISIT_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </Field>
              <Field label="Temperature (°C)">
                <input type="number" step="0.1" min="30" max="45" value={draft.temperature_c} onChange={(e) => setDraft({ ...draft, temperature_c: e.target.value })} />
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
              <Field label="Presenting complaint">
                <textarea rows={2} style={{ width: '100%' }} value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} />
              </Field>
              <Field label="Observations">
                <textarea rows={2} style={{ width: '100%' }} value={draft.observations} onChange={(e) => setDraft({ ...draft, observations: e.target.value })} />
              </Field>
              <Field label="Treatment given">
                <textarea rows={2} style={{ width: '100%' }} value={draft.treatment} onChange={(e) => setDraft({ ...draft, treatment: e.target.value })} />
              </Field>
            </div>
            <div className="check-grid">
              <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.85rem' }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={draft.parent_notified} onChange={(e) => setDraft({ ...draft, parent_notified: e.target.checked })} />
                Parent / guardian notified
              </label>
              <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.85rem' }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={draft.follow_up_needed} onChange={(e) => setDraft({ ...draft, follow_up_needed: e.target.checked })} />
                Follow-up needed
              </label>
            </div>
            <div style={{ marginTop: '0.75rem' }}>
              <button type="submit">Save visit</button>{' '}
              <button type="button" onClick={() => { setDraft(null); setStatus(null); }}>Cancel</button>
              {status && <span style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginLeft: '0.6rem' }}>{status}</span>}
            </div>
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
        <>
          <h2 style={{ margin: '0 0 0.7rem' }}>
            {filtered.length} visit{filtered.length === 1 ? '' : 's'} · {formatUKDate(from)} to {formatUKDate(to)}
          </h2>

          {filtered.length === 0 && (
            <div className="card"><p style={{ margin: 0 }}>No visits match these filters.</p></div>
          )}

          {filtered.map((v) => {
            const s = v.students;
            const urgent = v.outcome === 'sent_home' || v.outcome === 'referred_to_hospital';
            const cls = `visit-card${urgent ? ' is-urgent' : v.follow_up_needed ? ' is-followup' : ''}`;
            return (
              <div key={v.visit_id} className={cls}>
                <div className="visit-card-head">
                  <div className="visit-card-who">
                    <StudentPhoto student={{ ...s, photo_base64: photos[s?.student_id] }} size={48} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700 }}>
                        {s ? <a href={`/students/${s.student_id}`}>{studentName(s)}</a> : 'Unknown student'}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--ink-soft)' }}>
                        {s?.form_class || (s ? `Year ${s.year_group}` : '')}
                        {s?.boarding_house ? ` · ${s.boarding_house}` : ''}
                        {s?.gender ? ` · ${s.gender}` : ''}
                      </div>
                    </div>
                  </div>
                  <div className="visit-card-meta">
                    <div>{formatDateTime(v.visited_at)}</div>
                    <div style={{ marginTop: '0.3rem' }}>
                      <Chip tone="neutral">{labelFor(VISIT_CATEGORIES, v.category) || 'Unspecified'}</Chip>
                      {v.follow_up_needed && <Chip tone="warn">Follow-up</Chip>}
                      {urgent && <Chip tone="bad">{labelFor(VISIT_OUTCOMES, v.outcome)}</Chip>}
                    </div>
                  </div>
                </div>

                <p className="visit-card-reason">{v.reason}</p>

                <div className="visit-detail-grid">
                  <Detail label="Temperature">{v.temperature_c ? `${v.temperature_c} °C` : null}</Detail>
                  <Detail label="Outcome">{labelFor(VISIT_OUTCOMES, v.outcome)}</Detail>
                  <Detail label="Medication">{v.medication_given}</Detail>
                  <Detail label="Dose">{v.dose_given}</Detail>
                  <Detail label="Parent told">
                    {v.parent_notified
                      ? <Chip tone="good">Yes{v.parent_notified_at ? ` · ${formatUKDate(v.parent_notified_at.slice(0, 10))}` : ''}</Chip>
                      : <Chip tone="bad">No</Chip>}
                  </Detail>
                </div>

                <div className="visit-notes-grid">
                  <Detail label="Observations">{v.observations}</Detail>
                  <Detail label="Treatment">{v.treatment}</Detail>
                </div>

                {(!v.parent_notified || v.follow_up_needed) && (
                  <div className="visit-card-actions">
                    {!v.parent_notified && <button type="button" onClick={() => markNotified(v.visit_id)}>Mark parent told</button>}
                    {v.follow_up_needed && <button type="button" onClick={() => clearFollowUp(v.visit_id)}>Close follow-up</button>}
                  </div>
                )}
              </div>
            );
          })}
        </>
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
