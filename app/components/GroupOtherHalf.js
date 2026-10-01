'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { formatUKDate } from '../../lib/formatDate';
import { schoolToday } from '../../lib/schoolTime';
import { OH_DAYS, OH_DAY_NAMES, formatYearGroups, loadCurrentOtherHalfTermId } from '../../lib/otherHalf';

// A group's Other Half (migration 302): put every current student in the
// group into one activity, replacing their choice for that day, and lock it
// until staff unlock it or until a date. While the lock is in force the
// student can't change or drop that day (the database refuses); when it ends
// the placement stays and they may change it. A full activity, or one outside
// a student's year group, gets a warning first and then goes ahead (the
// principal's choice, as when placing by hand at /other-half/choices).
// Who may place and unlock is checked by the database
// (can_place_group_in_other_half()); canPlace only shows the controls.

const fullName = (s) => (s ? `${s.first_name} ${s.last_name}` : '');

export default function GroupOtherHalf({ groupId, members, archived, canPlace }) {
  const [termId, setTermId] = useState(null);
  const [activities, setActivities] = useState([]);
  const [taken, setTaken] = useState({});
  const [choices, setChoices] = useState([]); // members' choices this term
  const [activityId, setActivityId] = useState('');
  const [lockMode, setLockMode] = useState('until_unlocked'); // none | until_unlocked | until_date
  const [lockUntil, setLockUntil] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const current = members.filter((m) => m.students?.status === 'active');
  const memberIds = current.map((m) => m.student_id);
  const memberKey = memberIds.join(',');

  async function load() {
    const term = await loadCurrentOtherHalfTermId();
    setTermId(term);
    if (!term) return;
    const [{ data: acts }, { data: counts }, { data: ch }] = await Promise.all([
      supabase.from('other_half_activities').select('activity_id, activity_name, day_of_week, year_groups, capacity')
        .eq('term_id', term).eq('is_active', true).order('activity_name'),
      supabase.rpc('other_half_places_taken', { p_term_id: term }),
      memberIds.length
        ? supabase.from('other_half_choices').select('student_id, activity_id, day_of_week, locked, locked_until')
          .eq('term_id', term).in('student_id', memberIds)
        : Promise.resolve({ data: [] }),
    ]);
    setActivities(acts || []);
    setTaken(Object.fromEntries((counts || []).map((c) => [c.activity_id, c.taken])));
    setChoices(ch || []);
  }

  useEffect(() => { load(); }, [groupId, memberKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!termId) return <p style={{ color: 'var(--ink-soft)' }}>No Other Half term is running.</p>;

  const activityById = Object.fromEntries(activities.map((a) => [a.activity_id, a]));
  const today = schoolToday();
  const inForce = (c) => c.locked && (!c.locked_until || c.locked_until >= today);
  const choiceFor = (studentId, day) => choices.find((c) => c.student_id === studentId && c.day_of_week === day);
  // Days where at least one student in the group has a choice, Monday first.
  const daysUsed = OH_DAYS.filter((d) => choices.some((c) => c.day_of_week === d));

  async function place(e) {
    e.preventDefault();
    const a = activityById[Number(activityId)];
    if (!a) return;
    if (lockMode === 'until_date' && !lockUntil) { setError('Choose the last day of the lock.'); return; }

    // The same "anyway?" warnings as placing by hand.
    const alreadyIn = choices.filter((c) => c.activity_id === a.activity_id).length;
    const joining = current.length - alreadyIn;
    const warnings = [];
    if (a.capacity != null) {
      const left = a.capacity - (taken[a.activity_id] || 0);
      if (joining > left) warnings.push(`${a.activity_name} has ${Math.max(left, 0)} place${left === 1 ? '' : 's'} left and ${joining} student${joining === 1 ? '' : 's'} would join.`);
    }
    const wrongYear = current.filter((m) => !(a.year_groups || []).includes(m.students?.year_group));
    if (wrongYear.length) warnings.push(`${wrongYear.length} student${wrongYear.length === 1 ? ' is' : 's are'} not in its year groups (${formatYearGroups(a.year_groups)}).`);
    const replacing = choices.filter((c) => c.day_of_week === a.day_of_week && c.activity_id !== a.activity_id).length;
    if (replacing) warnings.push(`${replacing} student${replacing === 1 ? '' : 's'} will lose the ${OH_DAY_NAMES[a.day_of_week]} activity they chose.`);
    const lockWords = lockMode === 'none' ? 'not locked' : lockMode === 'until_unlocked' ? 'locked until staff unlock it' : `locked until ${formatUKDate(lockUntil)}`;
    const question = `Put ${current.length} student${current.length === 1 ? '' : 's'} in ${a.activity_name} on ${OH_DAY_NAMES[a.day_of_week]}s, ${lockWords}?`;
    if (!window.confirm([...warnings, question].join('\n\n'))) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    const { data, error: err } = await supabase.rpc('place_group_in_other_half', {
      p_group_id: groupId, p_activity_id: a.activity_id,
      p_lock: lockMode !== 'none', p_locked_until: lockMode === 'until_date' ? lockUntil : null,
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setNotice(`Placed ${data} student${data === 1 ? '' : 's'} in ${a.activity_name} (${lockWords}).`);
    await load();
  }

  async function unlock(day, studentIds, label) {
    if (!window.confirm(`Unlock ${label} on ${OH_DAY_NAMES[day]}s? ${studentIds.length === 1 ? 'They stay' : 'They all stay'} in the activity and can change it at Evening Prep while choices are open.`)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const { data, error: err } = await supabase.rpc('unlock_other_half_choices', { p_term_id: termId, p_day_of_week: day, p_student_ids: studentIds });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setNotice(`Unlocked ${data} placement${data === 1 ? '' : 's'}.`);
    await load();
  }

  const byDay = OH_DAYS.map((d) => ({ day: d, list: activities.filter((a) => a.day_of_week === d) })).filter((x) => x.list.length);

  return (
    <div>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {notice && <p style={{ color: 'var(--brand-700)' }}>{notice}</p>}

      {canPlace && !archived && current.length > 0 && (
        <form onSubmit={place}>
          <label>Activity
            <select value={activityId} onChange={(e) => setActivityId(e.target.value)} required>
              <option value="">Choose an activity…</option>
              {byDay.map(({ day, list }) => (
                <optgroup key={day} label={OH_DAY_NAMES[day]}>
                  {list.map((a) => (
                    <option key={a.activity_id} value={a.activity_id}>
                      {a.activity_name} ({a.capacity == null ? 'no limit' : `${Math.max(a.capacity - (taken[a.activity_id] || 0), 0)} left`})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label>Lock their choice
            <select value={lockMode} onChange={(e) => setLockMode(e.target.value)}>
              <option value="until_unlocked">until we unlock it</option>
              <option value="until_date">until a date</option>
              <option value="none">don&apos;t lock</option>
            </select>
          </label>
          {lockMode === 'until_date' && (
            <label>Last day locked<input type="date" min={today} value={lockUntil} onChange={(e) => setLockUntil(e.target.value)} required /></label>
          )}
          <button type="submit" disabled={busy || !activityId}>Place {current.length} student{current.length === 1 ? '' : 's'}</button>
          <span style={{ flexBasis: '100%', fontSize: '0.85rem', color: 'var(--ink-soft)' }}>
            Replaces each student&apos;s choice for that day only. Students and parents see &quot;Placed by the school&quot;, never why.
          </span>
        </form>
      )}

      {daysUsed.length === 0 ? (
        <p style={{ color: 'var(--ink-soft)' }}>No one in this group has an Other Half activity this term yet.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                {daysUsed.map((d) => {
                  const lockedIds = current.filter((m) => { const c = choiceFor(m.student_id, d); return c && c.locked; }).map((m) => m.student_id);
                  return (
                    <th key={d}>
                      {OH_DAY_NAMES[d]}
                      {canPlace && lockedIds.length > 1 && (
                        <button type="button" className="secondary" disabled={busy} onClick={() => unlock(d, lockedIds, `all ${lockedIds.length} locked students`)}
                          style={{ marginLeft: '0.4rem', padding: '0.05rem 0.4rem', fontSize: '0.75rem' }}>Unlock all</button>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {current.map((m) => (
                <tr key={m.student_id}>
                  <td>{fullName(m.students)}</td>
                  {daysUsed.map((d) => {
                    const c = choiceFor(m.student_id, d);
                    if (!c) return <td key={d} style={{ color: 'var(--ink-soft)' }}>—</td>;
                    return (
                      <td key={d}>
                        {activityById[c.activity_id]?.activity_name || 'Activity'}
                        {c.locked && (
                          <div style={{ fontSize: '0.8rem', color: inForce(c) ? '#a3232c' : 'var(--ink-soft)' }}>
                            {inForce(c) ? '🔒 Locked' : 'Lock ended'}{c.locked_until ? ` until ${formatUKDate(c.locked_until)}` : ' until unlocked'}
                            {canPlace && (
                              <button type="button" className="secondary" disabled={busy} onClick={() => unlock(d, [m.student_id], fullName(m.students))}
                                style={{ marginLeft: '0.4rem', padding: '0.05rem 0.4rem', fontSize: '0.75rem' }}>Unlock</button>
                            )}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
