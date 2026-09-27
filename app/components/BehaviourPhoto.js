'use client';
import { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

const STATUS_TEXT = {
  pending: 'Waiting for the school office to approve before parents see it',
  approved: 'Approved — parents can see it',
  rejected: 'Not approved — parents can’t see it',
};

// A behaviour event's picture (migration 209), loaded only when someone taps
// to see it, so long event lists don't pull every image. Staff see the
// office-review status underneath; parents and students only ever load
// approved pictures (row-level security), so they get no status line.
export default function BehaviourPhoto({ photoId, showStatus = false, label = '📷 Picture' }) {
  const [photo, setPhoto] = useState(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(null);

  async function toggle(e) {
    e.stopPropagation();
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (photo) return;
    const { data, error: err } = await supabase
      .from('behaviour_photos')
      .select('photo_id, image_jpeg_base64, status')
      .eq('photo_id', photoId)
      .maybeSingle();
    if (err) setError(err.message);
    else if (!data) setError('This picture isn’t available.');
    else setPhoto(data);
  }

  if (!photoId) return null;
  return (
    <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', alignItems: 'flex-start' }}>
      <button type="button" className="secondary bl-small" onClick={toggle}>
        {open ? 'Hide picture' : label}
      </button>
      {open && !photo && !error && <span style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>Loading…</span>}
      {error && <span style={{ fontSize: '0.85rem', color: 'var(--red-700)' }}>{error}</span>}
      {open && photo && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:image/jpeg;base64,${photo.image_jpeg_base64}`}
            alt="Picture added with this behaviour event"
            style={{ maxWidth: 'min(100%, 480px)', maxHeight: '60vh', borderRadius: 8, border: '1px solid var(--slate-200)' }}
          />
          {showStatus && (
            <span style={{ fontSize: '0.8rem', color: photo.status === 'rejected' ? 'var(--red-700)' : 'var(--ink-soft)' }}>
              {STATUS_TEXT[photo.status] || photo.status}
            </span>
          )}
        </>
      )}
    </div>
  );
}
