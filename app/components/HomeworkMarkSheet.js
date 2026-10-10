'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { formatUKDate } from '../../lib/formatDate';
import { schoolToday } from '../../lib/schoolTime';
import { gradeFromBoundaries } from '../../lib/homework';
import {
  loadClassworkColumns, loadClassworkMarks, setWorksheetMaxMark, saveClassworkMark, resetCardSortMark,
} from '../../lib/cardSorts';

// A class's homework marks over a period: one row per student, one column per
// homework, with each student's average (the principal, 30 Sept 2026). The
// database only returns marks to those allowed to see this class's grades
// (can_view_homework_marks()); this page adds nothing to that. Outside
// reporting like every homework grade.
//
// Classwork columns (migration 432): every worksheet put on the class's
// lessons in the dates, after the homework. A card sort's mark comes from the
// students' one check; other worksheets are marked here by the class's
// teachers once "out of" is set. Classwork never counts in the homework
// average, the report or prep time.

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const SHORT = { 'Not handed in': 'NHI', Excused: 'Exc' };

export default function HomeworkMarkSheet({ cls, schemes, onOpenMarkBook, onBack }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [homework, setHomework] = useState([]);
  const [students, setStudents] = useState([]);
  const [marks, setMarks] = useState({}); // `${homework_id}:${student_id}` -> mark
  const [boundaries, setBoundaries] = useState([]);
  const [classwork, setClasswork] = useState([]); // worksheet columns
  const [cwMarks, setCwMarks] = useState({}); // `${worksheet_id}:${student_id}` -> mark
  const [canMarkClasswork, setCanMarkClasswork] = useState(false);
  const [cwStatus, setCwStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  // Default period: the current term (or the most recent one started).
  useEffect(() => {
    (async () => {
      const today = schoolToday();
      const { data } = await supabase.from('terms').select('start_date, end_date')
        .lte('start_date', today).order('start_date', { ascending: false }).limit(1);
      setFrom(data?.[0]?.start_date || today);
      setTo(data?.[0]?.end_date || today);
    })();
  }, []);

  const load = useCallback(async () => {
    if (!from || !to) return;
    setLoading(true);
    const [{ data: hw }, { data: enrol }, { data: b }] = await Promise.all([
      supabase.from('homework').select('homework_id, title, due_on, scheme_id, out_of, status, marks_released, class_id, subject_id, year_group, instructions, due_slot_id')
        .eq('class_id', cls.class_id).eq('status', 'set')
        .gte('due_on', from).lte('due_on', to)
        .order('due_on').order('homework_id'),
      supabase.from('student_class').select('joined_on, students(student_id, first_name, last_name, status)').eq('class_id', cls.class_id),
      supabase.from('subject_grade_boundaries').select('grade, min_score')
        .eq('subject_id', cls.subject_id).eq('year_group', cls.year_group),
    ]);
    const list = hw || [];
    const ids = list.map((h) => h.homework_id);
    const [cols, { data: canCw }] = await Promise.all([
      loadClassworkColumns(cls.class_id, from, to),
      supabase.rpc('can_add_lesson_worksheet', { p_class_id: cls.class_id }),
    ]);
    const cwm = await loadClassworkMarks(cls.class_id, [...new Set(cols.map((c) => c.worksheet_id))]);
    const { data: m } = ids.length
      ? await supabase.from('homework_marks').select('homework_id, student_id, grade, score').in('homework_id', ids)
      : { data: [] };
    const byStudent = new Map();
    (enrol || []).filter((e) => e.students && e.students.status === 'active')
      .forEach((e) => byStudent.set(e.students.student_id, { ...e.students, joined_on: e.joined_on }));
    const missing = [...new Set([...(m || []), ...cwm].map((x) => x.student_id))].filter((id) => !byStudent.has(id));
    if (missing.length) {
      const { data: extra } = await supabase.from('students').select('student_id, first_name, last_name, status').in('student_id', missing);
      (extra || []).forEach((s) => byStudent.set(s.student_id, { ...s, notInClass: true }));
    }
    setHomework(list);
    setStudents([...byStudent.values()].sort((a, c) => a.last_name.localeCompare(c.last_name) || a.first_name.localeCompare(c.first_name)));
    setMarks(Object.fromEntries((m || []).map((x) => [`${x.homework_id}:${x.student_id}`, x])));
    setBoundaries(b || []);
    setClasswork(cols);
    setCwMarks(Object.fromEntries(cwm.map((x) => [`${x.worksheet_id}:${x.student_id}`, x])));
    setCanMarkClasswork(!!canCw);
    setLoading(false);
  }, [cls.class_id, cls.subject_id, cls.year_group, from, to]);

  useEffect(() => { load(); }, [load]);

  const schemeOf = (h) => schemes.find((s) => s.scheme_id === h.scheme_id);
  const maxOf = (h) => Number(h.out_of ?? schemeOf(h)?.fixed_max);

  function cell(h, s) {
    const m = marks[`${h.homework_id}:${s.student_id}`];
    // Due before the student joined the class (migration 298): not theirs.
    if (!m && s.joined_on && h.due_on < s.joined_on) return { text: '', kind: 'before', title: 'Joined the class after this was due' };
    if (!m) return { text: '', kind: 'none' };
    if (SHORT[m.grade]) return { text: SHORT[m.grade], title: m.grade, kind: m.grade === 'Excused' ? 'excused' : 'missing' };
    if (m.score != null) {
      const mark = schemeOf(h)?.name === 'Percentage' ? `${Number(m.score)}%` : `${Number(m.score)}/${maxOf(h)}`;
      return { text: m.grade ? `${mark} · ${m.grade}` : mark, kind: 'mark', pct: (Number(m.score) / maxOf(h)) * 100 };
    }
    return { text: m.grade || '', kind: 'grade' };
  }

  // Per student: the average of their marked (number) homework, how many were
  // marked, and how many weren't handed in.
  function summary(s) {
    const cells = homework.map((h) => cell(h, s));
    const pcts = cells.filter((c) => c.kind === 'mark').map((c) => c.pct);
    const avg = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null;
    return {
      avg,
      grade: avg == null ? null : gradeFromBoundaries(avg, boundaries),
      marked: cells.filter((c) => c.kind !== 'none' && c.kind !== 'before').length,
      of: cells.filter((c) => c.kind !== 'before').length,
      missing: cells.filter((c) => c.kind === 'missing').length,
    };
  }

  const nameOf = (id) => { const st = students.find((x) => x.student_id === id); return st ? `${st.first_name} ${st.last_name}` : 'a classmate'; };

  async function reloadClassworkMarks() {
    const cwm = await loadClassworkMarks(cls.class_id, [...new Set(classwork.map((c) => c.worksheet_id))]);
    setCwMarks(Object.fromEntries(cwm.map((x) => [`${x.worksheet_id}:${x.student_id}`, x])));
  }

  async function setOutOf(w) {
    const v = window.prompt(`What is "${w.title}" marked out of? (Leave empty if it isn't marked.)`, w.max_mark == null ? '' : String(Number(w.max_mark)));
    if (v === null) return;
    const n = v.trim() === '' ? null : Number(v);
    if (n !== null && !(n > 0)) { setCwStatus('The out-of mark must be a number above 0.'); return; }
    setCwStatus(null);
    const error = await setWorksheetMaxMark(w.worksheet_id, n);
    if (error) setCwStatus(error.message); else load();
  }

  async function saveCw(w, st, value) {
    const existing = cwMarks[`${w.worksheet_id}:${st.student_id}`];
    const v = value.trim();
    if (v === (existing ? String(Number(existing.score)) : '')) return;
    if (v !== '' && !(Number(v) >= 0 && Number(v) <= Number(w.max_mark))) {
      setCwStatus(`${st.first_name}'s mark must be between 0 and ${Number(w.max_mark)}.`);
      return;
    }
    setCwStatus(null);
    const error = await saveClassworkMark({ worksheetId: w.worksheet_id, classId: cls.class_id, studentId: st.student_id, existing, score: v });
    if (error) setCwStatus(error.message);
    reloadClassworkMarks();
  }

  async function resetCardSort(w, st) {
    const mark = cwMarks[`${w.worksheet_id}:${st.student_id}`];
    if (!mark) return;
    const partner = mark.partner_student_id ? cwMarks[`${w.worksheet_id}:${mark.partner_student_id}`] : null;
    const who = partner ? `${st.first_name} and ${nameOf(mark.partner_student_id)}` : st.first_name;
    if (!window.confirm(`Remove this card sort mark so ${who} can do it again?`)) return;
    const error = await resetCardSortMark(mark, partner);
    if (error) setCwStatus(error.message);
    reloadClassworkMarks();
  }

  function cwCell(w, st) {
    const m = cwMarks[`${w.worksheet_id}:${st.student_id}`];
    if (w.kind === 'card_sort') {
      if (!m) return <td key={`cw${w.worksheet_id}`} className="hw-sheet-cell hw-sheet-none">—</td>;
      const title = [m.partner_student_id ? `With ${nameOf(m.partner_student_id)}` : 'On their own', m.used_help ? 'used Help me start' : null]
        .filter(Boolean).join(' · ');
      return (
        <td key={`cw${w.worksheet_id}`} className="hw-sheet-cell hw-sheet-mark" title={title}>
          {Number(m.score)}/{Number(m.out_of)}{m.used_help ? ' (h)' : ''}
          {canMarkClasswork && (
            <button type="button" className="cw-reset" onClick={() => resetCardSort(w, st)} title="Let them do it again">↺</button>
          )}
        </td>
      );
    }
    if (w.max_mark == null) {
      return <td key={`cw${w.worksheet_id}`} className="hw-sheet-cell hw-sheet-none">{m ? `${Number(m.score)}` : '—'}</td>;
    }
    if (!canMarkClasswork) {
      return <td key={`cw${w.worksheet_id}`} className="hw-sheet-cell hw-sheet-mark">{m ? `${Number(m.score)}/${Number(m.out_of)}` : '—'}</td>;
    }
    return (
      <td key={`cw${w.worksheet_id}`} className="hw-sheet-cell">
        <input
          key={`${w.worksheet_id}:${st.student_id}:${m ? m.score : ''}`}
          className="cw-input" inputMode="decimal" defaultValue={m ? String(Number(m.score)) : ''}
          aria-label={`${st.first_name} ${st.last_name}, ${w.title}`}
          onBlur={(e) => saveCw(w, st, e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        />
      </td>
    );
  }

  function downloadCsv() {
    const header = ['Student', ...homework.map((h) => `${h.title} (${formatUKDate(h.due_on)})`), 'Average %', 'Average grade', 'Marked', 'Not handed in',
      ...classwork.map((w) => `Classwork: ${w.title} (${formatUKDate(w.lesson_date)})`)];
    const lines = students.map((s) => {
      const sum = summary(s);
      return [
        `${s.last_name}, ${s.first_name}`,
        ...homework.map((h) => { const c = cell(h, s); return c.title || c.text; }),
        sum.avg == null ? '' : Math.round(sum.avg), sum.grade || '', `${sum.marked}/${sum.of}`, sum.missing,
        ...classwork.map((w) => { const m = cwMarks[`${w.worksheet_id}:${s.student_id}`]; return m ? `${Number(m.score)}/${Number(m.out_of)}` : ''; }),
      ].map(csvCell).join(',');
    });
    const blob = new Blob([[header.map(csvCell).join(','), ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `marks-${cls.class_code.replace(/[^\w-]+/g, '_')}-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Mark book · {cls.class_code}</h2>
        <button type="button" className="secondary" onClick={onBack}>← Back to homework</button>
      </div>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap', margin: '0.75rem 0' }}>
        <label style={{ flex: '0 1 11rem' }}>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label style={{ flex: '0 1 11rem' }}>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button type="button" className="secondary" onClick={downloadCsv} disabled={loading || (homework.length === 0 && classwork.length === 0)}>Download CSV</button>
      </div>
      <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: 'var(--ink-soft)' }}>
        Homework due between {from ? formatUKDate(from) : '…'} and {to ? formatUKDate(to) : '…'}. The average covers homework marked with a number,
        and its grade comes from the subject&apos;s grade boundaries. NHI = not handed in, Exc = excused, · = due before the student joined the class. Click a homework to enter its marks.
        {' '}Classwork columns are the worksheets and card sorts put on this class&apos;s lessons; they never count in the homework average or the report.
        {' '}A card sort is marked by the students&apos; one check (h = used Help me start; ↺ lets a pair do it again). For a worksheet, set what it is out of, then type the marks.
      </p>
      {cwStatus && <p style={{ color: '#a3232c', margin: '0 0 0.5rem' }}>{cwStatus}</p>}
      {loading ? <p>Loading…</p> : homework.length === 0 && classwork.length === 0 ? (
        <p>No homework or classwork for this class in these dates.</p>
      ) : (
        <div className="table-scroll"><table className="hw-sheet">
          <thead>
            <tr>
              <th className="hw-sheet-name">Student</th>
              {homework.map((h) => (
                <th key={h.homework_id} className="hw-sheet-hw">
                  <button type="button" className="hw-sheet-link" onClick={() => onOpenMarkBook(h)} title={`Enter the marks for ${h.title}`}>
                    {/* Titles are at most 10 characters (migration 290); older ones are cut. */}
                    {h.title.length > 10 ? `${h.title.slice(0, 10)}…` : h.title}
                  </button>
                  <div className="hw-sheet-due">{formatUKDate(h.due_on).replace(/ \d{4}$/, '')}</div>
                </th>
              ))}
              <th>Average</th>
              <th>Marked</th>
              <th>NHI</th>
              {classwork.map((w, i) => (
                <th key={`cw${w.worksheet_id}`} className={`hw-sheet-hw cw-col${i === 0 ? ' cw-first' : ''}`}>
                  {i === 0 && <div className="cw-group">Classwork</div>}
                  <span title={w.title}>{w.kind === 'card_sort' ? '🃏' : '📄'} {w.title.length > 12 ? `${w.title.slice(0, 12)}…` : w.title}</span>
                  <div className="hw-sheet-due">{formatUKDate(w.lesson_date).replace(/ \d{4}$/, '')}</div>
                  {w.kind === 'file' && (canMarkClasswork ? (
                    <button type="button" className="hw-sheet-link cw-outof" onClick={() => setOutOf(w)}>
                      {w.max_mark == null ? 'Set out of' : `out of ${Number(w.max_mark)}`}
                    </button>
                  ) : w.max_mark != null && <div className="hw-sheet-due">out of {Number(w.max_mark)}</div>)}
                  {w.kind === 'card_sort' && w.card_out_of != null && <div className="hw-sheet-due">out of {w.card_out_of}</div>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {students.map((s) => {
              const sum = summary(s);
              return (
                <tr key={s.student_id}>
                  <td className="hw-sheet-name">
                    {s.last_name}, {s.first_name}
                    {s.notInClass && <div style={{ fontSize: '0.75rem', color: 'var(--ink-soft)' }}>no longer in this class</div>}
                  </td>
                  {homework.map((h) => {
                    const c = cell(h, s);
                    return <td key={h.homework_id} className={`hw-sheet-cell hw-sheet-${c.kind}`} title={c.title}>{c.kind === 'before' ? '·' : (c.text || '—')}</td>;
                  })}
                  <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>
                    {sum.avg == null ? '—' : `${Math.round(sum.avg)}%${sum.grade ? ` · ${sum.grade}` : ''}`}
                  </td>
                  <td>{sum.marked}/{sum.of}</td>
                  <td className={sum.missing ? 'hw-sheet-missing' : undefined}>{sum.missing}</td>
                  {classwork.map((w) => cwCell(w, s))}
                </tr>
              );
            })}
          </tbody>
        </table></div>
      )}
    </div>
  );
}
