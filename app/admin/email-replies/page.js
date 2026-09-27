'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';

// Where replies to each kind of Formwork email go (migration 226). Every
// email is sent as mis@abc.sch.ng, which nobody reads, so each carries a
// Reply-To worked out from these settings when the email is queued.
//
// SMT and admins only: RLS on email_reply_routes checks the SMT role itself,
// so granting this page to another role at /admin/permissions lets them see
// the link but not the settings. Changes are logged in Change History.

// Same rule as is_plain_email() in the database, which refuses the save
// anyway; this just says so before the round trip.
const PLAIN_EMAIL = /^[^\s@<>(),;:"[\]\\]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

function parseAddresses(text) {
  return [...new Set(text.split(/[\n,;]+/).map((a) => a.trim().toLowerCase()).filter(Boolean))];
}

function friendlyError(error) {
  if (/email_reply_fallback_needs_someone/.test(error.message)) {
    return '"Anything else" must always send replies somewhere: tick SMT or give at least one address.';
  }
  return error.message;
}

function EmailRepliesInner() {
  const [routes, setRoutes] = useState([]);
  const [edits, setEdits] = useState({}); // email_kind -> { sender, smt, text }
  const [smt, setSmt] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [status, setStatus] = useState({}); // email_kind -> message

  async function load() {
    setLoading(true);
    const [{ data, error }, { data: smtRows, error: smtError }] = await Promise.all([
      supabase.from('email_reply_routes')
        .select('email_kind, label, description, sender_label, reply_to_sender, reply_to_smt, addresses, updated_at')
        .order('sort_order'),
      supabase.rpc('email_reply_smt_preview'),
    ]);
    if (error || smtError) {
      setLoadError((error || smtError).message);
      setLoading(false);
      return;
    }
    setRoutes(data || []);
    setSmt(smtRows || []);
    const e = {};
    for (const r of data || []) {
      e[r.email_kind] = { sender: r.reply_to_sender, smt: r.reply_to_smt, text: (r.addresses || []).join('\n') };
    }
    setEdits(e);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function edit(kind, field, value) {
    setEdits((prev) => ({ ...prev, [kind]: { ...prev[kind], [field]: value } }));
    setStatus((prev) => ({ ...prev, [kind]: null }));
  }

  function isChanged(r) {
    const e = edits[r.email_kind];
    return e.sender !== r.reply_to_sender || e.smt !== r.reply_to_smt
      || parseAddresses(e.text).join(',') !== (r.addresses || []).join(',');
  }

  // Who replies would reach with the settings as they stand on screen.
  function preview(r) {
    const e = edits[r.email_kind];
    const parts = [];
    if (e.sender && r.sender_label) parts.push(r.sender_label.toLowerCase());
    if (e.smt) parts.push(smt.length ? `SMT (${smt.join(', ')})` : 'SMT (nobody holds the role)');
    parts.push(...parseAddresses(e.text));
    return parts;
  }

  async function save(r) {
    const e = edits[r.email_kind];
    const addresses = parseAddresses(e.text);
    const bad = addresses.filter((a) => !PLAIN_EMAIL.test(a));
    if (bad.length) {
      setStatus((prev) => ({ ...prev, [r.email_kind]: `Not an email address: ${bad.join(', ')}` }));
      return;
    }
    setStatus((prev) => ({ ...prev, [r.email_kind]: 'Saving...' }));
    const { error } = await supabase
      .from('email_reply_routes')
      .update({ reply_to_sender: !!(e.sender && r.sender_label), reply_to_smt: e.smt, addresses })
      .eq('email_kind', r.email_kind);
    if (error) {
      setStatus((prev) => ({ ...prev, [r.email_kind]: `Not saved: ${friendlyError(error)}` }));
      return;
    }
    await load();
    setStatus((prev) => ({ ...prev, [r.email_kind]: 'Saved. Emails queued from now on use this.' }));
  }

  if (loading) return <div><h1>Email Replies</h1><p>Loading...</p></div>;
  if (loadError) return <div><h1>Email Replies</h1><p style={{ color: '#a3232c' }}>Could not load: {loadError}</p></div>;

  const fallback = routes.find((r) => r.email_kind === 'fallback');
  const fallbackTo = fallback ? preview(fallback) : [];

  return (
    <div>
      <h1>Email Replies</h1>
      <p>
        Formwork sends every email from <code>mis@abc.sch.ng</code>, which nobody reads. These settings decide who
        gets the reply when someone answers one. A change applies to emails sent after you save it.
      </p>

      {routes.map((r) => {
        const e = edits[r.email_kind];
        const to = preview(r);
        return (
          <div className="card" key={r.email_kind}>
            <h2 style={{ marginTop: 0 }}>{r.label}</h2>
            <p style={{ color: '#555', marginTop: 0 }}>{r.description}</p>

            {r.sender_label && (
              <label className="checkbox-row">
                <input type="checkbox" checked={e.sender} onChange={(ev) => edit(r.email_kind, 'sender', ev.target.checked)} />
                {r.sender_label}
              </label>
            )}
            <label className="checkbox-row">
              <input type="checkbox" checked={e.smt} onChange={(ev) => edit(r.email_kind, 'smt', ev.target.checked)} />
              <span>
                Everyone in SMT{' '}
                <span style={{ color: '#666' }}>(currently {smt.length ? smt.join(', ') : 'nobody'})</span>
              </span>
            </label>
            <label style={{ margin: '0.4rem 0', maxWidth: '28rem' }}>
              Other addresses, one per line
              <textarea
                value={e.text}
                onChange={(ev) => edit(r.email_kind, 'text', ev.target.value)}
                rows={Math.max(2, e.text.split('\n').length + 1)}
                style={{ width: '100%', fontFamily: 'inherit' }}
                aria-label={`Other addresses for ${r.label}`}
              />
            </label>

            <p style={{ fontSize: '0.95em' }}>
              <strong>Replies go to:</strong>{' '}
              {to.length ? to.join(', ') : r.email_kind === 'fallback'
                ? <span style={{ color: '#a3232c' }}>nobody. &quot;Anything else&quot; must name someone.</span>
                : <>nobody here, so the &quot;Anything else&quot; setting: {fallbackTo.join(', ') || 'sro@abc.sch.ng'}</>}
              {r.email_kind !== 'fallback' && e.sender && r.sender_label && (
                <span style={{ color: '#666' }}> (a sender with no email on their staff record falls back to &quot;Anything else&quot;)</span>
              )}
            </p>

            <button onClick={() => save(r)} disabled={!isChanged(r)}>Save</button>
            {status[r.email_kind] && <span style={{ marginLeft: '0.75rem' }}>{status[r.email_kind]}</span>}
          </div>
        );
      })}
    </div>
  );
}

export default function EmailRepliesPage() {
  return (
    <RequireAuth>
      <RequireResource resourceKey="/admin/email-replies">
        <EmailRepliesInner />
      </RequireResource>
    </RequireAuth>
  );
}
