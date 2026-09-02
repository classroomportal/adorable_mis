'use client';
import { useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import { useAuth } from '../../../lib/AuthContext';

// Matches the CoreSats "StudentData" export format exactly.
function excelDateToISO(val) {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  if (typeof val === 'number') {
    const d = XLSX.SSF.parse_date_code(val);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  const s = String(val).trim();
  return s || null;
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
    const reader = new FileReader();
    reader.onload = (evt) => {
      const wb = XLSX.read(evt.target.result, { type: 'binary', cellDates: true });
      const sheetName = wb.SheetNames.includes('StudentData') ? 'StudentData' : wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(sheet, { defval: null });
      setRows(data);
      setPreview(data.slice(0, 10));
      setStatus(null);
      setErrors([]);
    };
    reader.readAsBinaryString(file);
  }

  async function handleImport() {
    setStatus('Importing...');
    const problems = [];
    let studentsUpdated = 0, cat4Written = 0, ngrtWritten = 0;

    for (const [i, row] of rows.entries()) {
      const upn = row['TW Unique ID'] ? String(row['TW Unique ID']).trim() : null;
      if (!upn) {
        problems.push(`Row ${i + 2}: missing TW Unique ID (UPN)`);
        continue;
      }

      const { data: student, error: sErr } = await supabase
        .from('students')
        .select('student_id')
        .eq('upn', upn)
        .maybeSingle();

      if (sErr || !student) {
        problems.push(`Row ${i + 2}: no student found with UPN "${upn}" — import students first`);
        continue;
      }

      // Update student-level flags
      const { error: updErr } = await supabase.from('students').update({
        ethnicity: row['Ethnicity'] || null,
        fsm: row['FSM'] || null,
        eal: row['EAL'] || null,
        send: row['SEND'] || null,
        custom1: row['Custom1'] || null,
        custom2: row['Custom2'] || null,
      }).eq('student_id', student.student_id);
      if (updErr) problems.push(`Row ${i + 2} (student flags): ${updErr.message}`);
      else studentsUpdated++;

      // CAT4
      const cat4Date = excelDateToISO(row['CAT4 - Date of Test']);
      if (cat4Date) {
        const { error: cErr } = await supabase.from('cat4_results').upsert([{
          student_id: student.student_id,
          test_date: cat4Date,
          level: row['CAT4 - Level'] || null,
          mean_sas: row['CAT4 - Mean SAS'] ?? null,
          verbal_sas: row['CAT4 - Verbal SAS'] ?? null,
          non_verbal_sas: row['CAT4 - Non Verbal SAS'] ?? null,
          quantitative_sas: row['CAT4 - Quantitative SAS'] ?? null,
          spatial_sas: row['CAT4 - Spatial SAS'] ?? null,
        }], { onConflict: 'student_id,test_date' });
        if (cErr) problems.push(`Row ${i + 2} (CAT4): ${cErr.message}`);
        else cat4Written++;
      }

      // NGRT
      const ngrtDate = excelDateToISO(row['NGRT - Date of Test']);
      if (ngrtDate) {
        const { error: nErr } = await supabase.from('ngrt_results').upsert([{
          student_id: student.student_id,
          test_date: ngrtDate,
          form: row['NGRT - Form'] || null,
          sas: row['NGRT - SAS'] ?? null,
          pc_stanine: row['NGRT - PC Stanine'] ?? null,
          sc_stanine: row['NGRT - SC Stanine'] ?? null,
          overall_stanine: row['NGRT - Overall Stanine'] ?? null,
          reading_age: row['NGRT - Reading Age YY:MM'] ? String(row['NGRT - Reading Age YY:MM']) : null,
        }], { onConflict: 'student_id,test_date' });
        if (nErr) problems.push(`Row ${i + 2} (NGRT): ${nErr.message}`);
        else ngrtWritten++;
      }
    }

    setErrors(problems);
    setStatus(`${studentsUpdated} students updated, ${cat4Written} CAT4 results, ${ngrtWritten} NGRT results written out of ${rows.length} rows.${problems.length ? ' Some rows had issues — see below.' : ''}`);
  }

  if (!isAdmin) return <p>Only admin accounts can import assessment data.</p>;

  return (
    <div>
      <h1>Import Predictive Assessment Data</h1>

      <div className="card">
        <p>Upload the CoreSats-format export directly (.ods, .xlsx, or .csv) — no need to convert it first.</p>
        <p>Matches students by <strong>TW Unique ID</strong> against the student's <strong>UPN</strong>. Students not already in the system are skipped and listed as issues — import students first via Students → Bulk import.</p>
        <p>Reads: ethnicity, FSM, EAL, SEND, Custom1/2 flags, plus CAT4 (level, mean/verbal/non-verbal/quantitative/spatial SAS) and NGRT (form, SAS, PC/SC/overall stanine, reading age) results.</p>
        <input type="file" accept=".ods,.xlsx,.xls,.csv" onChange={handleFile} />
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
                  <tr key={i}>{Object.values(r).map((v, j) => <td key={j}>{v instanceof Date ? v.toISOString().slice(0,10) : String(v ?? '')}</td>)}</tr>
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
