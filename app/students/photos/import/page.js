'use client';
import { useState } from 'react';
import { supabase } from '../../../../lib/supabaseClient';
import RequireAuth from '../../../RequireAuth';
import RequireResource from '../../../RequireResource';
import { useAuth } from '../../../../lib/AuthContext';

function ImportInner() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState(null);
  const [errors, setErrors] = useState([]);
  const [preview, setPreview] = useState([]);
  // On by default: an export from the old system can hold an older photo
  // than one already taken in Formwork (e.g. for students who left this term).
  const [keepExisting, setKeepExisting] = useState(true);

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
    // Current and left students alike, so leavers' photos can be imported.
    // Only the ids of students with a photo are fetched, not the photos.
    const [{ data: students }, { data: withPhoto }] = await Promise.all([
      supabase.from('students').select('student_id, upn, first_name, last_name').range(0, 9999),
      supabase.from('students').select('student_id').not('photo_base64', 'is', null).neq('photo_base64', '').range(0, 9999),
    ]);
    const byUpn = Object.fromEntries((students || []).map((s) => [s.upn, s]));
    const hasPhoto = new Set((withPhoto || []).map((s) => s.student_id));

    const problems = [];
    const matched = [];
    let kept = 0;
    rows.forEach((r) => {
      const s = byUpn[r.upn];
      if (!s) problems.push(`No student found with UPN ${r.upn}`);
      else if (keepExisting && hasPhoto.has(s.student_id)) kept += 1;
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
    setStatus(`Saved ${done} of ${matched.length} photos.${kept ? ` Kept the existing photo for ${kept} student${kept === 1 ? '' : 's'}.` : ''}${problems.length ? ' Some rows had issues — see below.' : ''}`);
  }

  if (!isAdmin) {
    return <p>Only admin accounts can bulk import photos.</p>;
  }

  return (
    <div>
      <h1>Import Student Photos</h1>

      <div className="card">
        <p>Expects the SIMS photo export XML (one <code>&lt;Record&gt;</code> per student, with <code>UPN</code> and a base64-encoded <code>Photo</code>).</p>
        <p>Photos are matched by UPN to current students and students who have left.</p>
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
          <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '1rem', fontWeight: 400 }}>
            <input type="checkbox" checked={keepExisting} onChange={(e) => setKeepExisting(e.target.checked)} style={{ width: 'auto' }} />
            Keep photos students already have (only fill in missing ones)
          </label>
          <button style={{ marginTop: '0.75rem' }} onClick={handleImport}>Import {rows.length} photos</button>
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
  return <RequireAuth><RequireResource resourceKey="/students/photos/import"><ImportInner /></RequireResource></RequireAuth>;
}
