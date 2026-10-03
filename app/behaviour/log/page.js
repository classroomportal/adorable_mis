'use client';
import { Fragment, useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { schoolToday, schoolDateOffset } from '../../../lib/schoolTime';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { useAuth } from '../../../lib/AuthContext';
import { formatUKDate } from '../../../lib/formatDate';
import EventCommentEditor, { useCanEditEventComment } from '../../components/EventCommentEditor';

const LIMIT = 200;

// The Behaviour Log: look up behaviour that has already been logged, and
// open or correct it. Logging new behaviour is /behaviour, reached from the
// big "Log behaviour" tile on the home page, so this page has no add form.
// A house-only houseparent (my_house_access().exclusive) sees their house
// here. Logging on /behaviour is not limited to it.
function BehaviourLogInner() {
  const { profile, staffRoles } = useAuth();
  // Removing a behaviour event (a merit included) is SMT only (migration 319).
  const canDelete = (staffRoles || []).includes('smt');
  const canEdit = useCanEditEventComment();

  const [students, setStudents] = useState([]);
  const [categories, setCategories] = useState([]);
  const [house, setHouse] = useState(null);
  const [filters, setFilters] = useState({
    search: '', type: '', category: '', from: schoolDateOffset(-30), to: schoolToday(), mine: false,
  });
  const [events, setEvents] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    supabase.from('students').select('student_id, first_name, last_name, boarding_house').eq('status', 'active').order('last_name')
      .then(({ data }) => setStudents(data || []));
    supabase.from('behaviour_categories').select('name, type').order('name')
      .then(({ data }) => setCategories(data || []));
    supabase.rpc('my_house_access').then(({ data }) => setHouse(data?.house && data?.exclusive ? data.house : null));
  }, []);

  // Name search runs against the student list, then asks for those students'
  // events, so a search isn't limited to whichever 200 events came back.
  const search = filters.search.trim().toLowerCase();
  const matchingIds = search
    ? students.filter((s) => `${s.first_name} ${s.last_name}`.toLowerCase().includes(search)).map((s) => s.student_id)
    : null;
  const matchingKey = matchingIds ? matchingIds.join(',') : '';

  useEffect(() => {
    if (!profile) return;
    if (matchingIds && matchingIds.length === 0) { setEvents([]); return; }
    let q = supabase
      .from('behaviour_events')
      .select('event_id, event_date, type, category, points, description, staff_id, photo_id, return_note, students!behaviour_events_student_id_fkey(student_id, first_name, last_name, boarding_house), staff!behaviour_events_staff_id_fkey(first_name, last_name)')
      .eq('is_demo', !!profile.is_demo_account)
      .is('voided_at', null)
      .gte('event_date', filters.from || '1900-01-01')
      .lte('event_date', filters.to || '2999-12-31')
      .order('event_date', { ascending: false })
      .order('event_id', { ascending: false })
      .limit(LIMIT);
    if (filters.type) q = q.eq('type', filters.type);
    if (filters.category) q = q.eq('category', filters.category);
    if (filters.mine) q = q.eq('staff_id', profile.staff_id ?? -1);
    if (matchingIds) q = q.in('student_id', matchingIds.slice(0, 300));
    q.then(({ data, error: err }) => {
      setError(err ? err.message : null);
      setEvents(data || []);
    });
    // matchingKey stands in for matchingIds, which is a new array every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, filters.type, filters.category, filters.from, filters.to, filters.mine, matchingKey]);

  const shown = (events || []).filter((e) => !house || e.students?.boarding_house === house);
  const categoryOptions = categories.filter((c) => !filters.type || c.type === filters.type);
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function handleDelete(eventId) {
    if (!window.confirm('Delete this behaviour event? This cannot be undone.')) return;
    const { error: err } = await supabase.from('behaviour_events').delete().eq('event_id', eventId);
    if (err) setError(err.message);
    else setEvents((list) => list.filter((x) => x.event_id !== eventId));
  }

  return (
    <div>
      <h1>Behaviour Log</h1>
      <p style={{ marginTop: 0 }}>
        Look up behaviour that has been logged, and open or correct it. <a href="/behaviour">Log behaviour →</a>
      </p>
      {house && <p style={{ color: 'var(--ink-soft)', fontSize: '0.85rem' }}>Showing {house} only (Houseparent view)</p>}

      <form onSubmit={(e) => e.preventDefault()} className="card behaviour-log">
        <div className="bl-row bl-filters">
          <label>
            Student
            <input type="search" value={filters.search} onChange={set('search')} placeholder="Name…" />
          </label>
          <label>
            Type
            <select value={filters.type} onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value, category: '' }))}>
              <option value="">All</option>
              <option value="positive">Positive</option>
              <option value="negative">Negative</option>
            </select>
          </label>
          <label>
            Category
            <select value={filters.category} onChange={set('category')}>
              <option value="">All</option>
              {categoryOptions.map((c) => <option key={`${c.type}-${c.name}`} value={c.name}>{c.name}</option>)}
            </select>
          </label>
          <label>
            From
            <input type="date" value={filters.from} onChange={set('from')} />
          </label>
          <label>
            To
            <input type="date" value={filters.to} onChange={set('to')} />
          </label>
        </div>
        <label className="bl-chip" style={{ alignSelf: 'flex-start' }}>
          <input type="checkbox" checked={filters.mine} onChange={set('mine')} />
          <span>Only events I logged</span>
        </label>
      </form>

      {error && <p style={{ color: 'var(--red-700)' }}>{error}</p>}
      {events === null ? <p>Loading…</p> : shown.length === 0 ? <p>No behaviour logged that matches.</p> : (
        <>
          <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>
            {events.length === LIMIT
              ? `Showing the latest ${LIMIT} — narrow the dates or search a name to see older ones.`
              : `${shown.length} event${shown.length === 1 ? '' : 's'}`}
          </p>
          <div className="table-scroll"><table>
            <thead>
              <tr><th>Date</th><th>Student</th><th>Category</th><th>Points</th><th>Logged by</th><th></th>{canDelete && <th></th>}</tr>
            </thead>
            <tbody>
              {shown.map((ev) => (
                <Fragment key={ev.event_id}>
                  <tr className="student-link" onClick={() => setOpen((o) => (o === ev.event_id ? null : ev.event_id))}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatUKDate(ev.event_date)}</td>
                    <td>
                      <a href={`/students/${ev.students?.student_id}`} onClick={(e) => e.stopPropagation()}>
                        {ev.students?.first_name} {ev.students?.last_name}
                      </a>
                    </td>
                    <td>{ev.category ?? '—'}{ev.photo_id && <span title="Has a picture"> 📷</span>}</td>
                    <td style={{ color: ev.type === 'negative' ? 'var(--red-700)' : '#1d6b3a', fontWeight: 600 }}>
                      {ev.points == null ? '—' : `${ev.points > 0 ? '+' : ''}${ev.points}`}
                    </td>
                    <td>{ev.staff ? `${ev.staff.first_name} ${ev.staff.last_name}` : '—'}</td>
                    <td>
                      <button type="button" className="secondary bl-small" style={{ whiteSpace: 'nowrap' }}>
                        {open === ev.event_id ? 'Hide' : canEdit(ev) ? 'View / edit' : 'View'}
                      </button>
                    </td>
                    {canDelete && (
                      <td><button type="button" className="secondary bl-small" onClick={(e) => { e.stopPropagation(); handleDelete(ev.event_id); }}>Delete</button></td>
                    )}
                  </tr>
                  {open === ev.event_id && (
                    <tr>
                      <td colSpan={canDelete ? 7 : 6} style={{ paddingLeft: '1.5rem' }}>
                        <EventCommentEditor
                          event={ev}
                          onSaved={(changes) => setEvents((list) => list.map((x) => (x.event_id === ev.event_id ? { ...x, ...changes } : x)))}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table></div>
        </>
      )}
    </div>
  );
}

export default function BehaviourLogPage() {
  // Shares the /behaviour grant rather than needing its own permissions row.
  return <RequireAuth><RequireResource resourceKey="/behaviour"><BehaviourLogInner /></RequireResource></RequireAuth>;
}
