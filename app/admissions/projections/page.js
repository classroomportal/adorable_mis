'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { useAuth } from '../../../lib/AuthContext';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { YEAR_GROUPS, errorText } from '../../../lib/admissions';

// Next year's intake, year group by year group, boys and girls: the new
// places the school will fill (admission_places, migration 266: new intake
// only, not the whole year group), less the entry year's newcomers. Today's
// active students moving up a year (Year 12 leave) are shown beside them
// for next year's roll, but don't use up new places. "Confirmed" newcomers are families who have accepted a place
// (accepted, deposit paid or enrolled); offers still awaiting a reply and
// applicants still in the process (enquiry to interview, or on the waiting
// list) are only predicted, at the share of each set on the page. Places
// are set here by holders of /admissions/places (SMT; RLS agrees).

const CONFIRMED = ['accepted', 'deposit_paid', 'enrolled'];
const OFFERED = ['offered'];
const IN_PROCESS = ['enquiry', 'form_paid', 'test_booked', 'tested', 'invited_to_interview', 'interviewed', 'waitlisted'];

// Gender is free text on older student records ('F', 'Female', 'Female ',
// blank), so it is read by its first letter.
function genderKey(g) {
  const c = (g || '').trim().charAt(0).toUpperCase();
  return c === 'M' || c === 'F' ? c : 'U';
}

const empty = () => ({ M: 0, F: 0, U: 0 });
const total = (c) => c.M + c.F + c.U;
const add = (...cs) => cs.reduce((a, c) => ({ M: a.M + c.M, F: a.F + c.F, U: a.U + c.U }), empty());
const sub = (a, ...cs) => { const b = add(...cs); return { M: a.M - b.M, F: a.F - b.F, U: 0 }; };
const scale = (c, pct) => ({ M: c.M * pct / 100, F: c.F * pct / 100, U: c.U * pct / 100 });

// Predicted figures can be fractional; one decimal place at most.
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

// A count of students, with its boys / girls / not-recorded split.
function Count({ c }) {
  const t = total(c);
  return (
    <div>
      <div style={{ fontWeight: 600 }}>{fmt(t)}</div>
      {t > 0 && (
        <div style={{ fontSize: '0.8em', color: '#666', whiteSpace: 'nowrap' }}>
          {fmt(c.M)} B · {fmt(c.F)} G{c.U ? ` · ${fmt(c.U)} ?` : ''}
        </div>
      )}
    </div>
  );
}

// Places (allowed or still free): boys and girls each, red when over.
function Places({ c, strong }) {
  if (!c) return <span style={{ color: '#888' }}>not set</span>;
  const red = (n) => (n < 0 ? { color: '#a3232c', fontWeight: 700 } : null);
  const t = c.M + c.F;
  return (
    <div>
      <div style={{ fontWeight: strong ? 800 : 600, fontSize: strong ? '1.05em' : undefined, ...red(t) }}>{fmt(t)}</div>
      <div style={{ fontSize: '0.8em', color: '#666', whiteSpace: 'nowrap' }}>
        <span style={red(c.M)}>{fmt(c.M)} B</span> · <span style={red(c.F)}>{fmt(c.F)} G</span>
      </div>
    </div>
  );
}

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

