'use client';
import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';
import RequireResource from '../RequireResource';
import { useAuth } from '../../lib/AuthContext';
import { formatUKDate } from '../../lib/formatDate';
import {
  GAP_BANDS, gapBand, formatGap, formatMonths, formatChange, changeColour,
  loadReadingAgeHistory, summariseReadings, SOURCE_LABEL,
} from '../../lib/readingAge';
import ReadingAgeHistory, { GapBadge } from '../components/ReadingAgeHistory';

// Reading ages (migration 323): the gap between each student's reading age
// and their actual age, and how it changes over time. Literacy is one of the
// school's improvement targets, so the page answers three questions for a
// year group or form: where are they now (latest gap, by band), is it getting
// better (the average gap at each sitting), and who needs help (students,
// worst gap first, with the change since their first reading).
//
// Every reading comes from reading_age_history(): the admissions interview
// (once the applicant is enrolled), the school's own tests and NGRT. Ages and
// gaps are worked out there, from the date of birth and the test date.

const fullName = (s) => `${s.first_name} ${s.last_name}`;

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function mean(xs) {
  const v = xs.filter((x) => x != null);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
}

// The sitting a reading belongs to: the term it falls in, or the term just
// before it if it was taken in the holiday after; failing that (older
// readings, before terms were set up), the school year, September to August.
function periodFor(iso, terms) {
  const t = [...terms].reverse().find((tm) => tm.start_date <= iso);
  const daysAfterEnd = t?.end_date ? (new Date(iso) - new Date(t.end_date)) / 86400000 : 0;
  if (t && daysAfterEnd <= 120) {
    return { key: `t${t.term_id}`, label: t.term_name, sort: t.start_date };
  }
  const [y, m] = iso.split('-').map(Number);
  const start = m >= 9 ? y : y - 1;
  return { key: `y${start}`, label: `School year ${start}/${String(start + 1).slice(2)}`, sort: `${start}-09-01` };
}

function Stat({ label, value, sub, style }) {
  return (
    <div className="card" style={{ margin: 0, padding: '0.75rem 1rem', minWidth: '9rem', flex: '1 1 9rem', ...style }}>
      <div style={{ fontSize: '0.8rem', color: '#5b6472' }}>{label}</div>
      <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{value}</div>
      {sub && <div style={{ fontSize: '0.8rem', color: '#5b6472' }}>{sub}</div>}
    </div>
  );
}

// Average gap at each sitting, as a small line over time.
function TrendChart({ rows, width = 640, height = 160 }) {
  const pts = rows.filter((r) => r.avgGap != null);
  if (pts.length < 2) return null;
  const pad = { l: 52, r: 12, t: 10, b: 22 };
  const vals = pts.map((r) => r.avgGap).concat([0]);
  const lo = Math.min(...vals) - 3;
  const hi = Math.max(...vals) + 3;
  const x = (i) => pad.l + (i * (width - pad.l - pad.r)) / (pts.length - 1);
  const y = (v) => height - pad.b - ((v - lo) * (height - pad.t - pad.b)) / (hi - lo);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ maxWidth: `${width}px` }} role="img" aria-label="Average gap at each sitting">
      <line x1={pad.l} x2={width - pad.r} y1={y(0)} y2={y(0)} stroke="#8a93a0" strokeDasharray="4 4" />
      <text x={pad.l - 6} y={y(0) + 4} fontSize="11" textAnchor="end" fill="#5b6472">their age</text>
      <polyline points={pts.map((r, i) => `${x(i)},${y(r.avgGap)}`).join(' ')} fill="none" stroke="#2f6fa8" strokeWidth="2.5" />
      {pts.map((r, i) => (
        <g key={r.key}>
          <circle cx={x(i)} cy={y(r.avgGap)} r="4" fill={r.avgGap < 0 ? '#a3232c' : '#1a7a3d'}>
            <title>{`${r.label}: average gap ${formatGap(r.avgGap)} (${r.n} tested)`}</title>
          </circle>
          <text x={x(i)} y={y(r.avgGap) - 8} fontSize="11" textAnchor="middle" fill="#1f2733">{formatGap(r.avgGap)}</text>
        </g>
      ))}
    </svg>
  );
}

