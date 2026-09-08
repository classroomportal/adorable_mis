'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';
import { useAuth } from '../../lib/AuthContext';

function InboxInner() {
  const { session } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session?.user) return;
    supabase
      .from('message_recipients')
      .select('id, message_id, read_at, messages(subject, body, sent_at)')
      .eq('profile_id', session.user.id)
      .order('id', { ascending: false })
      .then(({ data }) => { setItems(data || []); setLoading(false); });
  }, [session]);

  async function openMessage(item) {
    if (!item.read_at) {
      await supabase.rpc('mark_message_read', { p_message_id: item.message_id });
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, read_at: new Date().toISOString() } : i)));
    }
  }

  if (loading) return <p>Loading...</p>;

  const unreadCount = items.filter((i) => !i.read_at).length;

  return (
    <div>
      <h1>Inbox {unreadCount > 0 && `(${unreadCount} unread)`}</h1>
      {items.map((item) => (
        <div
          key={item.id}
          className="card"
          onClick={() => openMessage(item)}
          style={{ cursor: 'pointer', fontWeight: item.read_at ? 400 : 700 }}
        >
          <p>{item.messages?.subject}</p>
          <p style={{ fontWeight: 400 }}>{item.messages?.body}</p>
          <p style={{ fontWeight: 400, color: '#666', fontSize: '0.85rem' }}>
            {item.messages?.sent_at && new Date(item.messages.sent_at).toLocaleString()}
            {!item.read_at && ' — unread'}
          </p>
        </div>
      ))}
      {items.length === 0 && <p>No messages yet.</p>}
    </div>
  );
}

export default function InboxPage() {
  return <RequireAuth><InboxInner /></RequireAuth>;
}
