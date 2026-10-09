'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { formatUKDate } from '../../lib/formatDate';
import { formatTimeRange } from '../../lib/formatTime';
import { schoolToday, schoolDateOffset, schoolClock } from '../../lib/schoolTime';
import { fileSizeLabel, HOMEWORK_FILE_ACCEPT } from '../../lib/homework';
import {
  canAddWorksheets, loadClassLessons, loadClassWorksheets, addLessonWorksheet,
  removeLessonWorksheet, openLessonWorksheet, worksheetKey, opensAtClock, worksheetFileProblem,
} from '../../lib/lessonWorksheets';
import { btnSmall } from './HomeworkForm';

// Worksheets on the class register (/attendance), migration 428: the class's
// lessons from the register's date (or today) to two weeks ahead, each with
// its worksheets and a button to add one. Students see a worksheet on their
// timetable but can open it only from the start of the lesson. Shown only
// where can_add_lesson_worksheet() allows it (the class's teachers, its Head
// of Department and admins, in a department on the trial); the database
// applies the same check when a worksheet is added or removed.
export default function RegisterWorksheets({ classId, date, periodNumber }) {
  const [allowed, setAllowed] = useState(false);
  const [periods, setPeriods] = useState({});
  const [lessons, setLessons] = useState([]);
  const [worksheets, setWorksheets] = useState([]);
  const [busy, setBusy] = useState(null); // lesson key being uploaded to
  const [status, setStatus] = useState(null);

  const today = schoolToday();
  const nowIso = `${today}T${schoolClock()}:00`; // school time, the shape of opens_at
  const from = date && date < today ? date : today;
  const to = schoolDateOffset(14);

  const load = useCallback(async () => {
    const [{ lessons: l }, { worksheets: w }] = await Promise.all([
      loadClassLessons(classId, from, to),
      loadClassWorksheets(classId, from, to),
    ]);
    setLessons(l);
    setWorksheets(w);
  }, [classId, from, to]);

  useEffect(() => {
    setAllowed(false);
    setStatus(null);
    if (!classId) return;
    let cancelled = false;
    (async () => {
      if (!(await canAddWorksheets(classId)) || cancelled) return;
      const { data: p } = await supabase.from('periods').select('period_number, period_name');
      if (cancelled) return;
      setPeriods(Object.fromEntries((p || []).map((r) => [r.period_number, r.period_name])));
      setAllowed(true);
      load();
    })();
    return () => { cancelled = true; };
  }, [classId, load]);

  if (!allowed) return null;

  const byLesson = {};
  worksheets.forEach((w) => {
    const k = worksheetKey(w.lesson_date, w.period_number, w.class_id);
    (byLesson[k] = byLesson[k] || []).push(w);
  });

  async function add(lesson, files) {
    setStatus(null);
    const list = Array.from(files || []);
    const problems = list.map(worksheetFileProblem).filter(Boolean);
    if (problems.length) { setStatus(problems.join(' ')); return; }
    const key = worksheetKey(lesson.lesson_date, lesson.period_number, Number(classId));
    setBusy(key);
    for (const f of list) {
      const error = await addLessonWorksheet(classId, lesson.lesson_date, lesson.period_number, f, f.name.replace(/\.[^.]+$/, ''));
      if (error) { setStatus(`${f.name} wasn't added: ${error.message}`); break; }
    }
    setBusy(null);
    load();
  }

  async function remove(w) {
    if (!window.confirm(`Remove "${w.title}" from this lesson?`)) return;
    setStatus(null);
    const error = await removeLessonWorksheet(w);
    if (error) setStatus(`That wasn't removed: ${error.message}`);
    load();
  }

  async function open(w) {
    setStatus(null);
    const error = await openLessonWorksheet(w);
    if (error) setStatus(error.message);
  }

  return (
    <div className="card">
      <h2 style={{ margin: 0 }}>📄 Lesson worksheets</h2>
      <p style={{ color: 'var(--ink-soft)', margin: '0.3rem 0 0.6rem' }}>
        Students see a worksheet on their timetable but can only open it once the lesson starts. Up to 3 MB a file.
      </p>
      {status && <p style={{ color: '#a3232c', margin: '0 0 0.5rem' }}>{status}</p>}
      {lessons.length === 0 ? (
        <p style={{ color: 'var(--ink-soft)', marginBottom: 0 }}>No lessons for this class in the next two weeks.</p>
      ) : (
        <ul className="ws-lessons">
          {lessons.map((l) => {
            const key = worksheetKey(l.lesson_date, l.period_number, Number(classId));
            const items = byLesson[key] || [];
            const isThis = l.lesson_date === date && l.period_number === periodNumber;
            return (
              <li key={key} className={isThis ? 'ws-this' : undefined}>
                <div className="ws-lesson-head">
                  <span>
                    <strong>{formatUKDate(l.lesson_date, { weekday: true })}</strong>
                    {' · '}{periods[l.period_number] || `Period ${l.period_number}`}
                    <span style={{ color: 'var(--ink-soft)' }}> · {formatTimeRange(l.start_time, l.end_time)}</span>
                    {isThis && <span className="ws-this-tag">this register</span>}
                  </span>
                  <label className="secondary hw-file-button" style={{ ...btnSmall, ...(busy ? { opacity: 0.5, pointerEvents: 'none' } : {}) }}>
                    {busy === key ? 'Uploading…' : '+ Add worksheet'}
                    <input
                      type="file" multiple accept={HOMEWORK_FILE_ACCEPT} disabled={!!busy}
                      onChange={(e) => { add(l, e.target.files); e.target.value = ''; }}
                      style={{ display: 'none' }}
                    />
                  </label>
                </div>
                {items.length > 0 && (
                  <ul className="hw-attach-list" style={{ marginTop: '0.3rem' }}>
                    {items.map((w) => {
                      const isOpen = (w.opens_at || '').replace(' ', 'T') <= nowIso;
                      return (
                        <li key={w.worksheet_id}>
                          <span aria-hidden="true">📄</span>
                          <button type="button" className="hw-attachment" onClick={() => open(w)}>
                            <span className="hw-attachment-title">{w.title}</span>
                          </button>
                          <span className="hw-attachment-meta">
                            {fileSizeLabel(w.size_bytes)} · {isOpen ? 'open to students' : `students can open from ${opensAtClock(w.opens_at)}`}
                          </span>
                          <button type="button" className="secondary" style={btnSmall} onClick={() => remove(w)}>Remove</button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
