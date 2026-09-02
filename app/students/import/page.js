'use client';
import { useState } from 'react';
import Papa from 'papaparse';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import { useAuth } from '../../../lib/AuthContext';

// Recognized CSV columns (all optional except first_name, last_name, dob, year_group).
// upn is used to update an existing student if it matches; otherwise a new student is created.
const COLUMNS = [
  'upn', 'first_name', 'last_name', 'middle_name', 'legal_first_name', 'legal_last_name',
  'preferred_name', 'dob', 'year_group', 'form_class', 'admission_date', 'admitted_letter_date',
  'gender', 'student_email', 'nationality', 'religion', 'state_of_origin', 'lga', 'home_town',
  'boarding_house', 'boarding_room_number', 'sports_house', 'national_identity_number',
  'neco_exam_number', 'utme_pin', 'utme_profile_code', 'address_line1', 'address_line2',
  'city', 'postcode', 'country', 'emergency_contact_name', 'emergency_contact_phone',
  'medical_notes', 'leaving_date', 'status',
];

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
        setRows(results.data);
        setPreview(results.data.slice(0, 10));
        setStatus(null);
        setErrors([]);
      },
    });
  }

  function cleanRow(row) {
    const out = {};
    for (const col of COLUMNS) {
      const val = (row[col] ?? '').toString().trim();
      out[col] = val === '' ? null : val;
    }
    if (out.year_group) out.year_group = Number(out.year_group);
    if (!out.status) out.status = 'active';
    return out;
  }

  async function handleImport() {
    setStatus('Importing...');
    const problems = [];
    let created = 0, updated = 0;

    for (const [i, raw] of rows.entries()) {
      const row = cleanRow(raw);

      if (!row.first_name || !row.last_name || !row.dob || !row.year_group) {
        problems.push(`Row ${i + 2}: missing required field (first_name, last_name, dob, or year_group)`);
        continue;
      }

      if (row.upn) {
        const { data: existing } = await supabase
          .from('students')
          .select('student_id')
          .eq('upn', row.upn)
          .maybeSingle();

        if (existing) {
          const { error } = await supabase.from('students').update(row).eq('student_id', existing.student_id);
          if (error) problems.push(`Row ${i + 2} (UPN ${row.upn}): ${error.message}`);
          else updated++;
          continue;
        }
      }

      const { error } = await supabase.from('students').insert([row]);
      if (error) problems.push(`Row ${i + 2}: ${error.message}`);
      else created++;
    }

    setErrors(problems);
    setStatus(`Created ${created}, updated ${updated}, out of ${rows.length} rows.${problems.length ? ' Some rows had issues — see below.' : ''}`);
  }

  if (!isAdmin) {
    return <p>Only admin accounts can bulk import student data.</p>;
  }

  return (
    <div>
      <h1>Import Students (CSV)</h1>

      <div className="card">
        <p>Required columns: <code>first_name, last_name, dob, year_group</code></p>
        <p>Optional columns (include any you have data for — leave others out or blank):</p>
        <p style={{ fontSize: '0.85rem', wordBreak: 'break-word' }}>{COLUMNS.filter(c => !['first_name','last_name','dob','year_group'].includes(c)).join(', ')}</p>
        <p><code>upn</code>: if a student with this UPN already exists, their record is <strong>updated</strong>. If not (or left blank), a <strong>new</strong> student is created.</p>
        <p><code>dob</code>, <code>admission_date</code>, <code>admitted_letter_date</code>, <code>leaving_date</code> format: YYYY-MM-DD.</p>
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
