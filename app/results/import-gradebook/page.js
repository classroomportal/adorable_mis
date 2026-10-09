'use client';
import { useEffect, useState } from 'react';
import Papa from 'papaparse';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { useAuth } from '../../../lib/AuthContext';
import { formatUKDate } from '../../../lib/formatDate';
import { loadResultSetScopes, inReportPeriod } from '../../../lib/reportWriting';
import ResultSetPicker, { currentYearSets, confirmResultSetDate, ResultSetDateNote, fieldStyle } from '../../components/ResultSetPicker';

// Columns that are NOT subject score columns in the weekly gradebook export.
const METADATA_COLUMNS = new Set([
  'First name', 'Last name', 'ID number', 'Institution', 'Department',
  'Email address', 'Last downloaded from this course',
]);

const BATCH_SIZE = 25;

// "Quiz: Business Studies Exam (Real)" -> "Business Studies"
function parseSubjectName(header) {
  let name = header.trim();
  name = name.replace(/^Quiz:\s*/i, '');
  name = name.replace(/\s*Exam\s*\(Real\)\s*$/i, '');
  name = name.replace(/\s*\(Real\)\s*$/i, '');
  // Moodle exports append the year group as a trailing number, e.g.
  // "Spanish 6" or "Civics 6" — that's not part of the subject name, so
  // strip it before matching against existing subjects.
  name = name.replace(/\s+\d+$/, '');
  return name.trim();
}

