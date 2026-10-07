'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { formatUKDate } from '../../lib/formatDate';
import { schoolToday } from '../../lib/schoolTime';
import {
  addDays, dayKey, loadAttachments, addHomeworkLink, addHomeworkFile, removeAttachment,
} from '../../lib/homework';
import { AttachmentEditor } from './HomeworkAttachments';
import { loadPrepCheck, loadPrepBlocks, minutesLabel, HOMEWORK_MINUTE_CHOICES } from '../../lib/prep';

// The set / edit homework form (migration 278), used on /homework and on the
// class register (/attendance). The database decides who may save it
// (can_set_homework()); this only lays out the choices.

export const btnSmall = { padding: '0.3rem 0.6rem', fontSize: '0.85rem' };

// The class's lessons from tomorrow over the next five weeks, leaving out
// days the year has no homework (migration 353). Homework is always due in
// one of these: there is no free date picker.
function nextLessons(slots, blocked = {}, days = 35) {
  const out = [];
  const start = addDays(schoolToday(), 1);
  for (let i = 0; i < days; i += 1) {
    const date = addDays(start, i);
    const k = dayKey(date);
    if (blocked[date]) continue;
    (slots || [])
      .filter((s) => s.day_of_week === k)
      .sort((a, b) => a.period_number - b.period_number)
      .forEach((slot) => out.push({ date, slot }));
  }
  return out;
}

const FIRST_LESSONS = 6;

export function schemeLabel(scheme, outOf) {
  if (!scheme) return '';
  if (scheme.kind === 'mark' && scheme.fixed_max == null) return `Mark out of ${Number(outOf)}`;
  return scheme.name;
}

export function classLabel(c) {
  return `${c.class_code} · ${c.subjects?.display_name || c.subjects?.subject_name || ''}`;
}

// Which prep evening the homework goes on, and whether the class has time then.
function PrepNote({ check, dueOn, minutes, unchanged, blockedReason, yearGroup }) {
  if (!dueOn) return <span style={{ color: 'var(--ink-soft)' }}>Done in prep the evening before the deadline.</span>;
  if (blockedReason && !unchanged) {
    return (
      <span style={{ color: '#a3232c' }}>
        Year {yearGroup} has no homework on {formatUKDate(dueOn, { weekday: true }).replace(/ \d{4}$/, '')} ({blockedReason}). Choose another deadline.
      </span>
    );
  }
  if (!check) return <span style={{ color: 'var(--ink-soft)' }}>Checking prep time…</span>;
  if (!check.prep_on) {
    return <span style={{ color: '#a3232c' }}>No prep evening in the week before that deadline. Choose another deadline.</span>;
  }
  const evening = formatUKDate(check.prep_on, { weekday: true }).replace(/ \d{4}$/, '');
  if (!unchanged && check.prep_on < schoolToday()) {
    return <span style={{ color: '#a3232c' }}>Its prep evening ({evening}) has passed. Choose a later deadline.</span>;
  }
  if (!unchanged && check.students_short > 0) {
    return (
      <span style={{ color: '#a3232c' }}>
        Done in prep on <strong>{evening}</strong>, but {check.students_short} of {check.students} students
        haven&apos;t {minutesLabel(minutes)} left that evening (least: {minutesLabel(Math.max(check.least_free, 0))}).
        Shorten it or choose another deadline.
      </span>
    );
  }
  return (
    <span>
      Done in prep on <strong>{evening}</strong>
      <span style={{ color: 'var(--ink-soft)' }}> · every student has at least {minutesLabel(Math.max(check.least_free, 0))} free that evening</span>
    </span>
  );
}

