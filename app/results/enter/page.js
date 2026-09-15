'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import { useAuth } from '../../../lib/AuthContext';
import { formatUKDate } from '../../../lib/formatDate';

const RESULT_TYPES = [
  { value: 'short_test', label: 'Short Test' },
  { value: 'teacher_assessment', label: 'Teacher Assessment' },
  { value: 'exam_grade', label: 'Exam Grade' },
];

function EnterResultsInner() {
  const { profile } = useAuth();
  const staffId = profile?.staff_id;

  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState('');
  const [resultSets, setResultSets] = useState([]);
  const [resultSetEventId, setResultSetEventId] = useState('');
  const [resultType, setResultType] = useState('short_test');

  const [roster, setRoster] = useState([]); // [{student_id, first_name, last_name, year_group}]
  const [boundaries, setBoundaries] = useState([]); // grade boundaries for this class's subject
  const [rows, setRows] = useState({}); // student_id -> { score, grade, resultId }
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [status, setStatus] = useState(null);

  const selectedClass = classes.find((c) => String(c.class_id) === String(classId));

  // Load this teacher's own classes + the list of selectable result sets, once.
  useEffect(() => {
    if (!staffId) return;
    supabase
      .from('classes')
      .select('class_id, class_code, subject_id, year_group, subjects(subject_name)')
      .eq('staff_id', staffId)
      .order('class_code')
      .then(({ data }) => setClasses(data || []));

    supabase
      .from('calendar_events')
      .select('event_id, event_date, event_name')
      .eq('is_result_set', true)
      .order('event_date', { ascending: false })
      .then(({ data }) => setResultSets(data || []));
  }, [staffId]);

  const loadRosterAndExisting = useCallback(async () => {
    if (!classId || !resultSetEventId || !selectedClass) {
      setRoster([]);
      setRows({});
      return;
    }
    setLoadingRoster(true);
    setStatus(null);

    const { data: sc } = await supabase
      .from('student_class')
      .select('students(student_id, first_name, last_name, year_group)')
      .eq('class_id', classId);
    const studentList = (sc || [])
      .map((r) => r.students)
      .filter(Boolean)
      .sort((a, b) => a.last_name.localeCompare(b.last_name));
    setRoster(studentList);

    const yearGroups = Array.from(new Set(studentList.map((s) => s.year_group).filter((y) => y != null)));
    const { data: boundaryRows } = await supabase
      .from('subject_grade_boundaries')
      .select('grade, min_score, max_score, year_group')
      .eq('subject_id', selectedClass.subject_id)
      .in('year_group', yearGroups.length ? yearGroups : [-1]);
    setBoundaries(boundaryRows || []);

    const ids = studentList.map((s) => s.student_id);
    const nextRows = {};
    if (ids.length > 0) {
      const { data: existing } = await supabase
        .from('results')
        .select('result_id, student_id, score, grade')
        .eq('subject_id', selectedClass.subject_id)
        .eq('result_set_event_id', resultSetEventId)
        .in('student_id', ids);
      for (const r of existing || []) {
        nextRows[r.student_id] = { score: r.score ?? '', grade: r.grade ?? '', resultId: r.result_id };
      }
    }
    for (const s of studentList) {
      if (!nextRows[s.student_id]) nextRows[s.student_id] = { score: '', grade: '', resultId: null };
    }
    setRows(nextRows);
    setLoadingRoster(false);
  }, [classId, resultSetEventId, selectedClass]);

  useEffect(() => {
    loadRosterAndExisting();
  }, [loadRosterAndExisting]);

  function gradeFor(score, yearGroup) {
    if (score === '' || score === null || Number.isNaN(Number(score))) return '';
    const n = Number(score);
    const match = boundaries.find((b) => b.year_group === yearGroup && n >= b.min_score && n <= b.max_score);
    return match ? match.grade : '';
  }

  function handleScoreChange(studentId, yearGroup, value) {
    setRows((prev) => ({
      ...prev,
      [studentId]: { ...prev[studentId], score: value, grade: gradeFor(value, yearGroup) },
    }));
  }

  async function handleSaveAll() {
    if (!selectedClass || !resultSetEventId || !selectedResultSet) return;
    const toSave = roster
      .filter((s) => rows[s.student_id]?.score !== '' && rows[s.student_id]?.score != null)
      .map((s) => ({
        student_id: s.student_id,
        subject_id: selectedClass.subject_id,
        result_set_event_id: resultSetEventId,
        week_start_date: selectedResultSet.event_date,
        score: Number(rows[s.student_id].score),
        max_score: 100,
        grade: rows[s.student_id].grade || null,
        result_type: resultType,
        staff_id: staffId,
      }));

    if (toSave.length === 0) {
      setStatus('Nothing to save — enter at least one score.');
      return;
    }

    setStatus('Saving...');
    const { error } = await supabase
      .from('results')
      .upsert(toSave, { onConflict: 'student_id,subject_id,result_set_event_id' });

    if (error) {
      setStatus(`Error: ${error.message}`);
    } else {
      setStatus(`Saved ${toSave.length} result(s).`);
      loadRosterAndExisting();
    }
  }

  const selectedResultSet = resultSets.find((r) => String(r.event_id) === String(resultSetEventId));

  return (
    <div>
      <h1>Enter Results</h1>
      <p>Pick one of your classes and a result set, then enter a percentage for each student — the grade is calculated automatically.</p>

      <div className="card">
        <label>
          Class
          <select value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">Select a class...</option>
            {classes.map((c) => (
              <option key={c.class_id} value={c.class_id}>
                {c.class_code} — {c.subjects?.subject_name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Result Set
          <select value={resultSetEventId} onChange={(e) => setResultSetEventId(e.target.value)}>
            <option value="">Select a result set...</option>
            {resultSets.map((r) => (
              <option key={r.event_id} value={r.event_id}>
                {r.event_name} — {formatUKDate(r.event_date)}
              </option>
            ))}
          </select>
        </label>

        <label>
          Result Type
          <select value={resultType} onChange={(e) => setResultType(e.target.value)}>
            {RESULT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>
      </div>

      {classes.length === 0 && (
        <p style={{ color: '#666' }}>No classes are assigned to you as the teacher on record — nothing to select yet.</p>
      )}

      {loadingRoster && <p>Loading class list...</p>}

      {!loadingRoster && selectedClass && selectedResultSet && roster.length > 0 && (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Student</th><th>Score (%)</th><th>Grade</th></tr>
              </thead>
              <tbody>
                {roster.map((s) => (
                  <tr key={s.student_id}>
                    <td>{s.first_name} {s.last_name}</td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={rows[s.student_id]?.score ?? ''}
                        onChange={(e) => handleScoreChange(s.student_id, s.year_group, e.target.value)}
                        style={{ width: '5rem' }}
                      />
                    </td>
                    <td>{rows[s.student_id]?.grade || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button type="button" onClick={handleSaveAll} style={{ marginTop: '1rem' }}>
            Save all
          </button>
          {status && <p>{status}</p>}
        </>
      )}

      {!loadingRoster && selectedClass && selectedResultSet && roster.length === 0 && (
        <p style={{ color: '#666' }}>No students are linked to this class yet.</p>
      )}
    </div>
  );
}

export default function EnterResultsPage() {
  return <RequireAuth><EnterResultsInner /></RequireAuth>;
}
