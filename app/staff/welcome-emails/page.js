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

  function handleExportCsv() {
    const csv = Papa.unparse(rows.map((r) => ({
      staff_name: r.staff_name || '',
      email: r.email,
      temp_password: r.temp_password,
    })));
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `staff-welcome-emails-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const MAIL_MERGE_TEMPLATE = `Subject: Your Adorable MIS staff login

Dear {{staff_name}},

Your Adorable MIS staff account is ready.

Login email: {{email}}
Temporary password: {{temp_password}}

Please log in at mis.classroomportal.org and change your password on first login.

Kind regards,
Adorable British College`;

  const GMAIL_MAIL_MERGE_INSTRUCTIONS = `Sending via info@abc.sch.ng (Google Workspace mail merge)

1. Open Google Sheets → File → Import → upload the CSV you just downloaded. Keep the header row (staff_name, email, temp_password).
2. In Gmail, compose a new email and click the mail-merge icon in the compose toolbar (only shows if multi-send mode is on).
   Not showing? Settings → See all settings → Advanced → Multi-Send Mode → Enable.
3. Link the Google Sheet you just made as the recipient source.
4. Write the email using {{staff_name}}, {{email}}, {{temp_password}} as merge fields (see the Resend template above for wording — swap {{ }} for the merge fields).
5. Preview a few, then send. Workspace allows up to 2,000 recipients/day, so the whole staff list can go in one send.`;

  const OVER_DAILY_CAP = rows.length > 90;

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

          {OVER_DAILY_CAP && (
            <p style={{ color: '#b45309', fontWeight: 600 }}>
              {rows.length} is over Resend's 100/day free-tier cap — sending now will fail partway through.
              Export the CSV below and mail-merge it through the school office's own email instead.
            </p>
          )}

          <button onClick={handleExportCsv} style={{ marginRight: '0.5rem' }}>Download CSV for mail merge</button>
          <button onClick={handleSend} disabled={sending || OVER_DAILY_CAP}>
            {sending ? 'Sending...' : `Send ${rows.length} emails via Resend`}
          </button>

          <details style={{ marginTop: '0.75rem' }} open={OVER_DAILY_CAP}>
            <summary>How to send via info@abc.sch.ng (Google Workspace mail merge)</summary>
            <pre style={{ whiteSpace: 'pre-wrap', background: '#f5f5f0', padding: '0.75rem', fontSize: '0.85rem' }}>{GMAIL_MAIL_MERGE_INSTRUCTIONS}</pre>
          </details>

          <details style={{ marginTop: '0.5rem' }}>
            <summary>Mail-merge email template (copy for Word/Outlook)</summary>
            <pre style={{ whiteSpace: 'pre-wrap', background: '#f5f5f0', padding: '0.75rem', fontSize: '0.85rem' }}>{MAIL_MERGE_TEMPLATE}</pre>
          </details>
        </div>
      )}

      {status && <p>{status}</p>}
    </div>
  );
}

export default function StaffWelcomeEmailsPage() {
  return <RequireAuth><StaffWelcomeEmailsInner /></RequireAuth>;
}
