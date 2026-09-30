'use client';
import { Fragment, useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { schoolDateOffset } from '../../../lib/schoolTime';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { useAuth } from '../../../lib/AuthContext';
import { formatUKDate } from '../../../lib/formatDate';
import EventCommentEditor from '../../components/EventCommentEditor';

// Serious behaviour (-3 or worse) in the last 7 days. This used to sit above
// the logging form on /behaviour; it moved here so that page is just for
// logging, and the "Behaviour alerts" tile on the home page opens it. Same
// query as that tile's count, so the two always agree. A houseparent sees
// their own house, as they did on /behaviour.
function AlertsInner() {
  const { profile, isPastoralOrSmt } = useAuth();
  const [alerts, setAlerts] = useState(null);
  const [house, setHouse] = useState(null);
  const [open, setOpen] = useState(null);
  const [level, setLevel] = useState('all'); // 'all' | '-3' | '-4' | '-5'

  useEffect(() => {
    async function load() {
      const { data: access } = await supabase.rpc('my_house_access');
      setHouse(access?.house || null);
      const { data } = await supabase
        .from('behaviour_events')
        .select('event_id, event_date, type, category, points, description, staff_id, photo_id, students(student_id, first_name, last_name, boarding_house), staff!behaviour_events_staff_id_fkey(first_name, last_name)')
        .eq('type', 'negative')
        .lte('points', -3)
        .eq('is_demo', !!profile?.is_demo_account)
        .is('voided_at', null)
        .gte('event_date', schoolDateOffset(-7))
        .order('event_date', { ascending: false });
      setAlerts(data || []);
    }
    load();
  }, [profile?.is_demo_account]);

  const inHouse = (alerts || []).filter((a) => !house || a.students?.boarding_house === house);
  // -5 covers anything worse too, so no event is ever filtered out of sight.
  const matchesLevel = (a, l) => (l === 'all' ? true : l === '-5' ? a.points <= -5 : a.points === Number(l));
  const shown = inHouse.filter((a) => matchesLevel(a, level));
  const LEVELS = [
    { value: 'all', label: 'All' },
    { value: '-3', label: '-3' },
    { value: '-4', label: '-4' },
    { value: '-5', label: '-5 or worse' },
  ];

  return (
    <div>
      <h1>Behaviour alerts — last 7 days</h1>
      <p>
        Events of -3 points or worse. <a href="/behaviour">Log behaviour →</a>
      </p>
      {house && <p style={{ color: 'var(--ink-soft)', fontSize: '0.85rem' }}>Showing {house} only (Houseparent view)</p>}
      {!isPastoralOrSmt ? (
        <p>Behaviour alerts are for pastoral staff, houseparents and SMT.</p>
      ) : alerts === null ? <p>Loading…</p> : inHouse.length === 0 ? (
        <p>No events of -3 points or worse logged in the last 7 days.</p>
      ) : (
        <>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', margin: '0 0 0.75rem' }} role="group" aria-label="Filter by points">
          {LEVELS.map((l) => (
            <button
              key={l.value}
              type="button"
              className={level === l.value ? undefined : 'secondary'}
              aria-pressed={level === l.value}
              onClick={() => { setLevel(l.value); setOpen(null); }}
              style={{ width: 'auto' }}
            >
              {l.label} ({inHouse.filter((a) => matchesLevel(a, l.value)).length})
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <p>No events at {LEVELS.find((l) => l.value === level)?.label} in the last 7 days.</p>
        ) : (
        <div className="table-scroll"><table>
          <thead><tr><th>Date</th><th>Student</th><th>Category</th><th>Points</th><th>Logged by</th><th></th></tr></thead>
          <tbody>
            {shown.map((a) => (
              <Fragment key={a.event_id}>
                <tr className="student-link" onClick={() => window.location.href = `/students/${a.students?.student_id}`}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatUKDate(a.event_date).replace(/ \d{4}$/, '')}</td>
                  <td>{a.students?.first_name} {a.students?.last_name}</td>
                  <td>{a.category ?? '—'}{a.photo_id && <span title="Has a picture"> 📷</span>}</td>
                  <td style={{ color: 'var(--red-700)', fontWeight: 600 }}>{a.points}</td>
                  <td>{a.staff ? `${a.staff.first_name} ${a.staff.last_name}` : '—'}</td>
                  <td>
                    <button
                      type="button"
                      className="secondary bl-small"
                      onClick={(e) => { e.stopPropagation(); setOpen((o) => (o === a.event_id ? null : a.event_id)); }}
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      {open === a.event_id ? 'Hide' : 'Comment'}
                    </button>
                  </td>
                </tr>
                {open === a.event_id && (
                  <tr>
                    <td colSpan={6} style={{ paddingLeft: '1.5rem' }}>
                      <EventCommentEditor
                        event={a}
                        onSaved={(changes) => setAlerts((list) => list.map((x) => (x.event_id === a.event_id ? { ...x, ...changes } : x)))}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table></div>
        )}
        </>
      )}
    </div>
  );
}

export default function BehaviourAlertsPage() {
  // Shares the /behaviour grant rather than needing its own permissions row.
  return <RequireAuth><RequireResource resourceKey="/behaviour"><AlertsInner /></RequireResource></RequireAuth>;
}
