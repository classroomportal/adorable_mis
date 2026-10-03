'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';
import RequireResource from '../RequireResource';
import { useAuth } from '../../lib/AuthContext';
import { formatUKDate } from '../../lib/formatDate';
import { CALENDAR_CATEGORY_LABELS } from '../../lib/calendarExport';
import { academicYearOf, loadCurrentAcademicYearLabel } from '../../lib/academicYear';
import { schoolToday } from '../../lib/schoolTime';

const CATEGORY_LABELS = CALENDAR_CATEGORY_LABELS;

const ALL_YEAR_GROUPS = [7, 8, 9, 10, 11, 12];

function CalendarInner() {
  const { profile, staffRoles } = useAuth();
  // Matches the calendar_events write policy (migration 205): SMT, plus the admin login.
  const canEdit = profile?.role === 'admin' || staffRoles.includes('smt');
  const [terms, setTerms] = useState([]);
  const [events, setEvents] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState('');
  // Only this academic year by default: the historic end-of-term exam result
  // sets (migrations 246/252) go back to 2017 and swamp the list otherwise.
  const [yearFilter, setYearFilter] = useState(() => academicYearOf(schoolToday()));
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [newEvent, setNewEvent] = useState({ event_date: '', event_name: '', category: 'relp', year_group_note: '', is_result_set: false });
  const [status, setStatus] = useState(null);
  const [isReportPeriod, setIsReportPeriod] = useState(false);
  const [reportYearGroups, setReportYearGroups] = useState([]);
  const [checkDueDate, setCheckDueDate] = useState('');
  const [termStatus, setTermStatus] = useState(null);
  const [editingTermId, setEditingTermId] = useState(null);
  const [termDraft, setTermDraft] = useState(null);
  const [newTerm, setNewTerm] = useState({ term_name: '', start_date: '', end_date: '' });

  function toggleReportYearGroup(yg) {
    setReportYearGroups((prev) => (prev.includes(yg) ? prev.filter((y) => y !== yg) : [...prev, yg].sort((a, b) => a - b)));
  }

  async function loadEvents() {
    const { data: e } = await supabase.from('calendar_events').select('*').order('event_date');
    setEvents(e || []);
  }

  async function loadTerms() {
    const { data: t } = await supabase.from('terms').select('*').order('start_date');
    setTerms(t || []);
  }

  useEffect(() => {
    loadTerms();
    loadEvents();
    loadCurrentAcademicYearLabel().then(setYearFilter);
  }, []);

  function termError(t) {
    if (!t.term_name.trim() || !t.start_date || !t.end_date) return 'Term name, start and end are required.';
    if (t.end_date < t.start_date) return 'A term cannot end before it starts.';
    return null;
  }

  async function saveTerm() {
    const problem = termError(termDraft);
    if (problem) { setTermStatus(problem); return; }
    const { error } = await supabase.from('terms').update({
      term_name: termDraft.term_name.trim(),
      start_date: termDraft.start_date,
      end_date: termDraft.end_date,
    }).eq('term_id', editingTermId);
    if (error) setTermStatus(`Error: ${error.message}`);
    else { setEditingTermId(null); setTermStatus('Term saved.'); loadTerms(); }
  }

  async function addTerm(e) {
    e.preventDefault();
    const problem = termError(newTerm);
    if (problem) { setTermStatus(problem); return; }
    const { error } = await supabase.from('terms').insert([{ ...newTerm, term_name: newTerm.term_name.trim() }]);
    if (error) { setTermStatus(`Error: ${error.message}`); return; }
    setNewTerm({ term_name: '', start_date: '', end_date: '' });
    setTermStatus('Term added.');
    loadTerms();
  }

  function startEdit(ev) {
    setEditingId(ev.event_id);
    setEditDraft({ ...ev });
  }

  async function saveEdit() {
    const { error } = await supabase.from('calendar_events').update({
      event_date: editDraft.event_date,
      event_name: editDraft.event_name,
      category: editDraft.category,
      year_group_note: editDraft.year_group_note || null,
      is_result_set: !!editDraft.is_result_set,
    }).eq('event_id', editingId);
    if (error) setStatus(`Error: ${error.message}`);
    else { setEditingId(null); setStatus('Saved.'); loadEvents(); }
  }

  async function deleteEvent(id) {
    if (!confirm('Delete this event?')) return;
    const { error } = await supabase.from('calendar_events').delete().eq('event_id', id);
    if (error) setStatus(`Error: ${error.message}`);
    else { setStatus('Deleted.'); loadEvents(); }
  }

  async function addEvent(e) {
    e.preventDefault();
    if (!newEvent.event_date || !newEvent.event_name) { setStatus('Date and name are required.'); return; }
    if (isReportPeriod && reportYearGroups.length === 0) { setStatus('Select at least one year group for the report period.'); return; }

    const eventCategory = isReportPeriod ? 'report_period' : newEvent.category;
    const { data: inserted, error } = await supabase.from('calendar_events').insert([{
      event_date: newEvent.event_date,
      event_name: newEvent.event_name,
      category: eventCategory,
      year_group_note: newEvent.year_group_note || (isReportPeriod ? reportYearGroups.map((y) => `Y${y}`).join('/') : null),
      is_result_set: newEvent.is_result_set,
    }]).select().single();

    if (error) { setStatus(`Error: ${error.message}`); return; }

    if (isReportPeriod) {
      const { data: { user } } = await supabase.auth.getUser();
      const { error: rpError } = await supabase.from('report_periods').insert([{
        name: newEvent.event_name,
        year_groups: reportYearGroups,
        comments_due_date: newEvent.event_date,
        check_due_date: checkDueDate || null,
        calendar_event_id: inserted.event_id,
        created_by: user?.id || null,
      }]);
      if (rpError) { setStatus(`Event added, but report period failed: ${rpError.message}`); loadEvents(); return; }
    }

    setNewEvent({ event_date: '', event_name: '', category: 'relp', year_group_note: '', is_result_set: false });
    setIsReportPeriod(false); setReportYearGroups([]); setCheckDueDate('');
    setStatus(isReportPeriod ? 'Event and report period added.' : 'Added.');
    loadEvents();
  }

  const inYear = (date) => yearFilter === 'all' || academicYearOf(date) === yearFilter;
  const yearOptions = [...new Set([
    ...events.map((e) => academicYearOf(e.event_date)),
    ...terms.map((t) => academicYearOf(t.start_date)),
    yearFilter !== 'all' ? yearFilter : null,
  ].filter(Boolean))].sort().reverse();
  const shownTerms = terms.filter((t) => inYear(t.start_date));
  const filtered = events.filter((e) => inYear(e.event_date) && (!categoryFilter || e.category === categoryFilter));

  return (
    <div>
      <h1>Academic Calendar</h1>

      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
        Academic year
        <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
          {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
          <option value="all">All years</option>
        </select>
      </label>

      <div className="card">
        <h2>Terms</h2>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Term</th><th>Start</th><th>End</th>{editingTermId && <th>Actions</th>}</tr></thead>
            <tbody>
              {shownTerms.map((t) => (
                editingTermId === t.term_id ? (
                  <tr key={t.term_id}>
                    <td><input value={termDraft.term_name} onChange={(ev) => setTermDraft({ ...termDraft, term_name: ev.target.value })} /></td>
                    <td><input type="date" value={termDraft.start_date} onChange={(ev) => setTermDraft({ ...termDraft, start_date: ev.target.value })} />{termDraft.start_date && <span style={{ display: 'block', fontSize: '0.75rem', color: '#666', marginTop: '0.2rem' }}>{formatUKDate(termDraft.start_date)}</span>}</td>
                    <td><input type="date" value={termDraft.end_date} onChange={(ev) => setTermDraft({ ...termDraft, end_date: ev.target.value })} />{termDraft.end_date && <span style={{ display: 'block', fontSize: '0.75rem', color: '#666', marginTop: '0.2rem' }}>{formatUKDate(termDraft.end_date)}</span>}</td>
                    <td>
                      <button onClick={saveTerm}>Save</button>{' '}
                      <button className="secondary" onClick={() => setEditingTermId(null)}>Cancel</button>
                    </td>
                  </tr>
                ) : (
                  <tr key={t.term_id}>
                    {/* Edit sits in the name cell so it's visible on a phone without scrolling the table sideways. */}
                    <td>
                      {t.term_name}
                      {canEdit && (
                        <>{' '}<button className="secondary" style={{ marginLeft: '0.5rem', padding: '0.2rem 0.6rem', fontSize: '0.8rem' }} onClick={() => { setEditingTermId(t.term_id); setTermDraft({ ...t }); }}>Edit</button></>
                      )}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatUKDate(t.start_date)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatUKDate(t.end_date)}</td>
                    {editingTermId && <td />}
                  </tr>
                )
              ))}
            </tbody>
          </table>
        </div>
        {canEdit && (
          <form onSubmit={addTerm}>
            <label>New term
              <input value={newTerm.term_name} onChange={(e) => setNewTerm({ ...newTerm, term_name: e.target.value })} placeholder="e.g. September Term 2027" />
            </label>
            <label>Start
              <input type="date" value={newTerm.start_date} onChange={(e) => setNewTerm({ ...newTerm, start_date: e.target.value })} />
              {newTerm.start_date && <span style={{ display: 'block', fontSize: '0.75rem', color: '#666', marginTop: '0.2rem' }}>{formatUKDate(newTerm.start_date)}</span>}
            </label>
            <label>End
              <input type="date" value={newTerm.end_date} onChange={(e) => setNewTerm({ ...newTerm, end_date: e.target.value })} />
              {newTerm.end_date && <span style={{ display: 'block', fontSize: '0.75rem', color: '#666', marginTop: '0.2rem' }}>{formatUKDate(newTerm.end_date)}</span>}
            </label>
            <button type="submit">Add term</button>
          </form>
        )}
        {termStatus && <p>{termStatus}</p>}
      </div>

      <div className="card">
        <h2>Events</h2>
        <form onSubmit={(e) => e.preventDefault()}>
          <label>
            Category
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">All</option>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        </form>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Date</th><th>Event</th><th>Category</th><th>Note</th><th>Result set</th>{canEdit && <th>Actions</th>}</tr></thead>
            <tbody>
              {filtered.map((e) => (
                editingId === e.event_id ? (
                  <tr key={e.event_id}>
                    <td><input type="date" value={editDraft.event_date} onChange={(ev) => setEditDraft({ ...editDraft, event_date: ev.target.value })} /></td>
                    <td><input value={editDraft.event_name} onChange={(ev) => setEditDraft({ ...editDraft, event_name: ev.target.value })} /></td>
                    <td>
                      <select value={editDraft.category} onChange={(ev) => setEditDraft({ ...editDraft, category: ev.target.value })}>
                        {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </td>
                    <td><input value={editDraft.year_group_note || ''} onChange={(ev) => setEditDraft({ ...editDraft, year_group_note: ev.target.value })} /></td>
                    <td style={{ textAlign: 'center' }}>
                      <input type="checkbox" checked={!!editDraft.is_result_set} onChange={(ev) => setEditDraft({ ...editDraft, is_result_set: ev.target.checked })} />
                    </td>
                    <td>
                      <button onClick={saveEdit}>Save</button>{' '}
                      <button className="secondary" onClick={() => setEditingId(null)}>Cancel</button>
                    </td>
                  </tr>
                ) : (
                  <tr key={e.event_id}>
                    <td>{formatUKDate(e.event_date)}</td>
                    <td>{e.event_name}</td>
                    <td>{CATEGORY_LABELS[e.category] || e.category}</td>
                    <td>{e.year_group_note || ''}</td>
                    <td style={{ textAlign: 'center' }}>{e.is_result_set ? '✅' : ''}</td>
                    {canEdit && (
                      <td>
                        <button className="secondary" onClick={() => startEdit(e)}>Edit</button>{' '}
                        <button className="secondary" onClick={() => deleteEvent(e.event_id)}>Delete</button>
                      </td>
                    )}
                  </tr>
                )
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {status && <p>{status}</p>}

      {canEdit && (
        <div className="card">
          <h2>Add event</h2>
          <form onSubmit={addEvent}>
            <label>Date
              <input type="date" value={newEvent.event_date} onChange={(e) => setNewEvent({ ...newEvent, event_date: e.target.value })} required />
              {newEvent.event_date && <span style={{ display: 'block', fontSize: '0.75rem', color: '#666', marginTop: '0.2rem' }}>{formatUKDate(newEvent.event_date)}</span>}
            </label>
            <label>Name
              <input value={newEvent.event_name} onChange={(e) => setNewEvent({ ...newEvent, event_name: e.target.value })} required />
            </label>
            <label>Category
              <select value={newEvent.category} onChange={(e) => setNewEvent({ ...newEvent, category: e.target.value })}>
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label>Note (optional)
              <input value={newEvent.year_group_note} onChange={(e) => setNewEvent({ ...newEvent, year_group_note: e.target.value })} placeholder="e.g. Y9/11" />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <input type="checkbox" checked={newEvent.is_result_set} onChange={(e) => setNewEvent({ ...newEvent, is_result_set: e.target.checked })} />
              Result set (show in Review Results dataset picker)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <input type="checkbox" checked={isReportPeriod} onChange={(e) => setIsReportPeriod(e.target.checked)} />
              Report period (also creates a Report Period for Write/Check Reports)
            </label>
            {isReportPeriod && (
              <div style={{ border: '1px solid #ddd', borderRadius: 6, padding: '0.6rem', margin: '0.4rem 0', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div>
                  <div style={{ fontSize: '0.8rem', marginBottom: '0.2rem' }}>Year groups covered</div>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {ALL_YEAR_GROUPS.map((yg) => (
                      <label key={yg} style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.85rem' }}>
                        <input type="checkbox" checked={reportYearGroups.includes(yg)} onChange={() => toggleReportYearGroup(yg)} />
                        Y{yg}
                      </label>
                    ))}
                  </div>
                </div>
                <label>
                  Checking due date (end of week 2)
                  <input type="date" value={checkDueDate} onChange={(e) => setCheckDueDate(e.target.value)} />
                </label>
                <span style={{ fontSize: '0.75rem', color: '#666' }}>The event date above is used as the comments-due date (end of week 1).</span>
              </div>
            )}
            <button type="submit">Add event</button>
          </form>
        </div>
      )}
    </div>
  );
}

// Parents have their own read-only view with "add to my calendar"; send them
// there rather than showing the staff page's "no access" message.
function ParentRedirect({ children }) {
  const { profile } = useAuth();
  useEffect(() => {
    if (profile?.role === 'parent') window.location.replace('/parent-portal/calendar');
  }, [profile]);
  if (profile?.role === 'parent') return <p>Opening the school calendar…</p>;
  return children;
}

export default function CalendarPage() {
  return <RequireAuth><ParentRedirect><RequireResource resourceKey="/calendar"><CalendarInner /></RequireResource></ParentRedirect></RequireAuth>;
}
