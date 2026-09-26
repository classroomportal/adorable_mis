'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { formatUKDate } from '../../../lib/formatDate';

// Printable top 10 students for one result set (a calendar event flagged
// is_result_set), for one year, every year on its own page, or the whole
// school ranked together. Ranked on percentage (score / max_score): overall
// is the student's average across the subjects they have a result in for
// that set; a subject ranking uses that subject alone.
//
// Only current (active) students are listed — it's for celebrating and
// following up, and someone who has left can't be given a certificate.

const TOP_N = 10;
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

// Top N by pct, keeping everyone tied with Nth place. Ranks are shared on a
// tie ("=3").
function topN(entries) {
  const sorted = [...entries].sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name));
  const out = [];
  sorted.forEach((e, i) => {
    const pctKey = e.pct.toFixed(1);
    const prev = out[out.length - 1];
    const rank = prev && prev.pct.toFixed(1) === pctKey ? prev.rank : i + 1;
    if (rank > TOP_N) return;
    out.push({ ...e, rank });
  });
  return out.map((e) => ({
    ...e,
    tied: out.filter((o) => o.rank === e.rank).length > 1,
  }));
}

function TopTenInner() {
  const [sets, setSets] = useState([]);
  const [eventId, setEventId] = useState('');
  const [yearChoice, setYearChoice] = useState('each'); // 'each' | 'all' | year number as string
  const [rankBy, setRankBy] = useState('overall'); // 'overall' | 'each' | subject label
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
          .select('student_id, score, max_score, subjects(subject_name, display_name), students!inner(first_name, last_name, year_group, form_class, status)')
          .gt('max_score', 0)
          .eq('students.status', 'active')
          // Older sets (T3 Exam) predate result_set_event_id and are linked by
          // week_start_date = the event's date, as in /results/subject-overview.
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

  // Per student: their year then, and a percentage per subject (averaged if a
  // subject has more than one result in the set).
  const students = useMemo(() => {
    const byStudent = new Map();
    rows.forEach((r) => {
      const st = r.students;
      if (!st || st.year_group == null || r.score == null) return;
      if (!byStudent.has(r.student_id)) {
        byStudent.set(r.student_id, {
          id: r.student_id,
          name: `${st.first_name} ${st.last_name}`,
          form: st.form_class || '',
          yearThen: st.year_group - yearsAgo,
          yearNow: st.year_group,
          subjects: new Map(),
        });
      }
      const label = r.subjects?.display_name || r.subjects?.subject_name || 'Unknown';
      const subj = byStudent.get(r.student_id).subjects;
      const cur = subj.get(label) || { sum: 0, n: 0 };
      cur.sum += (Number(r.score) / Number(r.max_score)) * 100;
      cur.n += 1;
      subj.set(label, cur);
    });
    return [...byStudent.values()];
  }, [rows, yearsAgo]);

  const years = useMemo(() => [...new Set(students.map((s) => s.yearThen))].sort((a, b) => a - b), [students]);
  const subjects = useMemo(
    () => [...new Set(students.flatMap((s) => [...s.subjects.keys()]))].sort((a, b) => a.localeCompare(b)),
    [students],
  );

  // Drop a year or subject choice the newly picked set doesn't have.
  useEffect(() => {
    if (!['each', 'all'].includes(yearChoice) && years.length && !years.includes(Number(yearChoice))) setYearChoice('each');
  }, [years]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!['overall', 'each'].includes(rankBy) && subjects.length && !subjects.includes(rankBy)) setRankBy('overall');
  }, [subjects]); // eslint-disable-line react-hooks/exhaustive-deps

  function yearLabel(y) {
    return yearsAgo > 0 ? `Year ${y} (now Year ${y + yearsAgo})` : `Year ${y}`;
  }

  // Each list is one printed page.
  const lists = useMemo(() => {
    let yearGroups;
    if (yearChoice === 'all') yearGroups = [{ title: 'All years', members: students }];
    else if (yearChoice === 'each') yearGroups = years.map((y) => ({ title: yearLabel(y), members: students.filter((s) => s.yearThen === y) }));
    else yearGroups = [{ title: yearLabel(Number(yearChoice)), members: students.filter((s) => s.yearThen === Number(yearChoice)) }];

    const measures = rankBy === 'overall' ? ['overall'] : rankBy === 'each' ? subjects : [rankBy];
    const out = [];
    yearGroups.forEach((g) => {
      measures.forEach((m) => {
        const entries = g.members.map((s) => {
          if (m === 'overall') {
            const pcts = [...s.subjects.values()].map((v) => v.sum / v.n);
            return { ...s, pct: pcts.reduce((a, b) => a + b, 0) / pcts.length, count: pcts.length };
          }
          const v = s.subjects.get(m);
          return v ? { ...s, pct: v.sum / v.n } : null;
        }).filter(Boolean);
        if (entries.length === 0) return;
        out.push({
          key: `${g.title}|${m}`,
          title: `${g.title} — ${m === 'overall' ? 'Overall' : m}`,
          overall: m === 'overall',
          ranked: entries.length,
          top: topN(entries),
        });
      });
    });
    return out;
  }, [students, years, subjects, yearChoice, rankBy, yearsAgo]); // eslint-disable-line react-hooks/exhaustive-deps

  const showYearColumn = yearChoice === 'all';

  return (
    <div>
      <div className="no-print">
        <h1>Top 10 Students</h1>
        <div className="card" style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label>
            Result set
            <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
              {sets.map((s) => (
                <option key={s.event_id} value={s.event_id}>{s.event_name} ({formatUKDate(s.event_date)})</option>
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
            Rank by
            <select value={rankBy} onChange={(e) => setRankBy(e.target.value)}>
              <option value="overall">Overall average</option>
              <option value="each">Each subject (a page per subject)</option>
              {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <button onClick={() => window.print()} disabled={loading || lists.length === 0}>Print</button>
        </div>
        <p style={{ color: '#555', fontSize: '0.9rem' }}>
          Ranked on percentage. Overall is each student&apos;s average across the subjects they have a result in for this set.
          Students tied on 10th place are all listed. Current students only.
        </p>
        {error && <p style={{ color: '#a3232c' }}>Error: {error}</p>}
      </div>

      {loading ? <p>Loading…</p> : !set ? null : lists.length === 0 ? (
        <p>No results in {set.event_name} yet.</p>
      ) : lists.map((l) => (
        <section className="top-ten-page" key={l.key}>
          <h2>{l.title}</h2>
          <p className="top-ten-meta">
            Top {TOP_N} · {set.event_name} ({formatUKDate(set.event_date)}) · {l.ranked} student{l.ranked === 1 ? '' : 's'} ranked
          </p>
          <table className="top-ten-table">
            <thead>
              <tr>
                <th style={{ width: '3rem' }}>Rank</th>
                <th>Student</th>
                {showYearColumn && <th>Year</th>}
                <th>Form</th>
                {l.overall && <th style={{ textAlign: 'right' }}>Subjects</th>}
                <th style={{ textAlign: 'right' }}>{l.overall ? 'Average' : 'Score'}</th>
              </tr>
            </thead>
            <tbody>
              {l.top.map((e) => (
                <tr key={e.id}>
                  <td>{e.tied ? '=' : ''}{e.rank}</td>
                  <td>{e.name}</td>
                  {showYearColumn && <td>{e.yearThen}</td>}
                  <td>{e.form}</td>
                  {l.overall && <td style={{ textAlign: 'right' }}>{e.count}</td>}
                  <td style={{ textAlign: 'right' }}>{e.pct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

export default function TopTenPage() {
  return (
    <RequireAuth>
      <RequireResource resourceKey="/results/top-ten">
        <TopTenInner />
      </RequireResource>
    </RequireAuth>
  );
}
