'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { formatUKDate } from '../../lib/formatDate';
import { schoolToday } from '../../lib/schoolTime';
import { gradeFromBoundaries } from '../../lib/homework';

// A class's homework marks over a period: one row per student, one column per
// homework, with each student's average (the principal, 30 Sept 2026). The
// database only returns marks to those allowed to see this class's grades
// (can_view_homework_marks()); this page adds nothing to that. Outside
// reporting like every homework grade.

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
      supabase.from('student_class').select('students(student_id, first_name, last_name, status)').eq('class_id', cls.class_id),
      supabase.from('subject_grade_boundaries').select('grade, min_score')
        .eq('subject_id', cls.subject_id).eq('year_group', cls.year_group),
    ]);
    const list = hw || [];
    const ids = list.map((h) => h.homework_id);
    const { data: m } = ids.length
      ? await supabase.from('homework_marks').select('homework_id, student_id, grade, score').in('homework_id', ids)
      : { data: [] };
    const byStudent = new Map();
    (enrol || []).map((e) => e.students).filter((s) => s && s.status === 'active').forEach((s) => byStudent.set(s.student_id, s));
    const missing = [...new Set((m || []).map((x) => x.student_id))].filter((id) => !byStudent.has(id));
    if (missing.length) {
      const { data: extra } = await supabase.from('students').select('student_id, first_name, last_name, status').in('student_id', missing);
      (extra || []).forEach((s) => byStudent.set(s.student_id, { ...s, notInClass: true }));
    }
    setHomework(list);
    setStudents([...byStudent.values()].sort((a, c) => a.last_name.localeCompare(c.last_name) || a.first_name.localeCompare(c.first_name)));
    setMarks(Object.fromEntries((m || []).map((x) => [`${x.homework_id}:${x.student_id}`, x])));
    setBoundaries(b || []);
    setLoading(false);
  }, [cls.class_id, cls.subject_id, cls.year_group, from, to]);

  useEffect(() => { load(); }, [load]);

  const schemeOf = (h) => schemes.find((s) => s.scheme_id === h.scheme_id);
  const maxOf = (h) => Number(h.out_of ?? schemeOf(h)?.fixed_max);

  function cell(h, s) {
    const m = marks[`${h.homework_id}:${s.student_id}`];
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
      marked: cells.filter((c) => c.kind !== 'none').length,
      missing: cells.filter((c) => c.kind === 'missing').length,
    };
  }

  function downloadCsv() {
    const header = ['Student', ...homework.map((h) => `${h.title} (${h.due_on})`), 'Average %', 'Average grade', 'Marked', 'Not handed in'];
    const lines = students.map((s) => {
      const sum = summary(s);
      return [
        `${s.last_name}, ${s.first_name}`,
        ...homework.map((h) => { const c = cell(h, s); return c.title || c.text; }),
        sum.avg == null ? '' : Math.round(sum.avg), sum.grade || '', `${sum.marked}/${homework.length}`, sum.missing,
      ].map(csvCell).join(',');
    });
    const blob = new Blob([[header.map(csvCell).join(','), ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `homework-${cls.class_code.replace(/[^\w-]+/g, '_')}-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Mark sheet · {cls.class_code}</h2>
        <button type="button" className="secondary" onClick={onBack}>← Back to homework</button>
      </div>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap', margin: '0.75rem 0' }}>
        <label style={{ flex: '0 1 11rem' }}>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label style={{ flex: '0 1 11rem' }}>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button type="button" className="secondary" onClick={downloadCsv} disabled={loading || homework.length === 0}>Download CSV</button>
      </div>
      <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: 'var(--ink-soft)' }}>
        Homework due between {from ? formatUKDate(from) : '…'} and {to ? formatUKDate(to) : '…'}. The average covers homework marked with a number,
        and its grade comes from the subject&apos;s grade boundaries. NHI = not handed in, Exc = excused. Click a homework to open its mark book.
      </p>
      {loading ? <p>Loading…</p> : homework.length === 0 ? (
        <p>No homework is due for this class in these dates.</p>
      ) : (
        <div className="table-scroll"><table className="hw-sheet">
          <thead>
            <tr>
              <th className="hw-sheet-name">Student</th>
              {homework.map((h) => (
                <th key={h.homework_id} className="hw-sheet-hw">
                  <button type="button" className="hw-sheet-link" onClick={() => onOpenMarkBook(h)} title={`Open the mark book for ${h.title}`}>
                    {/* Titles are at most 10 characters (migration 290); older ones are cut. */}
                    {h.title.length > 10 ? `${h.title.slice(0, 10)}…` : h.title}
                  </button>
                  <div className="hw-sheet-due">{formatUKDate(h.due_on).replace(/ \d{4}$/, '')}</div>
                </th>
              ))}
              <th>Average</th>
              <th>Marked</th>
              <th>NHI</th>
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
                    return <td key={h.homework_id} className={`hw-sheet-cell hw-sheet-${c.kind}`} title={c.title}>{c.text || '—'}</td>;
                  })}
                  <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>
                    {sum.avg == null ? '—' : `${Math.round(sum.avg)}%${sum.grade ? ` · ${sum.grade}` : ''}`}
                  </td>
                  <td>{sum.marked}/{homework.length}</td>
                  <td className={sum.missing ? 'hw-sheet-missing' : undefined}>{sum.missing}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      )}
    </div>
  );
}
