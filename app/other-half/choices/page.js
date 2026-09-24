'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { OH_DAYS, OH_DAY_NAMES, formatYearGroups, loadOtherHalfSlots, loadCurrentOtherHalfTermId } from '../../../lib/otherHalf';

// Supabase caps an unranged select at 1000 rows; a term's choices can pass
// that (≈280 students × 5 days), so page through.
async function fetchAll(buildQuery) {
  const pageSize = 1000;
  let all = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < pageSize) return all;
  }
}

function ChoicesInner() {
  const [terms, setTerms] = useState([]);
  const [termId, setTermId] = useState(null);
  const [days, setDays] = useState(OH_DAYS);
  const [day, setDay] = useState(null);
  const [students, setStudents] = useState([]);
  const [activities, setActivities] = useState([]);
  const [choices, setChoices] = useState({}); // student_id -> activity_id, for this term + day
  const [yearFilter, setYearFilter] = useState('');
  const [onlyUnchosen, setOnlyUnchosen] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(null);

  useEffect(() => {
    async function loadStatic() {
      const [{ data: t }, slots, currentTerm, st] = await Promise.all([
        supabase.from('terms').select('*').order('start_date'),
        loadOtherHalfSlots(),
        loadCurrentOtherHalfTermId(),
        fetchAll(() => supabase.from('students').select('student_id, first_name, last_name, preferred_name, year_group, form_class').eq('status', 'active').order('year_group').order('last_name')),
      ]);
      setTerms(t || []);
      if (slots.days.length) setDays(slots.days);
      setTermId(currentTerm ?? t?.[0]?.term_id ?? null);
      setStudents(st);
      // Open on today's OH if there is one, otherwise the first day.
      const today = new Date().toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', weekday: 'short' });
      setDay((slots.days.includes(today) ? today : slots.days[0]) || 'Mon');
    }
    loadStatic();
  }, []);

  async function loadChoices() {
    if (!termId || !day) return;
    const [{ data: acts }, rows] = await Promise.all([
      supabase.from('other_half_activities').select('*').eq('term_id', termId).eq('day_of_week', day).order('activity_name'),
      fetchAll(() => supabase.from('other_half_choices').select('student_id, activity_id').eq('term_id', termId).eq('day_of_week', day).order('choice_id')),
    ]);
    setActivities(acts || []);
    setChoices(Object.fromEntries(rows.map((r) => [r.student_id, r.activity_id])));
  }

  useEffect(() => { loadChoices(); setStatus(null); }, [termId, day]);

  const activityById = Object.fromEntries(activities.map((a) => [a.activity_id, a]));
  const countByActivity = {};
  for (const aid of Object.values(choices)) countByActivity[aid] = (countByActivity[aid] || 0) + 1;

  async function setChoice(student, activityId) {
    const name = `${student.first_name} ${student.last_name}`;
    if (!activityId) {
      const { error } = await supabase.from('other_half_choices').delete()
        .eq('student_id', student.student_id).eq('term_id', termId).eq('day_of_week', day);
      if (error) { setStatus(`Error: ${error.message}`); return; }
      setChoices(({ [student.student_id]: _gone, ...rest }) => rest);
      setStatus(`${name}: choice removed.`);
      return;
    }
    const a = activityById[activityId];
    // Staff can place a student outside the rules on purpose (a Year 9 who
    // needs to be in the Year 10 group, one over the limit) — but say so.
    const warnings = [];
    if (a && !a.year_groups.includes(student.year_group)) warnings.push(`${a.activity_name} isn't open to Year ${student.year_group}`);
    if (a?.capacity != null && (countByActivity[activityId] || 0) >= a.capacity && choices[student.student_id] !== activityId) warnings.push(`${a.activity_name} is already full (${a.capacity})`);
    if (warnings.length && !window.confirm(`${warnings.join(', and ')}. Put ${name} in it anyway?`)) return;

    const { error } = await supabase.from('other_half_choices').upsert(
      { student_id: student.student_id, activity_id: activityId, term_id: termId, day_of_week: day, chosen_at: new Date().toISOString() },
      { onConflict: 'student_id,term_id,day_of_week' },
    );
    if (error) { setStatus(`Error: ${error.message}`); return; }
    setChoices((c) => ({ ...c, [student.student_id]: activityId }));
    setStatus(`${name} → ${a?.activity_name}.`);
  }

  const years = [...new Set(students.map((s) => s.year_group))].sort((a, b) => a - b);
  // Years that have anything to choose from on this day; the rest aren't expected to choose.
  const eligibleYears = new Set(activities.filter((a) => a.is_active).flatMap((a) => a.year_groups));
  const expected = students.filter((s) => eligibleYears.has(s.year_group));
  const unchosen = expected.filter((s) => !choices[s.student_id]);

  const q = search.trim().toLowerCase();
  const shown = students.filter((s) =>
    (!yearFilter || String(s.year_group) === yearFilter)
    && (!onlyUnchosen || (!choices[s.student_id] && eligibleYears.has(s.year_group)))
    && (!q || `${s.first_name} ${s.last_name} ${s.preferred_name || ''} ${s.form_class || ''}`.toLowerCase().includes(q)));

  function downloadCsv() {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Activity', 'Room', 'Student', 'Year', 'Form'].map(esc).join(',')];
    const sorted = [...students].filter((s) => choices[s.student_id])
      .sort((x, y) => (activityById[choices[x.student_id]]?.activity_name || '').localeCompare(activityById[choices[y.student_id]]?.activity_name || '') || x.last_name.localeCompare(y.last_name));
    for (const s of sorted) {
      const a = activityById[choices[s.student_id]];
      lines.push([a?.activity_name, a?.room, `${s.first_name} ${s.last_name}`, s.year_group, s.form_class].map(esc).join(','));
    }
    const term = terms.find((t) => t.term_id === termId);
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Other Half ${OH_DAY_NAMES[day]} ${term?.term_name || ''}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <h1>Other Half — Student Choices</h1>

      <div className="card">
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label>
            Term
            <select value={termId ?? ''} onChange={(e) => setTermId(Number(e.target.value))}>
              {terms.map((t) => <option key={t.term_id} value={t.term_id}>{t.term_name}</option>)}
            </select>
          </label>
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
            {days.map((d) => (
              <button key={d} type="button" className={d === day ? '' : 'secondary'} onClick={() => setDay(d)}>{OH_DAY_NAMES[d]}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h2 style={{ margin: 0 }}>{day ? OH_DAY_NAMES[day] : ''} activities</h2>
          {Object.keys(choices).length > 0 && <button type="button" className="secondary" onClick={downloadCsv}>Download lists (CSV)</button>}
        </div>
        {activities.length === 0 ? (
          <p>No activities on this day yet — add them on <a href="/other-half/activities">Activity Programme</a>.</p>
        ) : (
          <div className="table-scroll"><table>
            <thead><tr><th>Activity</th><th>Room</th><th>Open to</th><th>Students</th></tr></thead>
            <tbody>
              {activities.map((a) => {
                const n = countByActivity[a.activity_id] || 0;
                return (
                  <tr key={a.activity_id} style={a.is_active ? undefined : { opacity: 0.55 }}>
                    <td>{a.activity_name}{!a.is_active && ' (retired)'}</td>
                    <td>{a.room || '—'}</td>
                    <td>{formatYearGroups(a.year_groups)}</td>
                    <td style={a.capacity != null && n > a.capacity ? { color: '#b91c1c', fontWeight: 600 } : undefined}>
                      {n}{a.capacity != null ? ` / ${a.capacity}` : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
        {activities.length > 0 && (
          <p style={{ marginBottom: 0 }}>
            <strong>{expected.length - unchosen.length}</strong> of {expected.length} students in eligible years have a choice for {OH_DAY_NAMES[day]}.
            {unchosen.length > 0 && <> <button type="button" className="secondary" onClick={() => { setOnlyUnchosen(true); setYearFilter(''); }}>Show the {unchosen.length} without one</button></>}
          </p>
        )}
      </div>

      <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.75rem' }}>
          <label>
            Year
            <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
              <option value="">All years</option>
              {years.map((y) => <option key={y} value={y}>Year {y}</option>)}
            </select>
          </label>
          <label>
            Search
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or form" />
          </label>
          <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={onlyUnchosen} onChange={(e) => setOnlyUnchosen(e.target.checked)} />
            Only students without a choice
          </label>
        </div>
        {status && <p><strong>{status}</strong></p>}
        <div className="table-scroll"><table>
          <thead><tr><th>Student</th><th>Year</th><th>Form</th><th>Activity</th></tr></thead>
          <tbody>
            {shown.map((s) => {
              const current = choices[s.student_id];
              const options = activities.filter((a) => (a.is_active && a.year_groups.includes(s.year_group)) || a.activity_id === current);
              const others = activities.filter((a) => a.is_active && !options.includes(a));
              return (
                <tr key={s.student_id}>
                  <td>{s.first_name} {s.last_name}</td>
                  <td>{s.year_group}</td>
                  <td>{s.form_class || '—'}</td>
                  <td>
                    <select
                      value={current || ''}
                      onChange={(e) => setChoice(s, e.target.value ? Number(e.target.value) : null)}
                      aria-label={`Other Half activity — ${s.first_name} ${s.last_name}`}
                      style={!current && eligibleYears.has(s.year_group) ? { borderColor: '#b45309' } : undefined}
                    >
                      <option value="">{eligibleYears.has(s.year_group) ? '— not chosen —' : '—'}</option>
                      {options.map((a) => {
                        const n = countByActivity[a.activity_id] || 0;
                        return <option key={a.activity_id} value={a.activity_id}>{a.activity_name}{a.capacity != null ? ` (${n}/${a.capacity})` : ''}</option>;
                      })}
                      {others.length > 0 && (
                        <optgroup label="Not open to this year">
                          {others.map((a) => <option key={a.activity_id} value={a.activity_id}>{a.activity_name}</option>)}
                        </optgroup>
                      )}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        {shown.length === 0 && <p>No students match.</p>}
      </div>
    </div>
  );
}

export default function OtherHalfChoicesPage() {
  return (
    <RequireAuth><RequireResource resourceKey="/other-half/choices">
      <ChoicesInner />
    </RequireResource></RequireAuth>
  );
}
