'use client';

import { useEffect, useMemo, useState } from 'react';
import { groupBySchoolYear, schoolYearGroupLabel } from '../../../lib/academicYear';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { formatUKDate } from '../../../lib/formatDate';

// Every student's marks in one result set, a row per student and a column per
// subject, for one year, every year on its own page, or the whole school
// (the principal, 8 Oct 2026: "a list of results from a year for a result
// set"). The full-list version of Top 10, reading results the same way, and
// shares its page permission (/results/top-ten), so the same people see both.
// Current (active) students only, as on Top 10.

// PostgREST returns at most 1000 rows a request; a result set is several thousand.
const PAGE_SIZE = 1000;

// UK academic year runs Sept–Aug. Returns the year the academic year started in.
function academicYearStart(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function SetSheetInner() {
  const [sets, setSets] = useState([]);
  const [eventId, setEventId] = useState('');
  const [yearChoice, setYearChoice] = useState('each'); // 'each' | 'all' | year number as string
  const [show, setShow] = useState('pct'); // 'pct' | 'grade'
  const [sortBy, setSortBy] = useState('name'); // 'name' | 'average'
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    supabase.from('calendar_events').select('event_id, event_date, event_name')
      .eq('is_result_set', true)
      .lte('event_date', todayISO())
      .order('event_date', { ascending: false })
      .then(({ data, error: e }) => {
        if (e) setError(e.message);
        setSets(data || []);
        if (data?.length) setEventId(String(data[0].event_id));
      });
  }, []);

  const set = sets.find((s) => String(s.event_id) === eventId);
  // A set from an earlier academic year was sat in the year group below the
  // one the student is in now, so years are labelled as they were then.
  const yearsAgo = set ? academicYearStart(todayISO()) - academicYearStart(set.event_date) : 0;

  useEffect(() => {
    if (!set) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      let all = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error: e } = await supabase
          .from('results')
          .select('result_id, student_id, score, max_score, grade, subjects(subject_name, display_name), students!inner(first_name, last_name, year_group, form_class, status)')
          .gt('max_score', 0)
          .eq('students.status', 'active')
          // Older sets (T3 Exam) predate result_set_event_id and are linked by
          // week_start_date = the event's date, as on Top 10.
          .or(`result_set_event_id.eq.${set.event_id},and(result_set_event_id.is.null,week_start_date.eq.${set.event_date})`)
          .order('result_id')
          .range(from, from + PAGE_SIZE - 1);
        if (e) { if (!cancelled) setError(e.message); break; }
        all = all.concat(data || []);
        if (!data || data.length < PAGE_SIZE) break;
      }
      if (!cancelled) { setRows(all); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [set?.event_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Per student: their year then, and per subject a percentage (averaged if a
  // subject has more than one result in the set) and the latest grade.
  const students = useMemo(() => {
    const byStudent = new Map();
    rows.forEach((r) => {
      const st = r.students;
      if (!st || st.year_group == null || r.score == null) return;
      if (!byStudent.has(r.student_id)) {
        byStudent.set(r.student_id, {
          id: r.student_id,
          first: st.first_name,
          last: st.last_name,
          form: st.form_class || '',
          yearThen: st.year_group - yearsAgo,
          subjects: new Map(),
        });
      }
      const label = r.subjects?.display_name || r.subjects?.subject_name || 'Unknown';
      const subj = byStudent.get(r.student_id).subjects;
      const cur = subj.get(label) || { sum: 0, n: 0, grade: null };
      cur.sum += (Number(r.score) / Number(r.max_score)) * 100;
      cur.n += 1;
      // Rows come in result_id order, so the last grade seen is the latest.
      if (r.grade) cur.grade = r.grade;
      subj.set(label, cur);
    });
    return [...byStudent.values()].map((s) => {
      const pcts = [...s.subjects.values()].map((v) => v.sum / v.n);
      return { ...s, avg: pcts.reduce((a, b) => a + b, 0) / pcts.length, count: pcts.length };
    });
  }, [rows, yearsAgo]);

  const years = useMemo(() => [...new Set(students.map((s) => s.yearThen))].sort((a, b) => a - b), [students]);

  // Drop a year choice the newly picked set doesn't have.
  useEffect(() => {
    if (!['each', 'all'].includes(yearChoice) && years.length && !years.includes(Number(yearChoice))) setYearChoice('each');
  }, [years]); // eslint-disable-line react-hooks/exhaustive-deps

  function yearLabel(y) {
    return yearsAgo > 0 ? `Year ${y} (now Year ${y + yearsAgo})` : `Year ${y}`;
  }

  // Each sheet is one printed page (or run of pages). Its subject columns are
  // only those someone in it has a mark in.
  const sheets = useMemo(() => {
    let groups;
    if (yearChoice === 'all') groups = [{ title: 'All years', members: students }];
    else if (yearChoice === 'each') groups = years.map((y) => ({ title: yearLabel(y), members: students.filter((s) => s.yearThen === y) }));
    else groups = [{ title: yearLabel(Number(yearChoice)), members: students.filter((s) => s.yearThen === Number(yearChoice)) }];

    const byName = (a, b) => a.last.localeCompare(b.last) || a.first.localeCompare(b.first);
    return groups.filter((g) => g.members.length).map((g) => ({
      title: g.title,
      subjects: [...new Set(g.members.flatMap((s) => [...s.subjects.keys()]))].sort((a, b) => a.localeCompare(b)),
      members: [...g.members].sort(sortBy === 'average' ? (a, b) => b.avg - a.avg || byName(a, b) : byName),
    }));
  }, [students, years, yearChoice, sortBy, yearsAgo]); // eslint-disable-line react-hooks/exhaustive-deps

  const showYearColumn = yearChoice === 'all';

  function cellText(s, subject) {
    const v = s.subjects.get(subject);
    if (!v) return '';
    return show === 'grade' ? (v.grade || '') : (v.sum / v.n).toFixed(1);
  }

  function downloadCsv() {
    const lines = [];
    sheets.forEach((sh, i) => {
      if (i > 0) lines.push('');
      if (sheets.length > 1) lines.push(csvCell(sh.title));
      lines.push([
        'Surname', 'First name', ...(showYearColumn ? ['Year'] : []), 'Form',
        ...sh.subjects.map((sub) => (show === 'grade' ? `${sub} grade` : `${sub} %`)),
        'Subjects', 'Average %',
      ].map(csvCell).join(','));
      sh.members.forEach((s) => {
        lines.push([
          s.last, s.first, ...(showYearColumn ? [s.yearThen] : []), s.form,
          ...sh.subjects.map((sub) => cellText(s, sub)),
          s.count, s.avg.toFixed(1),
        ].map(csvCell).join(','));
      });
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${set.event_name.replace(/[^\w-]+/g, '_')}-${set.event_date}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div>
      <div className="no-print">
        <h1>Result Set Sheet</h1>
        <div className="card" style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label>
            Result set
            <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
              {groupBySchoolYear(sets).map((g) => (
                <optgroup key={g.year} label={schoolYearGroupLabel(g)}>
                  {g.sets.map((s) => (
                    <option key={s.event_id} value={s.event_id}>{s.event_name} ({formatUKDate(s.event_date)})</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label>
            Year
            <select value={yearChoice} onChange={(e) => setYearChoice(e.target.value)}>
              <option value="each">Each year (a page per year)</option>
              <option value="all">All years together</option>
              {years.map((y) => <option key={y} value={y}>{yearLabel(y)}</option>)}
            </select>
          </label>
          <label>
            Show
            <select value={show} onChange={(e) => setShow(e.target.value)}>
              <option value="pct">Percentages</option>
              <option value="grade">Grades</option>
            </select>
          </label>
          <label>
            Order
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="name">By surname</option>
              <option value="average">Highest average first</option>
            </select>
          </label>
          <button onClick={() => window.print()} disabled={loading || sheets.length === 0}>Print</button>
          <button className="secondary" onClick={downloadCsv} disabled={loading || sheets.length === 0}>Download CSV</button>
        </div>
        <p style={{ color: '#555', fontSize: '0.9rem' }}>
          Every current student with a mark in this set. Average is the student&apos;s average percentage across the subjects
          they have a mark in. A blank means no mark in that subject.
        </p>
        {error && <p style={{ color: '#a3232c' }}>Error: {error}</p>}
      </div>

      {loading ? <p>Loading…</p> : !set ? null : sheets.length === 0 ? (
        <p>No results in {set.event_name} yet.</p>
      ) : sheets.map((sh) => (
        <section className="set-sheet-page" key={sh.title}>
          <h2>{sh.title}</h2>
          <p className="top-ten-meta">
            {set.event_name} ({formatUKDate(set.event_date)}) · {sh.members.length} student{sh.members.length === 1 ? '' : 's'}
            {show === 'pct' ? ' · percentages' : ' · grades'}
          </p>
          <div className="table-scroll">
            <table className="set-sheet-table">
              <thead>
                <tr>
                  <th>Student</th>
                  {showYearColumn && <th>Year</th>}
                  <th>Form</th>
                  {sh.subjects.map((sub) => <th key={sub} className="num">{sub}</th>)}
                  <th className="num">Average</th>
                </tr>
              </thead>
              <tbody>
                {sh.members.map((s) => (
                  <tr key={s.id}>
                    <td>{s.last}, {s.first}</td>
                    {showYearColumn && <td>{s.yearThen}</td>}
                    <td>{s.form}</td>
                    {sh.subjects.map((sub) => <td key={sub} className="num">{cellText(s, sub)}</td>)}
                    <td className="num"><strong>{s.avg.toFixed(1)}%</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

export default function ResultSetSheetPage() {
  return (
    <RequireAuth>
      {/* Shares Top 10's grant rather than having a resource of its own. */}
      <RequireResource resourceKey="/results/top-ten">
        <SetSheetInner />
      </RequireResource>
    </RequireAuth>
  );
}