function ReadingAgesInner() {
  const { hasAccess } = useAuth();
  const router = useRouter();
  const canRecord = hasAccess('/reading-ages/record');
  const [students, setStudents] = useState(null);
  const [terms, setTerms] = useState([]);
  const [history, setHistory] = useState({});
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState({ year: '', form: '', band: '', name: '', tested: '' });
  const [sort, setSort] = useState('gap');
  const [open, setOpen] = useState(null);

  async function loadHistory() {
    const { byStudent, error: e } = await loadReadingAgeHistory();
    if (e) setError(e);
    setHistory(byStudent);
  }

  useEffect(() => {
    (async () => {
      const [{ data: s, error: e1 }, { data: t }] = await Promise.all([
        supabase.from('students').select('student_id, first_name, last_name, year_group, form_class, dob')
          .eq('status', 'active').order('last_name'),
        supabase.from('terms').select('term_id, term_name, start_date, end_date').order('start_date'),
      ]);
      if (e1) setError(e1.message);
      setStudents(s || []);
      setTerms(t || []);
    })();
    loadHistory();
  }, []);

  const years = useMemo(() => [...new Set((students || []).map((s) => s.year_group).filter(Boolean))].sort((a, b) => a - b), [students]);
  const forms = useMemo(() => [...new Set((students || [])
    .filter((s) => !filter.year || String(s.year_group) === filter.year)
    .map((s) => s.form_class).filter(Boolean))].sort(), [students, filter.year]);

  // The students in view (before the band filter), each with their summary.
  const cohort = useMemo(() => (students || [])
    .filter((s) => (!filter.year || String(s.year_group) === filter.year)
      && (!filter.form || s.form_class === filter.form))
    .map((s) => ({ ...s, readings: history[s.student_id] || [], sum: summariseReadings(history[s.student_id]) })),
  [students, history, filter.year, filter.form]);

  const tested = cohort.filter((s) => s.sum);
  const latestGaps = tested.map((s) => s.sum.latest.gap_months).filter((g) => g != null);
  const bandCounts = Object.fromEntries(GAP_BANDS.map((b) => [b.key, latestGaps.filter((g) => b.test(g)).length]));
  const withChange = tested.filter((s) => s.sum.change != null);
  const improved = withChange.filter((s) => s.sum.change > 0).length;

  // The cohort's average gap at each sitting.
  const trend = useMemo(() => {
    const byPeriod = {};
    for (const s of cohort) {
      for (const r of s.readings) {
        if (r.gap_months == null) continue;
        const p = periodFor(r.tested_on, terms);
        const row = (byPeriod[p.key] ||= { ...p, gaps: {}, sources: new Set() });
        // One reading per student per sitting: their latest in it.
        row.gaps[s.student_id] = r.gap_months;
        row.sources.add(r.source);
      }
    }
    return Object.values(byPeriod).sort((a, b) => a.sort.localeCompare(b.sort)).map((p) => {
      const gaps = Object.values(p.gaps);
      return {
        key: p.key, label: p.label, n: gaps.length, avgGap: mean(gaps),
        below: gaps.filter((g) => g < 0).length,
        wellBelow: gaps.filter((g) => g <= -24).length,
        sources: [...p.sources].map((k) => SOURCE_LABEL[k] || k).join(', '),
      };
    });
  }, [cohort, terms]);

  const name = filter.name.trim().toLowerCase();
  const shown = cohort
    .filter((s) => !name || fullName(s).toLowerCase().includes(name))
    .filter((s) => !filter.tested || (filter.tested === 'yes' ? !!s.sum : !s.sum))
    .filter((s) => !filter.band || (s.sum && gapBand(s.sum.latest.gap_months)?.key === filter.band))
    .sort((a, b) => {
      if (sort === 'name') return fullName(a).localeCompare(fullName(b));
      const key = sort === 'change' ? (s) => s.sum?.change : (s) => s.sum?.latest.gap_months;
      const va = key(a); const vb = key(b);
      if (va == null && vb == null) return a.last_name.localeCompare(b.last_name);
      if (va == null) return 1;
      if (vb == null) return -1;
      return va - vb;
    });

  function downloadCsv() {
    const header = ['Student', 'Year', 'Form', 'Readings', 'First test', 'First reading age', 'First gap (months)',
      'Latest test', 'Latest reading age', 'Age then', 'Latest gap (months)', 'Change since first (months)', 'Change since last (months)'];
    const lines = shown.map((s) => {
      const m = s.sum;
      return [fullName(s), s.year_group, s.form_class, m?.count || 0,
        m?.first.tested_on, m && formatMonths(m.first.reading_age_months), m?.first.gap_months,
        m?.latest.tested_on, m && formatMonths(m.latest.reading_age_months), m && formatMonths(m.latest.age_months), m?.latest.gap_months,
        m?.change, m?.sinceLast].map(csvCell).join(',');
    });
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `reading-ages${filter.year ? `-year-${filter.year}` : ''}${filter.form ? `-${filter.form}` : ''}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (!students) return <p>Loading...</p>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h1 style={{ margin: 0 }}>Reading Ages</h1>
        {canRecord && <button type="button" onClick={() => router.push('/reading-ages/record')}>Record a reading test</button>}
      </div>
      <p style={{ color: '#5b6472' }}>
        Each student&apos;s reading age against their actual age on the day they were tested. The gap is
        reading age minus age: negative means reading below their age. Readings come from the admissions
        interview, the school&apos;s own tests and NGRT.
      </p>
      {error && <p style={{ color: '#b42318' }}>{error}</p>}

      <div className="card">
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ maxWidth: '9rem' }}>Year group
            <select value={filter.year} onChange={(e) => setFilter({ ...filter, year: e.target.value, form: '' })}>
              <option value="">Whole school</option>
              {years.map((y) => <option key={y} value={y}>Year {y}</option>)}
            </select>
          </label>
          <label style={{ maxWidth: '9rem' }}>Form
            <select value={filter.form} onChange={(e) => setFilter({ ...filter, form: e.target.value })}>
              <option value="">All</option>
              {forms.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
        </div>
      </div>

      <h2>Where they are now</h2>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <Stat label="Students tested" value={`${tested.length} of ${cohort.length}`}
          sub={cohort.length - tested.length > 0 ? `${cohort.length - tested.length} with no reading yet` : 'Everyone has a reading'} />
        <Stat label="Average gap (latest reading)" value={formatGap(mean(latestGaps))}
          style={{ color: mean(latestGaps) < 0 ? '#a3232c' : undefined }} />
        <Stat label="Reading below their age" value={latestGaps.length ? `${Math.round((latestGaps.filter((g) => g < 0).length / latestGaps.length) * 100)}%` : '—'}
          sub={`${latestGaps.filter((g) => g < 0).length} students`} />
        <Stat label="Gap closed since first reading" value={withChange.length ? `${improved} of ${withChange.length}` : '—'}
          sub={withChange.length ? `average change ${formatChange(mean(withChange.map((s) => s.sum.change)))}` : 'Needs two readings'} />
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
        {GAP_BANDS.map((b) => (
          <button key={b.key} type="button" className={filter.band === b.key ? '' : 'secondary'}
            style={filter.band === b.key ? undefined : { ...b.style, border: 'none' }}
            onClick={() => setFilter({ ...filter, band: filter.band === b.key ? '' : b.key, tested: '' })}>
            {b.label}: {bandCounts[b.key]}
          </button>
        ))}
      </div>

      <h2>How it has changed</h2>
      <div className="card">
        {trend.length === 0 ? <p>No readings yet for these students.</p> : (
          <>
            <TrendChart rows={trend} />
            <div className="table-scroll">
              <table>
                <thead><tr><th>Sitting</th><th>Tested</th><th>Average gap</th><th>Below their age</th><th>2+ years below</th><th>From</th></tr></thead>
                <tbody>
                  {trend.map((t) => (
                    <tr key={t.key}>
                      <td>{t.label}</td><td>{t.n}</td><td><GapBadge gap={t.avgGap} /></td>
                      <td>{t.below} ({Math.round((t.below / t.n) * 100)}%)</td>
                      <td>{t.wellBelow}</td>
                      <td style={{ fontSize: '0.85em', color: '#5b6472' }}>{t.sources}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ color: '#666', fontSize: '0.85em' }}>
              The students in view now, at each sitting (a term, or a school year for older readings). Each student
              counts once per sitting. Different groups of students may have been tested each time, so check the
              Tested column before comparing.
            </p>
          </>
        )}
      </div>

      <h2>Students</h2>
      <div className="card">
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ maxWidth: '14rem' }}>Name
            <input type="text" value={filter.name} placeholder="Search" onChange={(e) => setFilter({ ...filter, name: e.target.value })} />
          </label>
          <label style={{ maxWidth: '11rem' }}>Show
            <select value={filter.band || filter.tested} onChange={(e) => {
              const v = e.target.value;
              if (GAP_BANDS.some((b) => b.key === v)) setFilter({ ...filter, band: v, tested: '' });
              else setFilter({ ...filter, band: '', tested: v });
            }}>
              <option value="">Everyone</option>
              <option value="yes">Tested</option>
              <option value="no">Not tested yet</option>
              {GAP_BANDS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
            </select>
          </label>
          <label style={{ maxWidth: '12rem' }}>Sort by
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="gap">Latest gap, furthest behind first</option>
              <option value="change">Change, most slipped first</option>
              <option value="name">Name</option>
            </select>
          </label>
          <button type="button" className="secondary" onClick={downloadCsv} disabled={shown.length === 0}>Download CSV</button>
        </div>
        <p style={{ fontSize: '0.85em', color: '#5b6472' }}>{shown.length} student{shown.length === 1 ? '' : 's'}. Click a row to see their readings over time.</p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Student</th><th>Form</th><th>Readings</th><th>First</th><th>Latest</th>
                <th>Reading age</th><th>Gap now</th><th>Since first</th><th>Since last</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => {
                const m = s.sum;
                const isOpen = open === s.student_id;
                return (
                  <Fragment key={s.student_id}>
                    <tr className="student-link" onClick={() => setOpen(isOpen ? null : s.student_id)}>
                      <td>{isOpen ? '▾' : '▸'} {fullName(s)}</td>
                      <td>{s.form_class || `Year ${s.year_group}`}</td>
                      <td>{m?.count || 0}</td>
                      <td>{m ? <>{formatUKDate(m.first.tested_on)}<br /><GapBadge gap={m.first.gap_months} /></> : '—'}</td>
                      <td>{m ? formatUKDate(m.latest.tested_on) : <span style={{ color: '#888' }}>Not tested</span>}</td>
                      <td>{m ? formatMonths(m.latest.reading_age_months) : ''}</td>
                      <td>{m ? <GapBadge gap={m.latest.gap_months} /> : ''}</td>
                      <td style={{ color: changeColour(m?.change), whiteSpace: 'nowrap' }}>{m && m.count > 1 ? formatChange(m.change) : ''}</td>
                      <td style={{ color: changeColour(m?.sinceLast), whiteSpace: 'nowrap' }}>{m && m.count > 1 ? formatChange(m.sinceLast) : ''}</td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={9} style={{ background: '#f6f7f9' }}>
                          <p style={{ margin: '0 0 0.5rem' }}>
                            <Link href={`/students/${s.student_id}#reading`}>Open {s.first_name}&apos;s profile</Link>
                            {s.dob && <> · born {formatUKDate(s.dob)}</>}
                          </p>
                          <ReadingAgeHistory readings={s.readings} canRecord={canRecord} onChanged={loadHistory} noDob={!s.dob} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function ReadingAgesPage() {
  return (
    <RequireAuth><RequireResource resourceKey="/reading-ages">
      <ReadingAgesInner />
    </RequireResource></RequireAuth>
  );
}