function ProjectionsInner() {
  const { hasAccess } = useAuth();
  const canEditPlaces = hasAccess('/admissions/places');
  const [years, setYears] = useState(null); // { current, next }
  const [students, setStudents] = useState([]);
  const [applicants, setApplicants] = useState([]);
  const [places, setPlaces] = useState({}); // year_group -> { M, F }
  const [editing, setEditing] = useState(null); // year_group -> { M, F } as typed
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [offerPct, setOfferPct] = useState(100);
  const [processPct, setProcessPct] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function loadPlaces(yearId) {
    const { data, error: err } = await supabase
      .from('admission_places').select('year_group, boys_allowed, girls_allowed')
      .eq('academic_year_id', yearId);
    if (err) throw err;
    const m = {};
    (data || []).forEach((r) => {
      if (r.boys_allowed != null || r.girls_allowed != null) {
        m[r.year_group] = { M: r.boys_allowed ?? 0, F: r.girls_allowed ?? 0, U: 0 };
      }
    });
    setPlaces(m);
  }

  useEffect(() => {
    (async () => {
      try {
        const { data: ys, error: yErr } = await supabase
          .from('academic_years').select('academic_year_id, label, status, start_date').order('start_date');
        if (yErr) throw yErr;
        const current = (ys || []).find((y) => y.status === 'current');
        // Only the year straight after the current one: today's students are
        // one year older then, so "move up one" is only right for that year.
        const next = current && (ys || []).find((y) => y.start_date > current.start_date);
        setYears({ current, next });
        if (!next) { setLoading(false); return; }
        const [st, ap] = await Promise.all([
          loadAll(() => supabase.from('students').select('student_id, year_group, gender')
            .eq('status', 'active').order('student_id')),
          loadAll(() => supabase.from('applicants').select('applicant_id, entry_year_group, gender, status')
            .eq('entry_academic_year_id', next.academic_year_id).order('applicant_id')),
          loadPlaces(next.academic_year_id),
        ]);
        setStudents(st);
        setApplicants(ap);
      } catch (e) {
        setError(errorText(e));
      }
      setLoading(false);
    })();
  }, []);

  function startEditing() {
    setMessage(null);
    setEditing(Object.fromEntries(YEAR_GROUPS.map((y) => [y, {
      M: places[y] ? String(places[y].M) : '',
      F: places[y] ? String(places[y].F) : '',
    }])));
  }

  async function savePlaces() {
    const rows = [];
    for (const y of YEAR_GROUPS) {
      const e = editing[y];
      const parse = (v) => (v.trim() === '' ? null : Number(v));
      const M = parse(e.M);
      const F = parse(e.F);
      if ([M, F].some((n) => n != null && (!Number.isInteger(n) || n < 0))) {
        setMessage({ error: true, text: `Year ${y}: places must be whole numbers, 0 or more.` });
        return;
      }
      rows.push({ academic_year_id: years.next.academic_year_id, year_group: y, boys_allowed: M, girls_allowed: F });
    }
    setSaving(true);
    const { error: err } = await supabase.from('admission_places')
      .upsert(rows, { onConflict: 'academic_year_id,year_group' });
    if (err) {
      setMessage({ error: true, text: errorText(err) });
    } else {
      try { await loadPlaces(years.next.academic_year_id); } catch (e) { setMessage({ error: true, text: errorText(e) }); }
      setEditing(null);
      setMessage({ text: 'Places saved.' });
    }
    setSaving(false);
  }

  if (loading) return <p>Loading...</p>;
  if (error) return <p style={{ color: '#a3232c' }}><strong>{error}</strong></p>;
  if (!years?.current) return <p>There is no current academic year set up at /admin/lookups.</p>;
  if (!years.next) return <p>The year after {years.current.label} hasn't been added yet. Add it at <a href="/admin/lookups">Lookups</a>.</p>;

  const byYear = (rows, ygField, statuses) => {
    const m = Object.fromEntries(YEAR_GROUPS.map((y) => [y, empty()]));
    rows.forEach((r) => {
      if (statuses && !statuses.includes(r.status)) return;
      if (m[r[ygField]]) m[r[ygField]][genderKey(r.gender)] += 1;
    });
    return m;
  };
  const now = byYear(students, 'year_group');
  const confirmed = byYear(applicants, 'entry_year_group', CONFIRMED);
  const offered = byYear(applicants, 'entry_year_group', OFFERED);
  const inProcess = byYear(applicants, 'entry_year_group', IN_PROCESS);

  const rows = YEAR_GROUPS.map((y) => {
    const allowed = places[y] || null;
    const movingUp = y === YEAR_GROUPS[0] ? empty() : now[y - 1];
    const free = allowed && sub(allowed, confirmed[y]);
    const predictedFree = allowed && sub(free, scale(offered[y], offerPct), scale(inProcess[y], processPct));
    const roll = add(movingUp, confirmed[y]);
    return { y, allowed, movingUp, confirmed: confirmed[y], free, offered: offered[y], inProcess: inProcess[y], predictedFree, roll };
  });
  const setRows = rows.filter((r) => r.allowed);
  const sumCount = (k) => add(...rows.map((r) => r[k]));
  const sumPlaces = (k) => (setRows.length ? add(...setRows.map((r) => r[k])) : null);
  const totals = {
    allowed: sumPlaces('allowed'), movingUp: sumCount('movingUp'), roll: sumCount('roll'),
    confirmed: sumCount('confirmed'), free: sumPlaces('free'), offered: sumCount('offered'),
    inProcess: sumCount('inProcess'), predictedFree: sumPlaces('predictedFree'),
  };
  const partTotal = setRows.length > 0 && setRows.length < YEAR_GROUPS.length;
  const lastYear = YEAR_GROUPS[YEAR_GROUPS.length - 1];
  const leaving = now[lastYear];
  const unknownGender = totals.movingUp.U + totals.confirmed.U + totals.offered.U + totals.inProcess.U;

  const pctInput = (value, set) => (
    <input
      type="number" min={0} max={100} step={5} value={value}
      onChange={(e) => set(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
      style={{ width: '5rem' }}
    />
  );
  const placeInput = (y, g) => (
    <input
      type="number" min={0} step={1} value={editing[y][g]} aria-label={`Year ${y} ${g === 'M' ? 'boys' : 'girls'} allowed`}
      onChange={(e) => setEditing({ ...editing, [y]: { ...editing[y], [g]: e.target.value } })}
      style={{ width: '4.5rem' }}
    />
  );

  const cells = (r, strong) => (
    <>
      <td>
        {editing && r.y ? (
          <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', whiteSpace: 'nowrap' }}>
            {placeInput(r.y, 'M')} B {placeInput(r.y, 'F')} G
          </div>
        ) : <Places c={r.allowed} strong={strong} />}
      </td>
      <td><Count c={r.confirmed} /></td>
      <td><Places c={r.free} strong /></td>
      <td><Count c={r.offered} /></td>
      <td><Count c={r.inProcess} /></td>
      <td><Places c={r.predictedFree} strong /></td>
      <td><Count c={r.movingUp} /></td>
      <td><Count c={r.roll} /></td>
    </>
  );

  return (
    <div>
      <h1 style={{ margin: 0 }}>Next Year's Numbers</h1>
      <p style={{ color: '#666', marginTop: '0.4rem' }}>
        {years.next.label}: the new places for boys and girls in each year, and how many are still free once new admissions are counted. Students moving up are shown for next year's roll; they don't use up new places. <a href="/admissions">Applicants</a>
      </p>

      <div className="stat-card-row">
        {[
          ['New places allowed', totals.allowed, `${years.next.label} intake, every year group`],
          ['New, confirmed', totals.confirmed, 'Accepted, deposit paid or enrolled'],
          ['Places still free', totals.free, 'New places less confirmed new'],
          [`Year ${lastYear} leaving`, leaving, `End of ${years.current.label}`],
          [`Roll ${years.next.label}`, totals.roll, 'Moving up + confirmed new'],
        ].map(([label, c, note]) => (
          <div key={label} className="stat-card accent-family" title={note}>
            <div>
              <div className="stat-card-value" style={c && total(c) < 0 ? { color: '#a3232c' } : null}>{c ? fmt(total(c)) : '—'}</div>
              <div className="stat-card-label">{label}</div>
              {c && <div style={{ fontSize: '0.75rem', color: '#666' }}>{fmt(c.M)} boys · {fmt(c.F)} girls{c.U ? ` · ${fmt(c.U)} not recorded` : ''}</div>}
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ flex: '0 0 auto' }}>
            Offers expected to accept (%)
            {pctInput(offerPct, setOfferPct)}
          </label>
          <label style={{ flex: '0 0 auto' }}>
            Applicants in process expected to join (%)
            {pctInput(processPct, setProcessPct)}
          </label>
          {canEditPlaces && (
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
              {editing ? (
                <>
                  <button type="button" onClick={savePlaces} disabled={saving}>{saving ? 'Saving...' : 'Save places'}</button>
                  <button type="button" className="secondary" onClick={() => { setEditing(null); setMessage(null); }} disabled={saving}>Cancel</button>
                </>
              ) : (
                <button type="button" onClick={startEditing}>Set new places</button>
              )}
            </div>
          )}
        </div>
        <p style={{ color: '#666', fontSize: '0.85em', marginBottom: 0 }}>
          The two shares only change <strong>Predicted free</strong>; they're your estimate and aren't saved.
          Unsuccessful and withdrawn applicants are never counted.
        </p>
        {message && <p style={{ color: message.error ? '#a3232c' : '#1a7a3d', marginBottom: 0 }}><strong>{message.text}</strong></p>}
      </div>

      <div className="card">
        <div className="table-scroll"><table>
          <thead>
            <tr>
              <th>{years.next.label}</th>
              <th title="New boys and girls the school will take into this year group">New places allowed</th>
              <th title="Accepted, deposit paid or enrolled">New: confirmed</th>
              <th title="New places less confirmed new">Places still free</th>
              <th title="Offered a place, no reply yet">New: offered</th>
              <th title="Enquiry, form paid, test booked, tested, invited to interview, interviewed or on the waiting list">New: in process</th>
              <th title={`Places still free less ${offerPct}% of offers and ${processPct}% of those in process`}>Predicted free</th>
              <th title="Today's students in the year below">Moving up</th>
              <th title="Moving up + confirmed new">Roll next year</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: '2px solid #ccc', background: '#fafafa' }}>
              <td><strong>Total</strong>{partTotal && <div style={{ fontSize: '0.8em', color: '#a3232c' }}>Places set for {setRows.length} of {YEAR_GROUPS.length} years</div>}</td>
              {cells({ ...totals, y: null }, true)}
            </tr>
            {rows.map((r) => (
              <tr key={r.y}>
                <td><strong>Year {r.y}</strong>{r.y > YEAR_GROUPS[0] && <div style={{ fontSize: '0.8em', color: '#666' }}>Year {r.y - 1} now</div>}</td>
                {cells(r)}
              </tr>
            ))}
            <tr>
              <td><strong>Leaving</strong><div style={{ fontSize: '0.8em', color: '#666' }}>Year {lastYear} now</div></td>
              <td colSpan={9}><Count c={leaving} /></td>
            </tr>
          </tbody>
        </table></div>
        <p style={{ color: '#666', fontSize: '0.85em', marginBottom: 0 }}>
          B = boys, G = girls. A red figure means more new students than new places.
          {unknownGender > 0 && ` “?” is a student or applicant with no gender recorded (${unknownGender} in all); they aren't taken off either the boys' or the girls' new places until it is filled in on their record.`}
        </p>
        <p style={{ color: '#666', fontSize: '0.85em', marginBottom: 0 }}>
          Assumes every current student below Year {lastYear} stays and moves up one year; anyone known to be leaving early isn't taken off.
          {!canEditPlaces && ' New places are set by SMT.'}
        </p>
      </div>
    </div>
  );
}

export default function AdmissionsProjectionsPage() {
  return (
    <RequireAuth><RequireResource resourceKey="/admissions">
      <ProjectionsInner />
    </RequireResource></RequireAuth>
  );
}
