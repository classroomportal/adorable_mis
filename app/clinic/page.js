'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';
import RequireResource from '../RequireResource';
import { Chip, Stat } from '../components/MedicalChips';
import { formatUKDate } from '../../lib/formatDate';
import { labelFor, VISIT_CATEGORIES, VISIT_OUTCOMES, formatTimeOnly, formatDateOnly, isoToday, studentName } from '../../lib/medical';

// The sick bay's own front page. The medical record card on /students/[id]
// answers "what about this child"; this answers "what is happening today"
// — which is the question the nurse actually starts the day with.

const STUDENT_COLS = 'students(student_id, first_name, last_name, year_group, form_class, boarding_house)';

function ClinicInner() {
  const [todayVisits, setTodayVisits] = useState([]);
  const [followUps, setFollowUps] = useState([]);
  const [overdueJabs, setOverdueJabs] = useState([]);
  const [unnotified, setUnnotified] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const today = isoToday();
      // Visits are timestamped, so "today" is the window from midnight to
      // midnight rather than a date equality test.
      const dayStart = new Date(`${today}T00:00:00`).toISOString();
      const dayEnd = new Date(`${today}T23:59:59.999`).toISOString();

      const [visits, follow, jabs, notify] = await Promise.all([
        supabase.from('student_clinic_visits')
          .select(`visit_id, visited_at, category, reason, outcome, parent_notified, follow_up_needed, ${STUDENT_COLS}`)
          .gte('visited_at', dayStart).lte('visited_at', dayEnd)
          .order('visited_at', { ascending: false }),
        supabase.from('student_clinic_visits')
          .select(`visit_id, visited_at, reason, outcome, ${STUDENT_COLS}`)
          .eq('follow_up_needed', true)
          .order('visited_at', { ascending: false }).limit(50),
        supabase.from('student_immunisations')
          .select(`immunisation_id, vaccine, dose_label, next_due_on, ${STUDENT_COLS}`)
          .lt('next_due_on', today)
          .order('next_due_on', { ascending: true }).limit(50),
        // "Was the parent told?" is the question that follows any incident,
        // so an un-notified sent-home or hospital referral is surfaced on its
        // own rather than left to be spotted in the log.
        supabase.from('student_clinic_visits')
          .select(`visit_id, visited_at, reason, outcome, ${STUDENT_COLS}`)
          .eq('parent_notified', false)
          .in('outcome', ['sent_home', 'referred_to_hospital'])
          .order('visited_at', { ascending: false }).limit(50),
      ]);

      const firstError = [visits, follow, jabs, notify].find((r) => r.error);
      if (firstError) setError(firstError.error.message);

      setTodayVisits(visits.data || []);
      setFollowUps(follow.data || []);
      setOverdueJabs(jabs.data || []);
      setUnnotified(notify.data || []);
      setLoading(false);
    })();
  }, []);

  const restingNow = todayVisits.filter((v) => v.outcome === 'rested_in_sick_bay');

  function studentCell(v) {
    const s = v.students;
    if (!s) return 'Unknown student';
    return (
      <a href={`/students/${s.student_id}`}>
        {studentName(s)}
        <span style={{ color: 'var(--ink-soft)', fontSize: '0.8rem' }}>
          {' '}{s.form_class || `Y${s.year_group}`}{s.boarding_house ? ` · ${s.boarding_house}` : ''}
        </span>
      </a>
    );
  }

  return (
    <main style={{ padding: '1.25rem', maxWidth: 1100, margin: '0 auto' }}>
      <h1>🩺 Clinic</h1>
      <p style={{ color: 'var(--ink-soft)', marginTop: 0 }}>
        Today in the sick bay, outstanding follow-ups and immunisations that have fallen due.
      </p>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <a href="/clinic/visits"><button type="button">Sick bay log &amp; record a visit</button></a>
        <a href="/clinic/measurements"><button type="button">Height &amp; weight round</button></a>
        <a href="/clinic/immunisations"><button type="button">Immunisations</button></a>
      </div>

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
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '1.1rem' }}>
            <Stat label="Visits today" value={todayVisits.length} />
            <Stat label="Rested in sick bay" value={restingNow.length} sub="today" />
            <Stat label="Follow-ups open" value={followUps.length} />
            <Stat label="Parent not told" value={unnotified.length} sub="sent home / referred" />
            <Stat label="Jabs overdue" value={overdueJabs.length} />
          </div>

          <div className="card">
            <h2>Today&apos;s sick bay</h2>
            {todayVisits.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>Nobody has been seen yet today.</p>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead><tr><th>Time</th><th>Student</th><th>Type</th><th>Reason</th><th>Outcome</th><th>Parent told</th></tr></thead>
                  <tbody>
                    {todayVisits.map((v) => (
                      <tr key={v.visit_id}>
                        <td>{formatTimeOnly(v.visited_at)}</td>
                        <td>{studentCell(v)}</td>
                        <td>{labelFor(VISIT_CATEGORIES, v.category) || '—'}</td>
                        <td>{v.reason}{v.follow_up_needed && <> <Chip tone="warn">follow-up</Chip></>}</td>
                        <td>{labelFor(VISIT_OUTCOMES, v.outcome) || '—'}</td>
                        <td>{v.parent_notified ? <Chip tone="good">Yes</Chip> : <Chip tone="bad">No</Chip>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {unnotified.length > 0 && (
            <div className="card">
              <h2>Sent home or referred — parent not yet told</h2>
              <div className="table-scroll">
                <table>
                  <thead><tr><th>When</th><th>Student</th><th>Reason</th><th>Outcome</th></tr></thead>
                  <tbody>
                    {unnotified.map((v) => (
                      <tr key={v.visit_id}>
                        <td>{formatDateOnly(v.visited_at)}</td>
                        <td>{studentCell(v)}</td>
                        <td>{v.reason}</td>
                        <td><Chip tone="bad">{labelFor(VISIT_OUTCOMES, v.outcome) || '—'}</Chip></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="card">
            <h2>Follow-ups outstanding</h2>
            {followUps.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>Nothing outstanding.</p>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead><tr><th>Seen</th><th>Student</th><th>Reason</th><th>Outcome</th></tr></thead>
                  <tbody>
                    {followUps.map((v) => (
                      <tr key={v.visit_id}>
                        <td>{formatDateOnly(v.visited_at)}</td>
                        <td>{studentCell(v)}</td>
                        <td>{v.reason}</td>
                        <td>{labelFor(VISIT_OUTCOMES, v.outcome) || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <h2>Immunisations overdue</h2>
            {overdueJabs.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>Nothing overdue.</p>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead><tr><th>Was due</th><th>Student</th><th>Vaccine</th><th>Dose</th></tr></thead>
                  <tbody>
                    {overdueJabs.map((i) => (
                      <tr key={i.immunisation_id}>
                        <td><Chip tone="bad">{formatUKDate(i.next_due_on)}</Chip></td>
                        <td>{studentCell(i)}</td>
                        <td>{i.vaccine}</td>
                        <td>{i.dose_label || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </main>
  );
}

export default function ClinicPage() {
  return (
    <RequireAuth>
      <RequireResource resourceKey="/clinic">
        <ClinicInner />
      </RequireResource>
    </RequireAuth>
  );
}