export default function HomeworkForm({ cls, schemes, existing, markCount, onSaved, onCancel, embedded = false }) {
  const [title, setTitle] = useState(existing?.title || '');
  const [instructions, setInstructions] = useState(existing?.instructions || '');
  const [dueOn, setDueOn] = useState(existing?.due_on || '');
  const [dueSlotId, setDueSlotId] = useState(existing?.due_slot_id ? String(existing.due_slot_id) : '');
  const [schemeId, setSchemeId] = useState(existing?.scheme_id ? String(existing.scheme_id) : '');
  const [outOf, setOutOf] = useState(existing?.out_of != null ? String(Number(existing.out_of)) : '');
  // How long it takes (migration 352). It is done in prep the evening
  // before the deadline, which the database works out.
  const [minutes, setMinutes] = useState(existing?.minutes != null ? String(existing.minutes) : '30');
  const [prepCheck, setPrepCheck] = useState(null);
  const [blocked, setBlocked] = useState({});

  useEffect(() => {
    loadPrepBlocks(supabase, cls.year_group, schoolToday()).then(setBlocked);
  }, [cls.year_group]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // Files and links (migration 281), saved after the homework itself.
  const [attachments, setAttachments] = useState({ existing: [], removeIds: [], newLinks: [], newFiles: [] });

  useEffect(() => {
    if (existing?.homework_id) loadAttachments(existing.homework_id).then((a) => setAttachments((v) => ({ ...v, existing: a })));
  }, [existing?.homework_id]);

  // The prep evening the deadline puts it on and the least time any student
  // in the class has left then. The database checks again on saving.
  useEffect(() => {
    if (!dueOn) { setPrepCheck(null); return undefined; }
    let live = true;
    setPrepCheck(null);
    loadPrepCheck(supabase, cls.class_id, dueOn, minutes, existing?.homework_id || null)
      .then(({ check }) => { if (live) setPrepCheck(check || { prep_on: null, students: 0, least_free: 0, students_short: 0 }); });
    return () => { live = false; };
  }, [cls.class_id, dueOn, minutes, existing?.homework_id]);
  // An existing homework whose deadline and time haven't changed isn't re-checked.
  const unchanged = existing && dueOn === existing.due_on && Number(minutes) === Number(existing.minutes);

  const scheme = schemes.find((s) => String(s.scheme_id) === schemeId);
  const needsOutOf = scheme?.kind === 'mark' && scheme.fixed_max == null;
  const schemeLocked = markCount > 0;
  const allPicks = nextLessons(cls.timetable_slots, blocked);
  const [showAll, setShowAll] = useState(false);
  const picks = showAll ? allPicks : allPicks.slice(0, FIRST_LESSONS);
  // An existing homework keeps its deadline unless a lesson is chosen, even
  // when that deadline isn't one of the lessons offered (passed, end of day,
  // or a lesson since moved by an import).
  const keptDeadline = existing?.due_on
    && !allPicks.some(({ date, slot }) => date === existing.due_on && String(slot.slot_id) === String(existing.due_slot_id || ''));
  const keptSlot = keptDeadline && (cls.timetable_slots || []).find((s) => String(s.slot_id) === String(existing.due_slot_id || ''));
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
    if (!dueOn) { setError('Choose the lesson it is due in.'); return; }
    if (!existing && dueOn < schoolToday()) { setError('The deadline is in the past.'); return; }
    if (!(Number(minutes) >= 5)) { setError('Say how many minutes it should take.'); return; }
    if (!schemeId) { setError('Choose how it will be graded.'); return; }
    if (needsOutOf && !(Number(outOf) > 0)) { setError('Say what it is marked out of.'); return; }
    setSaving(true);
    const payload = {
      title: title.trim(),
      instructions: instructions.trim() || null,
      due_on: dueOn,
      due_slot_id: dueSlotId ? Number(dueSlotId) : null,
      minutes: Number(minutes),
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
            {keptDeadline && (
              <button
                type="button"
                className={dueOn === existing.due_on && dueSlotId === String(existing.due_slot_id || '') ? '' : 'secondary'} style={btnSmall}
                onClick={() => { setDueOn(existing.due_on); setDueSlotId(existing.due_slot_id ? String(existing.due_slot_id) : ''); }}
              >
                As set: {formatUKDate(existing.due_on, { weekday: true }).replace(/ \d{4}$/, '')}
                {keptSlot ? ` · L${keptSlot.period_number}` : existing.due_slot_id ? '' : ' · end of day'}
              </button>
            )}
            {allPicks.length === 0 && <span style={{ color: 'var(--ink-soft)' }}>No lessons found for this class.</span>}
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
            {allPicks.length > FIRST_LESSONS && (
              <button type="button" className="secondary" style={{ ...btnSmall, borderStyle: 'dashed' }} onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Fewer lessons' : 'Later lessons…'}
              </button>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ flex: '0 1 10rem' }}>
            Time it takes
            <select value={minutes} onChange={(e) => setMinutes(e.target.value)}>
              {[...new Set([...HOMEWORK_MINUTE_CHOICES, Number(minutes)])].sort((a, b) => a - b).map((m) => (
                <option key={m} value={m}>{minutesLabel(m)}</option>
              ))}
            </select>
          </label>
          <div style={{ flex: '1 1 18rem', fontSize: '0.9rem', paddingBottom: '0.4rem' }}>
            <PrepNote check={prepCheck} dueOn={dueOn} minutes={minutes} unchanged={unchanged} blockedReason={blocked[dueOn]} yearGroup={cls.year_group} />
          </div>
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
