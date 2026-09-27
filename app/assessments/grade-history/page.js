'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { formatUKDate } from '../../../lib/formatDate';
import { schoolToday, schoolDateOffset, SCHOOL_TIMEZONE } from '../../../lib/schoolTime';

// Every grade entered, changed or deleted, from grade_history (migration 215).
// The database writes that table itself and nobody can edit it; reading it
// is limited to SMT, assessment managers and admins by RLS, whatever this
// page shows.
//
// "Changed by" is the person who was signed in when the change was made, not
// the teacher named on the grade record: results.staff_id is set by the page
// and could name someone else. Where the two differ, the row says so.

const LIMIT = 500;
const TABLES = {
  results: 'Assessment result',
  target_grades: 'Target grade',
  transcript_grades: 'Transcript grade',
};
const ACTIONS = { INSERT: 'Entered', UPDATE: 'Changed', DELETE: 'Deleted' };
// Bookkeeping columns that change on every save and say nothing about the grade.
const IGNORED_FIELDS = new Set(['updated_at', 'updated_by', 'created_at', 'is_demo', 'grade', 'target_grade', 'score']);

function whenLabel(ts) {
  return new Date(ts).toLocaleString('en-GB', {
    timeZone: SCHOOL_TIMEZONE, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// Midnight at the school (Lagos is UTC+1 all year) on an ISO date.
function schoolMidnight(isoDate) {
  return `${isoDate}T00:00:00+01:00`;
}

function nextDay(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function recordLabel(h) {
  const row = h.new_row || h.old_row || {};
  if (h.table_name === 'results') {
    return [row.result_type, row.week_start_date ? `week of ${formatUKDate(row.week_start_date)}` : null].filter(Boolean).join(', ');
  }
  if (h.table_name === 'transcript_grades') return `Year ${row.year_group}, term ${row.term_number}`;
  return '';
}

// Other fields that changed alongside the grade (comments, max score, ...).
function otherChanges(h) {
  if (h.action !== 'UPDATE' || !h.old_row || !h.new_row) return [];
  return Object.keys(h.new_row)
    .filter((k) => !IGNORED_FIELDS.has(k) && JSON.stringify(h.old_row[k]) !== JSON.stringify(h.new_row[k]))
    .map((k) => ({ field: k.replace(/_/g, ' '), from: h.old_row[k], to: h.new_row[k] }));
}

function show(v) {
  return v === null || v === undefined || v === '' ? '—' : String(v);
}

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function GradeHistoryInner() {
  const [from, setFrom] = useState(schoolDateOffset(-30));
  const [to, setTo] = useState(schoolToday());
  const [table, setTable] = useState('');
  const [action, setAction] = useState('');
  const [staffFilter, setStaffFilter] = useState('');
  const [studentQuery, setStudentQuery] = useState('');
  const [rows, setRows] = useState([]);
  const [staff, setStaff] = useState([]);
  const [subjects, setSubjects] = useState({});
  const [students, setStudents] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    supabase.from('staff').select('staff_id, first_name, last_name, staff_code').order('last_name')
      .then(({ data }) => setStaff(data || []));
    supabase.from('subjects').select('subject_id, subject_name, display_name')
      .then(({ data }) => setSubjects(Object.fromEntries((data || []).map((s) => [s.subject_id, s.display_name || s.subject_name]))));
  }, []);

  const staffById = useMemo(() => Object.fromEntries(staff.map((s) => [s.staff_id, s])), [staff]);

  async function load() {
    setLoading(true);
    setError(null);

    let studentIds = null;
    const q = studentQuery.trim();
    if (q) {
      // Characters PostgREST's or() filter treats as syntax are dropped.
      const words = q.replace(/[,()*%]/g, ' ').split(/\s+/).filter(Boolean);
      let sq = supabase.from('students').select('student_id');
      words.forEach((w) => { sq = sq.or(`first_name.ilike.%${w}%,last_name.ilike.%${w}%`); });
      const { data: found } = await sq.limit(200);
      studentIds = (found || []).map((s) => s.student_id);
      if (studentIds.length === 0) { setRows([]); setLoading(false); return; }
    }

    let query = supabase.from('grade_history').select('*')
      .gte('changed_at', schoolMidnight(from))
      .lt('changed_at', schoolMidnight(nextDay(to)))
      .order('changed_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(LIMIT);
    if (table) query = query.eq('table_name', table);
    if (action) query = query.eq('action', action);
    if (staffFilter === 'none') query = query.is('changed_by_staff_id', null);
    else if (staffFilter) query = query.eq('changed_by_staff_id', Number(staffFilter));
    if (studentIds) query = query.in('student_id', studentIds);

    const { data, error: e } = await query;
    if (e) { setError(e.message); setRows([]); setLoading(false); return; }
    const list = data || [];

    const missing = [...new Set(list.map((h) => h.student_id).filter((id) => id && !students[id]))];
    if (missing.length) {
      const { data: st } = await supabase.from('students').select('student_id, first_name, last_name, form_class').in('student_id', missing);
      setStudents((prev) => ({ ...prev, ...Object.fromEntries((st || []).map((s) => [s.student_id, s])) }));
    }
    setRows(list);
    setLoading(false);
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function staffName(id) {
    const s = staffById[id];
    return s ? `${s.first_name} ${s.last_name}${s.staff_code ? ` (${s.staff_code})` : ''}` : `staff #${id}`;
  }

  // Staff by their staff record; anyone else by the name the database stored
  // with the entry (migration 219). A change made through the database
  // connection has no sign-in, and carries the note it was made with
  // ("Principal (direct)") if one was set.
  function changedBy(h) {
    if (h.changed_by_staff_id) return staffName(h.changed_by_staff_id);
    if (h.changed_by_name) return `${h.changed_by_name} (${h.changed_by_role || 'account'})`;
    if (h.changed_by_role) return h.changed_by_role === 'admin' ? 'Admin account' : `${h.changed_by_role} account`;
    if (h.note) return h.note;
    return 'Directly in the database (no one signed in)';
  }

  // The teacher the grade record names, when it isn't the person who saved it.
  function claimedTeacher(h) {
    if (h.table_name !== 'results') return null;
    const claimed = (h.new_row || h.old_row || {}).staff_id;
    if (!claimed || !h.changed_by_staff_id || claimed === h.changed_by_staff_id) return null;
    return staffName(claimed);
  }

  function studentName(id) {
    const s = students[id];
    return s ? `${s.first_name} ${s.last_name}` : id ? `Student #${id}` : '—';
  }

  function downloadCsv() {
    const header = ['When', 'Student', 'Form', 'Subject', 'Type', 'Record', 'Action', 'Old grade', 'New grade', 'Old score', 'New score', 'Changed by', 'Grade record names', 'Other changes'];
    const lines = rows.map((h) => [
      whenLabel(h.changed_at), studentName(h.student_id), students[h.student_id]?.form_class || '',
      subjects[h.subject_id] || '', TABLES[h.table_name], recordLabel(h), ACTIONS[h.action],
      h.old_grade, h.new_grade, h.old_score, h.new_score, changedBy(h), claimedTeacher(h) || '',
      otherChanges(h).map((c) => `${c.field}: ${show(c.from)} -> ${show(c.to)}`).join('; '),
    ].map(csvCell).join(','));
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `grade-history-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div>
      <h1>Grade History</h1>
      <p>
        Every grade entered, changed or deleted, newest first. The database records this itself and nobody
        can edit or remove it. &quot;Changed by&quot; is whoever was signed in when the change was made.
      </p>

      <div className="card" style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label>
          Student
          <input type="text" value={studentQuery} onChange={(e) => setStudentQuery(e.target.value)} placeholder="Name" />
        </label>
        <label>
          Changed by
          <select value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)}>
            <option value="">Anyone</option>
            <option value="none">No staff record (database or admin account)</option>
            {staff.map((s) => <option key={s.staff_id} value={s.staff_id}>{s.first_name} {s.last_name}</option>)}
          </select>
        </label>
        <label>
          Type
          <select value={table} onChange={(e) => setTable(e.target.value)}>
            <option value="">All grades</option>
            {Object.entries(TABLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>
          What
          <select value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">Entered, changed or deleted</option>
            {Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <button onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Show'}</button>
        <button onClick={downloadCsv} disabled={loading || rows.length === 0}>Download CSV</button>
      </div>

      {error && <p style={{ color: '#a3232c' }}>Error: {error}</p>}

      <div className="card">
        {loading ? <p>Loading…</p> : rows.length === 0 ? (
          <p>No grade changes match these filters.</p>
        ) : (
          <>
            {rows.length === LIMIT && (
              <p style={{ color: '#5b6472', fontSize: '0.9rem' }}>
                Showing the latest {LIMIT}. Narrow the dates or filters to see older changes.
              </p>
            )}
            <div className="table-scroll"><table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Student</th>
                  <th>Subject</th>
                  <th>Grade</th>
                  <th>Change</th>
                  <th>Changed by</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((h) => {
                  const others = otherChanges(h);
                  const claimed = claimedTeacher(h);
                  const scoreChanged = h.table_name === 'results' && (h.old_score !== null || h.new_score !== null)
                    && String(h.old_score) !== String(h.new_score);
                  return (
                    <tr key={h.id} style={h.action === 'DELETE' ? { background: '#fdf1f1' } : undefined}>
                      <td style={{ whiteSpace: 'nowrap' }}>{whenLabel(h.changed_at)}</td>
                      <td>
                        {studentName(h.student_id)}
                        {students[h.student_id]?.form_class && (
                          <span style={{ color: '#5b6472', fontSize: '0.85rem' }}> · {students[h.student_id].form_class}</span>
                        )}
                      </td>
                      <td>{subjects[h.subject_id] || '—'}</td>
                      <td>
                        {TABLES[h.table_name]}
                        {recordLabel(h) && <div style={{ color: '#5b6472', fontSize: '0.85rem' }}>{recordLabel(h)}</div>}
                      </td>
                      <td>
                        <strong>{ACTIONS[h.action]}</strong>{' '}
                        {h.action === 'INSERT' ? show(h.new_grade)
                          : h.action === 'DELETE' ? `(was ${show(h.old_grade)})`
                            : `${show(h.old_grade)} → ${show(h.new_grade)}`}
                        {scoreChanged && (
                          <div style={{ fontSize: '0.85rem' }}>score {show(h.old_score)} → {show(h.new_score)}</div>
                        )}
                        {others.map((c) => (
                          <div key={c.field} style={{ fontSize: '0.85rem', color: '#5b6472' }}>
                            {c.field === 'staff id'
                              ? <>teacher named: {c.from ? staffName(c.from) : '—'} → {c.to ? staffName(c.to) : '—'}</>
                              : <>{c.field}: {show(c.from)} → {show(c.to)}</>}
                          </div>
                        ))}
                      </td>
                      <td>
                        {changedBy(h)}
                        {claimed && (
                          <div style={{ fontSize: '0.85rem', color: '#a3232c' }}>
                            ⚠ the grade record names {claimed}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          </>
        )}
      </div>
    </div>
  );
}

export default function GradeHistoryPage() {
  return (
    <RequireAuth>
      <RequireResource resourceKey="/assessments/grade-history">
        <GradeHistoryInner />
      </RequireResource>
    </RequireAuth>
  );
}
