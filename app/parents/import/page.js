'use client';
import { useState } from 'react';
import Papa from 'papaparse';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import { useAuth } from '../../../lib/AuthContext';

// Matches the SIMS parent export: a header row (Title, Forename, Surname, phones, emails, blank UPN)
// followed by one row per linked child (all other fields blank, only UPN filled).
function ImportInner() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [blocks, setBlocks] = useState([]);
  const [preview, setPreview] = useState([]);
  const [status, setStatus] = useState(null);
  const [errors, setErrors] = useState([]);

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const buf = evt.target.result;
      const bytes = new Uint8Array(buf);
      // Detect UTF-16 LE/BE BOM (common export from Windows tools); fall back to UTF-8.
      let text;
      if (bytes[0] === 0xFF && bytes[1] === 0xFE) {
        text = new TextDecoder('utf-16le').decode(buf);
      } else if (bytes[0] === 0xFE && bytes[1] === 0xFF) {
        text = new TextDecoder('utf-16be').decode(buf);
      } else {
        text = new TextDecoder('utf-8').decode(buf);
      }

      Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const rows = results.data;
          const parsedBlocks = [];
          let current = null;
          for (const row of rows) {
            const forename = (row['Forename'] || '').trim();
            const surname = (row['Surname'] || '').trim();
            const upn = (row['UPN'] || '').trim();
            if (forename || surname) {
              if (current) parsedBlocks.push(current);
              current = {
                first_name: forename || '',
                last_name: surname || '',
                phone: (row['Main Telephone'] || row['Main Home Telephone'] || '').trim() || null,
                email: (row['Home Email'] || row['Work Email'] || '').trim() || null,
                upns: [],
              };
            } else if (upn && current) {
              current.upns.push(upn);
            }
          }
          if (current) parsedBlocks.push(current);
          setBlocks(parsedBlocks);
          setPreview(parsedBlocks.slice(0, 10));
          setStatus(null);
          setErrors([]);
        },
      });
    };
    reader.readAsArrayBuffer(file);
  }

  async function handleImport() {
    setStatus('Importing...');
    const problems = [];
    let parentsCreated = 0, linksCreated = 0;

    for (const [i, b] of blocks.entries()) {
      if (!b.first_name && !b.last_name) continue;

      const { data: parent, error: pErr } = await supabase
        .from('parents')
        .insert([{ first_name: b.first_name, last_name: b.last_name, phone: b.phone, email: b.email }])
        .select('parent_id')
        .single();

      if (pErr) {
        problems.push(`Row ${i + 1} (${b.first_name} ${b.last_name}): ${pErr.message}`);
        continue;
      }
      parentsCreated++;

      for (const upn of b.upns) {
        const { data: student } = await supabase.from('students').select('student_id').eq('upn', upn).maybeSingle();
        if (!student) {
          problems.push(`Row ${i + 1} (${b.first_name} ${b.last_name}): no student found with UPN ${upn}`);
          continue;
        }
        const { error: linkErr } = await supabase
          .from('student_parent')
          .insert([{ student_id: student.student_id, parent_id: parent.parent_id }]);
        if (linkErr) problems.push(`Row ${i + 1} link to ${upn}: ${linkErr.message}`);
        else linksCreated++;
      }
    }

    setErrors(problems);
    setStatus(`Created ${parentsCreated} parents and ${linksCreated} student links, out of ${blocks.length} parent records.${problems.length ? ' Some rows had issues — see below.' : ''}`);
  }

  if (!isAdmin) {
    return <p>Only admin accounts can bulk import parent data.</p>;
  }

  return (
    <div>
      <h1>Import Parents (CSV)</h1>

      <div className="card">
        <p>Expects the standard export: columns <code>Title, Forename, Surname, Main Telephone, Main Home Telephone, Home Email, Work Email, UPN</code>.</p>
        <p>Each parent is one row with their details, followed by one row per child with just the UPN filled in — matches the SIMS export format exactly.</p>
        <input type="file" accept=".csv" onChange={handleFile} />
      </div>

      {preview.length > 0 && (
        <div className="card">
          <h2>Preview (first 10 parent records)</h2>
          <div className="table-scroll">
            <table>
              <thead><tr><th>First name</th><th>Last name</th><th>Phone</th><th>Email</th><th>Children (UPNs)</th></tr></thead>
              <tbody>
                {preview.map((b, i) => (
                  <tr key={i}>
                    <td>{b.first_name}</td>
                    <td>{b.last_name}</td>
                    <td>{b.phone}</td>
                    <td>{b.email}</td>
                    <td>{b.upns.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ marginTop: '1rem' }}>{blocks.length} total parent records detected.</p>
          <button onClick={handleImport}>Import all {blocks.length} parents</button>
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
