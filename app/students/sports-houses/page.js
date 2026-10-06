'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { useAuth } from '../../../lib/AuthContext';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { formatUKDate } from '../../../lib/formatDate';

// Sports house allocation (migration 380, the principal 6 Oct 2026). Lists
// active students with no sports house, a column per house to choose one,
// and the boys and girls each house has in each year group, counting the
// choices made here before they are saved. Saving writes
// students.sports_house through the ordinary update, so the field
// permissions decide who can (check_student_field_edit(): admins and the
// school office); everyone else with the page can look and print.

const YEARS = [7, 8, 9, 10, 11, 12];

// Gender is free text on older records ('F', 'Female', blank): read by its
// first letter, as on Next Year's Numbers.
function genderKey(g) {
  const c = (g || '').trim().charAt(0).toUpperCase();
  return c === 'M' || c === 'F' ? c : 'U';
}

const empty = () => ({ M: 0, F: 0, U: 0 });
const total = (c) => c.M + c.F + c.U;

// Paged, so a large roll isn't cut off at the API's row limit.
async function loadAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}

const fullName = (s) => `${s.preferred_name || s.first_name} ${s.last_name}`;

// Boys · girls (and not recorded, if any).
function Split({ c, muted }) {
  return (
    <span style={{ whiteSpace: 'nowrap', color: muted ? '#888' : undefined }}>
      {c.M} B · {c.F} G{c.U ? ` · ${c.U} ?` : ''}
    </span>
  );
}

