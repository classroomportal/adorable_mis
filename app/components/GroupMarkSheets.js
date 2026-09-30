'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { formatUKDate } from '../../lib/formatDate';
import { schoolToday } from '../../lib/schoolTime';
import { schemeLabel, btnSmall } from './HomeworkForm';

// Mark sheets for a student group (migration 287): a test or occasion, a
// date and a grading system (homework's list), then a mark for each student.
// Outside reporting: nothing in reports, transcripts or result sets reads
// them. The group's own staff and those who manage groups record and read
// marks (can_mark_student_group() in the database); other staff see only that
// a sheet exists. Every change is logged in Grade History.

// Fit any grading system (student_group_marks_check()).
export const GROUP_MARK_OUTCOMES = ['Absent', 'Not handed in', 'Excused'];

function MarkBook({ sheet, scheme, members, archived, onBack, onChanged }) {
  const [saved, setSaved] = useState({}); // student_id -> { grade, score, comment }
  const [rows, setRows] = useState({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [rowErrors, setRowErrors] = useState({});

  const values = scheme?.homework_scheme_values?.slice().sort((a, b) => a.sort_order - b.sort_order).map((v) => v.value) || [];
  const max = scheme?.kind === 'mark' ? Number(sheet.out_of ?? scheme.fixed_max) : null;
  const locked = sheet.status === 'withdrawn' || archived;

  const load = useCallback(async () => {
    const { data } = await supabase.from('student_group_marks').select('student_id, grade, score, comment').eq('sheet_id', sheet.sheet_id);
    const s = {};
    (data || []).forEach((m) => {
      s[m.student_id] = { grade: m.grade || '', score: m.score == null ? '' : String(Number(m.score)), comment: m.comment || '' };
    });
    setSaved(s);
    setRows(s);
    setRowErrors({});
  }, [sheet.sheet_id]);

  useEffect(() => { load(); }, [load]);

  // Current members, plus anyone marked who has since left or been taken out.
  const students = members
    .filter((m) => m.students?.status === 'active' || saved[m.student_id])
    .map((m) => ({ student_id: m.student_id, ...m.students }));

  const row = (id) => rows[id] || { grade: '', score: '', comment: '' };
  const setRow = (id, patch) => setRows((r) => ({ ...r, [id]: { ...row(id), ...patch } }));
  const isEmpty = (r) => !r.grade && r.score === '';
  function changed(id) {
    const a = row(id);
    const b = saved[id] || { grade: '', score: '', comment: '' };
    return a.grade !== b.grade || a.score !== b.score || a.comment !== b.comment;
  }
  const dirty = students.filter((s) => changed(s.student_id));
  const markedCount = students.filter((s) => saved[s.student_id]).length;

  async function saveMarks() {
    setBusy(true);
    setStatus(null);
    const errors = {};
    // One save per student, so one bad entry names that student.
    for (const s of dirty) {
      const r = row(s.student_id);
      let error;
      if (isEmpty(r)) {
        if (saved[s.student_id]) {
          ({ error } = await supabase.from('student_group_marks').delete().eq('sheet_id', sheet.sheet_id).eq('student_id', s.student_id));
        }
      } else {
        const v = { grade: r.grade || null, score: r.grade ? null : Number(r.score), comment: r.comment.trim() || null };
        ({ error } = saved[s.student_id]
          ? await supabase.from('student_group_marks').update(v).eq('sheet_id', sheet.sheet_id).eq('student_id', s.student_id)
          : await supabase.from('student_group_marks').insert({ sheet_id: sheet.sheet_id, student_id: s.student_id, ...v }));
      }
      if (error) errors[s.student_id] = error.message;
    }
    setBusy(false);
    const failed = Object.keys(errors).length;
    await load();
    setRowErrors(errors);
    if (failed) {
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

  return (
    <div className="card">
      <button type="button" className="secondary" onClick={onBack} style={btnSmall}>← All mark sheets</button>
      <h3 style={{ marginBottom: '0.25rem' }}>{sheet.title}</h3>
      <p style={{ margin: '0 0 0.5rem', color: 'var(--ink-soft)' }}>
        {formatUKDate(sheet.marked_on)} · {schemeLabel(scheme, sheet.out_of)} · {markedCount} of {students.length} marked
      </p>
      {sheet.status === 'withdrawn' && <p style={{ color: '#a3232c' }}>This sheet has been withdrawn, so it can&apos;t be marked.</p>}
      {archived && <p style={{ color: '#a3232c' }}>This group is archived, so its marks can&apos;t be changed.</p>}

      <div className="table-scroll"><table>
        <thead>
          <tr><th>Student</th><th>{scheme?.kind === 'mark' ? `Mark${max ? ` (out of ${max})` : ''}` : 'Grade'}</th><th>Comment</th></tr>
        </thead>
        <tbody>
          {students.map((s) => {
            const r = row(s.student_id);
            return (
              <tr key={s.student_id} style={changed(s.student_id) ? { background: 'var(--yellow-100)' } : undefined}>
                <td>
                  {s.last_name}, {s.first_name}
                  {s.status !== 'active' && <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>has left</div>}
                  {rowErrors[s.student_id] && <div style={{ fontSize: '0.8rem', color: '#a3232c' }}>{rowErrors[s.student_id]}</div>}
                </td>
                <td style={{ minWidth: '12rem' }}>
                  <div style={{ display: 'flex', gap: '0.35rem' }}>
                    {scheme?.kind === 'mark' && (
                      <input
                        type="number" min="0" max={max || undefined} step="any" inputMode="decimal"
                        value={r.grade ? '' : r.score} disabled={!!r.grade || locked}
                        onChange={(e) => setRow(s.student_id, { score: e.target.value })}
                        style={{ width: '6rem' }} aria-label={`Mark for ${s.first_name} ${s.last_name}`}
                      />
                    )}
                    <select
                      value={r.grade} disabled={locked}
                      onChange={(e) => setRow(s.student_id, { grade: e.target.value, ...(e.target.value ? { score: '' } : {}) })}
                      aria-label={`Grade for ${s.first_name} ${s.last_name}`}
                    >
                      <option value="">{scheme?.kind === 'mark' ? '—' : 'Not marked'}</option>
                      {scheme?.kind === 'list' && values.map((v) => <option key={v} value={v}>{v}</option>)}
                      {GROUP_MARK_OUTCOMES.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                </td>
                <td>
                  <input value={r.comment} maxLength={1000} disabled={locked} placeholder="Optional"
                    onChange={(e) => setRow(s.student_id, { comment: e.target.value })} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '0.75rem', flexWrap: 'wrap' }}>
        <button type="button" onClick={saveMarks} disabled={busy || dirty.length === 0 || locked}>
          {busy ? 'Saving…' : `Save ${dirty.length || ''} change${dirty.length === 1 ? '' : 's'}`}
        </button>
        {status && <span>{status}</span>}
      </div>
      <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>
        Group marks aren&apos;t part of reports, and students and parents don&apos;t see them. Every change is recorded in the grade history.
      </p>
    </div>
  );
}

export default function GroupMarkSheets({ groupId, canMark, archived, members }) {
  const [sheets, setSheets] = useState(null);
  const [schemes, setSchemes] = useState([]);
  const [counts, setCounts] = useState({}); // sheet_id -> marks recorded (only when canMark)
  const [open, setOpen] = useState(null); // sheet being marked
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ title: '', marked_on: schoolToday(), scheme_id: '', out_of: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const [{ data: sh, error: err }, { data: sc }] = await Promise.all([
      supabase.from('student_group_mark_sheets').select('*').eq('group_id', groupId).order('marked_on', { ascending: false }).order('sheet_id', { ascending: false }),
      supabase.from('homework_schemes').select('*, homework_scheme_values(value, sort_order)').order('sort_order'),
    ]);
    if (err) { setError(err.message); return; }
    setSheets(sh || []);
    setSchemes(sc || []);
    if (canMark && (sh || []).length) {
      const { data: m } = await supabase.from('student_group_marks').select('sheet_id').in('sheet_id', sh.map((s) => s.sheet_id));
      const c = {};
      (m || []).forEach((r) => { c[r.sheet_id] = (c[r.sheet_id] || 0) + 1; });
      setCounts(c);
    }
  }, [groupId, canMark]);

  useEffect(() => { load(); }, [load]);

  const schemeOf = (id) => schemes.find((s) => s.scheme_id === id);
  const chosen = schemeOf(Number(draft.scheme_id));
  const needsOutOf = chosen?.kind === 'mark' && chosen.fixed_max == null;

  async function createSheet(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.from('student_group_mark_sheets').insert({
      group_id: groupId, title: draft.title, marked_on: draft.marked_on,
      scheme_id: Number(draft.scheme_id), out_of: needsOutOf ? Number(draft.out_of) : null,
    }).select('*').single();
    setBusy(false);
    if (err) { setError(err.message); return; }
    setCreating(false);
    setDraft({ title: '', marked_on: schoolToday(), scheme_id: '', out_of: '' });
    await load();
    setOpen(data);
  }

  async function setWithdrawn(sheet, on) {
    const marked = counts[sheet.sheet_id] || 0;
    if (on && marked === 0) {
      if (!window.confirm(`Delete "${sheet.title}"? Nothing has been marked on it.`)) return;
      const { error: err } = await supabase.from('student_group_mark_sheets').delete().eq('sheet_id', sheet.sheet_id);
      if (err) setError(err.message);
      load();
      return;
    }
    if (on && !window.confirm(`Withdraw "${sheet.title}"? Its ${marked} mark${marked === 1 ? '' : 's'} are kept but can't be changed.`)) return;
    const { error: err } = await supabase.from('student_group_mark_sheets').update({ status: on ? 'withdrawn' : 'open' }).eq('sheet_id', sheet.sheet_id);
    if (err) setError(err.message);
    load();
  }

  if (sheets === null) return null;

  if (open) {
    const current = sheets.find((s) => s.sheet_id === open.sheet_id) || open;
    return (
      <MarkBook sheet={current} scheme={schemeOf(current.scheme_id)} members={members} archived={archived}
        onBack={() => setOpen(null)} onChanged={load} />
    );
  }

  return (
    <div>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {sheets.length === 0 ? (
        <p style={{ color: 'var(--ink-soft)' }}>No mark sheets yet.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Sheet</th><th>Date</th><th>Grading</th>{canMark && <th>Marked</th>}{canMark && <th></th>}</tr></thead>
            <tbody>
              {sheets.map((s) => (
                <tr key={s.sheet_id} style={s.status === 'withdrawn' ? { color: 'var(--ink-soft)' } : undefined}>
                  <td>{s.title}{s.status === 'withdrawn' && ' (withdrawn)'}</td>
                  <td>{formatUKDate(s.marked_on)}</td>
                  <td>{schemeLabel(schemeOf(s.scheme_id), s.out_of)}</td>
                  {canMark && <td>{counts[s.sheet_id] || 0}</td>}
                  {canMark && (
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button type="button" style={btnSmall} onClick={() => setOpen(s)}>{s.status === 'withdrawn' || archived ? 'View marks' : 'Mark book'}</button>{' '}
                      {!archived && (
                        <button type="button" className="secondary" style={btnSmall} onClick={() => setWithdrawn(s, s.status !== 'withdrawn')}>
                          {s.status === 'withdrawn' ? 'Restore' : (counts[s.sheet_id] ? 'Withdraw' : 'Delete')}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!canMark && sheets.length > 0 && (
        <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>Only the staff who run this group, SMT, pastoral staff and the school office can see its marks.</p>
      )}

      {canMark && !archived && (creating ? (
        <form onSubmit={createSheet} style={{ marginTop: '0.75rem' }}>
          <label>Title<input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required maxLength={200} placeholder="e.g. 100 m trial" /></label>
          <label>Date<input type="date" value={draft.marked_on} onChange={(e) => setDraft({ ...draft, marked_on: e.target.value })} required /></label>
          <label>Grading
            <select value={draft.scheme_id} onChange={(e) => setDraft({ ...draft, scheme_id: e.target.value })} required>
              <option value="">Choose…</option>
              {schemes.filter((s) => s.is_active).map((s) => <option key={s.scheme_id} value={s.scheme_id}>{s.name}</option>)}
            </select>
          </label>
          {needsOutOf && (
            <label>Out of<input type="number" min="1" step="any" value={draft.out_of} onChange={(e) => setDraft({ ...draft, out_of: e.target.value })} required /></label>
          )}
          <button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create and start marking'}</button>
          <button type="button" className="secondary" onClick={() => setCreating(false)}>Cancel</button>
        </form>
      ) : (
        <p style={{ marginTop: '0.75rem' }}><button type="button" onClick={() => setCreating(true)}>+ New mark sheet</button></p>
      ))}
    </div>
  );
}
