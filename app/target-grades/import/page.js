'use client';
import { useState } from 'react';
import Papa from 'papaparse';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { useAuth } from '../../../lib/AuthContext';

// Maps the raw CSV column header -> clean subject name stored in `subjects`.
// Two columns in the source export carry leftover boilerplate in their header text.
const SUBJECT_COLUMNS = {
  'Add Maths': 'Add Maths',
  'Art': 'Art',
  'Biology': 'Biology',
  'Chemistry': 'Chemistry',
  'Chinese': 'Chinese',
  'Computing': 'Computing',
  'Economics': 'Economics',
  'English': 'English',
  'English Lit A-E ABC: CAT Targets Most Recent': 'English Lit',
  'Extended A-E ABC: CAT Targets Most Recent': 'Extended',
  'Food': 'Food and Nutrition',
  'French': 'French',
  'Geography': 'Geography',
  'Graphics': 'Graphics',
  'History': 'History',
  'ICT': 'ICT',
  'Maths': 'Mathematics',
  'PE': 'PE',
  'Physics': 'Physics',
  'Religion': 'Religion',
  'Sociology': 'Sociology',
  'Spanish': 'Spanish',
};

// Supabase caps unpaginated selects at 1000 rows; student_class is well past
// that, so page through rather than read a silent slice of the timetable.
async function fetchAll(table, columns) {
  const PAGE = 1000;
  let from = 0;
  let all = [];
  while (true) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) { console.error(`fetchAll ${table}:`, error.message); break; }
    all = all.concat(data || []);
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

function ImportInner() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [rows, setRows] = useState([]);
  const [preview, setPreview] = useState([]);
  const [status, setStatus] = useState(null);
  const [errors, setErrors] = useState([]);

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const parsed = results.data
          .map((row) => {
            const upn = (row['UPN'] || '').trim();
            const targets = {};
            for (const [col, subjectName] of Object.entries(SUBJECT_COLUMNS)) {
              const v = (row[col] || '').trim();
              if (v) targets[subjectName] = v;
            }
            return { name: row['Surname Forename'] || '', upn, targets };
          })
          .filter((r) => r.upn && Object.keys(r.targets).length > 0);
        setRows(parsed);
        setPreview(parsed.slice(0, 8));
        setStatus(null);
        setErrors([]);
      },
    });
  }

  async function handleImport() {
    setStatus('Loading lookups...');
    const { data: students } = await supabase.from('students').select('student_id, upn');
    const { data: subjects } = await supabase.from('subjects').select('subject_id, subject_name, target_fallback_subject_id');
    const studentByUpn = Object.fromEntries((students || []).map((s) => [s.upn, s.student_id]));
    const subjectByName = Object.fromEntries((subjects || []).map((s) => [s.subject_name.toLowerCase(), s.subject_id]));
    const fallbackFor = Object.fromEntries(
      (subjects || []).filter((s) => s.target_fallback_subject_id).map((s) => [s.subject_id, s.target_fallback_subject_id])
    );

    // What each student actually studies. CAT4 predicts a grade for its whole
    // basket regardless of option choices, so without this the import writes a
    // target for every subject in the file to every student in it — which is
    // how 3,188 targets for subjects nobody takes got here in the first place.
    // student_class is 4000+ rows, past the 1000-row cap, so page through it.
    const enrolled = {};
    {
      const classes = await fetchAll('classes', 'class_id, subject_id');
      const subjectByClass = Object.fromEntries((classes || []).map((c) => [c.class_id, c.subject_id]));
      const links = await fetchAll('student_class', 'student_id, class_id');
      for (const l of links) {
        const subjectId = subjectByClass[l.class_id];
        if (!subjectId) continue;
        if (!enrolled[l.student_id]) enrolled[l.student_id] = new Set();
        enrolled[l.student_id].add(fallbackFor[subjectId] || subjectId);
      }
    }

    const problems = [];
    const upserts = [];
    const skippedBySubject = {};
    for (const r of rows) {
      const studentId = studentByUpn[r.upn];
      if (!studentId) { problems.push(`${r.name || r.upn}: no student found with UPN ${r.upn}`); continue; }
      const studies = enrolled[studentId];
      for (const [subjectName, grade] of Object.entries(r.targets)) {
        const subjectId = subjectByName[subjectName.toLowerCase()];
        if (!subjectId) { problems.push(`${r.name}: subject "${subjectName}" not found — run migration 028 first`); continue; }
        // A student with no class links at all is a timetabling gap, not a
        // signal that they study nothing, so their targets are written as
        // before rather than silently dropped.
        if (studies && studies.size > 0 && !studies.has(subjectId)) {
          skippedBySubject[subjectName] = (skippedBySubject[subjectName] || 0) + 1;
          continue;
        }
        upserts.push({ student_id: studentId, subject_id: subjectId, target_grade: grade });
      }
    }

    const skippedTotal = Object.values(skippedBySubject).reduce((a, b) => a + b, 0);
    if (skippedTotal > 0) {
      problems.push(
        `Skipped ${skippedTotal} target(s) for subjects the student is not timetabled for: `
        + Object.entries(skippedBySubject).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} (${n})`).join(', ')
        + '. If a subject here should have been written, the student is missing that class on their timetable.'
      );
    }

    setStatus(`Saving ${upserts.length} target grades...`);
    const CHUNK = 500;
    let saved = 0;
    for (let i = 0; i < upserts.length; i += CHUNK) {
      const chunk = upserts.slice(i, i + CHUNK);
      const { error } = await supabase.from('target_grades').upsert(chunk, { onConflict: 'student_id,subject_id' });
      if (error) problems.push(`Batch starting row ${i}: ${error.message}`);
      else saved += chunk.length;
    }

    setErrors(problems);
    setStatus(`Saved ${saved} of ${upserts.length} target grades across ${rows.length} students.${problems.length ? ' Some rows had issues — see below.' : ''}`);
  }

  if (!isAdmin) {
    return <p>Only admin accounts can bulk import target grades.</p>;
  }

  return (
    <div>
      <h1>Import Target Grades (CSV)</h1>

      <div className="card">
        <p>Expects the CAT4-derived target grades export: one row per student (matched by <code>UPN</code>), with a column per subject holding a target letter grade.</p>
        <p>CAT4 predicts a grade for every subject in its basket, whether or not the student takes it. Only subjects the student is timetabled for are written; anything skipped is listed after the import.</p>
        <p>Run migration <code>028_target_grades.sql</code> first — it creates the target grades table and the grade scale used for red/amber/green comparisons.</p>
        <input type="file" accept=".csv" onChange={handleFile} />
      </div>

      {preview.length > 0 && (
        <div className="card">
          <h2>Preview (first 8 students)</h2>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Student</th><th>UPN</th><th>Targets</th></tr></thead>
              <tbody>
                {preview.map((r, i) => (
                  <tr key={i}>
                    <td>{r.name}</td>
                    <td>{r.upn}</td>
                    <td>{Object.entries(r.targets).map(([s, g]) => `${s}:${g}`).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ marginTop: '1rem' }}>{rows.length} students with target grades detected.</p>
          <button onClick={handleImport}>Import all target grades</button>
        </div>
      )}

      {status && <p>{status}</p>}

      {errors.length > 0 && (
        <div className="card">
          <h2>Issues ({errors.length})</h2>
          <ul>
            {errors.slice(0, 50).map((e, i) => <li key={i} style={{ color: '#a3232c' }}>{e}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function ImportPage() {
  return <RequireAuth><RequireResource resourceKey="/target-grades/import"><ImportInner /></RequireResource></RequireAuth>;
}
