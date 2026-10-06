'use client';
import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { schoolToday } from '../../../lib/schoolTime';
import { formatUKDate } from '../../../lib/formatDate';
import { ageInMonths } from '../../../lib/admissions';
import { formatMonths, monthsFromParts } from '../../../lib/readingAge';
import { GapBadge } from '../../components/ReadingAgeHistory';

// Recording a reading test sitting (migration 323): one test for a year
// group or form, a reading age (years and months) per student. The sitting
// has a usual date, and any student who sat it on another day (absent, a
// catch-up, a different group) gets their own date on their row. Students
// left blank are skipped. Saving again for the same student, date and test
// updates the reading already there, so a sitting can be entered over
// several visits. The database checks who can write (/reading-ages/record), refuses
// future dates and stamps who entered each one.

const DEFAULT_TEST = 'School reading test';

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const fullName = (s) => `${s.first_name} ${s.last_name}`;
// The whole name, middle name included, for telling students apart.
const wholeName = (s) => [s.first_name, s.middle_name, s.last_name].filter(Boolean).join(' ');
// A name is clickable only when there's something more to show.
const hasDetails = (s) => !!(s.middle_name?.trim() || s.admitted_letter_date);

function RecordInner() {
  const today = schoolToday();
  const [students, setStudents] = useState([]);
  const [testNames, setTestNames] = useState([DEFAULT_TEST]);
  const [testedOn, setTestedOn] = useState(today);
  const [testName, setTestName] = useState(DEFAULT_TEST);
  const [filter, setFilter] = useState({ year: '', form: '', name: '' });
  const [entries, setEntries] = useState({}); // student_id -> { years, months } as typed
  const [rowDates, setRowDates] = useState({}); // student_id -> their own test date, if not the usual one
  const [saved, setSaved] = useState([]); // this test's readings around the usual date
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [openId, setOpenId] = useState(null); // student whose details are shown under their row

  useEffect(() => {
    (async () => {
      const [{ data: s }, { data: t }] = await Promise.all([
        supabase.from('students').select('student_id, first_name, middle_name, last_name, year_group, form_class, dob, admitted_letter_date')
          .eq('status', 'active').order('last_name'),
        supabase.from('reading_age_tests').select('test_name'),
      ]);
      setStudents(s || []);
      setTestNames([...new Set([DEFAULT_TEST, ...(t || []).map((r) => r.test_name)])].sort());
    })();
  }, []);

  // What's already saved for this test within 90 days either side of the
  // usual date, so a student's own date finds their reading too.
  async function loadExisting() {
    if (!testedOn || !testName.trim()) { setSaved([]); return; }
    const { data } = await supabase.from('reading_age_tests')
      .select('id, student_id, tested_on, reading_age_months')
      .eq('test_name', testName.trim())
      .gte('tested_on', addDays(testedOn, -90))
      .lte('tested_on', addDays(testedOn, 90));
    setSaved(data || []);
  }
  useEffect(() => { loadExisting(); }, [testedOn, testName]);

  const dateFor = (id) => rowDates[id] || testedOn;
  const existingFor = (id) => saved.find((r) => r.student_id === id && r.tested_on === dateFor(id)) || null;

  const years = [...new Set(students.map((s) => s.year_group).filter(Boolean))].sort((a, b) => a - b);
  const forms = [...new Set(students.filter((s) => !filter.year || String(s.year_group) === filter.year)
    .map((s) => s.form_class).filter(Boolean))].sort();
  const name = filter.name.trim().toLowerCase();
  const shown = (filter.year || filter.form || name)
    ? students.filter((s) => (!filter.year || String(s.year_group) === filter.year)
      && (!filter.form || s.form_class === filter.form)
      && (!name || fullName(s).toLowerCase().includes(name)))
    : [];

  const toSave = useMemo(() => Object.entries(entries)
    .filter(([, e]) => e.years !== '' || e.months !== '')
    .map(([id, e]) => ({ student_id: Number(id), months: monthsFromParts(e.years, e.months), tested_on: dateFor(Number(id)) })),
  [entries, rowDates, testedOn]);
  const invalid = toSave.filter((r) => r.months == null);
  const badDates = toSave.filter((r) => !r.tested_on || r.tested_on > today);
  const changed = toSave.filter((r) => r.months != null && existingFor(r.student_id)?.reading_age_months !== r.months);

  // A box shows what was typed, else what's saved for this sitting.
  function shownEntry(id) {
    if (entries[id]) return entries[id];
    const row = existingFor(id);
    return row
      ? { years: String(Math.floor(row.reading_age_months / 12)), months: String(row.reading_age_months % 12) }
      : { years: '', months: '' };
  }

  function setEntry(id, patch) {
    setEntries((m) => ({ ...m, [id]: { ...shownEntry(id), ...patch } }));
  }

  async function save() {
    if (!testedOn) { setStatus('Give the date of the test.'); return; }
    if (badDates.length) { setStatus("A test can't be dated after today, and every reading needs a date."); return; }
    if (invalid.length) { setStatus(`Check ${invalid.length} reading age${invalid.length === 1 ? '' : 's'}: whole years from 3 to 20, and months from 0 to 11.`); return; }
    if (changed.length === 0) { setStatus('Nothing new to save.'); return; }
    setSaving(true);
    setStatus('Saving...');
    const rows = changed.map((r) => ({
      student_id: r.student_id, tested_on: r.tested_on, test_name: testName.trim() || DEFAULT_TEST, reading_age_months: r.months,
    }));
    const { error } = await supabase.from('reading_age_tests')
      .upsert(rows, { onConflict: 'student_id,tested_on,test_name' });
    setSaving(false);
    if (error) { setStatus(`Not saved: ${error.message}`); return; }
    const otherDays = rows.filter((r) => r.tested_on !== testedOn).length;
    setStatus(`Saved ${rows.length} reading age${rows.length === 1 ? '' : 's'}${otherDays ? `, ${otherDays} on their own date` : ` for ${formatUKDate(testedOn)}`}.`);
    if (!testNames.includes(testName.trim())) setTestNames([...testNames, testName.trim()].sort());
    setEntries({});
    loadExisting();
  }

  async function removeExisting(s) {
    const row = existingFor(s.student_id);
    if (!row || !window.confirm(`Remove ${fullName(s)}'s reading age from ${formatUKDate(row.tested_on)}?`)) return;
    const { error } = await supabase.from('reading_age_tests').delete().eq('id', row.id);
    if (error) { setStatus(`Not removed: ${error.message}`); return; }
    setEntries((m) => { const n = { ...m }; delete n[s.student_id]; return n; });
    loadExisting();
  }

  return (
    <div>
      <p><Link href="/reading-ages">← Reading Ages</Link></p>
      <h1>Record a reading test</h1>
      <p style={{ color: '#5b6472' }}>
        Choose the test and the date most students sat it, then the year group or form. Type each reading age in
        years and months; leave a student blank if they weren&apos;t tested. If a student sat it on another day,
        change the date on their row. The gap to their actual age on their test date is worked out as you type.
        Reading ages from the admissions interview are entered on the applicant&apos;s page, and come across
        when the student is enrolled.
      </p>

      <div className="card">
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ maxWidth: '11rem' }}>Usual test date
            <input type="date" value={testedOn} max={today} onChange={(e) => setTestedOn(e.target.value)} />
          </label>
          <label style={{ maxWidth: '16rem' }}>Test
            <input type="text" list="reading-test-names" value={testName} maxLength={80} onChange={(e) => setTestName(e.target.value)} />
            <datalist id="reading-test-names">
              {testNames.map((t) => <option key={t} value={t} />)}
            </datalist>
          </label>
          <label style={{ maxWidth: '9rem' }}>Year group
            <select value={filter.year} onChange={(e) => setFilter({ ...filter, year: e.target.value, form: '' })}>
              <option value="">Choose</option>
              {years.map((y) => <option key={y} value={y}>Year {y}</option>)}
            </select>
          </label>
          <label style={{ maxWidth: '9rem' }}>Form
            <select value={filter.form} onChange={(e) => setFilter({ ...filter, form: e.target.value })}>
              <option value="">All</option>
              {forms.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <label style={{ maxWidth: '14rem' }}>Or find a student
            <input type="text" value={filter.name} placeholder="Name" onChange={(e) => setFilter({ ...filter, name: e.target.value })} />
          </label>
        </div>
        {shown.some((s) => existingFor(s.student_id)) && (
          <p style={{ fontSize: '0.85em', color: '#5b6472' }}>
            Readings already saved for this test on each student&apos;s date are filled in below.
          </p>
        )}
      </div>

      {shown.length > 0 && (
        <div className="card">
          <div className="table-scroll">
            <table>
              <thead><tr><th>Student</th><th>Form</th><th>Date tested</th><th>Age then</th><th>Reading age</th><th>Gap</th><th></th></tr></thead>
              <tbody>
                {shown.map((s) => {
                  const e = shownEntry(s.student_id);
                  const months = monthsFromParts(e.years, e.months);
                  const day = dateFor(s.student_id);
                  const age = s.dob && day ? ageInMonths(s.dob, day) : null;
                  const ownDate = !!rowDates[s.student_id] && rowDates[s.student_id] !== testedOn;
                  const typed = e.years !== '' || e.months !== '';
                  const open = openId === s.student_id && hasDetails(s);
                  return (
                    <Fragment key={s.student_id}>
                    <tr>
                      <td>
                        {hasDetails(s) ? (
                          <button type="button" aria-expanded={open}
                            title="Show full name and admission letter date"
                            style={{ background: 'none', border: 'none', padding: 0, color: '#1f5fa8', cursor: 'pointer', font: 'inherit', textAlign: 'left' }}
                            onClick={() => setOpenId(open ? null : s.student_id)}>
                            {fullName(s)}
                          </button>
                        ) : fullName(s)}
                      </td>
                      <td>{s.form_class || `Year ${s.year_group}`}</td>
                      <td>
                        <input type="date" value={day} max={today} aria-label={`${fullName(s)} test date`}
                          style={ownDate ? { borderColor: '#b06a00', background: '#fff6d6' } : { color: '#5b6472' }}
                          onChange={(ev) => setRowDates((m) => ({ ...m, [s.student_id]: ev.target.value }))} />
                      </td>
                      <td>{age != null ? formatMonths(age) : <span style={{ color: '#a3232c' }}>No date of birth</span>}</td>
                      <td>
                        <span style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center' }}>
                          <input type="number" min="3" max="20" inputMode="numeric" style={{ width: '4rem' }} aria-label={`${fullName(s)} years`}
                            value={e.years} onChange={(ev) => setEntry(s.student_id, { years: ev.target.value })} /> y
                          <input type="number" min="0" max="11" inputMode="numeric" style={{ width: '4rem' }} aria-label={`${fullName(s)} months`}
                            value={e.months} onChange={(ev) => setEntry(s.student_id, { months: ev.target.value })} /> m
                        </span>
                      </td>
                      <td>
                        {typed && months == null ? <span style={{ color: '#a3232c' }}>Check</span>
                          : months != null && age != null ? <GapBadge gap={months - age} /> : ''}
                      </td>
                      <td>
                        {existingFor(s.student_id) && (
                          <button type="button" className="secondary" onClick={() => removeExisting(s)}>Remove</button>
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={7} style={{ background: '#f4f7fb', fontSize: '0.9em' }}>
                          <strong>Full name:</strong> {wholeName(s)}
                          {s.admitted_letter_date && (
                            <span style={{ marginLeft: '1.5rem' }}><strong>Admitted/letter date:</strong> {formatUKDate(s.admitted_letter_date)}</span>
                          )}
                          <Link href={`/students/${s.student_id}`} style={{ marginLeft: '1.5rem' }}>Open profile</Link>
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
      )}

      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={save} disabled={saving || changed.length === 0}>
          Save {changed.length > 0 ? `${changed.length} reading age${changed.length === 1 ? '' : 's'}` : ''}
        </button>
        {status && <span>{status}</span>}
      </div>
    </div>
  );
}

export default function RecordReadingTestPage() {
  return (
    <RequireAuth><RequireResource resourceKey="/reading-ages/record">
      <RecordInner />
    </RequireResource></RequireAuth>
  );
}
