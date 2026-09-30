'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { formatUKDate } from '../../lib/formatDate';
import RequireAuth from '../RequireAuth';
import RequireResource from '../RequireResource';
import { useAuth } from '../../lib/AuthContext';

function StudentsList() {
  // Only the school office can add students (migration 275).
  const { staffRoles } = useAuth();
  const canAddStudent = (staffRoles || []).includes('school_office');
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [formFilter, setFormFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('active'); // 'active' | 'left' | ''(all) — defaults to current students
  // Calendar year of the leaving date ('2024'), 'none' for a leaver with no
  // leaving date, '' for any. Only offered when leavers are in the list.
  const [leftYearFilter, setLeftYearFilter] = useState('');
  const [yearFormPairs, setYearFormPairs] = useState([]); // [{year_group, form_class, status, leaving_date}]
  const [houseScope, setHouseScope] = useState(null);
  // Assume locked until my_house_access() says otherwise, so a slow RPC never
  // flashes the whole school at a house-only houseparent.
  const [houseScopeExclusive, setHouseScopeExclusive] = useState(true);
  const [showAllHouses, setShowAllHouses] = useState(false);
  // Cards or the old table; remembered per browser, since someone scanning a
  // whole year group may prefer the denser table.
  const [layout, setLayout] = useState('cards');
  useEffect(() => {
    try { if (localStorage.getItem('studentsLayout') === 'table') setLayout('table'); } catch {}
  }, []);
  function chooseLayout(next) {
    setLayout(next);
    try { localStorage.setItem('studentsLayout', next); } catch {}
  }

  // On mount, only fetch the small distinct year/form lists needed to
  // populate the filter dropdowns — not the full student list or photos.
  useEffect(() => {
    async function loadFilterOptions() {
      const { data } = await supabase.from('students').select('year_group, form_class, status, leaving_date');
      setYearFormPairs(data || []);
      // house NULL means unscoped (admin, SMT, etc.) — see everyone, same as
      // today. A house means the viewer is a Houseparent, and that house is
      // their default view. exclusive says whether it is all they may see: it
      // is false for a houseparent who also teaches or mentors, who meets
      // students from every house during the day and can switch to the whole
      // school (migration 126).
      const { data: access } = await supabase.rpc('my_house_access');
      setHouseScope(access?.house || null);
      setHouseScopeExclusive(!!access?.exclusive);
    }
    loadFilterOptions();
  }, []);

  // A houseparent who also teaches can widen to the whole school; one whose
  // only role is the house cannot, so the switch is not offered to them.
  const canWidenScope = !!houseScope && !houseScopeExclusive;
  const activeHouseScope = houseScope && !(canWidenScope && showAllHouses) ? houseScope : null;

  const years = [...new Set(yearFormPairs.map((s) => s.year_group))].sort((a, b) => a - b);
  // Form class options narrow to whatever Year group is currently selected.
  const forms = [...new Set(
    yearFormPairs
      .filter((s) => !yearFilter || String(s.year_group) === yearFilter)
      .map((s) => s.form_class)
  )].filter(Boolean).sort();
  const leavers = yearFormPairs.filter((s) => s.status !== 'active');
  const leftYears = [...new Set(leavers.filter((s) => s.leaving_date).map((s) => s.leaving_date.slice(0, 4)))].sort().reverse();
  const someLeftUndated = leavers.some((s) => !s.leaving_date);

  // Flipping the house switch re-runs the query straight away, rather than
  // leaving a stale list on screen until the viewer presses Load students.
  useEffect(() => {
    if (hasLoaded) loadStudents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeHouseScope]);

  // Typing a name (or changing a filter once a list is showing) searches
  // straight away, after a short pause so each keystroke isn't its own query.
  // Nothing loads on arrival: the whole school with photos is slow, so that
  // still waits for a name or the Load students button.
  const latestRequest = useRef(0);
  useEffect(() => {
    if (!search.trim() && !hasLoaded) return undefined;
    const timer = setTimeout(loadStudents, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, yearFilter, formFilter, statusFilter, leftYearFilter]);

  // A short list of matching names under the search box, like the bursar's
  // student pickers: pick one to open that student. It follows the Status,
  // Year and Form filters and a houseparent's house, and skips photos so it
  // stays quick.
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const latestSuggest = useRef(0);
  useEffect(() => {
    const term = search.replace(/[,()%*\\]/g, '').trim();
    if (term.length < 2) { setSuggestions([]); return undefined; }
    const timer = setTimeout(async () => {
      const requestId = ++latestSuggest.current;
      let q = supabase.from('students')
        .select('student_id, first_name, last_name, form_class, year_group, status')
        .or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%`)
        .order('last_name').order('first_name')
        .limit(8);
      if (statusFilter === 'active') q = q.eq('status', 'active');
      else if (statusFilter) q = q.neq('status', 'active');
      if (yearFilter) q = q.eq('year_group', Number(yearFilter));
      if (formFilter) q = q.eq('form_class', formFilter);
      if (activeHouseScope) q = q.eq('boarding_house', activeHouseScope);
      const { data } = await q;
      if (requestId !== latestSuggest.current) return;
      setSuggestions(data || []);
      setHighlighted(-1);
    }, 200);
    return () => clearTimeout(timer);
  }, [search, statusFilter, yearFilter, formFilter, activeHouseScope]);

  function openStudent(s) {
    window.location.href = `/students/${s.student_id}`;
  }

  function onSearchKeyDown(e) {
    if (!showSuggestions || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((h) => (h + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => (h <= 0 ? suggestions.length - 1 : h - 1));
    } else if (e.key === 'Enter' && highlighted >= 0) {
      e.preventDefault();
      openStudent(suggestions[highlighted]);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  }

  async function loadStudents() {
    // Only the newest search may fill the list: a slow earlier one (fewer
    // letters, more students) must not land on top of it.
    const requestId = ++latestRequest.current;
    const isStale = () => requestId !== latestRequest.current;
    setLoading(true);
    setError(null);
    let query = supabase.from('student_summary').select('*').order('last_name', { ascending: true });
    if (statusFilter) query = query.eq('status', statusFilter);
    if (yearFilter) query = query.eq('year_group', Number(yearFilter));
    if (formFilter) query = query.eq('form_class', formFilter);
    // Commas, brackets and wildcards would break or widen the .or() filter.
    const term = search.replace(/[,()%*\\]/g, '').trim();
    if (term) query = query.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%`);

    // student_summary has no boarding_house or leaving_date column, so a
    // Houseparent's scope and the year-left filter are applied by first
    // resolving matching student_ids from students directly.
    if (activeHouseScope || (statusFilter !== 'active' && leftYearFilter)) {
      let idQuery = supabase.from('students').select('student_id');
      if (activeHouseScope) idQuery = idQuery.eq('boarding_house', activeHouseScope);
      if (statusFilter !== 'active' && leftYearFilter === 'none') {
        idQuery = idQuery.neq('status', 'active').is('leaving_date', null);
      } else if (statusFilter !== 'active' && leftYearFilter) {
        // Leavers only: a current student can have a leaving date later this year.
        idQuery = idQuery.neq('status', 'active')
          .gte('leaving_date', `${leftYearFilter}-01-01`).lte('leaving_date', `${leftYearFilter}-12-31`);
      }
      const { data: scoped, error: scopeErr } = await idQuery;
      if (isStale()) return;
      if (scopeErr) { setError(scopeErr.message); setLoading(false); return; }
      const ids = (scoped || []).map((s) => s.student_id);
      query = query.in('student_id', ids.length ? ids : [-1]);
    }

    const { data, error } = await query;
    if (isStale()) return;
    if (error) { setError(error.message); setLoading(false); return; }

    // Only fetch photos for the students actually matching the filter,
    // not the whole school — this is what was making the page slow.
    // Leaving dates come along in the same query.
    const ids = (data || []).map((s) => s.student_id);
    let extraMap = {};
    if (ids.length > 0) {
      const { data: extra } = await supabase.from('students').select('student_id, photo_base64, leaving_date').in('student_id', ids);
      extraMap = Object.fromEntries((extra || []).map((p) => [p.student_id, p]));
    }
    if (isStale()) return;
    setStudents((data || []).map((s) => ({
      ...s,
      photo_base64: extraMap[s.student_id]?.photo_base64 || undefined,
      leaving_date: extraMap[s.student_id]?.leaving_date || null,
    })));
    setHasLoaded(true);
    setLoading(false);
  }

  if (error) return <p style={{ color: 'red' }}>Error: {error}</p>;

  return (
    <div>
      <h1>Students</h1>
      {canAddStudent && <p><a href="/students/new">+ Add a new student</a></p>}
      {houseScope && !canWidenScope && (
        <p style={{ background: '#fdecad', padding: '0.4rem 0.6rem', borderRadius: '4px', display: 'inline-block' }}>
          Showing {houseScope} students only (Houseparent view)
        </p>
      )}
      {canWidenScope && (
        <p style={{ background: '#fdecad', padding: '0.4rem 0.6rem', borderRadius: '4px' }}>
          <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
            <input
              type="checkbox"
              checked={!showAllHouses}
              onChange={(e) => setShowAllHouses(!e.target.checked)}
              style={{ flex: '0 0 auto', width: 'auto' }}
            />
            <span>{houseScope} students only (Houseparent view) — untick to search the whole school</span>
          </label>
        </p>
      )}

      <form onSubmit={(e) => { e.preventDefault(); loadStudents(); }}>
        <label>
          Search name
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setShowSuggestions(true); }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setShowSuggestions(false)}
              onKeyDown={onSearchKeyDown}
              placeholder="e.g. Wilson"
              autoComplete="off"
              role="combobox"
              aria-expanded={showSuggestions && suggestions.length > 0}
              aria-controls="student-suggestions"
            />
            {showSuggestions && suggestions.length > 0 && (
              <ul
                id="student-suggestions"
                role="listbox"
                style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
                  margin: '0.25rem 0 0', padding: 0, listStyle: 'none',
                  background: '#fff', border: '1px solid #d5dce8', borderRadius: '8px',
                  boxShadow: '0 6px 18px rgba(20, 35, 70, 0.12)', overflow: 'hidden',
                  minWidth: '16rem',
                }}
              >
                {suggestions.map((s, i) => (
                  <li
                    key={s.student_id}
                    role="option"
                    aria-selected={i === highlighted}
                    // mousedown, not click: the input's blur would close the list first.
                    onMouseDown={(e) => { e.preventDefault(); openStudent(s); }}
                    onMouseEnter={() => setHighlighted(i)}
                    style={{
                      padding: '0.5rem 0.75rem', cursor: 'pointer', fontWeight: 400,
                      background: i === highlighted ? '#eef3f8' : 'transparent',
                      borderTop: i === 0 ? 'none' : '1px solid #eef1f6',
                    }}
                  >
                    {s.first_name} {s.last_name}
                    <span style={{ color: '#8492a6' }}>
                      {' '}· {s.form_class || 'No form'} · Year {s.year_group}{s.status !== 'active' ? ' · Left' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </label>
        <label>
          Year group
          <select value={yearFilter} onChange={(e) => { setYearFilter(e.target.value); setFormFilter(''); }}>
            <option value="">All</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label>
          Form class
          <select value={formFilter} onChange={(e) => setFormFilter(e.target.value)}>
            <option value="">All</option>
            {forms.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label>
          Status
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); if (e.target.value === 'active') setLeftYearFilter(''); }}>
            <option value="active">Current</option>
            <option value="left">Left</option>
            <option value="">All</option>
          </select>
        </label>
        {statusFilter !== 'active' && (
          <label>
            Year left
            <select value={leftYearFilter} onChange={(e) => setLeftYearFilter(e.target.value)}>
              <option value="">Any</option>
              {leftYears.map((y) => <option key={y} value={y}>{y}</option>)}
              {someLeftUndated && <option value="none">No leaving date</option>}
            </select>
          </label>
        )}
        <button type="submit">{loading ? 'Loading...' : 'Load students'}</button>
      </form>

      {!hasLoaded && !loading && (
        <p style={{ color: '#5a6b8c' }}>Start typing a name to search, or choose filters (or leave blank for everyone) and press Load students.</p>
      )}

      {hasLoaded && (
        <>
          <div className="students-toolbar">
            <p style={{ color: '#5a6b8c', fontSize: '0.9rem', margin: 0 }}>{students.length} student(s) loaded</p>
            <div className="layout-toggle" role="group" aria-label="Layout">
              <button type="button" className={layout === 'cards' ? 'active' : ''} onClick={() => chooseLayout('cards')}>Cards</button>
              <button type="button" className={layout === 'table' ? 'active' : ''} onClick={() => chooseLayout('table')}>List</button>
            </div>
          </div>

          {layout === 'cards' ? (
            <div className="pupil-tiles">
              {students.map((s) => (
                <a key={s.student_id} href={`/students/${s.student_id}`} className="pupil-tile">
                  {s.photo_base64 ? (
                    <img className="pupil-tile-photo" src={`data:image/jpeg;base64,${s.photo_base64}`} alt="" />
                  ) : (
                    <span className="pupil-tile-photo">{s.first_name?.[0]}{s.last_name?.[0]}</span>
                  )}
                  <div className="pupil-tile-body">
                    <div className="pupil-tile-name">{s.first_name} {s.last_name}</div>
                    <div className="pupil-tile-sub">
                      {[s.year_group && `Year ${s.year_group}`, s.form_class, s.status !== 'active' && (s.leaving_date ? `Left ${formatUKDate(s.leaving_date)}` : 'Left')].filter(Boolean).join(' · ')}
                    </div>
                    <div className="pupil-tile-stats">
                      <span title="Net behaviour points">📋 {s.net_behaviour_points ?? 0}</span>
                      <span title="Latest weekly average">⭐ {s.latest_week_avg_pct != null ? `${s.latest_week_avg_pct}%` : '—'}</span>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          ) : (
          <div className="table-scroll"><table>
        <thead>
          <tr>
            <th></th>
            <th>Name</th>
            <th>Year</th>
            <th>Form</th>
            {students.some((s) => s.status !== 'active') && <th>Status</th>}
            <th>Net Behaviour</th>
            <th>Latest Avg %</th>
            <th>Primary Contact</th>
          </tr>
        </thead>
        <tbody>
          {students.map((s) => (
            <tr key={s.student_id} className="student-link" onClick={() => window.location.href = `/students/${s.student_id}`}>
              <td>
                {s.photo_base64 ? (
                  <img src={`data:image/jpeg;base64,${s.photo_base64}`} alt="" style={{ width: 32, height: 40, objectFit: 'cover', borderRadius: 4 }} />
                ) : (
                  <div style={{ width: 32, height: 40, borderRadius: 4, background: 'var(--slate-200)' }} />
                )}
              </td>
              <td>{s.first_name} {s.last_name}</td>
              <td>{s.year_group}</td>
              <td>{s.form_class}</td>
              {students.some((x) => x.status !== 'active') && <td>{s.status === 'active' ? 'Current' : (s.leaving_date ? `Left ${formatUKDate(s.leaving_date)}` : 'Left')}</td>}
              <td>{s.net_behaviour_points}</td>
              <td>{s.latest_week_avg_pct ?? '—'}</td>
              <td>{s.primary_contact_name ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
          )}
        </>
      )}
    </div>
  );
}

export default function Page() {
  return <RequireAuth><RequireResource resourceKey="/students"><StudentsList /></RequireResource></RequireAuth>;
}
