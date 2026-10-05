'use client';
import { useEffect, useMemo, useState, Fragment } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { ROLE_LABELS } from '../../lib/staffRoles';
import { loadOtherHalfSlots, loadCurrentOtherHalfTermId } from '../../lib/otherHalf';

// "When is a group free?" on the Timetable page: pick staff (a whole role,
// e.g. every Head of Department, and/or individuals) and see each period of
// the week marked with who is free. Busy means a lesson (the lesson's own
// teacher where Nova-T gives one, migration 182, else the class's), a
// Nova-T commitment, or an Other Half activity this term. Reads only what
// the Timetable page already reads; no new data rules.

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

const name = (s) => `${s.first_name} ${s.last_name}`;

export default function GroupFreeTimes({ staffList, periods }) {
  const [roles, setRoles] = useState([]); // staff_roles rows
  const [selected, setSelected] = useState([]); // staff_ids
  const [busy, setBusy] = useState({}); // `${day}-${period}` -> [{ staffId, what }]
  const [taught, setTaught] = useState(new Set()); // staff with any lesson
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [freeOnly, setFreeOnly] = useState(false);
  const [openCell, setOpenCell] = useState(null); // { day, period } tapped for detail

  useEffect(() => {
    supabase.from('staff_roles').select('staff_id, role_name, scope_value')
      .then(({ data }) => setRoles(data || []));
  }, []);

  const staffById = useMemo(() => new Map(staffList.map((s) => [s.staff_id, s])), [staffList]);

  const roleOptions = useMemo(() => {
    const counts = {};
    roles.forEach((r) => { counts[r.role_name] = (counts[r.role_name] || 0) + 1; });
    return Object.keys(counts)
      .map((k) => ({ key: k, label: ROLE_LABELS[k] || k, count: counts[k] }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [roles]);

  function addRole(roleName) {
    if (!roleName) return;
    const ids = [...new Set(roles.filter((r) => r.role_name === roleName).map((r) => r.staff_id))];
    setSelected((cur) => [...new Set([...cur, ...ids])].filter((id) => staffById.has(id)));
  }

  const remove = (id) => setSelected((cur) => cur.filter((x) => x !== id));

  function addPerson(id) {
    if (!id) return;
    setSelected((cur) => (cur.includes(id) ? cur : [...cur, id]));
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (selected.length === 0) { setBusy({}); setTaught(new Set()); return; }
      setLoading(true);
      setError(null);
      const ohTermId = await loadCurrentOtherHalfTermId();
      const ohSlots = await loadOtherHalfSlots();
      const slotCols = 'slot_id, day_of_week, period_number, staff_id';
      const [own, given, commitments, oh] = await Promise.all([
        supabase.from('classes').select(`class_code, staff_id, timetable_slots(${slotCols})`).in('staff_id', selected),
        supabase.from('timetable_slots').select(`${slotCols}, classes!inner(class_code)`).in('staff_id', selected),
        supabase.from('staff_commitments').select('staff_id, day_of_week, period_number, label').in('staff_id', selected),
        supabase
          .from('other_half_activity_staff')
          .select('staff_id, other_half_activities!inner(activity_name, day_of_week, term_id, is_active)')
          .in('staff_id', selected)
          .eq('other_half_activities.term_id', ohTermId ?? -1)
          .eq('other_half_activities.is_active', true),
      ]);
      if (cancelled) return;
      const err = own.error || given.error || commitments.error || oh.error;
      if (err) { setError(err.message); setLoading(false); return; }

      const map = {};
      const seen = new Set(); // staffId-slotId, so a lesson isn't counted twice
      const lessonStaff = new Set();
      const add = (staffId, day, period, what) => {
        const key = `${day}-${period}`;
        (map[key] ||= []).push({ staffId, what });
      };
      (own.data || []).forEach((c) => {
        (c.timetable_slots || []).forEach((t) => {
          if (t.staff_id && t.staff_id !== c.staff_id) return; // given to someone else
          seen.add(`${c.staff_id}-${t.slot_id}`);
          lessonStaff.add(c.staff_id);
          add(c.staff_id, t.day_of_week, t.period_number, c.class_code);
        });
      });
      (given.data || []).forEach((t) => {
        if (seen.has(`${t.staff_id}-${t.slot_id}`)) return;
        lessonStaff.add(t.staff_id);
        add(t.staff_id, t.day_of_week, t.period_number, t.classes?.class_code);
      });
      (commitments.data || []).forEach((cm) => add(cm.staff_id, cm.day_of_week, cm.period_number, cm.label?.trim()));
      (oh.data || []).forEach((r) => {
        const a = r.other_half_activities;
        const slot = a && ohSlots.byDay[a.day_of_week];
        if (slot) add(r.staff_id, a.day_of_week, slot.period_number, `OH: ${a.activity_name}`);
      });
      setBusy(map);
      setTaught(lessonStaff);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [selected]);

  const people = selected.map((id) => staffById.get(id)).filter(Boolean)
    .sort((a, b) => a.last_name.localeCompare(b.last_name));
  const total = people.length;
  const noLessons = people.filter((s) => !taught.has(s.staff_id));

  function cellInfo(day, period) {
    const entries = busy[`${day}-${period}`] || [];
    const busyIds = new Set(entries.map((e) => e.staffId));
    const free = people.filter((s) => !busyIds.has(s.staff_id));
    return { entries, free };
  }

  const allFreeSlots = [];
  DAYS.forEach((d) => periods.forEach((p) => {
    if (total > 0 && cellInfo(d, p.period_number).free.length === total) allFreeSlots.push(`${d} ${p.period_name}`);
  }));

  return (
    <div>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <p style={{ marginTop: 0 }}>
          Choose a group of staff to see when they are all free. Add everyone with a role (for example Head of Dept), then add or remove individuals.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
          <select value="" onChange={(e) => addRole(e.target.value)} style={{ flex: '1 1 14rem' }}>
            <option value="">Add everyone with a role…</option>
            {roleOptions.map((r) => (
              <option key={r.key} value={r.key}>{r.label} ({r.count})</option>
            ))}
          </select>
          <select value="" onChange={(e) => addPerson(Number(e.target.value))} style={{ flex: '1 1 14rem' }}>
            <option value="">Add a person…</option>
            {staffList.filter((s) => !selected.includes(s.staff_id)).map((s) => (
              <option key={s.staff_id} value={s.staff_id}>{name(s)}</option>
            ))}
          </select>
          {total > 0 && <button className="secondary" onClick={() => setSelected([])}>Clear</button>}
        </div>
        {total > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
            {people.map((s) => (
              <span key={s.staff_id} style={{ background: 'var(--brand-100)', borderRadius: '999px', padding: '0.15rem 0.6rem', fontSize: '0.8rem' }}>
                {name(s)}{' '}
                <span
                  role="button"
                  tabIndex={0}
                  onClick={() => remove(s.staff_id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') remove(s.staff_id); }}
                  title="Remove"
                  aria-label={`Remove ${name(s)}`}
                  style={{ cursor: 'pointer', fontWeight: 700, padding: '0 0.15rem' }}
                >×</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {total > 0 && !loading && !error && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          {allFreeSlots.length > 0
            ? <><strong>All {total} free:</strong> {allFreeSlots.join(', ')}</>
            : <strong>There is no period when all {total} are free.</strong>}
          {noLessons.length > 0 && (
            <p style={{ marginBottom: 0, fontSize: '0.85rem', opacity: 0.8 }}>
              No lessons on the timetable for {noLessons.map(name).join(', ')}, so they show as free all week.
            </p>
          )}
          <label style={{ display: 'block', marginTop: '0.5rem', fontSize: '0.85rem' }}>
            <input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} /> Show only periods when everyone is free
          </label>
        </div>
      )}

      {error && <p style={{ color: '#c0392b' }}>Could not load timetables: {error}</p>}
      {loading && <p>Loading...</p>}

      {total > 0 && !loading && !error && (
        <div className="table-scroll">
          <div className="timetable-grid">
            <div className="tt-head"></div>
            {DAYS.map((d) => <div key={d} className="tt-head">{d}</div>)}
            {periods.map((p) => (
              <Fragment key={p.period_number}>
                <div className="tt-cell tt-period-label">{p.period_name}</div>
                {DAYS.map((d) => {
                  const { entries, free } = cellInfo(d, p.period_number);
                  const allFree = free.length === total;
                  if (freeOnly && !allFree) return <div key={d} className="tt-cell" style={{ background: 'var(--slate-50)' }} />;
                  const bg = allFree ? '#dcf2e0' : free.length === 0 ? 'var(--slate-100)' : 'var(--yellow-100)';
                  const isOpen = openCell?.day === d && openCell?.period === p.period_number;
                  return (
                    <div
                      key={d}
                      className="tt-cell"
                      onClick={() => setOpenCell(isOpen ? null : { day: d, period: p.period_number, name: p.period_name })}
                      style={{ background: bg, cursor: 'pointer', outline: isOpen ? '2px solid var(--brand-700)' : undefined }}
                    >
                      <strong>{allFree ? 'All free' : `${free.length} of ${total} free`}</strong>
                      {!allFree && free.length > 0 && free.length <= 4 && (
                        <div style={{ opacity: 0.7, fontSize: '0.85em' }}>{free.map((s) => s.last_name).join(', ')}</div>
                      )}
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>
          {openCell && (() => {
            const { entries, free } = cellInfo(openCell.day, openCell.period);
            return (
              <div className="card" style={{ marginTop: '1rem' }}>
                <strong>{openCell.day} {openCell.name}</strong>
                <p style={{ margin: '0.4rem 0' }}><strong>Free:</strong> {free.length ? free.map(name).join(', ') : 'nobody'}</p>
                {entries.length > 0 && (
                  <div><strong>Busy:</strong>
                    <ul style={{ margin: '0.2rem 0 0', paddingLeft: '1.2rem' }}>
                      {entries.map((e, i) => (
                        <li key={i}>{staffById.get(e.staffId) ? name(staffById.get(e.staffId)) : '?'}: {e.what || 'busy'}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })()}
          <p style={{ fontSize: '0.8rem', opacity: 0.7 }}>Tap a period to see who is free, who is busy and why. Lessons, Nova-T commitments and this term&apos;s Other Half count as busy.</p>
        </div>
      )}
    </div>
  );
}
