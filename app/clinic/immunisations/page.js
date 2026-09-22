'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { Chip, Stat, Field } from '../../components/MedicalChips';
import { formatUKDate } from '../../../lib/formatDate';
import { isoToday, isoDateOffset, studentName } from '../../../lib/medical';

// Immunisations across the school, ordered by what is due soonest. The
// point of holding next_due_on at all is catching the ones that have gone
// past, so overdue leads and the horizon is adjustable.

const STUDENT_COLS = 'students(student_id, first_name, last_name, year_group, form_class, boarding_house)';

function ImmunisationsInner() {
  const [horizonDays, setHorizonDays] = useState(60);
  const [vaccineFilter, setVaccineFilter] = useState('');
  const [due, setDue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);
  const [draft, setDraft] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    // Rows with no next_due_on are complete records with nothing outstanding,
    // so they are not part of this list at all.
    let query = supabase.from('student_immunisations')
      .select(`immunisation_id, vaccine, dose_label, given_on, next_due_on, batch_number, administered_by, ${STUDENT_COLS}`)
      .not('next_due_on', 'is', null)
      .lte('next_due_on', isoDateOffset(horizonDays))
      .order('next_due_on', { ascending: true })
      .limit(500);
    if (vaccineFilter) query = query.ilike('vaccine', `%${vaccineFilter}%`);

    const { data, error: err } = await query;
    if (err) setError(err.message); else setError(null);
    setDue(data || []);
    setLoading(false);
  }, [horizonDays, vaccineFilter]);

  useEffect(() => { load(); }, [load]);

  // Giving the due dose is the common action here: it records the new dose
  // against the student and clears the old row's due date, so the same jab
  // does not stay on the list forever.
  async function recordGiven(e) {
    e.preventDefault();
    setStatus('Saving...');
    const { data: userData } = await supabase.auth.getUser();
    const { error: insertErr } = await supabase.from('student_immunisations').insert({
      student_id: draft.student_id,
      vaccine: draft.vaccine,
      dose_label: draft.dose_label || null,
      given_on: draft.given_on || null,
      next_due_on: draft.next_due_on || null,
      batch_number: draft.batch_number || null,
      administered_by: draft.administered_by || null,
      recorded_by: userData?.user?.id ?? null,
    });
    if (insertErr) { setStatus(`Could not save: ${insertErr.message}`); return; }

    const { error: clearErr } = await supabase.from('student_immunisations')
      .update({ next_due_on: null }).eq('immunisation_id', draft.from_immunisation_id);
    if (clearErr) { setStatus(`Dose saved, but the old row still shows as due: ${clearErr.message}`); return; }

    setStatus('Dose recorded.');
    setDraft(null);
    load();
  }

  const today = isoToday();
  const overdue = due.filter((i) => i.next_due_on < today);
  const upcoming = due.filter((i) => i.next_due_on >= today);

  function row(i) {
    const isOverdue = i.next_due_on < today;
    return (
      <tr key={i.immunisation_id}>
        <td>
          <Chip tone={isOverdue ? 'bad' : 'neutral'}>
            {formatUKDate(i.next_due_on)}{isOverdue ? ' — overdue' : ''}
          </Chip>
        </td>
        <td>
          {i.students
            ? <a href={`/students/${i.students.student_id}`}>{studentName(i.students)}</a>
            : 'Unknown student'}
          <div style={{ fontSize: '0.75rem', color: 'var(--ink-soft)' }}>
            {i.students?.form_class || (i.students ? `Y${i.students.year_group}` : '')}
            {i.students?.boarding_house ? ` · ${i.students.boarding_house}` : ''}
          </div>
        </td>
        <td>{i.vaccine}</td>
        <td>{i.dose_label || '—'}</td>
        <td>{i.given_on ? formatUKDate(i.given_on) : '—'}</td>
        <td>
          <button
            type="button"
            onClick={() => {
              setStatus(null);
              setDraft({
                from_immunisation_id: i.immunisation_id,
                student_id: i.students?.student_id,
                student_label: studentName(i.students),
                vaccine: i.vaccine,
                dose_label: '',
                given_on: today,
                next_due_on: '',
                batch_number: '',
                administered_by: '',
              });
            }}
          >
            Record dose
          </button>
        </td>
      </tr>
    );
  }

  return (
    <main style={{ padding: '1.25rem', maxWidth: 1100, margin: '0 auto' }}>
      <a className="dashboard-back" href="/clinic">← Clinic</a>
      <h1>Immunisations</h1>

      <div className="card">
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ maxWidth: '12rem' }}>Due within
            <select value={horizonDays} onChange={(e) => setHorizonDays(Number(e.target.value))}>
              <option value={0}>Overdue only</option>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={180}>6 months</option>
              <option value={365}>A year</option>
            </select>
          </label>
          <label style={{ maxWidth: '14rem' }}>Vaccine
            <input placeholder="All" value={vaccineFilter} onChange={(e) => setVaccineFilter(e.target.value)} />
          </label>
        </div>
        {status && <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginBottom: 0 }}>{status}</p>}
      </div>

      {draft && (
        <div className="card">
          <h2>Record a dose — {draft.student_label}</h2>
          <form onSubmit={recordGiven}>
            <Field label="Vaccine"><input value={draft.vaccine} onChange={(e) => setDraft({ ...draft, vaccine: e.target.value })} /></Field>
            <Field label="Dose (e.g. Dose 2, Booster)"><input value={draft.dose_label} onChange={(e) => setDraft({ ...draft, dose_label: e.target.value })} /></Field>
            <Field label="Date given"><input type="date" value={draft.given_on} onChange={(e) => setDraft({ ...draft, given_on: e.target.value })} /></Field>
            <Field label="Next due (leave blank if the course is complete)">
              <input type="date" value={draft.next_due_on} onChange={(e) => setDraft({ ...draft, next_due_on: e.target.value })} />
            </Field>
            <Field label="Batch number"><input value={draft.batch_number} onChange={(e) => setDraft({ ...draft, batch_number: e.target.value })} /></Field>
            <Field label="Administered by"><input value={draft.administered_by} onChange={(e) => setDraft({ ...draft, administered_by: e.target.value })} /></Field>
            <button type="submit">Save dose</button>{' '}
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
        <>
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <Stat label="Overdue" value={overdue.length} />
            <Stat label="Coming up" value={upcoming.length} sub={horizonDays ? `next ${horizonDays} days` : '—'} />
          </div>

          <div className="card">
            <h2>Overdue</h2>
            {overdue.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>Nothing overdue.</p>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead><tr><th>Was due</th><th>Student</th><th>Vaccine</th><th>Last dose</th><th>Last given</th><th></th></tr></thead>
                  <tbody>{overdue.map(row)}</tbody>
                </table>
              </div>
            )}
          </div>

          {horizonDays > 0 && (
            <div className="card">
              <h2>Coming up</h2>
              {upcoming.length === 0 ? (
                <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>Nothing due in this window.</p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead><tr><th>Due</th><th>Student</th><th>Vaccine</th><th>Last dose</th><th>Last given</th><th></th></tr></thead>
                    <tbody>{upcoming.map(row)}</tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </main>
  );
}

export default function ClinicImmunisationsPage() {
  return (
    <RequireAuth>
      <RequireResource resourceKey="/clinic/immunisations">
        <ImmunisationsInner />
      </RequireResource>
    </RequireAuth>
  );
}
