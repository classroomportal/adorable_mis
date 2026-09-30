'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { TILE_LISTS, loadTileOrder, sortTiles } from '../../../lib/tileOrder';

// Arrange the big dashboard tiles, once, for everyone (migration 280, the
// principal's choice of a school-wide order). Drag a tile, or use the arrows,
// then Save. Which tiles a person sees is still decided by page access and the
// homework pilot; this only sets the order. The database only accepts changes
// from people with this page (dashboard_tile_order policies).

function TileList({ dashboard }) {
  const list = TILE_LISTS[dashboard];
  const [tiles, setTiles] = useState(null);
  const [saved, setSaved] = useState(null);
  const [dragIndex, setDragIndex] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);

  async function load() {
    const order = await loadTileOrder(dashboard);
    const sorted = sortTiles(list.tiles, order);
    setTiles(sorted);
    setSaved(sorted.map((t) => t.key).join(','));
  }
  useEffect(() => { load(); }, [dashboard]); // eslint-disable-line react-hooks/exhaustive-deps

  function move(from, to) {
    if (to < 0 || to >= tiles.length || from === to) return;
    const next = tiles.slice();
    const [t] = next.splice(from, 1);
    next.splice(to, 0, t);
    setTiles(next);
    setStatus(null);
  }

  async function save() {
    setBusy(true);
    setStatus(null);
    const rows = tiles.map((t, i) => ({ dashboard, tile_key: t.key, position: i }));
    const { error } = await supabase.from('dashboard_tile_order').upsert(rows, { onConflict: 'dashboard,tile_key' });
    setBusy(false);
    if (error) { setStatus(`Error: ${error.message}`); return; }
    setSaved(tiles.map((t) => t.key).join(','));
    setStatus('Saved. Everyone sees this order the next time their dashboard loads.');
  }

  if (!tiles) return <div className="card"><p>Loading…</p></div>;
  const changed = tiles.map((t) => t.key).join(',') !== saved;

  return (
    <div className="card">
      <h2 style={{ marginTop: 0, marginBottom: '0.2rem' }}>{list.label}</h2>
      <p style={{ marginTop: 0, color: 'var(--ink-soft)' }}>{list.where}</p>
      <ol className="tile-order-list">
        {tiles.map((t, i) => (
          <li
            key={t.key}
            className={`tile-order-item${dragIndex === i ? ' tile-order-dragging' : ''}`}
            draggable
            onDragStart={(e) => { setDragIndex(i); e.dataTransfer.effectAllowed = 'move'; }}
            onDragOver={(e) => { e.preventDefault(); if (dragIndex !== null && dragIndex !== i) { move(dragIndex, i); setDragIndex(i); } }}
            onDragEnd={() => setDragIndex(null)}
          >
            <span className="tile-order-handle" aria-hidden="true">⋮⋮</span>
            <span className="tile-order-pos">{i + 1}</span>
            <span className="tile-order-icon" aria-hidden="true">{t.icon}</span>
            <span className="tile-order-label">
              {t.label}
              {t.note && <span className="tile-order-note">{t.note}</span>}
            </span>
            <span className="tile-order-buttons">
              <button type="button" className="secondary" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`Move ${t.label} up`}>↑</button>
              <button type="button" className="secondary" onClick={() => move(i, i + 1)} disabled={i === tiles.length - 1} aria-label={`Move ${t.label} down`}>↓</button>
            </span>
          </li>
        ))}
      </ol>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={save} disabled={busy || !changed}>{busy ? 'Saving…' : 'Save order'}</button>
        {changed && <button type="button" className="secondary" onClick={load} disabled={busy}>Undo changes</button>}
        {status && <span>{status}</span>}
      </div>
    </div>
  );
}

function TileOrderInner() {
  return (
    <div>
      <h1>Arrange Tiles</h1>
      <p style={{ color: 'var(--ink-soft)' }}>
        Drag the tiles, or use the arrows, into the order you want, then save. The order is the same for everyone.
        People only see the tiles they have access to, in this order.
      </p>
      <TileList dashboard="student" />
      <TileList dashboard="staff" />
    </div>
  );
}

export default function TileOrderPage() {
  return (
    <RequireAuth>
      <RequireResource resourceKey="/admin/tile-order">
        <TileOrderInner />
      </RequireResource>
    </RequireAuth>
  );
}
