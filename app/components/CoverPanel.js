'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { schoolToday } from '../../lib/schoolTime';

// Arrange cover for an absent teacher (migration 374), shown on the Timetable
// page to SMT only (can_arrange_cover()). Pick a date; each of the teacher's
// lessons that day gets a list of staff who are free then, from
// free_cover_staff(), with how many covers each has done this term. Adding
// and cancelling go through add_lesson_cover() / cancel_lesson_cover(), which
// check everything again; this page decides nothing.

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function nextSchoolDay() {
  const d = new Date(`${schoolToday()}T00:00:00`);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toLocaleDateString('en-CA');
}

const fullName = (s) => (s ? `${s.first_name} ${s.last_name}` : '');

function LessonCover({ lesson, date, existing, onChanged }) {
  const [free, setFree] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [choice, setChoice] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (existing) return;
    let cancelled = false;
    setFree(null);
    setChoice('');
    supabase
      .rpc('free_cover_staff', { p_class_id: lesson.classId, p_date: date, p_period: lesson.period })
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) setError(err.message);
        else setFree(data || []);
      });
    return () => { cancelled = true; };
  }, [lesson.classId, lesson.period, date, existing]);

  async function assign() {
    if (!choice) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc('add_lesson_cover', {
      p_class_id: lesson.classId, p_date: date, p_period: lesson.period,
      p_cover_staff_id: Number(choice), p_note: note || null,
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setNote('');
    onChanged();
  }

  async function cancel() {
    if (!window.confirm(`Cancel ${fullName(existing.cover)}'s cover of ${lesson.classCode}? They will be told.`)) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc('cancel_lesson_cover', { p_cover_id: existing.cover_id });
    setBusy(false);
    if (err) { setError(err.message); return; }
    onChanged();
  }

  // Teachers first, fewest covers this term first, then name; anyone
  // already being covered for that day is flagged.
  const options = (free || [])
    .filter((s) => showAll || s.teaches)
    .sort((a, b) => a.covers_this_term - b.covers_this_term || a.last_name.localeCompare(b.last_name));

  return (
    <div style={{ borderTop: '1px solid var(--slate-200)', padding: '0.6rem 0' }}>
      <div><strong>{lesson.periodName}</strong> · {lesson.classCode} {lesson.subject ? `· ${lesson.subject}` : ''}</div>
      {existing ? (
        <div style={{ marginTop: '0.3rem' }}>
          Covered by <strong>{fullName(existing.cover)}</strong>
          {existing.note ? <span style={{ opacity: 0.75 }}> · {existing.note}</span> : null}{' '}
          <button className="secondary" onClick={cancel} disabled={busy} style={{ marginLeft: '0.4rem', padding: '0.2rem 0.6rem' }}>Cancel cover</button>
        </div>
      ) : free === null && !error ? (
        <div style={{ opacity: 0.7 }}>Finding who is free…</div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.3rem', alignItems: 'center' }}>
          <select value={choice} onChange={(e) => setChoice(e.target.value)} style={{ flex: '1 1 14rem' }}>
            <option value="">{options.length ? `Choose from ${options.length} free…` : 'Nobody is free'}</option>
            {options.map((s) => (
              <option key={s.staff_id} value={s.staff_id}>
                {s.first_name} {s.last_name} ({s.covers_this_term} this term){s.covered_today ? ' (absent today?)' : ''}
              </option>
            ))}
          </select>
          <input
            type="text" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)}
            placeholder="Note for them (optional), e.g. where the work is" style={{ flex: '2 1 14rem' }}
          />
          <button onClick={assign} disabled={!choice || busy}>Add cover</button>
          <label style={{ fontSize: '0.8rem', flexBasis: '100%' }}>
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Include staff with no lessons on the timetable
          </label>
        </div>
      )}
      {error && <div style={{ color: '#c0392b', marginTop: '0.3rem' }}>{error}</div>}
    </div>
  );
}

export default function CoverPanel({ staffName, classes, periods, onChanged }) {
  const [date, setDate] = useState(nextSchoolDay);
  const [covers, setCovers] = useState([]);
  const [reload, setReload] = useState(0);

  const dow = WEEKDAYS[new Date(`${date}T00:00:00`).getDay()];
  const periodName = (n) => periods.find((p) => p.period_number === n)?.period_name || `Period ${n}`;

  const lessons = [];
  classes.forEach((c) => (c.timetable_slots || []).forEach((t) => {
    if (t.day_of_week !== dow) return;
    lessons.push({
      classId: c.class_id, classCode: c.class_code, period: t.period_number,
      periodName: periodName(t.period_number),
      subject: c.subjects?.display_name || c.subjects?.subject_name,
    });
  }));
  lessons.sort((a, b) => a.period - b.period);
  const classIds = [...new Set(lessons.map((l) => l.classId))];

  useEffect(() => {
    if (classIds.length === 0) { setCovers([]); return; }
    supabase
      .from('lesson_covers')
      .select('cover_id, class_id, period_number, note, cover:staff!lesson_covers_cover_staff_id_fkey(first_name, last_name)')
      .eq('cover_date', date)
      .is('cancelled_at', null)
      .in('class_id', classIds)
      .then(({ data }) => setCovers(data || []));
    // classIds is derived from classes + date
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, classes, reload]);

  const changed = () => { setReload((r) => r + 1); onChanged?.(); };
  const past = date < schoolToday();

  return (
    <div className="card" style={{ marginBottom: '1rem', borderColor: 'var(--brand-600)' }}>
      <strong>Arrange cover for {staffName}</strong>
      <div style={{ margin: '0.5rem 0' }}>
        <label>Date{' '}
          <input type="date" value={date} min={schoolToday()} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
      </div>
      {past ? (
        <p>Cover can only be arranged for today or later.</p>
      ) : lessons.length === 0 ? (
        <p>{staffName} has no lessons on {dow === 'Sat' || dow === 'Sun' ? 'that day' : `a ${dow}`}.</p>
      ) : (
        lessons.map((l) => (
          <LessonCover
            key={`${l.classId}-${l.period}`}
            lesson={l}
            date={date}
            existing={covers.find((c) => c.class_id === l.classId && c.period_number === l.period)}
            onChanged={changed}
          />
        ))
      )}
      <p style={{ fontSize: '0.8rem', opacity: 0.7, marginBottom: 0 }}>
        Each person you choose gets an inbox message with your note and an apology, and the lesson appears on their timetable for that day only.
      </p>
    </div>
  );
}
