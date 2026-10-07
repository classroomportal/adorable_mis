'use client';

// The Worry Box (migration 391). Students send worries from their portal;
// the DSL and the principal read them here, with the student's name, and
// nobody else does (the principal, 7 Oct 2026; admins get no rows). Paper
// slips from the box in school are typed in here too, signed or not.
//
// Opening a new worry marks it read (open_worry()), so the other reader can
// see someone has it. Notes stay with the staff; a reply is shown to the
// student on their portal and they get an inbox notice without its text.
// Nothing is deleted. Every write is a database function.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';
import RequireResource from '../RequireResource';
import { schoolToday } from '../../lib/schoolTime';
import { formatUKDate, formatUKDateTime } from '../../lib/formatDate';
import { WORRY_CATEGORIES, WORRY_STATUS_STAFF, worryCategoryLabel } from '../../lib/worries';

const soft = { fontSize: '0.85em', color: 'var(--ink-soft)' };

const VIEWS = {
  current: { label: 'New and open', statuses: ['new', 'open'] },
  new: { label: 'New', statuses: ['new'] },
  closed: { label: 'Closed', statuses: ['closed'] },
  all: { label: 'Everything', statuses: null },
};

function studentName(s) {
  if (!s) return 'Not signed (paper slip)';
  return `${s.preferred_name || s.first_name} ${s.last_name}`;
}

function studentSub(s) {
  if (!s) return '';
  return [s.year_group ? `Year ${s.year_group}` : null, s.boarding_house].filter(Boolean).join(' · ');
}

