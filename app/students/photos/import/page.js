'use client';
import { useState } from 'react';
import { supabase } from '../../../../lib/supabaseClient';
import RequireAuth from '../../../RequireAuth';
import { useAuth } from '../../../../lib/AuthContext';

function ImportInner() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState(null);
  const [errors, setErrors] = useState([]);
  const [preview, setPreview] = useState([]);

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setStatus('Reading file...');
    const text = await file.text();
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    const records = Array.from(doc.getElementsByTagName('Record'));
    const parsed = records
      .map((r) => ({
        upn: r.getElementsByTagName('UPN')[0]?.textContent?.trim(),
        photo: r.getElementsByTagName('Photo')[0]?.textContent?.trim(),
      }))
      .filter((r) => r.upn && r.photo);
    setRows(parsed);
    setPreview(parsed.slice(0, 6));
    setStatus(`Found ${parsed.length} photos in the file.`);
    setErrors([]);
  }

  async function handleImport() {
    setStatus('Matching students by UPN...');
    const { data: students } = await supabase.from('students').select('student_id, upn, first_name, last_name');
    const byUpn = Object.fromEntries((students || []).map((s) => [s.upn, s]));

    const problems = [];
    const matched = [];
    rows.forEach((r) => {
      const s = byUpn[r.upn];
      if (!s) problems.push(`No student found with UPN ${r.upn}`);
      else matched.push({ student_id: s.student_id, photo_base64: r.photo });
    });

    setStatus(`Saving ${matched.length} photos...`);
    const CONCURRENCY = 8;
    let done = 0;
    for (let i = 0; i < matched.length; i += CONCURRENCY) {
      const batch = matched.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map((m) => supabase.from('students').update({ photo_base64: m.photo_base64 }).eq('student_id', m.student_id))
      );
      results.forEach((res, idx) => {
        if (res.error) problems.push(`Student ${batch[idx].student_id}: ${res.error.message}`);
        else done += 1;
      });
      setStatus(`Saving photos... ${Math.min(i + CONCURRENCY, matched.length)}/${matched.length}`);
    }

    setErrors(problems);
    setStatus(`Saved ${done} of ${matched.length} photos.${problems.length ? ' Some rows had issues — see below.' : ''}`);
  }

  if (!isAdmin) {
    return <p>Only admin accounts can bulk import photos.</p>;
  }

  return (
    <div>
      <h1>Import Student Photos</h1>

      <div className="card">
        <p>Expects the SIMS photo export XML (one <code>&lt;Record&gt;</code> per student, with <code>UPN</code> and a base64-encoded <code>Photo</code>).</p>
        <p>Run migration <code>029_student_photos.sql</code> first — it adds the photo column to the students table.</p>
        <input type="file" accept=".xml" onChange={handleFile} />
      </div>

      {preview.length > 0 && (
        <div className="card">
          <h2>Preview</h2>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            {preview.map((r, i) => (
              <div key={i} style={{ textAlign: 'center' }}>
                <img src={`data:image/jpeg;base64,${r.photo}`} alt={r.upn} style={{ width: 80, height: 100, objectFit: 'cover', borderRadius: 6 }} />
                <div style={{ fontSize: '0.75rem' }}>{r.upn}</div>
              </div>
            ))}
          </div>
          <button style={{ marginTop: '1rem' }} onClick={handleImport}>Import all {rows.length} photos</button>
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
  return <RequireAuth><ImportInner /></RequireAuth>;
}
