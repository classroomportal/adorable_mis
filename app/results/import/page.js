'use client';
import { useState } from 'react';
import Papa from 'papaparse';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';

// Expected CSV columns: upn, subject_code, week_start_date, score, max_score, grade
function ImportInner() {
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
        setRows(results.data);
        setPreview(results.data.slice(0, 10));
        setStatus(null);
        setErrors([]);
      },
    });
  }

  async function handleImport() {
    setStatus('Importing...');
    const problems = [];
    let successCount = 0;

    for (const [i, row] of rows.entries()) {
      const upn = (row.upn || '').trim();
      const subjectCode = (row.subject_code || '').trim();
      const week = (row.week_start_date || '').trim();
      const score = row.score ? Number(row.score) : null;
      const maxScore = row.max_score ? Number(row.max_score) : null;
      const grade = row.grade || null;

      if (!upn || !subjectCode || !week) {
        problems.push(`Row ${i + 2}: missing upn, subject_code, or week_start_date`);
        continue;
      }

      const { data: student, error: sErr } = await supabase
        .from('students')
        .select('student_id')
        .eq('upn', upn)
        .maybeSingle();

      if (sErr || !student) {
        problems.push(`Row ${i + 2}: no student found with UPN "${upn}"`);
        continue;
      }

      const { data: subject, error: subErr } = await supabase
        .from('subjects')
        .select('subject_id')
        .eq('subject_code', subjectCode)
        .maybeSingle();

      if (subErr || !subject) {
        problems.push(`Row ${i + 2}: no subject found with code "${subjectCode}"`);
        continue;
      }

      const { error: insErr } = await supabase.from('results').insert([{
        student_id: student.student_id,
        subject_id: subject.subject_id,
        week_start_date: week,
        score,
        max_score: maxScore,
        grade,
      }]);

      if (insErr) problems.push(`Row ${i + 2}: ${insErr.message}`);
      else successCount++;
    }

    setErrors(problems);
    setStatus(`Imported ${successCount} of ${rows.length} rows.${problems.length ? ' Some rows had issues — see below.' : ''}`);
  }

  return (
    <div>
      <h1>Import Results (CSV)</h1>

      <div className="card">
        <p>CSV must have these column headers: <code>upn, subject_code, week_start_date, score, max_score, grade</code></p>
        <p><code>week_start_date</code> format: YYYY-MM-DD. <code>upn</code> must match a student already in the system. <code>subject_code</code> must match an existing subject (e.g. MAT, ENG, SCI).</p>
        <input type="file" accept=".csv" onChange={handleFile} />
      </div>

      {preview.length > 0 && (
        <div className="card">
          <h2>Preview (first 10 rows)</h2>
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
          <p style={{ marginTop: '1rem' }}>{rows.length} total rows detected.</p>
          <button onClick={handleImport}>Import all {rows.length} rows</button>
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

export default function ImportPage() {
  return <RequireAuth><ImportInner /></RequireAuth>;
}
