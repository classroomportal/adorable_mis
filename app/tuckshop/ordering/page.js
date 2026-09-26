'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import ScheduleEditor from './ScheduleEditor';

// Local date, not toISOString() — that is UTC, an hour behind Lagos, which
// would make "tomorrow" look like today for the first hour of the day.
function todayStr() {
  return new Date().toLocaleDateString('en-CA');
}

function addDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-CA');
}

function longDate(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function TuckshopOrderingInner() {
  const [closedUntil, setClosedUntil] = useState(null);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);

  // Form state for closing — defaults to reopening tomorrow.
  const [reopenOn, setReopenOn] = useState(addDays(1));
  const [newNote, setNewNote] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('system_settings')
      .select('tuckshop_ordering_closed_until, tuckshop_ordering_closed_note')
      .maybeSingle();
    const until = data?.tuckshop_ordering_closed_until || null;
    // A date in the past means ordering already reopened on its own.
    setClosedUntil(until && todayStr() < until ? until : null);
    setNote(data?.tuckshop_ordering_closed_note || '');
    const { count } = await supabase
      .from('tuckshop_preorders')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');
    setPendingCount(count || 0);
    setLoading(false);
  }

  async function apply(until, noteText) {
    setSaving(true);
    setStatus(null);
    const { error } = await supabase.rpc('set_tuckshop_ordering', {
      p_closed_until: until,
      p_note: noteText || null,
    });
    if (error) setStatus(`Error: ${error.message}`);
    else setStatus(until ? `Ordering closed until ${longDate(until)}.` : 'Ordering is open again.');
    await load();
    setSaving(false);
  }

  const isClosed = Boolean(closedUntil);

  return (
    <div>
      <h1>Tuckshop Ordering</h1>

      {loading ? <p>Loading…</p> : (
        <>
          <div className="card">
            <p style={{ marginTop: 0 }}>
              Status:{' '}
              <span className={`badge ${isClosed ? 'badge-negative' : 'badge-positive'}`}>
                {isClosed ? 'Closed' : 'Following the weekly schedule'}
              </span>
            </p>
            {isClosed ? (
              <p>
                Students can&apos;t place preorders. Ordering reopens on its own on{' '}
                <strong>{longDate(closedUntil)}</strong>.
              </p>
            ) : (
              <p>Students can order from their portal during the weekly ordering windows below.</p>
            )}
            {note && <p style={{ color: '#555' }}><em>{note}</em></p>}
            <p style={{ color: '#555', fontSize: '0.9rem' }}>
              Closing only stops students ordering from the portal — tuckshop and bursar
              staff can still enter an order at the counter.
            </p>
          </div>

          {isClosed ? (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Reopen</h3>
              <p>Reopen ordering now, without waiting for {longDate(closedUntil)}.</p>
              <button onClick={() => apply(null, null)} disabled={saving}>
                {saving ? 'Saving…' : 'Reopen ordering now'}
              </button>
            </div>
          ) : (
            <form
              className="card"
              onSubmit={(e) => { e.preventDefault(); apply(reopenOn, newNote); }}
            >
              <h3 style={{ marginTop: 0 }}>Close ordering (holidays, stock-takes)</h3>
              <p>
                Shuts ordering completely, whatever the weekly schedule says, until the date you pick.
                The schedule takes over again on its own — nobody has to turn it back on.
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <label>
                  Reopen on<br />
                  <input
                    type="date"
                    value={reopenOn}
                    min={addDays(1)}
                    onChange={(e) => setReopenOn(e.target.value)}
                    required
                  />
                </label>
                <label style={{ flex: '1 1 18rem' }}>
                  Reason (optional, shown to staff on this page)<br />
                  <input
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder="e.g. stock-take"
                    style={{ width: '100%' }}
                  />
                </label>
                <button type="submit" disabled={saving || !reopenOn}>
                  {saving ? 'Saving…' : 'Close ordering'}
                </button>
              </div>
            </form>
          )}

          {status && <p>{status}</p>}

          <ScheduleEditor />

          {pendingCount > 0 && (
            <div className="card">
              <p style={{ margin: 0 }}>
                There {pendingCount === 1 ? 'is' : 'are'} <strong>{pendingCount}</strong> outstanding
                preorder{pendingCount === 1 ? '' : 's'}. Closing ordering does not clear{' '}
                {pendingCount === 1 ? 'it' : 'them'} — review on the{' '}
                <a href="/tuckshop/preorders">Preorders</a> page.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function TuckshopOrderingPage() {
  return (
    <RequireAuth><RequireResource resourceKey="/tuckshop/ordering">
      <TuckshopOrderingInner />
    </RequireResource></RequireAuth>
  );
}
