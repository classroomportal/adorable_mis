'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/AuthContext';
import { formatUKDate } from '../../lib/formatDate';
import BehaviourPhoto from './BehaviourPhoto';
import { useBehaviourRules } from '../../lib/behaviourRules';
import { EventInvolvedStudents } from './InvolvedStudents';
import { GuidanceText, SeriousConfirmTick } from './SeriousEventGuidance';

// Who may edit a behaviour event: the member of staff who logged it,
// pastoral/houseparents/SMT/admin, or the school office (who fix serious
// events' explanations on /behaviour/review). Mirrors the check inside
// edit_behaviour_event() (migration 211), which is what enforces it.
export function useCanEditEventComment() {
  const { profile, isPastoralOrSmt, staffRoles } = useAuth();
  const isOffice = (staffRoles || []).includes('school_office');
  return (event) => isPastoralOrSmt || isOffice || (!!profile?.staff_id && profile.staff_id === event?.staff_id);
}

// Categories are the same for every event on a page, so fetch them once.
let categoriesPromise = null;
function loadCategories() {
  if (!categoriesPromise) {
    categoriesPromise = supabase
      .from('behaviour_categories')
      .select('name, type, default_points, description, retired, system_only')
      .order('name')
      .then(({ data }) => data || []);
  }
  return categoriesPromise;
}

function outcomeText(result) {
  if (!result?.changed) return 'No changes to save.';
  const parts = ['Saved.'];
  const day = result.detention_date ? formatUKDate(result.detention_date, { weekday: true }) : null;
  if (result.detentions_added) parts.push(`Detention added for ${day}.`);
  if (result.detentions_cancelled) parts.push(`Detention for ${day} cancelled — the student has been told.`);
  return parts.join(' ');
}

// A behaviour event's comment, with an Edit button for those allowed to change
// it. Editing covers the category (within the event's type) and the comment;
// the database sets the points from the category and adds or cancels
// detentions to match. Every change is kept in behaviour_event_audit.
// `event` needs event_id, staff_id, type, category, points and description.
export default function EventCommentEditor({ event, onSaved, emptyText = 'No comment.' }) {
  const canEdit = useCanEditEventComment()(event);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [seriousConfirmed, setSeriousConfirmed] = useState(false);

  useEffect(() => {
    if (editing) loadCategories().then(setCategories);
  }, [editing]);

  const { serious_event_points: seriousPoints, serious_event_guidance: seriousGuidance } = useBehaviourRules();
  // A retired category (migration 378) is offered only as the event's own;
  // so is an exclusion category (migration 401, recorded only from Exclusions).
  const options = categories.filter((c) => c.type === event.type && ((!c.retired && !c.system_only) || c.name === event.category));
  const chosen = options.find((c) => c.name === category);
  // Keeping the category keeps the event's points (migration 378); a
  // returned Stage 5 (0 points until changed) gets its points back.
  const returned = !!(event.returned_at || event.return_note);
  const points = chosen && (chosen.name !== event.category || returned) ? chosen.default_points : event.points;
  const serious = event.type === 'negative' && points <= seriousPoints;
  // Moving an event up to Stage 5 asks the same as logging one (migration 335).
  const becomingSerious = serious && !(event.type === 'negative' && event.points <= seriousPoints);

  async function save() {
    if (serious && !draft.trim()) {
      setError(`A serious event (${seriousPoints} points or worse) needs an explanation of what happened.`);
      return;
    }
    if (becomingSerious && !seriousConfirmed) {
      setError('Read the Stage 5 guidance and tick the confirmation first.');
      return;
    }
    setSaving(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('edit_behaviour_event', {
      p_event_id: event.event_id,
      p_category: category || event.category,
      p_description: draft,
    });
    setSaving(false);
    if (err) { setError(`Couldn't save: ${err.message}`); return; }
    setEditing(false);
    setMessage(outcomeText(data));
    onSaved?.({
      description: draft.trim() || null, category: category || event.category, points: data?.points ?? event.points,
      ...(data?.changed ? { return_note: null, returned_at: null } : {}),
    });
  }

  if (editing) {
    return (
      <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {event.category && (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={category}
              onChange={(e) => { setCategory(e.target.value); setSeriousConfirmed(false); }}
              style={{ width: 'auto', minWidth: '12rem', flex: '1 1 12rem' }}
            >
              {!options.some((c) => c.name === category) && <option value={category}>{category}</option>}
              {options.map((c) => (
                <option key={c.name} value={c.name}>{c.name} ({c.default_points > 0 ? '+' : ''}{c.default_points})</option>
              ))}
            </select>
            {chosen && chosen.name !== event.category && chosen.default_points !== event.points && event.type === 'negative' && (
              <span style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>
                {event.points} → {chosen.default_points} pts; detentions will be updated to match.
              </span>
            )}
          </div>
        )}
        {chosen?.description && chosen.name !== event.category && (
          <div className="bl-category-note"><strong>About {chosen.name}</strong>{chosen.description}</div>
        )}
        {becomingSerious && (
          <div className="bl-serious">
            <strong>Is this really a Stage 5?</strong> It gives a detention, and is reviewed and then sent to parents.
            <GuidanceText text={seriousGuidance} />
          </div>
        )}
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={serious ? `Explanation (required for ${seriousPoints} events)` : 'Comment'}
          rows={Math.min(12, Math.max(4, Math.ceil(draft.length / 80)))}
          style={{ width: '100%', font: 'inherit', padding: '0.5rem', borderRadius: 8, border: '1px solid var(--slate-200)' }}
          autoFocus
        />
        {becomingSerious && <SeriousConfirmTick checked={seriousConfirmed} onChange={setSeriousConfirmed} />}
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          <button type="button" className="secondary" onClick={() => { setEditing(false); setError(null); }} disabled={saving}>Cancel</button>
          {error && <span style={{ color: 'var(--red-700)', fontSize: '0.85rem' }}>{error}</span>}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <span style={{ whiteSpace: 'pre-wrap', color: event.description ? 'inherit' : 'var(--ink-soft)' }}>
          {event.description || emptyText}
        </span>
        {canEdit && (
          <button
            type="button"
            className="secondary no-print"
            onClick={(e) => {
              e.stopPropagation();
              setDraft(event.description || '');
              setCategory(event.category || '');
              setMessage(null);
              setSeriousConfirmed(false);
              setEditing(true);
            }}
            style={{ padding: '0.15rem 0.55rem', fontSize: '0.8rem', flexShrink: 0 }}
          >
            Edit
          </button>
        )}
      </div>
      {message && <span style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>{message}</span>}
      {/* Sent back from Behaviour Review (migration 335); any edit clears it. */}
      {event.return_note && (
        <span className="bl-returned">
          <strong>Returned by the reviewer:</strong> {event.return_note} Its points don&apos;t count until you
          change it. Choose the right category if it isn&apos;t a Stage 5, or edit the explanation to send it back for review.
        </span>
      )}
      {event.photo_id && <BehaviourPhoto photoId={event.photo_id} showStatus />}
      {event.type === 'negative' && event.points != null && event.points <= seriousPoints && (
        <EventInvolvedStudents event={event} canEdit={canEdit} />
      )}
    </div>
  );
}
