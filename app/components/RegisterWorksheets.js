'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { formatUKDate } from '../../lib/formatDate';
import { formatTimeRange } from '../../lib/formatTime';
import { schoolToday, schoolDateOffset, schoolClock } from '../../lib/schoolTime';
import { fileSizeLabel, HOMEWORK_FILE_ACCEPT } from '../../lib/homework';
import {
  canAddWorksheets, canAddYearWorksheets, loadClassLessons, loadClassWorksheets, loadYearWorksheetPlacements,
  addLessonWorksheet, addYearWorksheet, removeLessonWorksheet, openLessonWorksheet,
  worksheetKey, opensAtClock, worksheetFileProblem,
} from '../../lib/lessonWorksheets';
import { btnSmall } from './HomeworkForm';

// Worksheets on the class register (/attendance), migrations 428-430: the
// class's lessons from the register's date (or today) to two weeks ahead,
// each numbered within its week ("Lesson 2 of 4"). A worksheet goes either on
// every class in the year for that subject, at their own lesson of that
// number (the usual way: the department keeps the year in step), or on this
// class's lesson only. Students see it on their timetable but can open it only
// once their lesson starts. Shown only where the database allows it (the
// class's teachers, its Head of Department and admins, for a subject on the
// trial); it checks again when a worksheet is added or removed.
export default function RegisterWorksheets({ classId, date, periodNumber }) {
  const [cls, setCls] = useState(null);
  const [canClass, setCanClass] = useState(false);
  const [canYear, setCanYear] = useState(false);
  const [periods, setPeriods] = useState({});
  const [lessons, setLessons] = useState([]);
  const [worksheets, setWorksheets] = useState([]);
  const [placements, setPlacements] = useState({}); // year worksheet_id -> [{class_code, lesson_date, period_number, starts_at}]
  const [busy, setBusy] = useState(null); // lesson key being uploaded to
  const [status, setStatus] = useState(null);

  const today = schoolToday();
  const nowIso = `${today}T${schoolClock()}:00`; // school time, the shape of opens_at
  const from = date && date < today ? date : today;
  const to = schoolDateOffset(14);

  const load = useCallback(async (c) => {
    const [{ lessons: l }, { worksheets: w }] = await Promise.all([
      loadClassLessons(c.class_id, from, to),
      loadClassWorksheets(c, from, to),
    ]);
    setLessons(l);
    setWorksheets(w);
    const yearOnes = w.filter((x) => x.class_id == null);
    const pl = await Promise.all(yearOnes.map((x) => loadYearWorksheetPlacements(x.worksheet_id)));
    setPlacements(Object.fromEntries(yearOnes.map((x, i) => [x.worksheet_id, pl[i]])));
  }, [from, to]);

  useEffect(() => {
    setCls(null);
    setStatus(null);
    if (!classId) return;
    let cancelled = false;
    (async () => {
      const { data: c } = await supabase.from('classes')
        .select('class_id, class_code, subject_id, year_group, subjects(subject_name, display_name)')
        .eq('class_id', classId).single();
      if (!c || cancelled) return;
      const [own, year] = await Promise.all([
        canAddWorksheets(c.class_id),
        c.year_group ? canAddYearWorksheets(c.subject_id, c.year_group) : false,
      ]);
      if (cancelled || (!own && !year)) return;
      const { data: p } = await supabase.from('periods').select('period_number, period_name');
      if (cancelled) return;
      setPeriods(Object.fromEntries((p || []).map((r) => [r.period_number, r.period_name])));
      setCanClass(own);
      setCanYear(year);
      setCls(c);
      load(c);
    })();
    return () => { cancelled = true; };
  }, [classId, load]);

  if (!cls) return null;

  const subjectName = cls.subjects?.display_name || cls.subjects?.subject_name || 'this subject';
  const yearLabel = `Year ${cls.year_group} ${subjectName}`;

  async function add(lesson, files, wholeYear) {
    setStatus(null);
    const list = Array.from(files || []);
    const problems = list.map(worksheetFileProblem).filter(Boolean);
    if (problems.length) { setStatus(problems.join(' ')); return; }
    setBusy(worksheetKey(lesson.lesson_date, lesson.period_number, cls.class_id));
    for (const f of list) {
      const title = f.name.replace(/\.[^.]+$/, '');
      const error = wholeYear
        ? await addYearWorksheet(cls.subject_id, cls.year_group, lesson.week_start, lesson.lesson_number, f, title)
        : await addLessonWorksheet(cls.class_id, lesson.lesson_date, lesson.period_number, f, title);
      if (error) { setStatus(`${f.name} wasn't added: ${error.message}`); break; }
    }
    setBusy(null);
    load(cls);
  }

  async function remove(w) {
    const whom = w.class_id == null ? ` for every ${yearLabel} class` : '';
    if (!window.confirm(`Remove "${w.title}"${whom}?`)) return;
    setStatus(null);
    const error = await removeLessonWorksheet(w);
    if (error) setStatus(`That wasn't removed: ${error.message}`);
    load(cls);
  }

  async function open(w) {
    setStatus(null);
    const error = await openLessonWorksheet(w);
    if (error) setStatus(error.message);
  }

  function fileButton(lesson, key, wholeYear, label) {
    return (
      <label className={`${wholeYear ? '' : 'secondary '}hw-file-button`} style={{ ...btnSmall, ...(busy ? { opacity: 0.5, pointerEvents: 'none' } : {}) }}>
        {busy === key ? 'Uploading…' : label}
        <input
          type="file" multiple accept={HOMEWORK_FILE_ACCEPT} disabled={!!busy}
          onChange={(e) => { add(lesson, e.target.files, wholeYear); e.target.value = ''; }}
          style={{ display: 'none' }}
        />
      </label>
    );
  }

  return (
    <div className="card">
      <h2 style={{ margin: 0 }}>📄 Lesson worksheets</h2>
      <p style={{ color: 'var(--ink-soft)', margin: '0.3rem 0 0.6rem' }}>
        {canYear
          ? <>Add a worksheet to a lesson of the week (lesson 1, 2, 3…) for every {yearLabel} class: each class gets it in its own lesson of that number. </>
          : null}
        Students see it on their timetable but can only open it once their lesson starts. Up to 3 MB a file.
      </p>
      {status && <p style={{ color: '#a3232c', margin: '0 0 0.5rem' }}>{status}</p>}
      {lessons.length === 0 ? (
        <p style={{ color: 'var(--ink-soft)', marginBottom: 0 }}>No lessons for this class in the next two weeks.</p>
      ) : (
        <ul className="ws-lessons">
          {lessons.map((l) => {
            const key = worksheetKey(l.lesson_date, l.period_number, cls.class_id);
            const items = worksheets.filter((w) => (w.class_id == null
              ? w.week_start === l.week_start && w.lesson_number === l.lesson_number
              : w.lesson_date === l.lesson_date && w.period_number === l.period_number));
            const isThis = l.lesson_date === date && l.period_number === periodNumber;
            const lessonOpen = `${l.lesson_date}T${l.start_time}` <= nowIso;
            return (
              <li key={key} className={isThis ? 'ws-this' : undefined}>
                <div className="ws-lesson-head">
                  <span>
                    <strong>Lesson {l.lesson_number}</strong>
                    <span style={{ color: 'var(--ink-soft)' }}> of {l.lessons_in_week} this week</span>
                    {' · '}{formatUKDate(l.lesson_date, { weekday: true })}
                    {' · '}{periods[l.period_number] || `Period ${l.period_number}`}
                    <span style={{ color: 'var(--ink-soft)' }}> · {formatTimeRange(l.start_time, l.end_time)}</span>
                    {isThis && <span className="ws-this-tag">this register</span>}
                  </span>
                  <span style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                    {canYear && fileButton(l, key, true, `+ All Year ${cls.year_group} (lesson ${l.lesson_number})`)}
                    {canClass && fileButton(l, key, false, `+ ${cls.class_code} only`)}
                  </span>
                </div>
                {items.length > 0 && (
                  <ul className="hw-attach-list" style={{ marginTop: '0.3rem' }}>
                    {items.map((w) => {
                      const missing = (placements[w.worksheet_id] || []).filter((p) => !p.lesson_date).map((p) => p.class_code);
                      return (
                        <li key={w.worksheet_id} style={{ flexWrap: 'wrap' }}>
                          <span aria-hidden="true">📄</span>
                          <button type="button" className="hw-attachment" onClick={() => open(w)}>
                            <span className="hw-attachment-title">{w.title}</span>
                          </button>
                          <span className="hw-attachment-meta">
                            {fileSizeLabel(w.size_bytes)}
                            {' · '}{w.class_id == null ? `all Year ${w.year_group}, lesson ${w.lesson_number}` : `${cls.class_code} only`}
                            {' · '}{lessonOpen ? 'open to students' : `students can open from ${opensAtClock(`${l.lesson_date}T${l.start_time}`)}`}
                          </span>
                          {(w.class_id == null ? canYear : canClass) && (
                            <button type="button" className="secondary" style={btnSmall} onClick={() => remove(w)}>Remove</button>
                          )}
                          {missing.length > 0 && (
                            <div style={{ flexBasis: '100%', fontSize: '0.8rem', color: '#b45309' }}>
                              Not given to {missing.join(', ')}: fewer than {w.lesson_number} lessons that week.
                            </div>
                          )}
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
