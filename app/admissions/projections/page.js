'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { YEAR_GROUPS, errorText } from '../../../lib/admissions';

// Next year's roll, year group by year group and by gender: today's active
// students move up a year (Year 12 leave), and the entry year's applicants
// come in. "Confirmed" newcomers are families who have accepted a place
// (accepted, deposit paid or enrolled); offers still awaiting a reply and
// applicants still in the process (enquiry to interview, or on the waiting
// list) are only predicted, at the share of each set on the page. Nothing is
// written: the page reads students and applicants (RLS decides who sees them).

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
const scale = (c, pct) => ({ M: c.M * pct / 100, F: c.F * pct / 100, U: c.U * pct / 100 });

// Predicted figures can be fractional; one decimal place at most.
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function Count({ c, strong }) {
  const t = total(c);
  return (
    <div>
      <div style={{ fontWeight: strong ? 800 : 600, fontSize: strong ? '1.05em' : undefined }}>{fmt(t)}</div>
      {t > 0 && (
        <div style={{ fontSize: '0.8em', color: '#666', whiteSpace: 'nowrap' }}>
          {fmt(c.M)} M · {fmt(c.F)} F{c.U ? ` · ${fmt(c.U)} ?` : ''}
        </div>
      )}
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
  const [years, setYears] = useState(null); // { current, next }
  const [students, setStudents] = useState([]);
  const [applicants, setApplicants] = useState([]);
  const [offerPct, setOfferPct] = useState(100);
  const [processPct, setProcessPct] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
        ]);
        setStudents(st);
        setApplicants(ap);
      } catch (e) {
        setError(errorText(e));
      }
      setLoading(false);
    })();
  }, []);

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
    const movingUp = y === YEAR_GROUPS[0] ? empty() : now[y - 1];
    const projected = add(movingUp, confirmed[y]);
    const predicted = add(projected, scale(offered[y], offerPct), scale(inProcess[y], processPct));
    return { y, movingUp, confirmed: confirmed[y], offered: offered[y], inProcess: inProcess[y], projected, predicted };
  });
  const sum = (k) => add(...rows.map((r) => r[k]));
  const totals = {
    movingUp: sum('movingUp'), confirmed: sum('confirmed'), offered: sum('offered'),
    inProcess: sum('inProcess'), projected: sum('projected'), predicted: sum('predicted'),
  };
  const nowRoll = add(...YEAR_GROUPS.map((y) => now[y]));
  const lastYear = YEAR_GROUPS[YEAR_GROUPS.length - 1];
  const leaving = now[lastYear];
  const unknownGender = nowRoll.U + totals.confirmed.U + totals.offered.U + totals.inProcess.U;

  const cards = [
    ['Roll now', nowRoll, `${years.current.label}, active students`],
    [`Year ${lastYear} leaving`, leaving, `End of ${years.current.label}`],
    ['New, confirmed', totals.confirmed, 'Accepted, deposit paid or enrolled'],
    [`Projected roll ${years.next.label}`, totals.projected, 'Moving up + confirmed new'],
    [`Predicted roll ${years.next.label}`, totals.predicted, 'Adds offers and applicants in process'],
  ];

  const pctInput = (value, set) => (
    <input
      type="number" min={0} max={100} step={5} value={value}
      onChange={(e) => set(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
      style={{ width: '5rem' }}
    />
  );

  return (
    <div>
      <h1 style={{ margin: 0 }}>Next Year's Numbers</h1>
      <p style={{ color: '#666', marginTop: '0.4rem' }}>
        {years.next.label}: today's students moving up a year, Year {lastYear} leaving, and new admissions coming in. <a href="/admissions">Applicants</a>
      </p>

      <div className="stat-card-row">
        {cards.map(([label, c, note]) => (
          <div key={label} className="stat-card accent-family" title={note}>
            <div>
              <div className="stat-card-value">{fmt(total(c))}</div>
              <div className="stat-card-label">{label}</div>
              <div style={{ fontSize: '0.75rem', color: '#666' }}>{fmt(c.M)} boys · {fmt(c.F)} girls{c.U ? ` · ${fmt(c.U)} not recorded` : ''}</div>
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
        </div>
        <p style={{ color: '#666', fontSize: '0.85em', marginBottom: 0 }}>
          These two shares only change the <strong>Predicted</strong> column; they're your estimate and aren't saved.
          Unsuccessful and withdrawn applicants are never counted.
        </p>
      </div>

      <div className="card">
        <div className="table-scroll"><table>
          <thead>
            <tr>
              <th>{years.next.label}</th>
              <th title="Today's students in the year below">Moving up</th>
              <th title="Accepted, deposit paid or enrolled">New: confirmed</th>
              <th title="Moving up + confirmed new">Projected</th>
              <th title="Offered a place, no reply yet">New: offered</th>
              <th title="Enquiry, form paid, test booked, tested, invited to interview, interviewed or on the waiting list">New: in process</th>
              <th title={`Projected + ${offerPct}% of offers + ${processPct}% of those in process`}>Predicted</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.y}>
                <td><strong>Year {r.y}</strong>{r.y > YEAR_GROUPS[0] && <div style={{ fontSize: '0.8em', color: '#666' }}>Year {r.y - 1} now</div>}</td>
                <td><Count c={r.movingUp} /></td>
                <td><Count c={r.confirmed} /></td>
                <td><Count c={r.projected} strong /></td>
                <td><Count c={r.offered} /></td>
                <td><Count c={r.inProcess} /></td>
                <td><Count c={r.predicted} strong /></td>
              </tr>
            ))}
            <tr style={{ borderTop: '2px solid #ccc' }}>
              <td><strong>Total</strong></td>
              <td><Count c={totals.movingUp} /></td>
              <td><Count c={totals.confirmed} /></td>
              <td><Count c={totals.projected} strong /></td>
              <td><Count c={totals.offered} /></td>
              <td><Count c={totals.inProcess} /></td>
              <td><Count c={totals.predicted} strong /></td>
            </tr>
            <tr>
              <td><strong>Leaving</strong><div style={{ fontSize: '0.8em', color: '#666' }}>Year {lastYear} now</div></td>
              <td colSpan={6}><Count c={leaving} /></td>
            </tr>
          </tbody>
        </table></div>
        {unknownGender > 0 && (
          <p style={{ color: '#666', fontSize: '0.85em', marginBottom: 0 }}>
            “?” is a student or applicant with no gender recorded ({unknownGender} in all); fill it in on their record to have them counted as a boy or girl.
          </p>
        )}
        <p style={{ color: '#666', fontSize: '0.85em', marginBottom: 0 }}>
          Assumes every current student below Year {lastYear} stays and moves up one year; anyone known to be leaving early isn't taken off.
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
