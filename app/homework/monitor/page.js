'use client';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { LESSON_COLUMNS, lessonRoom, lessonTeacher } from '../../../lib/lessons';
import { formatTimeRange } from '../../../lib/formatTime';
import { isOtherHalfSubject, mergeOtherHalfIntoCells } from '../../../lib/otherHalf';
import { schoolToday } from '../../../lib/schoolTime';
import { addDays, defaultWeekStart, shortDate, groupHomeworkByDay, placeHomeworkInCells } from '../../../lib/homework';
import { HomeworkChip, HomeworkDetail } from '../../components/HomeworkChip';
import { WeekPicker, HomeworkCard } from '../../components/HomeworkWeek';

// Homework Monitor (migration 311, the principal, 1 Oct 2026): SMT see what
// homework is being set, on the students' own cards, either for a whole year
// group or for one student. A year group's week is every class's homework
// due that week, plus the switched-on classes with nothing due. A student's
// week is their timetable with homework on it and their Homework cards,
// exactly as on their portal (their own Done ticks and released grades),
// through homework_as_student(), which applies my_homework()'s rules to the
// chosen student and returns nothing to anyone without this page.
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

// How far a homework's marking has got, as SMT see it on a year group's week
// (the principal, 2 Oct 2026): not the student's "Overdue", which only means
// the due date has passed. A class's count is its active students who had
// joined by the due date, plus any with a mark (migration 298's rule, as in
// the mark book). A row in homework_marks, including Not handed in or
// Excused, counts as marked.
function markingStatus(hw, marked, size, today) {
  const notReleased = marked > 0 && !hw.marks_released ? ', not released to students' : '';
  const note = `${marked} of ${size} marked${notReleased}`;
  if (size > 0 && marked >= size) {
    return { key: 'graded', label: hw.marks_released ? 'Marked' : 'Marked · not released', note };
  }
  if (marked > 0) return { key: 'today', label: `Marked ${marked} of ${size}`, note };
  if (hw.due_on < today) return { key: 'overdue', label: 'Not marked', note };
  return null; // Not due yet and nothing marked: the usual Due / Due today.
}

function subjectOf(cls) {
  return cls?.subjects?.display_name || cls?.subjects?.subject_name || '';
}

// The Mon–Fri (and weekend, when anything is due then) grid of cards.
function WeekCards({ homework, weekStart, selected, onSelect }) {
  const today = schoolToday();
  const byDay = groupHomeworkByDay(homework, weekStart);
  const weekend = [...byDay[addDays(weekStart, 5)], ...byDay[addDays(weekStart, 6)]];
  const days = DAYS.map((d, i) => ({ key: d, date: addDays(weekStart, i), items: byDay[addDays(weekStart, i)] }));
  if (weekend.length) days.push({ key: 'Weekend', date: addDays(weekStart, 5), items: weekend, weekend: true });
  return (
    <div className={`hw-grid${days.length > 5 ? ' hw-grid-6' : ''}`}>
      {days.map((d) => (
        <div key={d.key} className={`hw-day${!d.weekend && d.date === today ? ' hw-today' : ''}`}>
          <div className="hw-day-head">{d.weekend ? 'Weekend' : shortDate(d.date)}</div>
          {d.items.length === 0 ? <div className="hw-nothing">Nothing due</div> : d.items.map((hw) => (
            <HomeworkCard key={hw.homework_id} hw={hw} selected={selected === hw.homework_id} onSelect={onSelect} showDate={d.weekend} />
          ))}
        </div>
      ))}
    </div>
  );
}

// ---- A whole year group -----------------------------------------------------