// The same choices as Enter Results; results_result_type_check allows
// only these (and term_exam_import, which is for historic loads).
const RESULT_TYPES = [
  { value: 'short_test', label: 'Short Test' },
  { value: 'teacher_assessment', label: 'Teacher Assessment' },
  { value: 'exam_grade', label: 'Exam Grade' },
];

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function ImportInner() {
  const { profile } = useAuth();
  const [rows, setRows] = useState([]);
  const [subjectColumns, setSubjectColumns] = useState([]); // raw header names
  const [subjectNames, setSubjectNames] = useState({}); // raw header -> parsed name (display only)
  const [allSubjects, setAllSubjects] = useState([]); // {subject_id, subject_name}
  const [resolution, setResolution] = useState({}); // header -> { mode: 'existing'|'new'|'unresolved', subjectId, auto }
  const [resultSets, setResultSets] = useState([]);
  const [resultSetEventId, setResultSetEventId] = useState('');
  // Sets only for some students: a special set's years (migration 358), or
  // a report period's years and join date (e.g. "New students check").
  const [setScopes, setSetScopes] = useState({});
  const [resultType, setResultType] = useState('short_test');
  const [status, setStatus] = useState(null);
  const [errors, setErrors] = useState([]);
  const [preview, setPreview] = useState([]);

  useEffect(() => {
    async function loadSubjectsAndAliases() {
      const { data: subs } = await supabase.from('subjects').select('subject_id, subject_name').order('subject_name');
      setAllSubjects(subs || []);
    }
    loadSubjectsAndAliases();
  }, []);

  // Marks go into a result set, as on Enter Results, never a bare week:
  // the reports, progress pages and appeals all find marks by their set.
  useEffect(() => {
    supabase
      .from('calendar_events')
      .select('event_id, event_date, event_name, special_year_groups')
      .eq('is_result_set', true)
      .order('event_date', { ascending: false })
      .then(async ({ data }) => {
        const sets = currentYearSets(data || []);
        setResultSets(sets);
        const scopes = await loadResultSetScopes();
        for (const ev of sets) {
          if (ev.special_year_groups?.length) scopes[ev.event_id] = { year_groups: ev.special_year_groups };
        }
        setSetScopes(scopes);
      });
  }, []);

  const selectedResultSet = resultSets.find((r) => String(r.event_id) === String(resultSetEventId));
  const setScope = setScopes[resultSetEventId] || null;

  function chooseResultSet(id) {
    const rs = resultSets.find((r) => String(r.event_id) === String(id));
    if (!confirmResultSetDate(rs)) return;
    setResultSetEventId(id);
  }

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const data = results.data;
        setRows(data);
        setPreview(data.slice(0, 8));
        setStatus(null);
        setErrors([]);

        const headers = data.length ? Object.keys(data[0]) : [];
        const subjCols = headers.filter((h) => !METADATA_COLUMNS.has(h.trim()));
        setSubjectColumns(subjCols);

        const names = {};
        subjCols.forEach((h) => { names[h] = parseSubjectName(h); });
        setSubjectNames(names);

        // Resolve each column against aliases, then exact subject name match.
        // Anything left over is NOT auto-created — it needs a person to pair
        // it to an existing subject or explicitly confirm a new one, since a
        // typo'd or shorthand header should never silently spawn an orphan
        // subject with no class behind it.
        const { data: aliasRows } = await supabase.from('subject_aliases').select('alias_name, subject_id');
        const aliasByName = {};
        (aliasRows || []).forEach((a) => { aliasByName[a.alias_name] = a.subject_id; });

        const res = {};
        for (const h of subjCols) {
          const name = names[h];
          if (aliasByName[name]) {
            res[h] = { mode: 'existing', subjectId: aliasByName[name], auto: true };
            continue;
          }
          const match = allSubjects.find((s) => s.subject_name === name);
          if (match) {
            res[h] = { mode: 'existing', subjectId: match.subject_id, auto: true };
          } else {
            res[h] = { mode: 'unresolved', subjectId: null, auto: false };
          }
        }
        setResolution(res);
      },
    });
  }

  function setResolutionMode(header, mode, subjectId = null) {
    setResolution((prev) => ({ ...prev, [header]: { mode, subjectId, auto: false } }));
  }

  const unresolvedCount = subjectColumns.filter((h) => resolution[h]?.mode === 'unresolved').length;

  async function handleImport() {
    if (!selectedResultSet) {
      setStatus('Please choose a result set first.');
      return;
    }
    if (unresolvedCount > 0) {
      setStatus(`${unresolvedCount} column(s) still need to be paired to a subject before importing.`);
      return;
    }
    setStatus('Importing...');
    const problems = [];
    let successCount = 0;

    // Cache grade boundaries per subject+year_group to avoid a query per row.
    const boundaryCache = new Map();
    async function lookupGrade(subjectId, yearGroup, score) {
      const key = `${subjectId}:${yearGroup}`;
      if (!boundaryCache.has(key)) {
        const { data } = await supabase
          .from('subject_grade_boundaries')
          .select('grade, min_score, max_score')
          .eq('subject_id', subjectId)
          .eq('year_group', yearGroup);
        boundaryCache.set(key, data || []);
      }
      const rows = boundaryCache.get(key);
      const match = rows.find((r) => score >= r.min_score && score <= r.max_score);
      return match ? match.grade : null;
    }

    // 1. Resolve subject_id for each column from the confirmed pairing —
    // no silent creation here. "existing" reuses the chosen subject and,
    // if the header text differs from that subject's stored name, saves a
    // permanent alias so the same header auto-resolves next time. "new"
    // creates a subject only because a person explicitly confirmed it.
    const subjectIdByHeader = {};
    for (const header of subjectColumns) {
      const r = resolution[header];
      const name = subjectNames[header];
      if (!r || r.mode === 'unresolved') { problems.push(`Column "${header}": not paired to a subject, skipped.`); continue; }

      if (r.mode === 'existing') {
        subjectIdByHeader[header] = r.subjectId;
        if (!r.auto) {
          const existingSubject = allSubjects.find((s) => s.subject_id === r.subjectId);
          if (existingSubject && existingSubject.subject_name !== name) {
            await supabase.from('subject_aliases').upsert([{ alias_name: name, subject_id: r.subjectId }]);
          }
        }
      } else if (r.mode === 'new') {
        const { data: created, error: createErr } = await supabase
          .from('subjects')
          .insert([{ subject_name: name }])
          .select('subject_id')
          .single();
        if (createErr) { problems.push(`Could not create subject "${name}": ${createErr.message}`); continue; }
        subjectIdByHeader[header] = created.subject_id;
      }
    }

    // 2. Build result rows: one per student per subject column with a real score
    const toUpsert = [];
    for (const [i, row] of rows.entries()) {
      const upn = (row['ID number'] || '').trim();
      if (!upn) { problems.push(`Row ${i + 2}: missing ID number, skipped.`); continue; }

      const { data: student, error: sErr } = await supabase
        .from('students')
        .select('student_id, year_group, admission_date')
        .eq('upn', upn)
        .maybeSingle();

      if (sErr || !student) { problems.push(`Row ${i + 2}: no student found with ID "${upn}".`); continue; }
      // The database refuses a special set's marks for other years
      // (trg_results_special_set_year), which would fail the whole batch.
      if (setScope && !inReportPeriod(student, setScope)) {
        problems.push(`Row ${i + 2}: ${row['First name'] || ''} ${row['Last name'] || ''} (Year ${student.year_group}) is not in "${selectedResultSet.event_name}", skipped.`);
        continue;
      }

      for (const header of subjectColumns) {
        const subjectId = subjectIdByHeader[header];
        if (!subjectId) continue;
        const raw = (row[header] || '').trim();
        if (raw === '' || raw === '-') continue; // no mark for this subject

        const score = Number(raw);
        if (Number.isNaN(score)) { problems.push(`Row ${i + 2}, "${header}": "${raw}" is not a number, skipped.`); continue; }

        const grade = await lookupGrade(subjectId, student.year_group, score);

        toUpsert.push({
          student_id: student.student_id,
          subject_id: subjectId,
          result_set_event_id: selectedResultSet.event_id,
          week_start_date: selectedResultSet.event_date,
          score,
          max_score: 100,
          grade,
          result_type: resultType,
          staff_id: profile?.staff_id ?? null,
        });
      }
    }

    // Re-importing replaces marks already in the set (a teacher's, too), so
    // say how many before writing anything.
    const subjectIds = Array.from(new Set(toUpsert.map((r) => r.subject_id)));
    const studentIds = Array.from(new Set(toUpsert.map((r) => r.student_id)));
    if (toUpsert.length > 0) {
      const existing = new Set();
      for (const ids of chunk(studentIds, 200)) {
        const { data } = await supabase
          .from('results')
          .select('student_id, subject_id')
          .eq('result_set_event_id', selectedResultSet.event_id)
          .in('subject_id', subjectIds)
          .in('student_id', ids);
        for (const r of data || []) existing.add(`${r.student_id}:${r.subject_id}`);
      }
      const replacing = toUpsert.filter((r) => existing.has(`${r.student_id}:${r.subject_id}`)).length;
      if (replacing > 0 && !confirm(`${replacing} of these ${toUpsert.length} marks are already in "${selectedResultSet.event_name}" and will be replaced by the file's.\n\nImport anyway?`)) {
        setStatus('Import cancelled. Nothing was saved.');
        return;
      }
    }

    // 3. Write in batches
    // A batch that runs past the database's 8-second limit when the server is
    // busy (9 Oct 2026) is split in half and tried again, down to one mark,
    // so a slow moment loses nothing.
    const writeBatch = async (batch) => {
      const { error: upErr } = await supabase
        .from('results')
        // One mark per student, subject and result set
        // (results_student_subject_resultset_unique), as on Enter Results,
        // so re-importing the same file updates in place.
        .upsert(batch, { onConflict: 'student_id,subject_id,result_set_event_id' });
      if (!upErr) {
        successCount += batch.length;
        return;
      }
      if (/statement timeout/i.test(upErr.message) && batch.length > 1) {
        const half = Math.ceil(batch.length / 2);
        await writeBatch(batch.slice(0, half));
        await writeBatch(batch.slice(half));
        return;
      }
      problems.push(`Batch write failed (${batch.length} mark${batch.length === 1 ? '' : 's'}): ${upErr.message}`);
    };
    const batches = chunk(toUpsert, BATCH_SIZE);
    for (const [i, batch] of batches.entries()) {
      setStatus(`Importing batch ${i + 1} of ${batches.length} (${successCount} of ${toUpsert.length} results written so far)...`);
      await writeBatch(batch);
    }

    setErrors(problems);
    setStatus(`Imported ${successCount} of ${toUpsert.length} results into "${selectedResultSet.event_name}" (${formatUKDate(selectedResultSet.event_date)}).${problems.length ? ' Some rows had issues — see below.' : ''}`);
  }

  return (
    <div>
      <h1>Upload Adorable.net Gradebook (CSV)</h1>

      <div className="card">
        <p>Upload the gradebook export. Any number of subject/quiz columns is fine — they're detected automatically. Students are matched by <code>ID number</code> against each student's UPN.</p>
        <input type="file" accept=".csv" onChange={handleFile} />
      </div>

      {rows.length > 0 && (
        <div className="card">
          <h2>Result set</h2>
          <div style={{ ...fieldStyle, margin: '0.5rem 0' }}>
            Result Set
            <ResultSetPicker resultSets={resultSets} value={resultSetEventId} onChange={chooseResultSet} />
            <ResultSetDateNote resultSet={selectedResultSet} checkDate />
            {setScope && (
              <span style={{ color: 'var(--ink-soft)' }}>
                Only for Year {(setScope.year_groups || []).join(', ')}
                {setScope.joined_from ? `, joined since ${formatUKDate(setScope.joined_from)}` : ''}; other students in the file are skipped.
              </span>
            )}
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
      )}

      {subjectColumns.length > 0 && (
        <div className="card">
          <h2>Detected subjects ({subjectColumns.length})</h2>
          <p>
            Columns that already match an existing subject are paired automatically. Anything unmatched
            needs to be paired to an existing subject or explicitly confirmed as new — nothing is created
            silently.
          </p>
          {unresolvedCount > 0 && (
            <p style={{ color: '#a33', fontWeight: 600 }}>
              {unresolvedCount} column(s) need pairing before you can import.
            </p>
          )}
          <table>
            <thead><tr><th>CSV column</th><th>Parsed name</th><th>Pairing</th></tr></thead>
            <tbody>
              {subjectColumns.map((h) => {
                const r = resolution[h] || { mode: 'unresolved' };
                return (
                  <tr key={h} style={r.mode === 'unresolved' ? { background: '#fdeaea' } : undefined}>
                    <td><code>{h}</code></td>
                    <td>{subjectNames[h]}</td>
                    <td>
                      {r.mode === 'existing' && r.auto && (
                        <span>
                          ✓ matches <strong>{allSubjects.find((s) => s.subject_id === r.subjectId)?.subject_name}</strong>
                          {' '}
                          <button className="secondary" onClick={() => setResolutionMode(h, 'unresolved')}>change</button>
                        </span>
                      )}
                      {r.mode !== 'existing' || !r.auto ? (
                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                          <select
                            value={r.mode === 'existing' ? r.subjectId : ''}
                            onChange={(e) => e.target.value && setResolutionMode(h, 'existing', Number(e.target.value))}
                          >
                            <option value="">-- pair to existing subject --</option>
                            {allSubjects.map((s) => (
                              <option key={s.subject_id} value={s.subject_id}>{s.subject_name}</option>
                            ))}
                          </select>
                          <button
                            className="secondary"
                            onClick={() => setResolutionMode(h, 'new')}
                            style={r.mode === 'new' ? { fontWeight: 700 } : undefined}
                          >
                            {r.mode === 'new' ? '✓ ' : ''}Create new subject "{subjectNames[h]}"
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {preview.length > 0 && (
        <div className="card">
          <h2>Preview (first 8 students)</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>{Object.keys(preview[0]).map((k) => <th key={k}>{k}</th>)}</tr>
              </thead>
              <tbody>
                {preview.map((r, i) => (
                  <tr key={i}>{Object.values(r).map((v, j) => <td key={j}>{v}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ marginTop: '1rem' }}>{rows.length} students, {subjectColumns.length} subject columns detected. Written in batches of {BATCH_SIZE}.</p>
          <button onClick={handleImport} disabled={unresolvedCount > 0 || !selectedResultSet}>
            {selectedResultSet ? `Import results into ${selectedResultSet.event_name}` : 'Choose a result set to import'}
          </button>
        </div>
      )}

      {status && <p>{status}</p>}

      {errors.length > 0 && (
        <div className="card">
          <h2>Issues ({errors.length})</h2>
          <ul>
            {errors.map((e, i) => <li key={i} style={{ color: '#a3232c' }}>{e}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function ImportGradebookPage() {
  return <RequireAuth><RequireResource resourceKey="/results/import-gradebook"><ImportInner /></RequireResource></RequireAuth>;
}
