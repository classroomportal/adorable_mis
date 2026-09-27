'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { useAuth } from '../../../lib/AuthContext';

function ComposeInner() {
  const { profile, staffRoles } = useAuth();
  const allowed = profile?.role === 'admin' || ['smt', 'pastoral', 'school_office'].some((r) => staffRoles.includes(r));

  const [messages, setMessages] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [receipts, setReceipts] = useState([]);
  const [emails, setEmails] = useState([]);
  const [emailFilter, setEmailFilter] = useState('');
  const [emailLimit, setEmailLimit] = useState(100);

  useEffect(() => {
    if (!allowed) return;
    supabase
      .from('messages')
      .select('id, subject, body, target_type, target_value, recipient_count, email_sent, sent_at')
      .order('sent_at', { ascending: false })
      .then(({ data }) => setMessages(data || []));
  }, [allowed]);

  // Emails Formwork sends by itself (welcome emails, behaviour alerts,
  // detention set/reminder/cancelled) go through email_outbox, not messages.
  // Only these columns are readable from the client: the body can hold a
  // parent's initial password (migration 201).
  useEffect(() => {
    if (!allowed) return;
    let q = supabase
      .from('email_outbox')
      .select('email_id, recipient, subject, status, attempts, last_error, created_at, sent_at')
      .order('created_at', { ascending: false })
      .limit(emailLimit);
    if (emailFilter.trim()) {
      const f = emailFilter.trim().replace(/[%,()]/g, ' ');
      q = q.or(`subject.ilike.%${f}%,recipient.ilike.%${f}%`);
    }
    q.then(({ data }) => setEmails(data || []));
  }, [allowed, emailFilter, emailLimit]);

  async function toggleExpand(id) {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    const { data } = await supabase
      .from('message_read_status')
      .select('recipient_name, recipient_email, read_at')
      .eq('message_id', id);
    setReceipts(data || []);
  }

  if (!allowed) return <p>Only SMT, Pastoral, or School Office can view message history.</p>;

  return (
    <div>
      <h1>Message history</h1>
      {messages.map((m) => {
        const readCount = expanded === m.id ? receipts.filter((r) => r.read_at).length : null;
        return (
          <div className="card" key={m.id}>
            <p><strong>{m.subject}</strong> — {m.recipient_count} recipient(s), {m.email_sent ? 'emailed + in-app' : 'in-app only'}</p>
            <p style={{ color: '#666', fontSize: '0.85rem' }}>{new Date(m.sent_at).toLocaleString()} — {m.target_type}{m.target_value ? `: ${m.target_value}` : ''}</p>
            <p>{m.body}</p>
            <button onClick={() => toggleExpand(m.id)}>
              {expanded === m.id ? 'Hide read receipts' : 'Show read receipts'}
            </button>
            {expanded === m.id && (
              <div style={{ marginTop: '0.5rem' }}>
                <p>{readCount} of {receipts.length} read.</p>
                <ul>
                  {receipts.map((r, i) => (
                    <li key={i}>
                      {r.recipient_name || r.recipient_email || 'Unknown'} — {r.read_at ? `read ${new Date(r.read_at).toLocaleString()}` : 'unread'}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })}
      {messages.length === 0 && <p>No messages sent from Compose yet.</p>}

      <div className="card">
        <h2>Automatic emails</h2>
        <p style={{ color: '#666', fontSize: '0.85rem' }}>
          Emails Formwork sends by itself: welcome emails, behaviour alerts and detention emails.
        </p>
        <input
          placeholder="Search subject or recipient"
          value={emailFilter}
          onChange={(e) => { setEmailFilter(e.target.value); setEmailLimit(100); }}
          style={{ maxWidth: '20rem' }}
        />
        {emails.length === 0 ? <p>No emails found.</p> : (
          <div className="table-scroll"><table>
            <thead><tr><th>Subject</th><th>To</th><th>Status</th><th>Time</th></tr></thead>
            <tbody>
              {emails.map((e) => (
                <tr key={e.email_id}>
                  <td>{e.subject}</td>
                  <td>{e.recipient}</td>
                  <td>
                    {e.status === 'sent' ? 'Sent' : e.status === 'failed' ? 'Failed' : 'Waiting to send'}
                    {e.status === 'failed' && e.last_error && (
                      <div style={{ color: '#a3232c', fontSize: '0.8rem' }}>{e.last_error}</div>
                    )}
                  </td>
                  <td>{new Date(e.sent_at || e.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        {emails.length === emailLimit && (
          <button className="secondary" onClick={() => setEmailLimit((n) => n + 100)}>Show more</button>
        )}
      </div>
    </div>
  );
}

export default function HistoryPage() {
  return <RequireAuth><RequireResource resourceKey="/comms/history"><ComposeInner /></RequireResource></RequireAuth>;
}
