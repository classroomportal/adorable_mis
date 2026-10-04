'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { useAuth } from '../../../lib/AuthContext';
import { schoolToday } from '../../../lib/schoolTime';
import { formatUKDate } from '../../../lib/formatDate';

// Running totals of positive and negative behaviour points (migration 361,
// behaviour_totals()), the principal 4 Oct 2026. Mentors see their own
// group, student by student; SMT, pastoral and head of boarding see every
// mentor group with its average (net points ÷ active students in the group,
// including those with no events) and can open any group. Voided events are
// left out. The narrowing to a mentor's group is display only: every member
// of staff can already read behaviour events.

const WHOLE_SCHOOL_ROLES = ['smt', 'pastoral', 'head_of_boarding'];

const studentName = (s) => `${s.first_name} ${s.last_name}${s.preferred_name && s.preferred_name !== s.first_name ? ` (${s.preferred_name})` : ''}`;
const signed = (n) => (n > 0 ? `+${n}` : String(n));
const netColour = (n) => (n > 0 ? '#1a7f37' : n < 0 ? '#b42318' : undefined);

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename, header, rows) {
  const text = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function summarise(students) {
  const t = { count: students.length, positive: 0, negative: 0, positiveCount: 0, negativeCount: 0 };
  students.forEach((s) => {
    t.positive += s.positive_points;
    t.negative += s.negative_points;
    t.positiveCount += s.positive_count;
    t.negativeCount += s.negative_count;
  });
  t.net = t.positive + t.negative;
  t.average = t.count ? t.net / t.count : 0;
  return t;
}

function StudentTable({ students, title, from, to }) {
  const [sort, setSort] = useState('net_desc');
  const sorted = useMemo(() => {
    const list = [...students];
    const byName = (a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name);
    if (sort === 'name') list.sort(byName);
    else if (sort === 'net_asc') list.sort((a, b) => a.net_points - b.net_points || byName(a, b));
    else if (sort === 'negative') list.sort((a, b) => a.negative_points - b.negative_points || byName(a, b));
    else list.sort((a, b) => b.net_points - a.net_points || byName(a, b));
    return list;
  }, [students, sort]);
  const t = summarise(students);

  function exportCsv() {
    downloadCsv(
      `behaviour-totals-${title.replace(/[^\w-]+/g, '_')}-${from}-to-${to}.csv`,
      ['Student', 'Year', 'Mentor group', 'Positive events', 'Positive points', 'Negative events', 'Negative points', 'Net points'],
      sorted.map((s) => [studentName(s), s.year_group, s.mentor_class_code || '', s.positive_count, s.positive_points, s.negative_count, s.negative_points, s.net_points]),
    );
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort students">
            <option value="net_desc">Net: highest first</option>
            <option value="net_asc">Net: lowest first</option>
            <option value="negative">Most negative points</option>
            <option value="name">Surname</option>
          </select>
          <button type="button" className="secondary" onClick={exportCsv} disabled={students.length === 0}>Download CSV</button>
        </div>
      </div>
      <p style={{ margin: '0.5rem 0' }}>
        {t.count} students · positives <strong style={{ color: '#1a7f37' }}>{signed(t.positive)}</strong> ({t.positiveCount})
        · negatives <strong style={{ color: '#b42318' }}>{t.negative}</strong> ({t.negativeCount})
        · net <strong style={{ color: netColour(t.net) }}>{signed(t.net)}</strong>
        · average per student <strong style={{ color: netColour(t.average) }}>{signed(Number(t.average.toFixed(1)))}</strong>
      </p>
      {students.length === 0 ? <p>No students.</p> : (
        <div className="table-scroll"><table>
          <thead>
            <tr>
              <th>Student</th>
              <th>Year</th>
              <th style={{ textAlign: 'right' }}>Positive</th>
              <th style={{ textAlign: 'right' }}>Negative</th>
              <th style={{ textAlign: 'right' }}>Net</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr key={s.student_id}>
                <td><Link href={`/students/${s.student_id}#behaviour`} title="Open this student's behaviour log">{studentName(s)}</Link></td>
                <td>{s.year_group}</td>
                <td style={{ textAlign: 'right', color: '#1a7f37' }}>{signed(s.positive_points)} <span style={{ color: '#667', fontSize: '0.8rem' }}>({s.positive_count})</span></td>
                <td style={{ textAlign: 'right', color: '#b42318' }}>{s.negative_points} <span style={{ color: '#667', fontSize: '0.8rem' }}>({s.negative_count})</span></td>
                <td style={{ textAlign: 'right', fontWeight: 600, color: netColour(s.net_points) }}>{signed(s.net_points)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      <p style={{ fontSize: '0.8rem', color: '#667', margin: '0.5rem 0 0' }}>Points, with the number of events in brackets.</p>
    </div>
  );
}

function BehaviourTotalsInner() {
  const { profile, staffRoles } = useAuth();
  const wholeSchool = profile?.role === 'admin' || (staffRoles || []).some((r) => WHOLE_SCHOOL_ROLES.includes(r));

  const [periods, setPeriods] = useState(null);
  const [periodKey, setPeriodKey] = useState('');
  const [customFrom, setCustomFrom] = useState(schoolToday());
  const [customTo, setCustomTo] = useState(schoolToday());
  const [rows, setRows] = useState(null);
  const [staff, setStaff] = useState({});
  const [error, setError] = useState(null);
  const [year, setYear] = useState('');
  const [groupId, setGroupId] = useState(null);
  const [groupSort, setGroupSort] = useState('average');

  // Periods: this academic year and each of its terms, the current term
  // chosen to start with.
  useEffect(() => {
    (async () => {
      const today = schoolToday();
      const { data: ay } = await supabase.from('academic_years').select('academic_year_id, label, start_date, end_date').eq('status', 'current').maybeSingle();
      let terms = [];
      if (ay) {
        const { data: t } = await supabase.from('terms').select('term_id, term_name, start_date, end_date')
          .eq('academic_year_id', ay.academic_year_id).order('start_date');
        terms = t || [];
      }
      const list = terms.map((t) => ({ key: `term-${t.term_id}`, label: t.term_name, from: t.start_date, to: t.end_date }));
      if (ay) list.push({ key: 'year', label: `Academic year ${ay.label}`, from: ay.start_date, to: ay.end_date });
      list.push({ key: 'custom', label: 'Choose dates…' });
      setPeriods(list);
      const current = list.find((p) => p.from && p.key !== 'year' && p.from <= today && today <= p.to)
        || [...list].reverse().find((p) => p.from && p.key !== 'year' && p.from <= today)
        || list[0];
      setPeriodKey(current.key);
    })();
  }, []);

  const period = (periods || []).find((p) => p.key === periodKey);
  const from = period?.key === 'custom' ? customFrom : period?.from;
  const to = period?.key === 'custom' ? customTo : (period?.to && period.to < schoolToday() ? period.to : schoolToday());

  useEffect(() => {
    if (!from || !to) return;
    let cancelled = false;
    setRows(null);
    supabase.rpc('behaviour_totals', { p_from: from, p_to: to }).then(({ data, error: e }) => {
      if (cancelled) return;
      if (e) { setError(e.message); setRows([]); return; }
      setError(null);
      setRows(data || []);
    });
    return () => { cancelled = true; };
  }, [from, to]);

  useEffect(() => {
    supabase.from('staff').select('staff_id, first_name, last_name').then(({ data }) => {
      setStaff(Object.fromEntries((data || []).map((s) => [s.staff_id, s])));
    });
  }, []);

  const groups = useMemo(() => {
    const map = new Map();
    (rows || []).forEach((r) => {
      const key = r.mentor_class_id ?? 0;
      if (!map.has(key)) map.set(key, { id: key, code: r.mentor_class_code || 'No mentor group', staffId: r.mentor_staff_id, students: [] });
      map.get(key).students.push(r);
    });
    return [...map.values()].map((g) => ({
      ...g,
      year: Math.min(...g.students.map((s) => s.year_group)),
      ...summarise(g.students),
    }));
  }, [rows]);

  const myGroups = groups.filter((g) => profile?.staff_id && g.staffId === profile.staff_id);
  const years = [...new Set(groups.map((g) => g.year))].sort((a, b) => a - b);
  const shownGroups = useMemo(() => {
    const list = groups.filter((g) => !year || g.year === Number(year));
    if (groupSort === 'name') list.sort((a, b) => a.year - b.year || a.code.localeCompare(b.code));
    else list.sort((a, b) => b.average - a.average || a.code.localeCompare(b.code));
    return list;
  }, [groups, year, groupSort]);
  const shownTotal = summarise(shownGroups.flatMap((g) => g.students));
  const selected = groups.find((g) => g.id === groupId);
  const mentorName = (id) => (staff[id] ? `${staff[id].first_name} ${staff[id].last_name}` : '');

  function exportGroups() {
    downloadCsv(
      `behaviour-totals-groups${year ? `-year${year}` : ''}-${from}-to-${to}.csv`,
      ['Mentor group', 'Year', 'Mentor', 'Students', 'Positive events', 'Positive points', 'Negative events', 'Negative points', 'Net points', 'Average per student'],
      shownGroups.map((g) => [g.code, g.year, mentorName(g.staffId), g.count, g.positiveCount, g.positive, g.negativeCount, g.negative, g.net, g.average.toFixed(2)]),
    );
  }

  return (
    <div>
      <h1>Behaviour Totals</h1>
      <p>
        Running totals of positive and negative behaviour points. Net is positives minus negatives;
        a group&apos;s average is its net points divided by the number of students in it, including
        students with no events. Voided events don&apos;t count.
      </p>

      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
        <label>Period{' '}
          <select value={periodKey} onChange={(e) => setPeriodKey(e.target.value)}>
            {(periods || []).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </label>
        {period?.key === 'custom' && (
          <>
            <label>From <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} /></label>
            <label>To <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} /></label>
          </>
        )}
        {from && to && <span style={{ color: '#667' }}>{formatUKDate(from)} to {formatUKDate(to)}</span>}
      </div>

      {error && <p style={{ color: '#a3232c' }}>{error}</p>}
      {rows === null ? <p>Loading...</p> : (
        <>
          {myGroups.map((g) => (
            <StudentTable key={g.id} students={g.students} title={`My mentor group: ${g.code}`} from={from} to={to} />
          ))}
          {!wholeSchool && myGroups.length === 0 && (
            <div className="card"><p>You aren&apos;t the mentor of a mentor group on the timetable, so there is nothing to show.</p></div>
          )}

          {wholeSchool && (
            <div className="card">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between' }}>
                <h2 style={{ margin: 0 }}>Mentor groups</h2>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                  <select value={year} onChange={(e) => { setYear(e.target.value); setGroupId(null); }} aria-label="Year group">
                    <option value="">All years</option>
                    {years.map((y) => <option key={y} value={y}>Year {y}</option>)}
                  </select>
                  <select value={groupSort} onChange={(e) => setGroupSort(e.target.value)} aria-label="Sort groups">
                    <option value="average">Average: highest first</option>
                    <option value="name">Year and group</option>
                  </select>
                  <button type="button" className="secondary" onClick={exportGroups} disabled={shownGroups.length === 0}>Download CSV</button>
                </div>
              </div>
              <div className="table-scroll"><table>
                <thead>
                  <tr>
                    <th>Group</th>
                    <th>Mentor</th>
                    <th style={{ textAlign: 'right' }}>Students</th>
                    <th style={{ textAlign: 'right' }}>Positive</th>
                    <th style={{ textAlign: 'right' }}>Negative</th>
                    <th style={{ textAlign: 'right' }}>Net</th>
                    <th style={{ textAlign: 'right' }}>Average</th>
                  </tr>
                </thead>
                <tbody>
                  {shownGroups.map((g) => (
                    <tr key={g.id} onClick={() => setGroupId(g.id === groupId ? null : g.id)}
                      style={{ cursor: 'pointer', background: g.id === groupId ? '#fff7e0' : undefined }}>
                      <td style={{ textDecoration: 'underline' }}>{g.code}</td>
                      <td>{mentorName(g.staffId)}</td>
                      <td style={{ textAlign: 'right' }}>{g.count}</td>
                      <td style={{ textAlign: 'right', color: '#1a7f37' }}>{signed(g.positive)}</td>
                      <td style={{ textAlign: 'right', color: '#b42318' }}>{g.negative}</td>
                      <td style={{ textAlign: 'right', color: netColour(g.net) }}>{signed(g.net)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: netColour(g.average) }}>{signed(Number(g.average.toFixed(1)))}</td>
                    </tr>
                  ))}
                  <tr style={{ fontWeight: 600, borderTop: '2px solid #ccd' }}>
                    <td colSpan={2}>{year ? `Year ${year}` : 'Whole school'}</td>
                    <td style={{ textAlign: 'right' }}>{shownTotal.count}</td>
                    <td style={{ textAlign: 'right', color: '#1a7f37' }}>{signed(shownTotal.positive)}</td>
                    <td style={{ textAlign: 'right', color: '#b42318' }}>{shownTotal.negative}</td>
                    <td style={{ textAlign: 'right', color: netColour(shownTotal.net) }}>{signed(shownTotal.net)}</td>
                    <td style={{ textAlign: 'right', color: netColour(shownTotal.average) }}>{signed(Number(shownTotal.average.toFixed(1)))}</td>
                  </tr>
                </tbody>
              </table></div>
              <p style={{ fontSize: '0.8rem', color: '#667', margin: '0.5rem 0 0' }}>Click a group to see its students.</p>
            </div>
          )}

          {wholeSchool && selected && (
            <StudentTable students={selected.students} title={`${selected.code}${selected.staffId ? ` (${mentorName(selected.staffId)})` : ''}`} from={from} to={to} />
          )}
        </>
      )}
    </div>
  );
}

export default function BehaviourTotalsPage() {
  return <RequireAuth><RequireResource resourceKey="/pastoral/behaviour-totals"><BehaviourTotalsInner /></RequireResource></RequireAuth>;
}
