'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';
import RequireResource from '../RequireResource';
import { LESSON_COLUMNS } from '../../lib/lessons';
import { formatUKDate } from '../../lib/formatDate';
import { schoolToday } from '../../lib/schoolTime';
import { OUTCOMES, loadAttachments, removeAttachment } from '../../lib/homework';
import { AttachmentList } from '../components/HomeworkAttachments';
import { Instructions } from '../components/HomeworkChip';
import HomeworkForm, { btnSmall, schemeLabel, classLabel } from '../components/HomeworkForm';

// Homework (migration 278, docs/homework-design.md): set homework for a class,
// with a deadline and a grading system, and record a grade for each student.
// Homework grades are outside reporting: nothing in reports, transcripts or
// result sets reads them.
//
// Which classes appear is decided by can_set_homework() in the database: the
// class teacher, the teacher of any single lesson of the class, the Head of
// Department and admins, and only for classes homework is switched on for
// (homework_classes, the pilot). RLS enforces the same rule on every save.

function MarkBook({ hw, cls, scheme, onBack, onChanged }) {
  const [students, setStudents] = useState([]);
  const [saved, setSaved] = useState({}); // student_id -> { grade, score, comment }
  const [rows, setRows] = useState({});
  const [released, setReleased] = useState(hw.marks_released);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [rowErrors, setRowErrors] = useState({});

  const values = scheme?.homework_scheme_values?.slice().sort((a, b) => a.sort_order - b.sort_order).map((v) => v.value) || [];
  const max = scheme?.kind === 'mark' ? Number(hw.out_of ?? scheme.fixed_max) : null;
  const withdrawn = hw.status === 'withdrawn';

  const load = useCallback(async () => {
    const [{ data: enrol }, { data: marks }] = await Promise.all([
      supabase.from('student_class').select('students(student_id, first_name, last_name, status)').eq('class_id', cls.class_id),
      supabase.from('homework_marks').select('student_id, grade, score, comment').eq('homework_id', hw.homework_id),
    ]);
    const byId = new Map();
    (enrol || []).map((e) => e.students).filter((s) => s && s.status === 'active').forEach((s) => byId.set(s.student_id, s));
    const missing = (marks || []).map((m) => m.student_id).filter((id) => !byId.has(id));
    if (missing.length) {
      const { data: extra } = await supabase.from('students').select('student_id, first_name, last_name, status').in('student_id', missing);
      (extra || []).forEach((s) => byId.set(s.student_id, { ...s, notInClass: true }));
    }
    setStudents([...byId.values()].sort((a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name)));
    const s = {};
    (marks || []).forEach((m) => {
      s[m.student_id] = { grade: m.grade || '', score: m.score == null ? '' : String(Number(m.score)), comment: m.comment || '' };
    });
    setSaved(s);
    setRows(s);
    setRowErrors({});
  }, [cls.class_id, hw.homework_id]);

  useEffect(() => { load(); }, [load]);

  function row(id) { return rows[id] || { grade: '', score: '', comment: '' }; }
  function setRow(id, patch) { setRows((r) => ({ ...r, [id]: { ...row(id), ...patch } })); }
  function isEmpty(r) { return !r.grade && r.score === ''; }
  function changed(id) {
    const a = row(id);
    const b = saved[id] || { grade: '', score: '', comment: '' };
    return a.grade !== b.grade || a.score !== b.score || a.comment !== b.comment;
  }
  const dirty = students.filter((s) => changed(s.student_id));
  const markedCount = students.filter((s) => saved[s.student_id]).length;

  function fillEmpty(value) {
    setRows((r) => {
      const next = { ...r };
      students.forEach((s) => {
        const cur = next[s.student_id] || { grade: '', score: '', comment: '' };
        if (isEmpty(cur) && !s.notInClass) next[s.student_id] = { ...cur, grade: value };
      });
      return next;
    });
  }

  async function saveMarks() {
    setBusy(true);
    setStatus(null);
    const errors = {};
    // One save per student, so one bad entry names that student instead of
    // failing everyone's.
    for (const s of dirty) {
      const r = row(s.student_id);
      let error;
      if (isEmpty(r)) {
        if (saved[s.student_id]) {
          ({ error } = await supabase.from('homework_marks').delete()
            .eq('homework_id', hw.homework_id).eq('student_id', s.student_id));
        }
      } else {
        const values = {
          grade: r.grade || null,
          score: r.grade ? null : Number(r.score),
          comment: r.comment.trim() || null,
        };
        // Update an existing mark rather than upsert: an upsert runs the
        // insert-time "is this student in the class" check, which would
        // refuse a correction for a student who has since left the class.
        ({ error } = saved[s.student_id]
          ? await supabase.from('homework_marks').update(values)
            .eq('homework_id', hw.homework_id).eq('student_id', s.student_id)
          : await supabase.from('homework_marks').insert({ homework_id: hw.homework_id, student_id: s.student_id, ...values }));
      }
      if (error) errors[s.student_id] = error.message;
    }
    setBusy(false);
    const failed = Object.keys(errors).length;
    await load();
    setRowErrors(errors);
    if (failed) {
      // Keep what the teacher typed for the rows that failed.
      setRows((cur) => {
        const next = { ...cur };
        dirty.forEach((s) => { if (errors[s.student_id]) next[s.student_id] = row(s.student_id); });
        return next;
      });
      setStatus(`${dirty.length - failed} saved, ${failed} not saved: see the rows marked below.`);
    } else {
      setStatus(dirty.length ? `Saved ${dirty.length} mark${dirty.length === 1 ? '' : 's'}.` : 'Nothing to save.');
    }
    onChanged();
  }

  async function toggleRelease() {
    setBusy(true);
    const { error } = await supabase.from('homework').update({ marks_released: !released }).eq('homework_id', hw.homework_id);
    setBusy(false);
    if (error) { setStatus(`Error: ${error.message}`); return; }
    setReleased(!released);
    onChanged();
  }

  return (
    <div className="card">
      <button type="button" className="secondary" onClick={onBack} style={btnSmall}>← Back to {cls.class_code}</button>
      <h2 style={{ marginBottom: '0.25rem' }}>{hw.title}</h2>
      <p style={{ margin: '0 0 0.5rem', color: 'var(--ink-soft)' }}>
        {classLabel(cls)} · due {formatUKDate(hw.due_on, { weekday: true })} · {schemeLabel(scheme, hw.out_of)} · {markedCount} of {students.length} marked
      </p>
      {withdrawn && <p style={{ color: '#a3232c' }}>This homework has been withdrawn, so it can&apos;t be marked. Restore it first.</p>}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', margin: '0.5rem 0 0.75rem' }}>
        {released
          ? <span className="badge badge-positive">Marks released: students can see their own grade</span>
          : <span className="badge" style={{ background: 'var(--slate-100)', color: 'var(--ink-soft)' }}>Marks not released: students can&apos;t see them yet</span>}
        <button type="button" className="secondary" style={btnSmall} onClick={toggleRelease} disabled={busy || withdrawn}>
          {released ? 'Hide marks again' : 'Release marks'}
        </button>
        {scheme?.kind === 'list' && values.includes('Complete') && (
          <button type="button" className="secondary" style={btnSmall} onClick={() => fillEmpty('Complete')} disabled={withdrawn}>
            Mark everyone left as Complete
          </button>
        )}
      </div>

      <div className="table-scroll"><table>
        <thead>
          <tr><th>Student</th><th>{scheme?.kind === 'mark' ? `Mark${max ? ` (out of ${max})` : ''}` : 'Grade'}</th><th>Comment for the student</th></tr>
        </thead>
        <tbody>
          {students.map((s) => {
            const r = row(s.student_id);
            return (
              <tr key={s.student_id} style={changed(s.student_id) ? { background: 'var(--yellow-100)' } : undefined}>
                <td>
                  {s.last_name}, {s.first_name}
                  {s.notInClass && <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>no longer in this class</div>}
                  {rowErrors[s.student_id] && <div style={{ fontSize: '0.8rem', color: '#a3232c' }}>{rowErrors[s.student_id]}</div>}
                </td>
                <td style={{ minWidth: '12rem' }}>
                  <div style={{ display: 'flex', gap: '0.35rem' }}>
                    {scheme?.kind === 'mark' && (
                      <input
                        type="number" min="0" max={max || undefined} step="any" inputMode="decimal"
                        value={r.grade ? '' : r.score} disabled={!!r.grade || withdrawn}
                        onChange={(e) => setRow(s.student_id, { score: e.target.value })}
                        style={{ width: '6rem' }} aria-label={`Mark for ${s.first_name} ${s.last_name}`}
                      />
                    )}
                    <select
                      value={r.grade} disabled={withdrawn}
                      onChange={(e) => setRow(s.student_id, { grade: e.target.value, ...(e.target.value ? { score: '' } : {}) })}
                      aria-label={`Grade for ${s.first_name} ${s.last_name}`}
                    >
                      <option value="">{scheme?.kind === 'mark' ? '—' : 'Not marked'}</option>
                      {scheme?.kind === 'list' && values.map((v) => <option key={v} value={v}>{v}</option>)}
                      {OUTCOMES.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                </td>
                <td>
                  <input
                    value={r.comment} maxLength={1000} disabled={withdrawn}
                    onChange={(e) => setRow(s.student_id, { comment: e.target.value })}
                    placeholder="Optional"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '0.75rem', flexWrap: 'wrap' }}>
        <button type="button" onClick={saveMarks} disabled={busy || dirty.length === 0 || withdrawn}>
          {busy ? 'Saving…' : `Save ${dirty.length || ''} change${dirty.length === 1 ? '' : 's'}`}
        </button>
        {status && <span>{status}</span>}
      </div>
      <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>
        Homework grades aren&apos;t part of reports. Every change is recorded in the grade history.
      </p>
    </div>
  );
}

function HomeworkInner() {
  const [classes, setClasses] = useState(null); // null = loading
  const [schemes, setSchemes] = useState([]);
  const [classId, setClassId] = useState(null);
  const [homework, setHomework] = useState([]);
  const [mode, setMode] = useState({ kind: 'list' }); // list | form (homework?) | marks (homework)
  const [roster, setRoster] = useState(0);
  const [markCounts, setMarkCounts] = useState({}); // homework_id -> marks recorded
  const pendingHomework = useRef(null);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    (async () => {
      const [{ data: pilot }, { data: sch }] = await Promise.all([
        supabase.from('homework_classes')
          .select(`classes(class_id, class_code, subject_id, year_group, staff_id, subjects(subject_name, display_name), timetable_slots(${LESSON_COLUMNS}))`),
        supabase.from('homework_schemes').select('*, homework_scheme_values(value, sort_order)').order('sort_order'),
      ]);
      setSchemes(sch || []);
      const all = (pilot || []).map((p) => p.classes).filter(Boolean);
      // The same check the database applies on every save.
      const allowed = await Promise.all(all.map((c) => supabase.rpc('can_set_homework', { p_class_id: c.class_id })));
      const mine = all.filter((c, i) => allowed[i].data === true).sort((a, b) => a.class_code.localeCompare(b.class_code));
      setClasses(mine);
      // ?class=…&homework=… (from the register's "Mark book" links).
      const params = new URLSearchParams(window.location.search);
      const wanted = mine.find((c) => String(c.class_id) === params.get('class'));
      if (wanted) setClassId(wanted.class_id);
      else if (mine.length === 1) setClassId(mine[0].class_id);
      pendingHomework.current = params.get('homework');
    })();
  }, []);

  const cls = (classes || []).find((c) => c.class_id === classId) || null;

  const loadHomework = useCallback(async () => {
    if (!classId) { setHomework([]); return; }
    const [{ data }, { data: enrol }] = await Promise.all([
      supabase.from('homework').select('*').eq('class_id', classId)
        .order('due_on', { ascending: false }).order('homework_id', { ascending: false }),
      supabase.from('student_class').select('students(status)').eq('class_id', classId),
    ]);
    const ids = (data || []).map((h) => h.homework_id);
    const { data: marks } = ids.length
      ? await supabase.from('homework_marks').select('homework_id').in('homework_id', ids)
      : { data: [] };
    const counts = {};
    (marks || []).forEach((m) => { counts[m.homework_id] = (counts[m.homework_id] || 0) + 1; });
    setMarkCounts(counts);
    setHomework(data || []);
    setRoster((enrol || []).filter((e) => e.students?.status === 'active').length);
  }, [classId]);

  useEffect(() => { loadHomework(); setMode({ kind: 'list' }); setStatus(null); }, [loadHomework]);

  // Open the mark book asked for in the URL once its class's homework is loaded.
  useEffect(() => {
    if (!pendingHomework.current) return;
    const hw = homework.find((h) => String(h.homework_id) === pendingHomework.current);
    if (hw) { pendingHomework.current = null; setMode({ kind: 'marks', homework: hw }); }
  }, [homework]);

  const schemeFor = (hw) => schemes.find((s) => s.scheme_id === hw.scheme_id);
  const marksOf = (hw) => markCounts[hw.homework_id] || 0;

  async function setWithdrawn(hw, withdrawn) {
    const { error } = await supabase.from('homework').update({ status: withdrawn ? 'withdrawn' : 'set' }).eq('homework_id', hw.homework_id);
    setStatus(error ? `Error: ${error.message}` : withdrawn ? `"${hw.title}" withdrawn: students no longer see it.` : `"${hw.title}" restored.`);
    loadHomework();
  }

  async function remove(hw) {
    if (!window.confirm(`Delete "${hw.title}"? This can't be undone.`)) return;
    // Files first: once the homework (and so its attachment rows) is gone,
    // nobody could see or remove them.
    for (const att of await loadAttachments(hw.homework_id)) {
      const e = await removeAttachment(att);
      if (e) { setStatus(`Error removing ${att.title}: ${e.message}`); return; }
    }
    const { error } = await supabase.from('homework').delete().eq('homework_id', hw.homework_id);
    setStatus(error ? `Error: ${error.message}` : `"${hw.title}" deleted.`);
    loadHomework();
  }

  const today = schoolToday();

  return (
    <div>
      <h1>Homework</h1>
      <p style={{ color: 'var(--ink-soft)' }}>
        Set homework for a class and record a grade for each student. Students see it on their timetable and
        Homework page, and see their own grade once you release the marks. Homework grades aren&apos;t part of reports.
      </p>

      {classes === null ? <p>Loading…</p> : classes.length === 0 ? (
        <div className="card"><p>Homework isn&apos;t switched on for any of your classes yet.</p></div>
      ) : (
        <div className="card" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <strong style={{ marginRight: '0.25rem' }}>Class</strong>
          {classes.map((c) => (
            <button key={c.class_id} type="button" className={c.class_id === classId ? '' : 'secondary'} onClick={() => setClassId(c.class_id)}>
              {classLabel(c)}
            </button>
          ))}
        </div>
      )}

      {cls && mode.kind === 'form' && (
        <HomeworkForm
          key={mode.homework?.homework_id || 'new'}
          cls={cls} schemes={schemes} existing={mode.homework} markCount={mode.homework ? marksOf(mode.homework) : 0}
          onCancel={() => setMode({ kind: 'list' })}
          onSaved={(msg) => { setStatus(msg || (mode.homework ? 'Homework updated.' : 'Homework set.')); setMode({ kind: 'list' }); loadHomework(); }}
        />
      )}

      {cls && mode.kind === 'marks' && (
        <MarkBook
          hw={mode.homework} cls={cls} scheme={schemeFor(mode.homework)}
          onBack={() => setMode({ kind: 'list' })} onChanged={loadHomework}
        />
      )}

      {cls && mode.kind === 'list' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>{classLabel(cls)}</h2>
            <button type="button" onClick={() => setMode({ kind: 'form' })}>Set homework</button>
          </div>
          {status && <p>{status}</p>}
          {homework.length === 0 ? <p>No homework set for this class yet.</p> : (
            <div className="table-scroll"><table>
              <thead><tr><th>Due</th><th>Homework</th><th>Graded as</th><th>Marked</th><th></th></tr></thead>
              <tbody>
                {homework.map((hw) => {
                  const lesson = (cls.timetable_slots || []).find((s) => s.slot_id === hw.due_slot_id);
                  const withdrawn = hw.status === 'withdrawn';
                  const n = marksOf(hw);
                  return (
                    <tr key={hw.homework_id} style={withdrawn ? { opacity: 0.55 } : undefined}>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {formatUKDate(hw.due_on, { weekday: true })}
                        <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>
                          {lesson ? `Lesson ${lesson.period_number}` : 'End of day'}
                          {!withdrawn && hw.due_on < today && n < roster ? ' · past due' : ''}
                        </div>
                      </td>
                      <td>
                        <strong>{hw.title}</strong>{withdrawn && <span className="badge badge-negative" style={{ marginLeft: '0.4rem' }}>withdrawn</span>}
                        <details style={{ fontSize: '0.85rem' }}>
                          <summary>Instructions and resources</summary>
                          {hw.instructions ? <Instructions text={hw.instructions} /> : <p style={{ margin: '0.3rem 0' }}>No instructions.</p>}
                          <AttachmentList homeworkId={hw.homework_id} />
                        </details>
                      </td>
                      <td>{schemeLabel(schemeFor(hw), hw.out_of)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {n} / {roster}
                        <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>{hw.marks_released ? 'released' : 'not released'}</div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                          <button type="button" style={btnSmall} onClick={() => setMode({ kind: 'marks', homework: hw })}>Mark book</button>
                          {!withdrawn && <button type="button" className="secondary" style={btnSmall} onClick={() => setMode({ kind: 'form', homework: hw })}>Edit</button>}
                          <button type="button" className="secondary" style={btnSmall} onClick={() => setWithdrawn(hw, !withdrawn)}>{withdrawn ? 'Restore' : 'Withdraw'}</button>
                          {n === 0 && <button type="button" className="secondary" style={btnSmall} onClick={() => remove(hw)}>Delete</button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          )}
        </div>
      )}
    </div>
  );
}

export default function HomeworkPage() {
  return (
    <RequireAuth>
      <RequireResource resourceKey="/homework">
        <HomeworkInner />
      </RequireResource>
    </RequireAuth>
  );
}
