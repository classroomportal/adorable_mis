'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import { useAuth } from '../../../lib/AuthContext';

function ComposeInner() {
  const { profile, staffRoles } = useAuth();
  const allowed = profile?.role === 'admin' || ['smt', 'pastoral', 'school_office'].some((r) => staffRoles.includes(r));

  const [messages, setMessages] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [receipts, setReceipts] = useState([]);

  useEffect(() => {
    if (!allowed) return;
    supabase
      .from('messages')
      .select('id, subject, body, target_type, target_value, recipient_count, email_sent, sent_at')
      .order('sent_at', { ascending: false })
      .then(({ data }) => setMessages(data || []));
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
      {messages.length === 0 && <p>No messages sent yet.</p>}
    </div>
  );
}

export default function HistoryPage() {
  return <RequireAuth><ComposeInner /></RequireAuth>;
}