function SportsHousesInner() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [houses, setHouses] = useState([]);
  const [students, setStudents] = useState([]);
  const [siblings, setSiblings] = useState({}); // student_id -> [sibling student_id]
  const [canSave, setCanSave] = useState(false);
  const [choices, setChoices] = useState({}); // student_id -> house name, not yet saved
  const [year, setYear] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  async function load() {
    const [{ data: hs, error: hErr }, st, { data: fields }] = await Promise.all([
      supabase.from('sports_houses').select('name').order('name'),
      loadAll(() => supabase.from('students')
        .select('student_id, first_name, preferred_name, last_name, year_group, form_class, gender, sports_house, admission_date')
        .eq('status', 'active').order('student_id')),
      supabase.rpc('my_editable_student_fields'),
    ]);
    if (hErr) throw hErr;
    setHouses((hs || []).map((h) => h.name));
    setStudents(st);
    setCanSave(isAdmin || (fields || []).includes('sports_house'));
    return st;
  }

  useEffect(() => {
    (async () => {
      try {
        const st = await load();
        const waiting = st.filter((s) => !s.sports_house);
        const firstYear = YEARS.find((y) => waiting.some((s) => s.year_group === y));
        setYear(firstYear ? String(firstYear) : 'all');
        // Siblings through shared parents (student_siblings(), "Other" links
        // never counting), so a brother's or sister's house can be seen.
        const map = {};
        for (let i = 0; i < waiting.length; i += 10) {
          const batch = waiting.slice(i, i + 10);
          const res = await Promise.all(batch.map((s) => supabase.rpc('student_siblings', { p_student_id: s.student_id })));
          batch.forEach((s, j) => { map[s.student_id] = (res[j].data || []).map((r) => r.student_id); });
        }
        setSiblings(map);
      } catch (e) {
        setError(e.message || String(e));
      }
      setLoading(false);
    })();
  }, []);

  const byId = useMemo(() => Object.fromEntries(students.map((s) => [s.student_id, s])), [students]);
  const houseOf = (s) => s.sports_house || choices[s.student_id] || null;

  // counts[year][house or ''] and school[house or ''], saved plus chosen.
  const { counts, school } = useMemo(() => {
    const counts = {};
    const school = {};
    for (const y of YEARS) {
      counts[y] = { '': empty() };
      houses.forEach((h) => { counts[y][h] = empty(); });
    }
    school[''] = empty();
    houses.forEach((h) => { school[h] = empty(); });
    for (const s of students) {
      const h = houseOf(s) || '';
      const g = genderKey(s.gender);
      if (counts[s.year_group] && counts[s.year_group][h]) counts[s.year_group][h][g] += 1;
      if (school[h]) school[h][g] += 1;
    }
    return { counts, school };
  }, [students, houses, choices]);

  // The house with fewest of the student's sex in their year, then fewest in
  // the year, then fewest of that sex in the school, then fewest overall.
  function suggest(s, cts = counts, sch = school) {
    const g = genderKey(s.gender);
    const yc = cts[s.year_group];
    if (!yc || houses.length === 0) return null;
    const key = (h) => [g === 'U' ? total(yc[h]) : yc[h][g], total(yc[h]), g === 'U' ? total(sch[h]) : sch[h][g], total(sch[h])];
    return [...houses].sort((a, b) => {
      const ka = key(a); const kb = key(b);
      for (let i = 0; i < ka.length; i += 1) if (ka[i] !== kb[i]) return ka[i] - kb[i];
      return a.localeCompare(b);
    })[0];
  }

  const waiting = students
    .filter((s) => !s.sports_house && (year === 'all' || String(s.year_group) === year))
    .sort((a, b) => a.year_group - b.year_group || a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name));
  const waitingAll = students.filter((s) => !s.sports_house);
  const chosenCount = Object.keys(choices).length;

  function choose(id, h) {
    setMessage(null);
    setChoices((prev) => {
      const next = { ...prev };
      if (h) next[id] = h;
      else delete next[id];
      return next;
    });
  }

  // Suggest for every listed student without a choice, one at a time, so
  // each suggestion counts the ones before it. Boys and girls are taken in
  // turn so neither fills the smaller houses first.
  function fillSuggestions() {
    setMessage(null);
    const cts = JSON.parse(JSON.stringify(counts));
    const sch = JSON.parse(JSON.stringify(school));
    const next = { ...choices };
    const todo = waiting.filter((s) => !next[s.student_id]);
    const boys = todo.filter((s) => genderKey(s.gender) === 'M');
    const girls = todo.filter((s) => genderKey(s.gender) !== 'M');
    const order = [];
    for (let i = 0; i < Math.max(boys.length, girls.length); i += 1) {
      if (girls[i]) order.push(girls[i]);
      if (boys[i]) order.push(boys[i]);
    }
    for (const s of order) {
      const h = suggest(s, cts, sch);
      if (!h) continue;
      const g = genderKey(s.gender);
      next[s.student_id] = h;
      cts[s.year_group][''][g] -= 1; cts[s.year_group][h][g] += 1;
      sch[''][g] -= 1; sch[h][g] += 1;
    }
    setChoices(next);
  }

  function clearChoices() {
    setMessage(null);
    const listed = new Set(waiting.map((s) => s.student_id));
    setChoices((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !listed.has(Number(id)))));
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    const entries = Object.entries(choices);
    const failed = [];
    const failedIds = new Set();
    const taken = [];
    for (let i = 0; i < entries.length; i += 10) {
      const batch = entries.slice(i, i + 10);
      const res = await Promise.all(batch.map(([id, h]) => supabase.from('students')
        .update({ sports_house: h })
        .eq('student_id', Number(id))
        // Only if nobody has given them a house since the page loaded.
        .is('sports_house', null)
        .select('student_id')));
      batch.forEach(([id], j) => {
        const name = byId[id] ? fullName(byId[id]) : `#${id}`;
        if (res[j].error) { failed.push(`${name}: ${res[j].error.message}`); failedIds.add(id); }
        else if (!res[j].data || res[j].data.length === 0) taken.push(name);
      });
    }
    const saved = entries.length - failed.length - taken.length;
    try {
      await load();
    } catch (e) {
      setError(e.message || String(e));
    }
    // Keep only the choices that didn't save, so they can be tried again.
    setChoices((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => failedIds.has(id))));
    setMessage({
      ok: failed.length === 0,
      text: [
        `${saved} saved.`,
        taken.length ? `${taken.length} already had a house given by someone else, so were left as they are: ${taken.join(', ')}.` : '',
        failed.length ? `${failed.length} not saved: ${failed.join('; ')}` : '',
      ].filter(Boolean).join(' '),
    });
    setSaving(false);
  }

  if (loading) return <div className="card"><p>Loading…</p></div>;
  if (error) return <div className="card"><p style={{ color: '#a3232c' }}>{error}</p></div>;

  const yearLabel = year === 'all' ? 'All years' : `Year ${year}`;
  const shownYears = year === 'all' ? YEARS : [Number(year)];

  return (
    <div>
      <div className="no-print">
        <h1 style={{ marginTop: 0 }}>Sports Houses</h1>
        <p style={{ color: '#555', marginTop: 0 }}>
          Give new students a sports house. The table shows how many boys (B) and girls (G) each house has in each
          year, including the choices below before they are saved. <strong>Suggested</strong> is the house with fewest of
          that student&apos;s sex in their year.
          {!canSave && ' You can look and print here; only the school office and admins can save houses.'}
        </p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }} className="no-print">Boys and girls in each house</h2>
        <h2 style={{ marginTop: 0, display: 'none' }} className="print-only">Sports house choice sheet: {yearLabel}</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Year</th>
                {houses.map((h) => <th key={h}>{h}</th>)}
                <th>No house</th>
              </tr>
            </thead>
            <tbody>
              {YEARS.map((y) => (
                <tr key={y} style={shownYears.includes(y) && year !== 'all' ? { background: '#fff8e1' } : null}>
                  <td><strong>Year {y}</strong></td>
                  {houses.map((h) => (
                    <td key={h}>
                      <div style={{ fontWeight: 600 }}>{total(counts[y][h])}</div>
                      <div style={{ fontSize: '0.85em' }}><Split c={counts[y][h]} /></div>
                    </td>
                  ))}
                  <td>
                    <div style={{ fontWeight: 600, color: total(counts[y]['']) ? '#a3232c' : '#888' }}>{total(counts[y][''])}</div>
                    <div style={{ fontSize: '0.85em' }}><Split c={counts[y]['']} muted /></div>
                  </td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid #999' }}>
                <td><strong>Whole school</strong></td>
                {houses.map((h) => (
                  <td key={h}>
                    <div style={{ fontWeight: 700 }}>{total(school[h])}</div>
                    <div style={{ fontSize: '0.85em' }}><Split c={school[h]} /></div>
                  </td>
                ))}
                <td>
                  <div style={{ fontWeight: 700 }}>{total(school[''])}</div>
                  <div style={{ fontSize: '0.85em' }}><Split c={school['']} muted /></div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        {chosenCount > 0 && (
          <p className="no-print" style={{ marginBottom: 0, color: '#8a5a00' }}>
            Includes {chosenCount} choice{chosenCount === 1 ? '' : 's'} not saved yet.
          </p>
        )}
      </div>

      <div className="card">
        <div className="no-print" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h2 style={{ margin: 0, marginRight: 'auto' }}>Students with no sports house ({waitingAll.length})</h2>
          <select value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="all">All years</option>
            {YEARS.map((y) => {
              const n = waitingAll.filter((s) => s.year_group === y).length;
              return <option key={y} value={String(y)}>Year {y} ({n})</option>;
            })}
          </select>
          <button type="button" className="secondary" onClick={fillSuggestions} disabled={waiting.length === 0}>Fill with suggestions</button>
          <button type="button" className="secondary" onClick={clearChoices} disabled={!waiting.some((s) => choices[s.student_id])}>Clear choices</button>
          <button type="button" className="secondary" onClick={() => window.print()}>Print sheet</button>
          {canSave && (
            <button type="button" onClick={save} disabled={saving || chosenCount === 0}>
              {saving ? 'Saving…' : `Save ${chosenCount} choice${chosenCount === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
        {message && (
          <p className="no-print" style={{ color: message.ok ? '#1f6f3a' : '#a3232c' }}>{message.text}</p>
        )}

        {waiting.length === 0 ? (
          <p>Everyone in {yearLabel === 'All years' ? 'the school' : yearLabel} has a sports house.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Year</th>
                  <th>B/G</th>
                  <th>Joined</th>
                  <th>Siblings&apos; houses</th>
                  <th>Suggested</th>
                  {houses.map((h) => <th key={h} style={{ textAlign: 'center' }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {waiting.map((s) => {
                  const g = genderKey(s.gender);
                  const sibs = (siblings[s.student_id] || []).map((id) => byId[id]).filter(Boolean);
                  const chosen = choices[s.student_id];
                  // The suggestion ignores this student's own choice.
                  const own = chosen ? JSON.parse(JSON.stringify({ counts, school })) : null;
                  if (own) {
                    own.counts[s.year_group][chosen][g] -= 1;
                    own.school[chosen][g] -= 1;
                  }
                  const suggested = own ? suggest(s, own.counts, own.school) : suggest(s);
                  return (
                    <tr key={s.student_id}>
                      <td><a href={`/students/${s.student_id}`}>{s.last_name}, {s.preferred_name || s.first_name}</a></td>
                      <td>{s.year_group}{s.form_class ? ` · ${s.form_class}` : ''}</td>
                      <td>{g === 'M' ? 'Boy' : g === 'F' ? 'Girl' : '?'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{s.admission_date ? formatUKDate(s.admission_date) : '—'}</td>
                      <td style={{ fontSize: '0.9em' }}>
                        {sibs.length === 0 ? <span style={{ color: '#888' }}>—</span> : sibs.map((x) => (
                          <div key={x.student_id}>
                            {x.preferred_name || x.first_name} (Y{x.year_group}): <strong>{houseOf(x) || 'none'}</strong>
                          </div>
                        ))}
                      </td>
                      <td>{suggested || '—'}</td>
                      {houses.map((h) => (
                        <td key={h} style={{ textAlign: 'center' }}>
                          <input
                            type="radio"
                            className="no-print"
                            name={`house-${s.student_id}`}
                            checked={chosen === h}
                            onChange={() => choose(s.student_id, h)}
                            onClick={() => { if (chosen === h) choose(s.student_id, null); }}
                            aria-label={`${fullName(s)}: ${h}`}
                          />
                          <span className="print-only" style={{ display: 'none' }}>{chosen === h ? '☑' : '☐'}</span>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SportsHousesPage() {
  return (
    <RequireAuth>
      <RequireResource resourceKey="/students/sports-houses">
        <SportsHousesInner />
      </RequireResource>
    </RequireAuth>
  );
}
