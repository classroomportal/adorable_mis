'use client';

// The Worry Box on a student's portal (migration 391). A student writes what
// is worrying them and sends it; only the DSL and the principal read it, with
// their name (the principal, 7 Oct 2026). They see what they have sent, its
// status and any reply. Staff notes are never shown here (the database
// returns replies only). Every rule is in send_worry().

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { formatUKDateTime } from '../../lib/formatDate';
import { WORRY_CATEGORIES, WORRY_STATUS_STUDENT, worryCategoryLabel } from '../../lib/worries';

const soft = { fontSize: '0.85rem', color: 'var(--ink-soft)' };

export default function WorryBox({ studentId }) {
  const [worries, setWorries] = useState([]);
  const [replies, setReplies] = useState([]);
  const [category, setCategory] = useState('');
  const [details, setDetails] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [status, setStatus] = useState(null);
  const [sent, setSent] = useState(false);
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    const [{ data: w }, { data: n }] = await Promise.all([
      supabase.from('worries').select('worry_id, category, details, urgent, status, created_at')
        .eq('student_id', studentId).order('created_at', { ascending: false }),
      // Row security returns only replies to this student's own worries.
      supabase.from('worry_notes').select('note_id, worry_id, note, created_at, created_by_name')
        .eq('kind', 'reply').order('created_at'),
    ]);
    setWorries(w || []);
    setReplies(n || []);
  }

  useEffect(() => { if (studentId) load(); }, [studentId]);

  async function send() {
    if (!category) { setStatus('Please choose what your worry is about.'); return; }
    if (!details.trim()) { setStatus('Please write what is worrying you.'); return; }
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setStatus(null);
    let error;
    try {
      ({ error } = await supabase.rpc('send_worry', { p_category: category, p_details: details.trim(), p_urgent: urgent }));
    } catch (err) {
      error = err;
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
    if (error) { setStatus(error.message); return; }
    setCategory('');
    setDetails('');
    setUrgent(false);
    setSent(true);
    load();
  }

  return (
    <div>
      <div className="card" style={{ borderLeft: '5px solid #a3232c', background: '#fff4f4', margin: '0 0 1rem' }}>
        <strong>If you are in danger or don&apos;t feel safe right now, tell any member of staff straight away.</strong>
        <div style={{ marginTop: '0.25rem' }}>Don&apos;t wait for a reply here.</div>
      </div>

      <p>
        Write about anything that worries you. Only the Designated Safeguarding Lead and the Principal
        read it, and they will see your name, so they can help you. Nobody else does: not your teachers,
        not other students, not your parents.
      </p>

      {sent ? (
        <div className="card" style={{ background: '#eef8f1', margin: '0 0 1rem' }}>
          <strong>Thank you. Your worry has been sent.</strong>
          <div style={{ marginTop: '0.25rem' }}>Someone will read it and may come and talk to you, or reply here.</div>
          <button className="secondary" style={{ marginTop: '0.5rem' }} onClick={() => setSent(false)}>Send another</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '0.6rem', maxWidth: 640 }}>
          <label>
            What is it about?
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ display: 'block', width: '100%' }}>
              <option value="">Choose…</option>
              {WORRY_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>
          <label>
            What is worrying you?
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              rows={6}
              maxLength={2000}
              style={{ display: 'block', width: '100%' }}
              placeholder="Write as much or as little as you like."
            />
            <span style={soft}>{details.length} / 2000</span>
          </label>
          <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
            <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
            <span>This is urgent: I don&apos;t feel safe, or I need to talk to someone soon.</span>
          </label>
          <div>
            <button onClick={send} disabled={submitting}>{submitting ? 'Sending…' : 'Send'}</button>
          </div>
        </div>
      )}
      {status && <p style={{ color: '#a3232c' }}>{status}</p>}

      {worries.length > 0 && (
        <>
          <h3 style={{ margin: '1.5rem 0 0.5rem' }}>Worries you have sent</h3>
          {worries.map((w) => (
            <div key={w.worry_id} className="card" style={{ margin: '0 0 0.6rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                <strong>{worryCategoryLabel(w.category)}</strong>
                <span className="badge">{WORRY_STATUS_STUDENT[w.status] || w.status}</span>
              </div>
              <div style={soft}>{formatUKDateTime(w.created_at)}{w.urgent ? ' · marked urgent' : ''}</div>
              <p style={{ whiteSpace: 'pre-wrap', margin: '0.5rem 0' }}>{w.details}</p>
              {replies.filter((r) => r.worry_id === w.worry_id).map((r) => (
                <div key={r.note_id} style={{ borderLeft: '3px solid #1a7a3d', paddingLeft: '0.6rem', margin: '0.4rem 0' }}>
                  <div style={soft}>Reply from {r.created_by_name || 'staff'}, {formatUKDateTime(r.created_at)}</div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{r.note}</div>
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
