'use client';
import { useState } from 'react';
import Papa from 'papaparse';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import { useAuth } from '../../../lib/AuthContext';

function StaffWelcomeEmailsInner() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [csvText, setCsvText] = useState('');
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState(null);
  const [sending, setSending] = useState(false);

  function handleParse() {
    const parsed = Papa.parse(csvText.trim(), { header: true, skipEmptyLines: true });
    const valid = (parsed.data || []).filter((r) => r.email && r.temp_password && !r.temp_password.startsWith('('));
    setRows(valid);
    setStatus(`${valid.length} staff member(s) ready to email (skipped rows without a real password).`);
  }

  async function handleSend() {
    setSending(true);
    let sent = 0;
    const problems = [];
    for (const r of rows) {
      const { error } = await supabase.rpc('send_staff_welcome_email', {
        p_email: r.email,
        p_name: r.staff_name || r.email,
        p_temp_password: r.temp_password,
      });
      if (error) problems.push(`${r.email}: ${error.message}`);
      else sent += 1;
      setStatus(`Sending... ${sent + problems.length}/${rows.length}`);
    }
    setSending(false);
    setStatus(`Sent ${sent} of ${rows.length}.${problems.length ? ' Issues: ' + problems.slice(0, 10).join('; ') : ''}`);
  }

  if (!isAdmin) return <p>Only admin can send welcome emails.</p>;

  return (
    <div>
      <h1>Send Staff Welcome Emails</h1>
      <div className="card">
        <p>
          First run <code>select * from create_staff_logins();</code> in the Supabase SQL editor — it creates a
          login for every staff member with an email who doesn't already have one, and returns the CSV to paste below.
        </p>
        <p>Paste the CSV that <code>create_staff_logins()</code> returned (columns: <code>staff_name,email,temp_password</code>). Rows marked "skipped" are ignored automatically.</p>
        <textarea
          rows={8}
          style={{ width: '100%' }}
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          placeholder="staff_name,email,temp_password&#10;Chris TERRY,chris@classroomportal.org,0b575c25d5&#10;..."
        />
        <button onClick={handleParse} style={{ marginTop: '0.5rem' }}>Parse</button>
      </div>

      {rows.length > 0 && (
        <div className="card">
          <p>{rows.length} staff member(s) will receive an email with their login and temporary password.</p>
          <button onClick={handleSend} disabled={sending}>{sending ? 'Sending...' : `Send ${rows.length} emails`}</button>
        </div>
      )}

      {status && <p>{status}</p>}
    </div>
  );
}

export default function StaffWelcomeEmailsPage() {
  return <RequireAuth><StaffWelcomeEmailsInner /></RequireAuth>;
}
