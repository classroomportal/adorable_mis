'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { useAuth } from '../../../lib/AuthContext';
import { loadResultSetScopes, scopeToReportPeriod, inReportPeriod } from '../../../lib/reportWriting';
import SaveBar, { useSaveStatus } from '../../components/SaveBar';
import ResultSetPicker, { currentYearSets, confirmResultSetDate, ResultSetDateNote, fieldStyle } from '../../components/ResultSetPicker';

const RESULT_TYPES = [
  { value: 'short_test', label: 'Short Test' },
  { value: 'teacher_assessment', label: 'Teacher Assessment' },
  { value: 'exam_grade', label: 'Exam Grade' },
];

function EnterResultsInner() {
  const { profile, staffRoles } = useAuth();
  const staffId = profile?.staff_id;
  // Admins and assessment staff may enter results for any class, not just
  // their own — the `results` write policies already allow it for exactly
  // these roles (is_assessment_manager() and has_staff_role('assessment_user')).
  // Everyone else is limited to classes they teach, matching
  // teaches_student_for_subject() (migration 129).
  const canEnterAnyClass =
    profile?.role === 'admin' ||
    (staffRoles || []).includes('assessment_manager') ||
    (staffRoles || []).includes('assessment_user');
  // Who may delete a saved score (migration 236, can_delete_result()): the
  // class teacher, a Head of Department for their department's subjects,
  // and assessment managers/admins for any. This only decides which
  // Delete buttons show; the database policy is the real check.
  const isAssessmentManager =
    profile?.role === 'admin' || (staffRoles || []).includes('assessment_manager');
  const [hodDepartments, setHodDepartments] = useState([]);

  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState('');
  const [resultSets, setResultSets] = useState([]);
  const [resultSetEventId, setResultSetEventId] = useState('');
  const [resultType, setResultType] = useState('short_test');
  // Result sets only for some students (e.g. "New students check"): event_id
  // -> the linked report period's { year_groups, joined_from }.
  const [setScopes, setSetScopes] = useState({});
  // For such a set, the classes its students are in; null otherwise.
  const [scopeClassIds, setScopeClassIds] = useState(null);

  const [roster, setRoster] = useState([]); // [{student_id, first_name, last_name, year_group}]
  const [boundaries, setBoundaries] = useState([]); // grade boundaries for this class's subject
  const [rows, setRows] = useState({}); // student_id -> { score, grade, resultId }
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [status, setStatus] = useSaveStatus();

  const selectedClass = classes.find((c) => String(c.class_id) === String(classId));

  // Load the selectable classes (own classes, plus a Head of Department's
  // department classes, or every class for admins and assessment staff) + the
  // list of selectable result sets, once.
  useEffect(() => {
    if (!staffId && !canEnterAnyClass) return;
    (async () => {
      let depts = [];
      if (staffId) {
        const { data: hod } = await supabase
          .from('staff_roles')
          .select('scope_value')
          .eq('staff_id', staffId)
          .eq('role_name', 'head_of_department')
          .eq('scope_type', 'department');
        depts = (hod || []).map((r) => r.scope_value).filter(Boolean);
      }
      setHodDepartments(depts);

      const cols = 'class_id, class_code, subject_id, year_group, staff_id, staff(first_name, last_name)';
      if (canEnterAnyClass) {
        const { data } = await supabase.from('classes').select(`${cols}, subjects(subject_name, department_name)`).order('class_code');
        setClasses(data || []);
        return;
      }
      const [{ data: own }, { data: dept }] = await Promise.all([
        supabase.from('classes').select(`${cols}, subjects(subject_name, department_name)`).eq('staff_id', staffId).order('class_code'),
        depts.length
          ? supabase.from('classes').select(`${cols}, subjects!inner(subject_name, department_name)`).in('subjects.department_name', depts).order('class_code')
          : Promise.resolve({ data: [] }),
      ]);
      const byId = new Map();
      for (const c of [...(own || []), ...(dept || [])]) byId.set(c.class_id, c);
      setClasses(Array.from(byId.values()).sort((a, b) => a.class_code.localeCompare(b.class_code)));
    })();

    supabase
      .from('calendar_events')
      .select('event_id, event_date, event_name, special_year_groups')
      .eq('is_result_set', true)
      .order('event_date', { ascending: false })
      .then(async ({ data }) => {
        const sets = currentYearSets(data || []);
        setResultSets(sets);
        // A special result set (migration 358, e.g. Year 12 mocks) is for
        // its year groups only, narrowed the same way as a report period's
        // set; the database refuses marks for anyone else.
        const scopes = await loadResultSetScopes();
        for (const ev of sets) {
          if (ev.special_year_groups?.length) scopes[ev.event_id] = { year_groups: ev.special_year_groups };
        }
        setSetScopes(scopes);
      });
  }, [staffId, canEnterAnyClass]);

  const setScope = setScopes[resultSetEventId] || null;

  useEffect(() => {
    if (!setScope) { setScopeClassIds(null); return; }
    scopeToReportPeriod(
      supabase.from('students').select('student_id, student_class(class_id)').eq('status', 'active'),
      setScope
    ).then(({ data }) => {
      setScopeClassIds(new Set((data || []).flatMap((s) => (s.student_class || []).map((sc) => sc.class_id))));
    });
  }, [setScope]);

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
      .select('students(student_id, first_name, last_name, year_group, status, admission_date)')
      .eq('class_id', classId);
    const studentList = (sc || [])
      .map((r) => r.students)
      .filter((s) => s && s.status === 'active' && (!setScope || inReportPeriod(s, setScope)))
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
  }, [classId, resultSetEventId, selectedClass, setScope]);

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
      // A row-level security refusal means this isn't a class they teach, which
      // the raw Postgres wording ("new row violates row-level security policy")
      // tells a teacher nothing useful about.
      setStatus(
        error.code === '42501' || /row-level security/i.test(error.message || '')
          ? "You can only enter results for classes you are the teacher of record for. If this is your class, ask an admin to check who it's assigned to."
          : `Error: ${error.message}`,
        'error'
      );
    } else {
      setStatus(`Saved ${toSave.length} result(s).`);
      loadRosterAndExisting();
    }
  }

  // A Head of Department can enter, change and delete scores in a colleague's
  // class in their department (migration 321, is_hod_for_subject()).
  const canWriteSelected =
    canEnterAnyClass ||
    (!!staffId && selectedClass?.staff_id === staffId) ||
    hodDepartments.includes(selectedClass?.subjects?.department_name);

  function canDelete(row) {
    if (!row?.resultId) return false;
    return (
      isAssessmentManager ||
      (!!staffId && selectedClass?.staff_id === staffId) ||
      hodDepartments.includes(selectedClass?.subjects?.department_name)
    );
  }

  // Removes a saved score entered by mistake. Clearing the box and saving
  // doesn't do this (Save all only sends rows with a score), so it's a
  // separate, confirmed action. The deleted row is kept in grade_history.
  async function handleDelete(student) {
    const row = rows[student.student_id];
    if (!row?.resultId) return;
    if (!window.confirm(`Delete the saved score for ${student.first_name} ${student.last_name}? This removes it from trackers and reports.`)) return;

    setStatus('Deleting...');
    const { data, error } = await supabase
      .from('results')
      .delete()
      .eq('result_id', row.resultId)
      .select('result_id');

    if (error) {
      setStatus(`Error: ${error.message}`);
    } else if (!data || data.length === 0) {
      // RLS hides rows you can't delete rather than raising, so nothing
      // coming back means it wasn't theirs to delete.
      setStatus("That score couldn't be deleted — you can only delete scores for classes you teach (Heads of Department: any in their department).", 'error');
    } else {
      setStatus(`Deleted the score for ${student.first_name} ${student.last_name}.`);
      loadRosterAndExisting();
    }
  }

  const selectedResultSet = resultSets.find((r) => String(r.event_id) === String(resultSetEventId));

  // Picking a result set whose date doesn't fit today (not happened yet, or
  // weeks old) asks first — scores saved against the wrong set land in the
  // wrong column of every tracker and report.
  function chooseResultSet(id) {
    if (!confirmResultSetDate(resultSets.find((r) => String(r.event_id) === String(id)))) return;
    setResultSetEventId(id);
  }

  // A result set for some students only offers the classes they're in.
  const shownClasses = scopeClassIds ? classes.filter((c) => scopeClassIds.has(c.class_id)) : classes;
  const ownClasses = shownClasses.filter((c) => staffId && c.staff_id === staffId);
  const deptClasses = canEnterAnyClass ? [] : shownClasses.filter((c) => !(staffId && c.staff_id === staffId));
  const otherClasses = shownClasses.filter((c) => !(staffId && c.staff_id === staffId));
  const classOption = (c, showTeacher) => (
    <option key={c.class_id} value={c.class_id}>
      {c.class_code} — {c.subjects?.subject_name}
      {showTeacher && (c.staff ? ` (${c.staff.first_name} ${c.staff.last_name})` : ' (no teacher assigned)')}
    </option>
  );

  return (
    <div>
      <h1>Enter Results</h1>
      <p>
        {canEnterAnyClass
          ? 'Pick any class and a result set, then enter a percentage for each student — the grade is calculated automatically.'
          : hodDepartments.length > 0
          ? "Pick one of your classes or one in your department, and a result set, then enter a percentage for each student — the grade is calculated automatically."
          : 'Pick one of your classes and a result set, then enter a percentage for each student — the grade is calculated automatically.'}
      </p>
      <p><a href="/results/missing" className="secondary">Find missing grades by class</a></p>

      <div className="card">
        <label>
          Class
          <select value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">Select a class...</option>
            {canEnterAnyClass ? (
              <>
                {ownClasses.length > 0 && (
                  <optgroup label="My classes">{ownClasses.map((c) => classOption(c, false))}</optgroup>
                )}
                <optgroup label={ownClasses.length > 0 ? 'Other classes' : 'All classes'}>
                  {otherClasses.map((c) => classOption(c, true))}
                </optgroup>
              </>
            ) : deptClasses.length > 0 ? (
              <>
                {ownClasses.length > 0 && (
                  <optgroup label="My classes">{ownClasses.map((c) => classOption(c, false))}</optgroup>
                )}
                <optgroup label="Department classes">
                  {deptClasses.map((c) => classOption(c, true))}
                </optgroup>
              </>
            ) : (
              shownClasses.map((c) => classOption(c, false))
            )}
          </select>
        </label>

        <div style={{ ...fieldStyle, margin: '0.5rem 0' }}>
          Result Set
          <ResultSetPicker resultSets={resultSets} value={resultSetEventId} onChange={chooseResultSet} />
          <ResultSetDateNote resultSet={selectedResultSet} checkDate />
        </div>

        <label>
          Result Type
          <select value={resultType} onChange={(e) => setResultType(e.target.value)}>
            {RESULT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>
      </div>

      {classes.length === 0 && !canEnterAnyClass && (
        <p style={{ color: '#666' }}>No classes are assigned to you as the teacher on record — nothing to select yet.</p>
      )}

      {loadingRoster && <p>Loading class list...</p>}

      {!loadingRoster && selectedClass && selectedResultSet && roster.length > 0 && (
        <>
          {canWriteSelected ? (
            <SaveBar status={status}>
              <button type="button" onClick={handleSaveAll}>Save all</button>
            </SaveBar>
          ) : (
            <>
              <p style={{ color: '#666' }}>Only this class's teacher, its Head of Department or assessment staff can enter scores here.</p>
              <SaveBar status={status} />
            </>
          )}
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Student</th><th>Score (%)</th><th>Grade</th><th></th></tr>
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
                        disabled={!canWriteSelected}
                        style={{ width: '5rem' }}
                      />
                    </td>
                    <td>{rows[s.student_id]?.grade || '—'}</td>
                    <td>
                      {canDelete(rows[s.student_id]) && (
                        <button type="button" className="secondary" onClick={() => handleDelete(s)}>
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

        </>
      )}

      {!loadingRoster && selectedClass && selectedResultSet && roster.length === 0 && (
        <p style={{ color: '#666' }}>
          {setScope ? 'None of the students this result set is for are in this class.' : 'No students are linked to this class yet.'}
        </p>
      )}
    </div>
  );
}

export default function EnterResultsPage() {
  return <RequireAuth><RequireResource resourceKey="/results/enter"><EnterResultsInner /></RequireResource></RequireAuth>;
}