function YearWeek({ year, weekStart }) {
  const [classes, setClasses] = useState(null); // switched-on classes in the year
  const [homework, setHomework] = useState(null);
  const [subject, setSubject] = useState('');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setClasses(null);
      setSubject('');
      const { data } = await supabase.from('homework_classes')
        .select('classes!inner(class_id, class_code, year_group, subjects(subject_name, display_name))')
        .eq('classes.year_group', year);
      if (!cancelled) setClasses((data || []).map((r) => r.classes).filter(Boolean));
    })();
    return () => { cancelled = true; };
  }, [year]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setHomework(null);
      setSelected(null);
      const [{ data: hw }, { data: schemes }, { data: years }] = await Promise.all([
        supabase.from('homework')
          .select('homework_id, class_id, class_code, subject_id, title, instructions, set_on, due_on, due_slot_id, scheme_id, out_of, academic_year_id, marks_released, subjects(subject_name, display_name), set_by:staff!homework_set_by_staff_id_fkey(first_name, last_name)')
          .eq('year_group', year).eq('status', 'set')
          .gte('due_on', weekStart).lte('due_on', addDays(weekStart, 6))
          .order('due_on').order('class_code'),
        supabase.from('homework_schemes').select('scheme_id, name, kind, fixed_max'),
        supabase.from('academic_years').select('academic_year_id').eq('status', 'current'),
      ]);
      const current = new Set((years || []).map((y) => y.academic_year_id));
      const rows = (hw || []).filter((h) => current.has(h.academic_year_id));
      const slotIds = [...new Set(rows.map((h) => h.due_slot_id).filter(Boolean))];
      const hwIds = rows.map((h) => h.homework_id);
      const classIds = [...new Set(rows.map((h) => h.class_id))];
      const [{ data: slots }, { data: marks }, { data: enrol }] = await Promise.all([
        slotIds.length
          ? supabase.from('timetable_slots').select('slot_id, period_number').in('slot_id', slotIds)
          : { data: [] },
        hwIds.length
          ? supabase.from('homework_marks').select('homework_id, student_id').in('homework_id', hwIds)
          : { data: [] },
        classIds.length
          ? supabase.from('student_class').select('class_id, student_id, joined_on, students(status)').in('class_id', classIds)
          : { data: [] },
      ]);
      if (cancelled) return;
      const periodOf = Object.fromEntries((slots || []).map((s) => [s.slot_id, s.period_number]));
      const markedBy = {};
      (marks || []).forEach((m) => { (markedBy[m.homework_id] ||= new Set()).add(m.student_id); });
      const today = schoolToday();
      setHomework(rows.map((h) => {
        const scheme = (schemes || []).find((s) => s.scheme_id === h.scheme_id);
        const subj = subjectOf(h);
        const marked = markedBy[h.homework_id] || new Set();
        const size = (enrol || []).filter((e) => e.class_id === h.class_id && e.students?.status === 'active'
          && (!e.joined_on || e.joined_on <= h.due_on || marked.has(e.student_id))).length;
        const marking = markingStatus(h, marked.size, size, today);
        return {
          ...h,
          subject: subj,
          // The class code goes with the subject: a year has several sets of each.
          subject_name: `${subj} · ${h.class_code}`,
          due_period: periodOf[h.due_slot_id] ?? null,
          scheme_name: scheme?.name,
          scheme_kind: scheme?.kind,
          out_of: h.out_of ?? scheme?.fixed_max,
          teacher_name: h.set_by ? `${h.set_by.first_name || ''} ${h.set_by.last_name || ''}`.trim() : null,
          marked: false,
          done: false,
          status_override: marking ? { key: marking.key, label: marking.label } : null,
          marking_note: marking?.note || `${marked.size} of ${size} marked`,
          not_marked: !!marking && marked.size < size && h.due_on < today,
        };
      }));
    })();
    return () => { cancelled = true; };
  }, [year, weekStart]);

  const subjects = useMemo(
    () => [...new Set((classes || []).map(subjectOf).filter(Boolean))].sort(),
    [classes],
  );
  const shown = (homework || []).filter((h) => !subject || h.subject === subject);
  const selectedHw = shown.find((h) => h.homework_id === selected) || null;

  // Per subject: switched-on classes, and which of them have nothing due this week.
  const summary = useMemo(() => {
    if (!classes || !homework) return [];
    const withHw = new Set(homework.map((h) => h.class_id));
    const bySubject = new Map();
    for (const c of classes) {
      const s = subjectOf(c) || 'No subject';
      if (!bySubject.has(s)) bySubject.set(s, { subject: s, classes: [], set: 0, none: [], unmarked: [] });
      const row = bySubject.get(s);
      row.classes.push(c);
      if (withHw.has(c.class_id)) row.set += 1; else row.none.push(c.class_code);
      if (homework.some((h) => h.class_id === c.class_id && h.not_marked)) row.unmarked.push(c.class_code);
    }
    return [...bySubject.values()]
      .filter((r) => !subject || r.subject === subject)
      .sort((a, b) => a.subject.localeCompare(b.subject));
  }, [classes, homework, subject]);

  const classesWithHw = new Set(shown.map((h) => h.class_id)).size;
  const classCount = summary.reduce((n, r) => n + r.classes.length, 0);

  return (
    <>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '0.75rem' }}>
        <label>
          Subject{' '}
          <select value={subject} onChange={(e) => { setSubject(e.target.value); setSelected(null); }}>
            <option value="">All subjects</option>
            {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        {homework && classes && (
          <span style={{ color: 'var(--ink-soft)', fontSize: '0.9rem' }}>
            {shown.length} homework due this week, from {classesWithHw} of {classCount} switched-on class{classCount === 1 ? '' : 'es'}
          </span>
        )}
      </div>
      {homework === null ? <p>Loading…</p> : (
        <>
          <WeekCards homework={shown} weekStart={weekStart} selected={selected} onSelect={setSelected} />
          <HomeworkDetail hw={selectedHw} onClose={() => setSelected(null)} />
        </>
      )}
      {classes && homework && (
        <>
          <h3 style={{ marginTop: '1.25rem' }}>Classes by subject this week</h3>
          {summary.length === 0 ? <p>No classes in Year {year} have homework switched on.</p> : (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr><th>Subject</th><th>Classes</th><th>With homework due</th><th>Nothing due this week</th><th>Past due, not fully marked</th></tr>
                </thead>
                <tbody>
                  {summary.map((r) => (
                    <tr key={r.subject}>
                      <td>{r.subject}</td>
                      <td>{r.classes.length}</td>
                      <td>{r.set}</td>
                      <td style={{ color: r.none.length ? 'inherit' : 'var(--ink-soft)' }}>
                        {r.none.length ? r.none.sort().join(', ') : 'All set'}
                      </td>
                      <td style={{ color: r.unmarked.length ? '#7a1a1a' : 'var(--ink-soft)' }}>
                        {r.unmarked.length ? r.unmarked.sort().join(', ') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}

// ---- One student ------------------------------------------------------------

function StudentWeek({ studentId, weekStart }) {
  const [periods, setPeriods] = useState([]);
  const [classes, setClasses] = useState(null);
  const [otherHalf, setOtherHalf] = useState([]);
  const [homework, setHomework] = useState(null);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    supabase.from('periods').select('*').order('period_number').then(({ data }) => setPeriods(data || []));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setClasses(null);
      const [{ data }, { data: oh }] = await Promise.all([
        supabase.from('student_class')
          .select(`classes(class_id, room, class_code, subjects(subject_name, display_name, subject_code), staff(first_name, last_name), timetable_slots(${LESSON_COLUMNS}))`)
          .eq('student_id', studentId),
        supabase.from('other_half_timetable').select('*').eq('student_id', studentId),
      ]);
      if (cancelled) return;
      setClasses((data || []).map((r) => r.classes).filter(Boolean));
      setOtherHalf(oh || []);
    })();
    return () => { cancelled = true; };
  }, [studentId]);

  useEffect(() => {
    let cancelled = false;
    setHomework(null);
    setSelected(null);
    supabase.rpc('homework_as_student', { p_student_id: studentId, p_from: weekStart, p_to: addDays(weekStart, 6) })
      .then(({ data }) => { if (!cancelled) setHomework(data || []); });
    return () => { cancelled = true; };
  }, [studentId, weekStart]);

  if (classes === null || homework === null) return <p>Loading…</p>;

  const cellMap = {};
  classes.forEach((c) => {
    (c.timetable_slots || []).forEach((slot) => {
      const key = `${slot.day_of_week}-${slot.period_number}`;
      const entry = {
        classId: c.class_id,
        subject: subjectOf(c),
        room: lessonRoom(slot, c),
        teacher: lessonTeacher(slot, c),
        time: formatTimeRange(slot.start_time, slot.end_time),
        isOtherHalfClass: isOtherHalfSubject(c.subjects),
      };
      cellMap[key] = cellMap[key] ? [...cellMap[key], entry] : [entry];
    });
  });
  mergeOtherHalfIntoCells(cellMap, otherHalf, (r) => ({
    subject: r.activity_name,
    room: r.room,
    teacher: r.staff_names,
    time: formatTimeRange(r.start_time, r.end_time),
  }));
  const unplaced = placeHomeworkInCells(cellMap, homework, periods);
  const selectedHw = homework.find((h) => h.homework_id === selected) || null;

  return (
    <>
      <h3 style={{ marginTop: '1rem' }}>Timetable</h3>
      <div style={{ overflowX: 'auto' }}>
        <div className="timetable-grid">
          <div className="tt-head"></div>
          {DAYS.map((d, i) => (
            <div key={d} className="tt-head">
              {shortDate(addDays(weekStart, i))}
              {(unplaced[d] || []).map((hw) => (
                <div key={hw.homework_id} style={{ marginTop: '0.25rem' }}>
                  <HomeworkChip hw={hw} selected={selected === hw.homework_id} onSelect={setSelected} />
                </div>
              ))}
            </div>
          ))}
          {periods.map((p) => (
            <Fragment key={p.period_number}>
              <div className="tt-cell tt-period-label">{p.period_name}</div>
              {DAYS.map((d) => {
                const entries = cellMap[`${d}-${p.period_number}`];
                return (
                  <div key={`${d}-${p.period_number}`} className={`tt-cell ${entries ? 'tt-filled' : ''}`}>
                    {entries ? entries.map((e, i) => (
                      <div key={i} style={{ marginBottom: entries.length > 1 ? '0.3rem' : 0 }}>
                        {e.subject}<br />
                        <span style={{ opacity: 0.6 }}>{e.room}{e.teacher ? ` · ${e.teacher}` : ''}</span><br />
                        <span style={{ opacity: 0.6, fontSize: '0.85em' }}>{e.time}</span>
                        {(e.homework || []).map((hw) => (
                          <div key={hw.homework_id} style={{ marginTop: '0.25rem' }}>
                            <HomeworkChip hw={hw} selected={selected === hw.homework_id} onSelect={setSelected} />
                          </div>
                        ))}
                      </div>
                    )) : ''}
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
      <HomeworkDetail hw={selectedHw} onClose={() => setSelected(null)} />
      <h3 style={{ marginTop: '1.25rem' }}>Homework</h3>
      <WeekCards homework={homework} weekStart={weekStart} selected={selected} onSelect={setSelected} />
    </>
  );
}

// ---- The page ---------------------------------------------------------------

function HomeworkMonitorInner() {
  const [years, setYears] = useState([]);
  const [year, setYear] = useState(null);
  const [students, setStudents] = useState([]);
  const [studentId, setStudentId] = useState('');
  const [filter, setFilter] = useState('');
  const [weekStart, setWeekStart] = useState(defaultWeekStart());

  // The year groups with homework switched on for at least one class.
  useEffect(() => {
    supabase.from('homework_classes').select('classes!inner(year_group)').then(({ data }) => {
      const ys = [...new Set((data || []).map((r) => r.classes?.year_group).filter((y) => y != null))].sort((a, b) => a - b);
      setYears(ys);
      setYear((y) => y ?? ys[0] ?? null);
    });
  }, []);

  useEffect(() => {
    setStudentId('');
    setFilter('');
    if (year == null) { setStudents([]); return; }
    supabase.from('students').select('student_id, first_name, last_name')
      .eq('year_group', year).eq('status', 'active')
      .order('last_name').order('first_name')
      .then(({ data }) => setStudents(data || []));
  }, [year]);

  const f = filter.trim().toLowerCase();
  const matching = f
    ? students.filter((s) => `${s.first_name} ${s.last_name}`.toLowerCase().includes(f) || `${s.last_name} ${s.first_name}`.toLowerCase().includes(f))
    : students;
  const student = students.find((s) => String(s.student_id) === studentId);

  return (
    <div className="card">
      <h2 style={{ margin: 0 }}>Homework Monitor</h2>
      <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem', color: 'var(--ink-soft)' }}>
        Homework as students see it. Choose a year group for every class&apos;s homework due in the week, with how far its marking has got, or a student
        for their timetable and Homework page, with their own Done ticks and released grades.
      </p>
      {years.length === 0 ? <p>No classes have homework switched on yet.</p> : (
        <>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '0.75rem' }}>
            <label>
              Year{' '}
              <select value={year ?? ''} onChange={(e) => setYear(Number(e.target.value))}>
                {years.map((y) => <option key={y} value={y}>Year {y}</option>)}
              </select>
            </label>
            <input
              type="search" placeholder="Find a student…" value={filter}
              onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: '14rem' }}
            />
            <label>
              Show{' '}
              <select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
                <option value="">Whole year</option>
                {student && !matching.includes(student) && (
                  <option value={studentId}>{student.last_name}, {student.first_name}</option>
                )}
                {matching.map((s) => (
                  <option key={s.student_id} value={String(s.student_id)}>{s.last_name}, {s.first_name}</option>
                ))}
              </select>
            </label>
          </div>
          <WeekPicker weekStart={weekStart} onChange={setWeekStart} />
          {year != null && (studentId
            ? <StudentWeek studentId={Number(studentId)} weekStart={weekStart} />
            : <YearWeek year={year} weekStart={weekStart} />)}
        </>
      )}
    </div>
  );
}

export default function HomeworkMonitorPage() {
  return (
    <RequireAuth>
      <RequireResource resourceKey="/homework/monitor">
        <HomeworkMonitorInner />
      </RequireResource>
    </RequireAuth>
  );
}
