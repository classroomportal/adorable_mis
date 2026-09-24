'use client';
import { useState } from 'react';
import Papa from 'papaparse';
import { supabase } from '../../../lib/supabaseClient';
import { schoolToday } from '../../../lib/schoolTime';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { useAuth } from '../../../lib/AuthContext';

function WelcomeEmailsInner() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [csvText, setCsvText] = useState('');
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [status, setStatus] = useState(null);
  const [sending, setSending] = useState(false);

  function handleParse() {
    const parsed = Papa.parse(csvText.trim(), { header: true, skipEmptyLines: true });
    const valid = (parsed.data || []).filter((r) => r.email && r.temp_password && !r.temp_password.startsWith('('));
    setRows(valid);
    setSelected(new Set(valid.map((_, i) => i)));
    setStatus(`${valid.length} parent(s) ready to email (skipped rows without a real password).`);
  }

  const GMAIL_MAIL_MERGE_INSTRUCTIONS = `Sending via mis@abc.sch.ng (Google Workspace mail merge)

1. Open Google Sheets → File → Import → upload the CSV you just downloaded. Keep the header row (parent_name, email, temp_password).
2. In Gmail, compose a new email and click the mail-merge icon in the compose toolbar (only shows if multi-send mode is on).
   Not showing? Settings → See all settings → Advanced → Multi-Send Mode → Enable.
3. Link the Google Sheet you just made as the recipient source.
4. Write the email using {{parent_name}}, {{email}}, {{temp_password}} as merge fields (see the template above for wording — swap {{ }} for the merge fields).
5. Preview a few, then send. Workspace allows up to 2,000 recipients/day, so the whole parent list can go in one send.`;

  const chosen = rows.filter((_, i) => selected.has(i));

  function toggle(i) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  function handleExportCsv() {
    const csv = Papa.unparse(chosen.map((r) => ({
      parent_name: r.parent_name || '',
      email: r.email,
      temp_password: r.temp_password,
    })));
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `parent-welcome-emails-${schoolToday()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const MAIL_MERGE_TEMPLATE = `Subject: Your Formwork parent portal login

Dear {{parent_name}},

Your Formwork parent portal account is ready.

Login email: {{email}}
Temporary password: {{temp_password}}

Please log in at misform.work and change your password on first login.

Kind regards,
Adorable British College`;

  const OVER_DAILY_CAP = chosen.length > 2000;

  async function handleSend() {
    setSending(true);
    let sent = 0;
    const problems = [];
    const toSend = chosen;
    for (const r of toSend) {
      const { error } = await supabase.rpc('send_parent_welcome_email', {
        p_email: r.email,
        p_name: r.parent_name || r.email,
        p_temp_password: r.temp_password,
      });
      if (error) problems.push(`${r.email}: ${error.message}`);
      else sent += 1;
      setStatus(`Sending... ${sent + problems.length}/${toSend.length}`);
    }
    setSending(false);
    setStatus(`Sent ${sent} of ${toSend.length}.${problems.length ? ' Issues: ' + problems.slice(0, 10).join('; ') : ''}`);
  }

  if (!isAdmin) return <p>Only admin can send welcome emails.</p>;

  return (
    <div>
      <h1>Send Parent Welcome Emails</h1>
      <div className="card">
        <p>Paste the CSV that <code>create_parent_logins()</code> returned (columns: <code>parent_name,email,temp_password</code>). Rows marked "skipped" are ignored automatically.</p>
        <textarea
          rows={8}
          style={{ width: '100%' }}
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          placeholder="parent_name,email,temp_password&#10;Adaobi ABIAH,adafaith483@gmail.com,0b575c25d5&#10;..."
        />
        <button onClick={handleParse} style={{ marginTop: '0.5rem' }}>Parse</button>
      </div>

      {rows.length > 0 && (
        <div className="card">
          <p>{chosen.length} of {rows.length} parent(s) selected. Only ticked parents will receive an email with their login and temporary password.</p>

          <div style={{ marginBottom: '0.5rem' }}>
            <button onClick={() => setSelected(new Set(rows.map((_, i) => i)))} disabled={sending} style={{ marginRight: '0.5rem' }}>Select all</button>
            <button onClick={() => setSelected(new Set())} disabled={sending}>Select none</button>
          </div>
          <div style={{ maxHeight: '320px', overflowY: 'auto', border: '1px solid #ddd', padding: '0.5rem', marginBottom: '0.75rem' }}>
            {rows.map((r, i) => (
              <label key={i} style={{ display: 'block', padding: '0.15rem 0' }}>
                <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} disabled={sending} />{' '}
                {r.parent_name || '(no name)'} — {r.email}
              </label>
            ))}
          </div>

          {OVER_DAILY_CAP && (
            <p style={{ color: '#b45309', fontWeight: 600 }}>
              {chosen.length} is over Google Workspace's ~2,000/day send limit — sending now will fail partway through.
              Export the CSV below and mail-merge it through the school office's own email instead.
            </p>
          )}

          <button onClick={handleExportCsv} disabled={chosen.length === 0} style={{ marginRight: '0.5rem' }}>Download CSV for mail merge</button>
          <button onClick={handleSend} disabled={sending || OVER_DAILY_CAP || chosen.length === 0}>
            {sending ? 'Sending...' : `Send ${chosen.length} email${chosen.length === 1 ? '' : 's'} from mis@abc.sch.ng`}
          </button>

          <details style={{ marginTop: '0.75rem' }} open={OVER_DAILY_CAP}>
            <summary>How to send via mis@abc.sch.ng (Google Workspace mail merge)</summary>
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

export default function WelcomeEmailsPage() {
  return <RequireAuth><RequireResource resourceKey="/parents/welcome-emails"><WelcomeEmailsInner /></RequireResource></RequireAuth>;
}
