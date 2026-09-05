'use client';
import { useState } from 'react';
import Papa from 'papaparse';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import { useAuth } from '../../../lib/AuthContext';

function ImportInner() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [csvText, setCsvText] = useState('');
  const [matches, setMatches] = useState([]); // { row, staff, status }
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);

  function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => setCsvText(evt.target.result);
    reader.readAsText(file);
  }

  async function handleParse() {
    const parsed = Papa.parse(csvText.trim(), { header: true, skipEmptyLines: true });
    const rows = (parsed.data || []).map((r) => ({
      staff_code: (r.staff_code || r.Code || r['Staff Code'] || '').trim().toUpperCase() || null,
      first_name: (r.first_name || r.First_Name || r['First Name'] || '').trim(),
      last_name: (r.last_name || r.Last_Name || r['Last Name'] || '').trim(),
      email: (r.email || r.Email || r['Work Email'] || r['Home Email'] || '').trim(),
    }));

    const { data: staffList } = await supabase.from('staff').select('staff_id, first_name, last_name, staff_code, email');

    const results = rows.map((row) => {
      if (!row.email) return { row, staff: null, status: 'no email given, skipped' };

      // Prefer matching by staff_code (most reliable), fall back to exact name match.
      let match = null;
      if (row.staff_code) {
        match = staffList.find((s) => (s.staff_code || '').toUpperCase() === row.staff_code);
      }
      if (!match && row.first_name && row.last_name) {
        const nameMatches = staffList.filter(
          (s) => s.first_name.toLowerCase() === row.first_name.toLowerCase() &&
                 s.last_name.toLowerCase() === row.last_name.toLowerCase()
        );
        if (nameMatches.length === 1) match = nameMatches[0];
        else if (nameMatches.length > 1) return { row, staff: null, status: 'ambiguous — multiple staff with this name, use staff_code instead' };
      }

      if (!match) return { row, staff: null, status: 'no matching staff found' };
      if (match.email && match.email !== row.email) return { row, staff: match, status: `will overwrite existing email (${match.email})` };
      if (match.email === row.email) return { row, staff: match, status: 'already set, no change' };
      return { row, staff: match, status: 'ready' };
    });

    setMatches(results);
    setStatus(`${results.filter((r) => r.staff).length} of ${rows.length} row(s) matched to a staff record.`);
  }

  async function handleApply() {
    setSaving(true);
    const toApply = matches.filter((m) => m.staff && m.status !== 'already set, no change');
    let ok = 0;
    const problems = [];
    for (const m of toApply) {
      const { error } = await supabase.from('staff').update({ email: m.row.email }).eq('staff_id', m.staff.staff_id);
      if (error) problems.push(`${m.staff.first_name} ${m.staff.last_name}: ${error.message}`);
      else ok += 1;
    }
    setSaving(false);
    setStatus(`Updated ${ok} of ${toApply.length}.${problems.length ? ' Issues: ' + problems.join('; ') : ''}`);
  }

  if (!isAdmin) return <p>Only admin can bulk-import staff emails.</p>;

  const readyCount = matches.filter((m) => m.staff && m.status !== 'already set, no change').length;

  return (
    <div>
      <h1>Bulk Import Staff Emails</h1>
      <div className="card">
        <p>
          Paste a CSV with columns <code>staff_code,email</code> (preferred — most reliable match) or
          <code> first_name,last_name,email</code>. Nothing is written until you review the match preview
          below and press Apply.
        </p>
        <input type="file" accept=".csv,text/csv" onChange={handleFileSelect} style={{ marginBottom: '0.5rem' }} />
        <textarea
          rows={8}
          style={{ width: '100%' }}
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          placeholder="staff_code,email&#10;CBT,chris@classroomportal.org&#10;..."
        />
        <button onClick={handleParse} style={{ marginTop: '0.5rem' }}>Preview matches</button>
      </div>

      {matches.length > 0 && (
        <div className="card">
          <div className="table-scroll"><table>
            <thead><tr><th>CSV row</th><th>Matched staff</th><th>Status</th></tr></thead>
            <tbody>
              {matches.map((m, i) => (
                <tr key={i} style={!m.staff ? { background: '#fdeaea' } : undefined}>
                  <td>{m.row.staff_code || `${m.row.first_name} ${m.row.last_name}`} — {m.row.email || '(no email)'}</td>
                  <td>{m.staff ? `${m.staff.first_name} ${m.staff.last_name}` : '—'}</td>
                  <td>{m.status}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <button onClick={handleApply} disabled={saving || readyCount === 0} style={{ marginTop: '0.5rem' }}>
            {saving ? 'Applying...' : `Apply ${readyCount} email(s)`}
          </button>
        </div>
      )}

      {status && <p>{status}</p>}
    </div>
  );
}

export default function StaffEmailImportPage() {
  return <RequireAuth><ImportInner /></RequireAuth>;
}
