'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { formatUKDate } from '../../../lib/formatDate';
import { OH_DAYS, OH_DAY_NAMES, loadOtherHalfSlots } from '../../../lib/otherHalf';

// Which year groups have the Other Half on which days (migration 386, the
// principal 6 Oct 2026). The grid is the rule: activities can only be opened
// to, and chosen by, a year on its ticked days, and the Nova-T import leaves
// out any lesson in the OH period on a ticked day. set_other_half_year_days()
// does the checks (who may, and nothing left on a day being unticked or
// lessons on a day being ticked) and logs the change.

const YEARS = [7, 8, 9, 10, 11, 12, 13];

function YearDaysInner() {
  const [slots, setSlots] = useState(null);
  const [saved, setSaved] = useState({}); // year -> days as stored
  const [ticks, setTicks] = useState({}); // year -> days as ticked here
  const [updated, setUpdated] = useState({}); // year -> updated_at
  const [lessons, setLessons] = useState({}); // `${year}|${day}` -> class codes in the OH period
  const [canEdit, setCanEdit] = useState(false);
  const [status, setStatus] = useState({}); // year -> message
  const [loading, setLoading] = useState(true);

  async function load() {
    const s = await loadOtherHalfSlots();
    const [{ data: rows }, { data: manage }, { data: ohLessons }] = await Promise.all([
      supabase.from('other_half_year_days').select('year_group, days, updated_at'),
      supabase.rpc('can_manage_other_half'),
      s.periodNumber
        ? supabase.from('timetable_slots').select('day_of_week, classes(class_code, year_group)').eq('period_number', s.periodNumber)
        : Promise.resolve({ data: [] }),
    ]);
    const stored = {};
    const when = {};
    for (const r of rows || []) { stored[r.year_group] = r.days || []; when[r.year_group] = r.updated_at; }
    const inPeriod = {};
    for (const l of ohLessons || []) {
      if (!l.classes) continue;
      const key = `${l.classes.year_group}|${l.day_of_week}`;
      (inPeriod[key] ||= new Set()).add(l.classes.class_code);
    }
    setSlots(s);
    setSaved(stored);
    setTicks(stored);
    setUpdated(when);
    setLessons(Object.fromEntries(Object.entries(inPeriod).map(([k, v]) => [k, [...v].sort()])));
    setCanEdit(!!manage);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function toggle(year, day) {
    setTicks((t) => {
      const days = t[year] || [];
      const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day];
      return { ...t, [year]: OH_DAYS.filter((d) => next.includes(d)) };
    });
    setStatus((st) => ({ ...st, [year]: null }));
  }

  async function saveYear(year) {
    setStatus((st) => ({ ...st, [year]: 'Saving...' }));
    const { error } = await supabase.rpc('set_other_half_year_days', { p_year_group: year, p_days: ticks[year] || [] });
    if (error) {
      setStatus((st) => ({ ...st, [year]: `Not saved: ${error.message}` }));
      return;
    }
    setSaved((sv) => ({ ...sv, [year]: ticks[year] || [] }));
    setUpdated((u) => ({ ...u, [year]: new Date().toISOString() }));
    setStatus((st) => ({ ...st, [year]: 'Saved.' }));
  }

  if (loading) return <p>Loading...</p>;
  const days = OH_DAYS.filter((d) => slots.byDay[d]);
  const same = (a, b) => (a || []).join() === (b || []).join();

  return (
    <div>
      <p><a href="/other-half">← The Other Half</a></p>
      <h1>Other Half Days</h1>
      <p style={{ color: '#555', maxWidth: '48rem' }}>
        Tick the days each year group has the Other Half. Activities can only be opened to a year group, and chosen by its students, on its ticked days.
        On an unticked day the year has lessons in that period instead: the Nova-T import keeps those lessons and leaves out any in the
        Other Half period on a ticked day.
      </p>
      {!canEdit && <p style={{ color: '#666' }}>Only SMT and the Other Half coordinator can change this.</p>}

      <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <div className="table-scroll"><table>
          <thead>
            <tr>
              <th>Year</th>
              {days.map((d) => <th key={d} style={{ textAlign: 'center' }}>{OH_DAY_NAMES[d]}</th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            {YEARS.map((y) => {
              const row = ticks[y];
              const changed = !same(row, saved[y]);
              return (
                <tr key={y}>
                  <td><strong>Year {y}</strong>{saved[y] === undefined && <div style={{ fontSize: '0.8em', color: '#999' }}>not set: any day</div>}</td>
                  {days.map((d) => {
                    const ticked = !!row?.includes(d);
                    const inPeriod = lessons[`${y}|${d}`];
                    return (
                      <td key={d} style={{ textAlign: 'center', background: ticked ? '#e8f5e9' : undefined }}>
                        <input
                          type="checkbox"
                          style={{ width: 'auto' }}
                          checked={ticked}
                          disabled={!canEdit}
                          onChange={() => toggle(y, d)}
                          aria-label={`Year ${y} has the Other Half on ${OH_DAY_NAMES[d]}`}
                        />
                        {inPeriod && (
                          <div style={{ fontSize: '0.75em', color: ticked ? '#c62828' : '#666' }}>
                            Lessons: {inPeriod.join(', ')}
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td style={{ minWidth: '10rem' }}>
                    {canEdit && changed && <button type="button" onClick={() => saveYear(y)}>Save Year {y}</button>}
                    {status[y] && <div style={{ fontSize: '0.85em', color: status[y].startsWith('Not saved') ? '#c62828' : '#1a7f37' }}>{status[y]}</div>}
                    {!status[y] && updated[y] && <div style={{ fontSize: '0.8em', color: '#999' }}>Changed {formatUKDate(updated[y].slice(0, 10))}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}

export default function OtherHalfYearDaysPage() {
  return (
    <RequireAuth><RequireResource resourceKey="/other-half/year-days">
      <YearDaysInner />
    </RequireResource></RequireAuth>
  );
}
