'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { formatUKDate } from '../../../lib/formatDate';

// Marks not yet entered for a result set, one row per class, so they can be
// chased with the teacher. missing_grades_by_class() (migration 175) does the
// counting in Postgres: a single result set is already past the 1,000-row cap
// on a client select. It only expects marks from a class whose subject was
// assessed in its year group for that set — so Year 9 Religion isn't listed
// for Week 1, when Years 7-9 sat English, Maths and Science only.
function MissingGradesInner() {
  const [resultSets, setResultSets] = useState([]);
  const [eventId, setEventId] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showComplete, setShowComplete] = useState(false);
  const [open, setOpen] = useState({}); // class_id -> names expanded

  useEffect(() => {
    supabase
      .from('calendar_events')
      .select('event_id, event_date, event_name')
      .eq('is_result_set', true)
      .order('event_date', { ascending: false })
      .then(({ data }) => {
        const sets = data || [];
        setResultSets(sets);
        // Open on the most recent set that has already happened.
        const today = new Date().toISOString().slice(0, 10);
        const current = sets.find((s) => s.event_date <= today) || sets[0];
        if (current) setEventId(String(current.event_id));
      });
  }, []);

  useEffect(() => {
    if (!eventId) { setRows([]); return; }
    setLoading(true);
    setError(null);
    setOpen({});
    supabase.rpc('missing_grades_by_class', { p_event_id: Number(eventId) }).then(({ data, error: err }) => {
      if (err) { setError(err.message); setRows([]); } else { setRows(data || []); }
      setLoading(false);
    });
  }, [eventId]);

  const sorted = [...rows].sort((a, b) =>
    (b.expected - b.entered) - (a.expected - a.entered)
    || a.year_group - b.year_group
    || (a.class_code || '').localeCompare(b.class_code || '')
  );
  const incomplete = sorted.filter((r) => r.entered < r.expected);
  const shown = showComplete ? sorted : incomplete;
  const totalMissing = incomplete.reduce((n, r) => n + (r.expected - r.entered), 0);
  const notStarted = incomplete.filter((r) => r.entered === 0).length;

  return (
    <div>
      <h1>Missing Grades</h1>
      <p>
        Students with no mark for a result set, grouped by class. A class is only listed if its subject
        was assessed in its year group for that set.
      </p>

      <div className="card">
        <label>
          Result set
          <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
            <option value="">Select a result set...</option>
            {resultSets.map((s) => (
              <option key={s.event_id} value={s.event_id}>{s.event_name} — {formatUKDate(s.event_date)}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-start', gap: '0.4rem', alignItems: 'center', fontSize: '0.9rem', marginTop: '0.5rem' }}>
          <input type="checkbox" checked={showComplete} onChange={(e) => setShowComplete(e.target.checked)} style={{ width: 'auto', margin: 0 }} />
          Also show complete classes
        </label>
      </div>

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: '#A6192E' }}>{error}</p>}

      {!loading && !error && eventId && (
        rows.length === 0 ? (
          <p>No marks have been entered for this result set yet, so there is nothing to compare against.</p>
        ) : (
          <>
            <p>
              {incomplete.length === 0
                ? `All ${rows.length} classes assessed in this result set are complete.`
                : <><strong>{totalMissing}</strong> missing {totalMissing === 1 ? 'mark' : 'marks'} across <strong>{incomplete.length}</strong> of {rows.length} classes{notStarted > 0 && <> — {notStarted} {notStarted === 1 ? 'class has' : 'classes have'} none entered at all</>}.</>}
            </p>
            {shown.length > 0 && (
              <div className="table-scroll"><table>
                <thead>
                  <tr><th>Class</th><th>Subject</th><th>Year</th><th>Teacher</th><th>Entered</th><th>Missing</th><th>Students without a mark</th></tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const missing = r.missing_students || [];
                    const expanded = open[r.class_id] || missing.length <= 3;
                    return (
                      <tr key={r.class_id}>
                        <td>{r.class_code}</td>
                        <td>{r.subject_name}</td>
                        <td>{r.year_group}</td>
                        <td>{r.teacher || '—'}</td>
                        <td style={r.entered === 0 ? { color: '#A6192E', fontWeight: 600 } : undefined}>
                          {r.entered} / {r.expected}{r.entered === 0 && ' — none entered'}
                        </td>
                        <td><strong>{r.expected - r.entered}</strong></td>
                        <td style={{ fontSize: '0.85rem' }}>
                          {missing.length === 0 ? '—' : expanded ? (
                            missing.map((s) => `${s.first_name} ${s.last_name}`).join(', ')
                          ) : (
                            <button
                              type="button"
                              onClick={() => setOpen((o) => ({ ...o, [r.class_id]: true }))}
                              style={{ padding: '0.15rem 0.5rem', fontSize: '0.8rem' }}
                            >
                              Show {missing.length} names
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
            )}
          </>
        )
      )}
    </div>
  );
}

export default function MissingGradesPage() {
  // Same audience as Weekly Results and Enter Results, so it shares the
  // /results grant rather than needing its own row in /admin/permissions.
  return <RequireAuth><RequireResource resourceKey="/results"><MissingGradesInner /></RequireResource></RequireAuth>;
}
