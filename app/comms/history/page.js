'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { useAuth } from '../../../lib/AuthContext';

const AUDIENCES = [
  { key: 'parents', label: 'To parents' },
  { key: 'staff', label: 'To staff' },
  { key: 'students', label: 'To students' },
  { key: 'other', label: 'Other addresses' },
];

// One audience's emails, grouped by kind (e.g. all "Detention" emails),
// newest group first. Rows arrive newest first from email_log().
function groupEmails(emails, audience, filter) {
  const f = filter.trim().toLowerCase();
  const groups = {};
  for (const e of emails) {
    if (e.audience !== audience) continue;
    if (f && !`${e.subject} ${e.recipient}`.toLowerCase().includes(f)) continue;
    const g = (groups[e.kind] ||= { kind: e.kind, rows: [], failed: 0, waiting: 0, latest: e.created_at });
    g.rows.push(e);
    if (e.status === 'failed') g.failed += 1;
    else if (e.status !== 'sent') g.waiting += 1;
  }
  return Object.values(groups).sort((a, b) => new Date(b.latest) - new Date(a.latest));
}

function ComposeInner() {
  const { profile, staffRoles } = useAuth();
  const allowed = profile?.role === 'admin' || ['smt', 'pastoral', 'school_office'].some((r) => staffRoles.includes(r));

  const [messages, setMessages] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [receipts, setReceipts] = useState([]);
  const [emails, setEmails] = useState([]);
  const [emailFilter, setEmailFilter] = useState('');
  const [noticeReads, setNoticeReads] = useState({}); // message_id -> [{ recipient_name, read_at }]

  useEffect(() => {
    if (!allowed) return;
    supabase
      .from('messages')
      .select('id, subject, body, sent_by, target_type, target_value, recipient_count, email_sent, sent_at')
      .order('sent_at', { ascending: false })
      .then(async ({ data }) => {
        setMessages(data || []);
        // Automatic notices (detention notices to a student, migration 203;
        // behaviour alerts to cs@/SMT/SRO, migration 204) go to a handful of
        // people each, so show who read them inline rather than behind a
        // button.
        const ids = (data || []).filter((m) => !m.sent_by).map((m) => m.id);
        if (!ids.length) return;
        const { data: reads } = await supabase
          .from('message_read_status')
          .select('message_id, recipient_name, read_at')
          .in('message_id', ids);
        const byMessage = {};
        (reads || []).forEach((row) => { (byMessage[row.message_id] ||= []).push(row); });
        setNoticeReads(byMessage);
      });
  }, [allowed]);

  // Emails Formwork sends by itself (welcome emails, behaviour alerts,
  // detention set/reminder/cancelled) go through email_outbox, not messages.
  // email_log() (migration 202) says who each went to - parents, staff or
  // students - and what kind of email it is, and never returns the body,
  // which can hold a parent's initial password (migration 201).
  useEffect(() => {
    if (!allowed) return;
    supabase.rpc('email_log').then(({ data }) => setEmails(data || []));
  }, [allowed]);

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

  const composed = messages.filter((m) => m.sent_by);
  const notices = messages.filter((m) => !m.sent_by);

  return (
    <div>
      <h1>Message history</h1>
      {composed.map((m) => {
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
      {composed.length === 0 && <p>No messages sent from Compose yet.</p>}

      <div className="card">
        <h2>Automatic notices in Formwork inboxes</h2>
        <p style={{ color: '#666', fontSize: '0.85rem' }}>
          Detention notices and behaviour alerts, sent to Formwork inboxes as well as by email. Read means they opened it in Formwork.
        </p>
        {notices.length === 0 ? <p>None yet.</p> : (
          <div className="table-scroll"><table>
            <thead><tr><th>Notice</th><th>To</th><th>Read</th></tr></thead>
            <tbody>
              {notices.map((m) => {
                const reads = noticeReads[m.id] || [];
                return (
                  <tr key={m.id}>
                    <td>{m.subject}<div style={{ color: '#666', fontSize: '0.8rem' }}>{new Date(m.sent_at).toLocaleString()}</div></td>
                    <td>{reads.map((x) => x.recipient_name).filter(Boolean).join(', ') || '—'}</td>
                    <td>
                      {reads.length <= 1
                        ? (reads[0]?.read_at ? `Read ${new Date(reads[0].read_at).toLocaleString()}` : <strong>Not read yet</strong>)
                        : (
                          <>
                            <strong>{reads.filter((x) => x.read_at).length} of {reads.length} read</strong>
                            {reads.filter((x) => x.read_at).map((x) => (
                              <div key={x.recipient_name} style={{ fontSize: '0.8rem' }}>
                                {x.recipient_name} — {new Date(x.read_at).toLocaleString()}
                              </div>
                            ))}
                          </>
                        )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </div>

      <div className="card">
        <h2>Automatic emails</h2>
        <p style={{ color: '#666', fontSize: '0.85rem' }}>
          Emails Formwork sends by itself: welcome emails, behaviour alerts and detention emails.
        </p>
        <input
          placeholder="Search subject or recipient"
          value={emailFilter}
          onChange={(e) => setEmailFilter(e.target.value)}
          style={{ maxWidth: '20rem' }}
        />
        {AUDIENCES.map(({ key, label }) => {
          const groups = groupEmails(emails, key, emailFilter);
          if (groups.length === 0) return null;
          return (
            <div key={key} style={{ marginTop: '1rem' }}>
              <h3>{label}</h3>
              {groups.map((g) => (
                <details key={g.kind} style={{ marginBottom: '0.5rem' }}>
                  <summary style={{ cursor: 'pointer' }}>
                    <strong>{g.kind}</strong> — {g.rows.length} email{g.rows.length === 1 ? '' : 's'}
                    {g.failed > 0 && <span style={{ color: '#a3232c' }}>, {g.failed} failed</span>}
                    {g.waiting > 0 && <span>, {g.waiting} waiting to send</span>}
                    <span style={{ color: '#666', fontSize: '0.85rem' }}> · latest {new Date(g.latest).toLocaleString()}</span>
                  </summary>
                  <div className="table-scroll"><table>
                    <thead><tr><th>Subject</th><th>To</th><th>Status</th><th>Time</th></tr></thead>
                    <tbody>
                      {g.rows.map((e) => (
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
                </details>
              ))}
            </div>
          );
        })}
        {emails.length > 0 && AUDIENCES.every(({ key }) => groupEmails(emails, key, emailFilter).length === 0) && (
          <p>No emails match that search.</p>
        )}
        {emails.length === 0 && <p>No emails sent yet.</p>}
      </div>
    </div>
  );
}

export default function HistoryPage() {
  return <RequireAuth><RequireResource resourceKey="/comms/history"><ComposeInner /></RequireResource></RequireAuth>;
}
