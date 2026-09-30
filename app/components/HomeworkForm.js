'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { formatUKDate } from '../../lib/formatDate';
import { schoolToday } from '../../lib/schoolTime';
import {
  addDays, dayKey, loadAttachments, addHomeworkLink, addHomeworkFile, removeAttachment,
} from '../../lib/homework';
import { AttachmentEditor } from './HomeworkAttachments';

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
  // Files and links (migration 281), saved after the homework itself.
  const [attachments, setAttachments] = useState({ existing: [], removeIds: [], newLinks: [], newFiles: [] });

  useEffect(() => {
    if (existing?.homework_id) loadAttachments(existing.homework_id).then((a) => setAttachments((v) => ({ ...v, existing: a })));
  }, [existing?.homework_id]);

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
    // Migration 290: at most 10 characters (a title saved before then may be
    // longer, and can stay as long as it isn't changed).
    if (title.trim().length > 10 && (!existing || title.trim() !== existing.title)) {
      setError('The title can be at most 10 characters. Put the detail in the instructions.');
      return;
    }
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
    let homeworkId = existing?.homework_id;
    if (existing) {
      const { error: e } = await supabase.from('homework').update(payload).eq('homework_id', homeworkId);
      if (e) { setSaving(false); setError(e.message); return; }
    } else {
      const { data, error: e } = await supabase.from('homework')
        .insert({ ...payload, class_id: cls.class_id }).select('homework_id').single();
      if (e) { setSaving(false); setError(e.message); return; }
      homeworkId = data.homework_id;
    }

    // Then the files and links, one at a time so one failure names itself.
    const problems = [];
    for (const id of attachments.removeIds) {
      const att = attachments.existing.find((a) => a.attachment_id === id);
      const e = att && await removeAttachment(att);
      if (e) problems.push(`Couldn't remove ${att.title}: ${e.message}`);
    }
    for (const l of attachments.newLinks) {
      const e = await addHomeworkLink(homeworkId, l.title, l.url);
      if (e) problems.push(`Couldn't add the link ${l.title || l.url}: ${e.message}`);
    }
    for (const f of attachments.newFiles) {
      const e = await addHomeworkFile(homeworkId, f.file, f.title);
      if (e) problems.push(`Couldn't upload ${f.file.name}: ${e.message}`);
    }
    setSaving(false);
    if (problems.length) {
      // The homework is saved; say what didn't attach rather than lose it.
      onSaved(`Homework saved, but: ${problems.join(' ')}`);
      return;
    }
    onSaved();
  }

  return (
    <div className={embedded ? undefined : 'card'}>
      {!embedded && <h2 style={{ marginTop: 0 }}>{existing ? 'Edit homework' : 'Set homework'} · {classLabel(cls)}</h2>}
      <div style={{ display: 'grid', gap: '0.75rem', maxWidth: '44rem' }}>
        <label>
          Title (up to 10 characters, so it fits the mark sheet)
          <input value={title} maxLength={10} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Ex 4B" />
          <span style={{ fontSize: '0.8rem', color: title.trim().length > 10 ? '#a3232c' : 'var(--ink-soft)' }}>
            {title.trim().length}/10{title.trim().length > 10 ? ' · an older title: shorten it to save a change to it' : ' · put the detail in the instructions'}
          </span>
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
        <AttachmentEditor value={attachments} onChange={setAttachments} disabled={saving} />
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
          <button type="button" onClick={save} disabled={saving}>{saving ? (attachments.newFiles.length ? 'Uploading…' : 'Saving…') : existing ? 'Save changes' : 'Set homework'}</button>
          <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
