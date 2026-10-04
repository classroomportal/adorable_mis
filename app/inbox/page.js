'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';
import { useAuth } from '../../lib/AuthContext';
import { formatUKDateTime } from '../../lib/formatDate';

function InboxInner() {
  const { session } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!session?.user) return;
    supabase
      .from('message_recipients')
      .select('id, message_id, read_at, messages(subject, body, sent_at)')
      .eq('profile_id', session.user.id)
      .order('id', { ascending: false })
      .then(({ data }) => { setItems(data || []); setLoading(false); });
  }, [session]);

  // A message is only marked read when it is opened here, and senders see
  // that on /comms/history as "Read". The list used to show every message in
  // full, so people read them without clicking and nothing was recorded; now
  // only the subject shows until the message is opened.
  async function openMessage(item) {
    setOpenId((prev) => (prev === item.id ? null : item.id));
    if (item.read_at) return;
    const { error: rpcError } = await supabase.rpc('mark_message_read', { p_message_id: item.message_id });
    if (rpcError) {
      setError(`Couldn't mark this message as read: ${rpcError.message}`);
      return;
    }
    setError('');
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, read_at: new Date().toISOString() } : i)));
  }

  if (loading) return <p>Loading...</p>;

  const unreadCount = items.filter((i) => !i.read_at).length;

  return (
    <div>
      <h1>Inbox {unreadCount > 0 && `(${unreadCount} unread)`}</h1>
      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
      {items.length > 0 && <p style={{ color: '#666' }}>Click a message to open it.</p>}
      {items.map((item) => (
        <div
          key={item.id}
          className="card"
          onClick={() => openMessage(item)}
          style={{ cursor: 'pointer', fontWeight: item.read_at ? 400 : 700 }}
        >
          <p>{item.messages?.subject}</p>
          {openId === item.id && (
            <p style={{ fontWeight: 400, whiteSpace: 'pre-line' }}>{item.messages?.body}</p>
          )}
          <p style={{ fontWeight: 400, color: '#666', fontSize: '0.85rem' }}>
            {item.messages?.sent_at && formatUKDateTime(item.messages.sent_at)}
            {!item.read_at && ' — unread'}
          </p>
        </div>
      ))}
      {items.length === 0 && <p>No messages yet.</p>}
    </div>
  );
}

export default function InboxPage() {
  // Not gated by RequireResource: parents (who hold no staff role/resource
  // grant at all) are linked here directly from the parent portal — see
  // the same reasoning on app/parent-portal/page.js.
  return <RequireAuth><InboxInner /></RequireAuth>;
}