function PaperSlipForm({ onSaved, onCancel }) {
  const [students, setStudents] = useState([]);
  const [search, setSearch] = useState('');
  const [studentId, setStudentId] = useState('');
  const [category, setCategory] = useState('');
  const [details, setDetails] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [receivedOn, setReceivedOn] = useState(schoolToday());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    supabase.from('students').select('student_id, first_name, last_name, preferred_name, year_group')
      .eq('status', 'active').order('last_name').then(({ data }) => setStudents(data || []));
  }, []);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return students.filter((s) => `${s.first_name} ${s.preferred_name || ''} ${s.last_name}`.toLowerCase().includes(q)).slice(0, 30);
  }, [search, students]);
  const chosen = students.find((s) => String(s.student_id) === String(studentId));

  async function save() {
    setBusy(true);
    setStatus(null);
    const { error } = await supabase.rpc('record_paper_worry', {
      p_student_id: studentId ? Number(studentId) : null,
      p_category: category || null,
      p_details: details,
      p_urgent: urgent,
      p_received_on: receivedOn,
    });
    setBusy(false);
    if (error) { setStatus(error.message); return; }
    onSaved();
  }

  return (
    <div className="card">
      <h2>Type in a paper slip</h2>
      <div style={{ display: 'grid', gap: '0.6rem', maxWidth: 640 }}>
        <div>
          <div>Student (leave empty if the slip isn&apos;t signed)</div>
          {chosen ? (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <strong>{studentName(chosen)}</strong> <span style={soft}>{studentSub(chosen)}</span>
              <button className="secondary" onClick={() => { setStudentId(''); setSearch(''); }}>Change</button>
            </div>
          ) : (
            <>
              <input placeholder="Type a name" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: '100%' }} />
              {matches.length > 0 && (
                <div style={{ border: '1px solid #ddd', borderRadius: 6, maxHeight: 220, overflowY: 'auto' }}>
                  {matches.map((s) => (
                    <button key={s.student_id} type="button" className="secondary"
                      style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', borderRadius: 0 }}
                      onClick={() => setStudentId(String(s.student_id))}>
                      {studentName(s)} <span style={soft}>{studentSub(s)}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <label>
          What is it about?
          <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ display: 'block', width: '100%' }}>
            <option value="">Choose…</option>
            {WORRY_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
        <label>
          What the slip says
          <textarea rows={5} maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} style={{ display: 'block', width: '100%' }} />
        </label>
        <label>
          Date found in the box
          <input type="date" value={receivedOn} max={schoolToday()} onChange={(e) => setReceivedOn(e.target.value)} style={{ display: 'block' }} />
        </label>
        <label style={{ display: 'flex', gap: '0.5rem' }}>
          <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> Urgent
        </label>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          <button className="secondary" onClick={onCancel}>Cancel</button>
        </div>
        {status && <p style={{ color: '#a3232c' }}>{status}</p>}
      </div>
    </div>
  );
}

function WorryDetail({ worry, notes, onChanged, onBack }) {
  const [note, setNote] = useState('');
  const [toStudent, setToStudent] = useState(false);
  const [closeNote, setCloseNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const canReply = worry.source === 'portal' && worry.student_id;

  async function run(fn, args) {
    setBusy(true);
    setStatus(null);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) { setStatus(error.message); return false; }
    onChanged();
    return true;
  }

  async function addNote() {
    if (!note.trim()) { setStatus('Please write the note.'); return; }
    if (toStudent && !window.confirm('The student will see this reply on their portal. Send it?')) return;
    if (await run('add_worry_note', { p_worry_id: worry.worry_id, p_note: note.trim(), p_to_student: toStudent })) {
      setNote('');
      setToStudent(false);
    }
  }

  async function setWorryStatus(next) {
    if (await run('set_worry_status', { p_worry_id: worry.worry_id, p_status: next, p_note: closeNote })) setCloseNote('');
  }

  return (
    <div className="card">
      <button className="secondary" onClick={onBack}>&larr; Back to the list</button>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.75rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>
            {worry.student_id ? <a href={`/students/${worry.student_id}`}>{studentName(worry.students)}</a> : studentName(null)}
          </h2>
          <div style={soft}>{studentSub(worry.students)}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          {worry.urgent && <span className="badge badge-negative" style={{ marginRight: '0.4rem' }}>Urgent</span>}
          <span className="badge">{WORRY_STATUS_STAFF[worry.status]}</span>
          <div style={soft}>
            {worry.source === 'paper' ? `Paper slip, found ${formatUKDate(worry.received_on)}` : `Sent ${formatUKDateTime(worry.created_at)}`}
          </div>
        </div>
      </div>
      <p><strong>{worryCategoryLabel(worry.category)}</strong></p>
      <p style={{ whiteSpace: 'pre-wrap', background: '#f7f7f9', padding: '0.75rem', borderRadius: 6 }}>{worry.details}</p>

      <h3>What has been done</h3>
      {notes.length === 0 ? <p style={soft}>Nothing yet.</p> : (
        <div>
          {notes.map((n) => (
            <div key={n.note_id} style={{
              borderLeft: `3px solid ${n.kind === 'reply' ? '#1a7a3d' : n.kind === 'status' ? '#bbb' : '#2f6fa8'}`,
              paddingLeft: '0.6rem', margin: '0.5rem 0',
            }}>
              <div style={soft}>
                {n.kind === 'reply' ? 'Reply to the student' : n.kind === 'status' ? 'Status' : 'Note'}
                {' · '}{n.created_by_name || 'Unknown'}{' · '}{formatUKDateTime(n.created_at)}
              </div>
              <div style={{ whiteSpace: 'pre-wrap', ...(n.kind === 'status' ? soft : {}) }}>{n.note}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gap: '0.5rem', maxWidth: 640, marginTop: '1rem' }}>
        <textarea rows={4} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder={toStudent ? 'Reply to the student (they will see this)' : 'Note for the DSL and the Principal (the student doesn’t see it)'} />
        {canReply && (
          <label style={{ display: 'flex', gap: '0.5rem' }}>
            <input type="checkbox" checked={toStudent} onChange={(e) => setToStudent(e.target.checked)} />
            Send as a reply the student sees on their portal
          </label>
        )}
        <div><button onClick={addNote} disabled={busy}>{toStudent ? 'Send reply' : 'Add note'}</button></div>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '1rem' }}>
        {worry.status !== 'closed' ? (
          <>
            <input placeholder="Why it can be closed (optional)" value={closeNote} onChange={(e) => setCloseNote(e.target.value)} style={{ minWidth: 260 }} />
            <button className="secondary" onClick={() => setWorryStatus('closed')} disabled={busy}>Close</button>
          </>
        ) : (
          <button className="secondary" onClick={() => setWorryStatus('open')} disabled={busy}>Reopen</button>
        )}
      </div>
      {status && <p style={{ color: '#a3232c' }}>{status}</p>}
    </div>
  );
}

function WorryBoxInner() {
  const [worries, setWorries] = useState([]);
  const [notes, setNotes] = useState([]);
  const [view, setView] = useState('current');
  const [category, setCategory] = useState('');
  const [selected, setSelected] = useState(null);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load() {
    const [{ data: w, error: e1 }, { data: n, error: e2 }] = await Promise.all([
      supabase.from('worries')
        .select('*, students(first_name, last_name, preferred_name, year_group, boarding_house)')
        .order('created_at', { ascending: false }),
      supabase.from('worry_notes').select('*').order('created_at'),
    ]);
    setError(e1?.message || e2?.message || null);
    setWorries(w || []);
    setNotes(n || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function openWorry(w) {
    setSelected(w.worry_id);
    if (w.status === 'new') {
      await supabase.rpc('open_worry', { p_worry_id: w.worry_id });
      load();
    }
  }

  const shown = worries.filter((w) => (!VIEWS[view].statuses || VIEWS[view].statuses.includes(w.status))
    && (!category || w.category === category));
  const current = worries.find((w) => w.worry_id === selected);

  if (adding) {
    return <PaperSlipForm onCancel={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />;
  }
  if (current) {
    return (
      <WorryDetail
        worry={current}
        notes={notes.filter((n) => n.worry_id === current.worry_id)}
        onChanged={load}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h1 style={{ margin: 0 }}>Worry Box</h1>
        <button onClick={() => setAdding(true)}>Type in a paper slip</button>
      </div>
      <p style={soft}>Only the Designated Safeguarding Lead and the Principal can see these worries.</p>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', margin: '0.75rem 0' }}>
        <select value={view} onChange={(e) => setView(e.target.value)}>
          {Object.entries(VIEWS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Every kind</option>
          {WORRY_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.short}</option>)}
        </select>
      </div>

      {error && <p style={{ color: '#a3232c' }}>{error}</p>}
      {loading ? <p>Loading…</p> : shown.length === 0 ? <p>No worries here.</p> : (
        <div className="table-scroll"><table>
          <thead><tr><th>Received</th><th>Student</th><th>About</th><th>Worry</th><th>Status</th></tr></thead>
          <tbody>
            {shown.map((w) => (
              <tr key={w.worry_id} onClick={() => openWorry(w)} style={{ cursor: 'pointer', fontWeight: w.status === 'new' ? 600 : undefined }}>
                <td>
                  {w.source === 'paper' ? formatUKDate(w.received_on) : formatUKDateTime(w.created_at)}
                  {w.source === 'paper' && <div style={soft}>Paper slip</div>}
                </td>
                <td>{studentName(w.students)}<div style={soft}>{studentSub(w.students)}</div></td>
                <td>{worryCategoryLabel(w.category, { short: true })}</td>
                <td style={{ maxWidth: 360 }}>{w.details.length > 120 ? `${w.details.slice(0, 120)}…` : w.details}</td>
                <td>
                  {w.urgent && w.status !== 'closed' && <span className="badge badge-negative" style={{ marginRight: '0.3rem' }}>Urgent</span>}
                  <span className="badge">{WORRY_STATUS_STAFF[w.status]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}

export default function WorryBoxPage() {
  return (
    <RequireAuth>
      <RequireResource resourceKey="/worry-box">
        <WorryBoxInner />
      </RequireResource>
    </RequireAuth>
  );
}
