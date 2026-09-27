'use client';
import { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/AuthContext';

// Who may correct a behaviour event's comment: the member of staff who logged
// it, or pastoral/houseparents/SMT/admin. Mirrors the check inside
// edit_behaviour_event_comment() (migration 207), which is what enforces it.
export function useCanEditEventComment() {
  const { profile, isPastoralOrSmt } = useAuth();
  return (event) => isPastoralOrSmt || (!!profile?.staff_id && profile.staff_id === event?.staff_id);
}

// A behaviour event's comment, with an Edit button for those allowed to change
// it. Only the comment can be edited — category and points have already set
// off detentions and alerts. Every change is kept in behaviour_event_audit.
// `event` needs event_id, staff_id and description.
export default function EventCommentEditor({ event, onSaved, emptyText = 'No comment.' }) {
  const canEdit = useCanEditEventComment()(event);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setSaving(true);
    setError(null);
    const { error: err } = await supabase.rpc('edit_behaviour_event_comment', {
      p_event_id: event.event_id,
      p_description: draft,
    });
    setSaving(false);
    if (err) { setError(`Couldn't save: ${err.message}`); return; }
    setEditing(false);
    onSaved?.(draft.trim() || null);
  }

  if (editing) {
    return (
      <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={Math.min(12, Math.max(4, Math.ceil(draft.length / 80)))}
          style={{ width: '100%', font: 'inherit', padding: '0.5rem', borderRadius: 8, border: '1px solid var(--slate-200)' }}
          autoFocus
        />
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button type="button" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save comment'}</button>
          <button type="button" className="secondary" onClick={() => { setEditing(false); setError(null); }} disabled={saving}>Cancel</button>
          {error && <span style={{ color: 'var(--red-700)', fontSize: '0.85rem' }}>{error}</span>}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', justifyContent: 'space-between' }}>
      <span style={{ whiteSpace: 'pre-wrap', color: event.description ? 'inherit' : 'var(--ink-soft)' }}>
        {event.description || emptyText}
      </span>
      {canEdit && (
        <button
          type="button"
          className="secondary no-print"
          onClick={(e) => { e.stopPropagation(); setDraft(event.description || ''); setEditing(true); }}
          style={{ padding: '0.15rem 0.55rem', fontSize: '0.8rem', flexShrink: 0 }}
        >
          Edit
        </button>
      )}
    </div>
  );
}
