'use client';
import { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { formatUKDate } from '../../lib/formatDate';
import { schoolToday } from '../../lib/schoolTime';
import { addDays, dayKey } from '../../lib/homework';

// The set / edit homework form (migration 278), used on /homework and on the
// class register (/attendance). The database decides who may save it
// (can_set_homework()); this only lays out the choices.

export const btnSmall = { padding: '0.3rem 0.6rem', fontSize: '0.85rem' };

// The class's next few lessons from tomorrow, as one-click deadlines.
function nextLessons(slots, count = 6) {
  const out = [];
  const start = addDays(schoolToday(), 1);
  for (let i = 0; i < 21 && out.length < count; i += 1) {
    const date = addDays(start, i);
    const k = dayKey(date);
    (slots || [])
      .filter((s) => s.day_of_week === k)
      .sort((a, b) => a.period_number - b.period_number)
      .forEach((slot) => { if (out.length < count) out.push({ date, slot }); });
  }
  return out;
}

export function schemeLabel(scheme, outOf) {
  if (!scheme) return '';
  if (scheme.kind === 'mark' && scheme.fixed_max == null) return `Mark out of ${Number(outOf)}`;
  return scheme.name;
}

export function classLabel(c) {
  return `${c.class_code} · ${c.subjects?.display_name || c.subjects?.subject_name || ''}`;
}

export default function HomeworkForm({ cls, schemes, existing, markCount, onSaved, onCancel, embedded = false }) {
  const [title, setTitle] = useState(existing?.title || '');
  const [instructions, setInstructions] = useState(existing?.instructions || '');
  const [dueOn, setDueOn] = useState(existing?.due_on || '');
  const [dueSlotId, setDueSlotId] = useState(existing?.due_slot_id ? String(existing.due_slot_id) : '');
  const [schemeId, setSchemeId] = useState(existing?.scheme_id ? String(existing.scheme_id) : '');
  const [outOf, setOutOf] = useState(existing?.out_of != null ? String(Number(existing.out_of)) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const scheme = schemes.find((s) => String(s.scheme_id) === schemeId);
  const needsOutOf = scheme?.kind === 'mark' && scheme.fixed_max == null;
  const schemeLocked = markCount > 0;
  const lessonsThatDay = dueOn
    ? (cls.timetable_slots || []).filter((s) => s.day_of_week === dayKey(dueOn)).sort((a, b) => a.period_number - b.period_number)
    : [];
  const picks = nextLessons(cls.timetable_slots);
  const offered = schemes.filter((s) => s.is_active || String(s.scheme_id) === schemeId);

  async function save() {
    setError(null);
    if (!title.trim()) { setError('Give the homework a title.'); return; }
    if (!dueOn) { setError('Choose a deadline.'); return; }
    if (!existing && dueOn < schoolToday()) { setError('The deadline is in the past.'); return; }
    if (!schemeId) { setError('Choose how it will be graded.'); return; }
    if (needsOutOf && !(Number(outOf) > 0)) { setError('Say what it is marked out of.'); return; }
    setSaving(true);
    const payload = {
      title: title.trim(),
      instructions: instructions.trim() || null,
      due_on: dueOn,
      due_slot_id: dueSlotId ? Number(dueSlotId) : null,
      scheme_id: Number(schemeId),
      out_of: needsOutOf ? Number(outOf) : null,
    };
    const { error: e } = existing
      ? await supabase.from('homework').update(payload).eq('homework_id', existing.homework_id)
      : await supabase.from('homework').insert({ ...payload, class_id: cls.class_id });
    setSaving(false);
    if (e) { setError(e.message); return; }
    onSaved();
  }

  return (
    <div className={embedded ? undefined : 'card'}>
      {!embedded && <h2 style={{ marginTop: 0 }}>{existing ? 'Edit homework' : 'Set homework'} · {classLabel(cls)}</h2>}
      <div style={{ display: 'grid', gap: '0.75rem', maxWidth: '44rem' }}>
        <label>
          Title
          <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Simultaneous equations, exercise 4B" />
        </label>
        <label>
          Instructions
          <textarea
            value={instructions} maxLength={5000} rows={6}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="What to do. Links starting https:// become clickable for students."
            style={{ width: '100%', fontFamily: 'inherit', fontSize: '1rem', padding: '0.5rem', borderRadius: 8, border: '1px solid var(--slate-200)' }}
          />
        </label>
        <div>
          <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginBottom: '0.3rem' }}>Due in a lesson</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {picks.length === 0 && <span style={{ color: 'var(--ink-soft)' }}>No lessons found for this class.</span>}
            {picks.map(({ date, slot }) => {
              const on = dueOn === date && dueSlotId === String(slot.slot_id);
              return (
                <button
                  key={`${date}-${slot.slot_id}`} type="button"
                  className={on ? '' : 'secondary'} style={btnSmall}
                  onClick={() => { setDueOn(date); setDueSlotId(String(slot.slot_id)); }}
                >
                  {formatUKDate(date, { weekday: true }).replace(/ \d{4}$/, '')} · L{slot.period_number}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <label style={{ flex: '1 1 12rem' }}>
            Or pick a date
            <input type="date" value={dueOn} onChange={(e) => { setDueOn(e.target.value); setDueSlotId(''); }} />
            {dueOn && <span style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>{formatUKDate(dueOn, { weekday: true })}</span>}
          </label>
          <label style={{ flex: '1 1 12rem' }}>
            Due by
            <select value={dueSlotId} onChange={(e) => setDueSlotId(e.target.value)} disabled={!dueOn}>
              <option value="">End of the day</option>
              {lessonsThatDay.map((s) => <option key={s.slot_id} value={s.slot_id}>Lesson {s.period_number}</option>)}
            </select>
          </label>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <label style={{ flex: '2 1 14rem' }}>
            Graded as
            <select value={schemeId} onChange={(e) => setSchemeId(e.target.value)} disabled={schemeLocked}>
              <option value="">Choose…</option>
              {offered.map((s) => <option key={s.scheme_id} value={s.scheme_id}>{s.name}</option>)}
            </select>
            {schemeLocked && <span style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>Marks have been recorded, so this can&apos;t change.</span>}
          </label>
          {needsOutOf && (
            <label style={{ flex: '1 1 8rem' }}>
              Out of
              <input type="number" min="1" step="any" value={outOf} onChange={(e) => setOutOf(e.target.value)} disabled={schemeLocked} />
            </label>
          )}
        </div>
        {error && <p style={{ color: '#a3232c', margin: 0 }}>{error}</p>}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="button" onClick={save} disabled={saving}>{saving ? 'Saving…' : existing ? 'Save changes' : 'Set homework'}</button>
          <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
