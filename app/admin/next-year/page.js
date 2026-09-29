'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';

// Next Year Setup (migration 265; phase 4 of
// docs/admissions-and-year-rollover-design.md). Setting up a year follows on
// from creating it on Lookups, in order:
//   1. the mentor structure: next year's mentor groups and their mentors;
//   2. next year's Nova-T timetable, imported into plan tables the live
//      school never reads (unlocked once step 1 is confirmed);
//   3. a look at next year's classes as imported.
// Placing students into next year's classes comes next. Nothing here touches
// this year's mentor groups, timetable or class lists.

const YEARS = [7, 8, 9, 10, 11, 12];

// "7 George" -> "8 George": the school's mentor groups are named by year
// group, then a name that stays with the group as it moves up.
function movedUpName(name, toYear) {
  const m = String(name).match(/^\s*\d+\s*(.*)$/);
  return `${toYear} ${m ? m[1] : name}`.trim();
}

function staffName(s) {
  return s ? `${s.first_name} ${s.last_name}` : '';
}

function NextYearInner() {
  const [years, setYears] = useState([]);
  const [yearId, setYearId] = useState(null);
  const [groups, setGroups] = useState([]);
  const [assign, setAssign] = useState([]);
  const [staff, setStaff] = useState([]);
  const [classes, setClasses] = useState([]);
  const [lessons, setLessons] = useState({}); // class_id -> count
  const [enrolled, setEnrolled] = useState({}); // class_id -> count
  const [subjects, setSubjects] = useState({});
  const [newGroup, setNewGroup] = useState({ name: '', year: '7' });
  const [picking, setPicking] = useState({});
  const [renaming, setRenaming] = useState({});
  const [status, setStatus] = useState(null);
  const [openYear, setOpenYear] = useState(null);

  useEffect(() => {
    (async () => {
      const [{ data: ys }, { data: st }, { data: subj }] = await Promise.all([
        supabase.from('academic_years').select('*').order('start_date'),
        supabase.from('staff').select('staff_id, first_name, last_name, staff_code').order('last_name'),
        supabase.from('subjects').select('subject_id, subject_name, display_name'),
      ]);
      setYears(ys || []);
      setStaff(st || []);
      setSubjects(Object.fromEntries((subj || []).map((s) => [s.subject_id, s.display_name || s.subject_name])));
      const wanted = Number(new URLSearchParams(window.location.search).get('year'));
      const planning = (ys || []).filter((y) => y.status === 'planning');
      setYearId((planning.find((y) => y.academic_year_id === wanted) || planning[0])?.academic_year_id ?? null);
    })();
  }, []);

  const year = years.find((y) => y.academic_year_id === yearId);
  const confirmed = !!year?.mentor_structure_confirmed_at;
  const staffById = useMemo(() => Object.fromEntries(staff.map((s) => [s.staff_id, s])), [staff]);

  async function load() {
    if (!yearId) return;
    const [{ data: g }, { data: a }, { data: c }, { data: y }] = await Promise.all([
      supabase.from('plan_mentor_groups').select('*').eq('academic_year_id', yearId).order('year_group').order('group_name'),
      supabase.from('plan_mentor_assignments').select('*').eq('academic_year_id', yearId),
      supabase.from('plan_classes').select('class_id, class_code, subject_id, staff_id, room, year_group, block_id').eq('academic_year_id', yearId).order('class_code'),
      supabase.from('academic_years').select('*').eq('academic_year_id', yearId).maybeSingle(),
    ]);
    setGroups(g || []);
    setAssign(a || []);
    setClasses(c || []);
    if (y) setYears((prev) => prev.map((p) => (p.academic_year_id === y.academic_year_id ? y : p)));
    // Lesson and enrolment counts, a page at a time (PostgREST returns 1,000 rows at most).
    const count = async (table) => {
      const out = {};
      for (let from = 0; ; from += 1000) {
        const { data } = await supabase.from(table).select('class_id').eq('academic_year_id', yearId).range(from, from + 999);
        (data || []).forEach((r) => { out[r.class_id] = (out[r.class_id] || 0) + 1; });
        if (!data || data.length < 1000) break;
      }
      return out;
    };
    setLessons(await count('plan_timetable_slots'));
    setEnrolled(await count('plan_student_class'));
  }
  useEffect(() => { load(); }, [yearId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(promise, ok) {
    const { error } = await promise;
    if (error) { setStatus({ error: true, text: error.message }); return false; }
    if (ok) setStatus({ text: ok });
    await load();
    return true;
  }

  // Step 1 --------------------------------------------------------------------

  async function suggestFromThisYear() {
    setStatus({ text: 'Copying this year\'s groups...' });
    const [{ data: cur }, { data: roles }] = await Promise.all([
      supabase.from('mentor_groups').select('group_name, year_group'),
      supabase.from('staff_roles').select('staff_id, scope_value').eq('role_name', 'mentor').eq('scope_type', 'mentor_group'),
    ]);
    const rows = [];
    const mentors = [];
    for (const g of cur || []) {
      const y = Number(g.year_group);
      if (!(y >= 7 && y <= 11)) continue; // Year 12 leaves
      const name = movedUpName(g.group_name, y + 1);
      rows.push({ academic_year_id: yearId, group_name: name, year_group: y + 1, description: `Was ${g.group_name}` });
      (roles || []).filter((r) => r.scope_value === g.group_name)
        .forEach((r) => mentors.push({ academic_year_id: yearId, group_name: name, staff_id: r.staff_id }));
      // The same names again for next year's new Year 7.
      if (y === 7) rows.push({ academic_year_id: yearId, group_name: g.group_name, year_group: 7, description: 'New Year 7' });
    }
    if (rows.length === 0) { setStatus({ error: true, text: 'No mentor groups this year to copy.' }); return; }
    const { error } = await supabase.from('plan_mentor_groups').upsert(rows, { onConflict: 'academic_year_id,group_name', ignoreDuplicates: true });
    if (error) { setStatus({ error: true, text: error.message }); return; }
    if (mentors.length) {
      const { error: mErr } = await supabase.from('plan_mentor_assignments')
        .upsert(mentors, { onConflict: 'academic_year_id,group_name,staff_id', ignoreDuplicates: true });
      if (mErr) { setStatus({ error: true, text: mErr.message }); return; }
    }
    setStatus({ text: `Copied ${rows.length} groups, moved up a year, with their mentors. Year 12 leaves, so this year's Year 12 groups aren't carried over; the Year 7 names are repeated for the new Year 7. Check and adjust them below.` });
    load();
  }

  function addGroup(e) {
    e.preventDefault();
    if (!newGroup.name.trim()) return;
    run(supabase.from('plan_mentor_groups').insert({ academic_year_id: yearId, group_name: newGroup.name.trim(), year_group: Number(newGroup.year) }), 'Group added.');
    setNewGroup({ ...newGroup, name: '' });
  }

  function renameGroup(g) {
    const name = (renaming[g.plan_mentor_group_id] || '').trim();
    if (!name || name === g.group_name) { setRenaming({ ...renaming, [g.plan_mentor_group_id]: undefined }); return; }
    run(supabase.from('plan_mentor_groups').update({ group_name: name }).eq('plan_mentor_group_id', g.plan_mentor_group_id), 'Renamed.');
    setRenaming({ ...renaming, [g.plan_mentor_group_id]: undefined });
  }

  function removeGroup(g) {
    if (!window.confirm(`Remove ${g.group_name} from next year's mentor groups?`)) return;
    run(supabase.from('plan_mentor_groups').delete().eq('plan_mentor_group_id', g.plan_mentor_group_id), 'Removed.');
  }

  function addMentor(g) {
    const staffId = Number(picking[g.group_name]);
    if (!staffId) return;
    run(supabase.from('plan_mentor_assignments').insert({ academic_year_id: yearId, group_name: g.group_name, staff_id: staffId }));
    setPicking({ ...picking, [g.group_name]: '' });
  }

  function removeMentor(g, staffId) {
    run(supabase.from('plan_mentor_assignments').delete()
      .eq('academic_year_id', yearId).eq('group_name', g.group_name).eq('staff_id', staffId));
  }

  function confirm(on) {
    run(supabase.rpc('confirm_mentor_structure', { p_academic_year_id: yearId, p_confirmed: on }),
      on ? 'Mentor structure confirmed. The timetable import is now open.' : 'Reopened for changes.');
  }

  // ----------------------------------------------------------------------------

  if (years.length && !yearId) {
    return (
      <div>
        <h1>Next Year Setup</h1>
        <p>There&apos;s no academic year being planned. Add the next year on <a href="/admin/lookups">Lookups</a> (Academic years) first.</p>
      </div>
    );
  }
  if (!year) return <p>Loading...</p>;

  const byYear = (y) => groups.filter((g) => g.year_group === y);
  const classesByYear = (y) => classes.filter((c) => c.year_group === y);
  const totalLessons = Object.values(lessons).reduce((a, b) => a + b, 0);
  const stepStyle = (done) => ({ display: 'inline-block', minWidth: '1.6rem', textAlign: 'center', borderRadius: '50%', marginRight: '0.4rem', background: done ? '#1a7a3d' : '#1d4a8f', color: 'white' });

  return (
    <div>
      <h1>Next Year Setup: {year.label}</h1>
      <p>
        Set up {year.label} in order: first the mentor structure, then its Nova-T timetable. Everything here is a plan for
        next year; this year&apos;s mentor groups, timetable, registers and class lists are not affected. It all becomes live
        when the school moves up at the start of {year.label}.
        {years.filter((y) => y.status === 'planning').length > 1 && (
          <> Year:{' '}
            <select value={yearId} onChange={(e) => setYearId(Number(e.target.value))}>
              {years.filter((y) => y.status === 'planning').map((y) => <option key={y.academic_year_id} value={y.academic_year_id}>{y.label}</option>)}
            </select>
          </>
        )}
      </p>
      {status && <p style={{ color: status.error ? '#a3232c' : '#1a7a3d', fontWeight: 600 }}>{status.text}</p>}

      {/* Step 1 */}
      <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <h2 style={{ marginTop: 0 }}><span style={stepStyle(confirmed)}>{confirmed ? '✓' : '1'}</span>Mentor structure</h2>
        <p style={{ marginTop: 0 }}>
          Next year&apos;s mentor groups and who mentors each. Start from this year&apos;s groups moved up a year, then add,
          rename or remove groups and change mentors. Confirm it to open the timetable import.
        </p>
        {confirmed ? (
          <p style={{ color: '#1a7a3d' }}>
            Confirmed {new Date(year.mentor_structure_confirmed_at).toLocaleDateString('en-GB')}.{' '}
            <button className="secondary" onClick={() => confirm(false)}>Reopen for changes</button>
          </p>
        ) : groups.length === 0 ? (
          <p><button onClick={suggestFromThisYear}>Start from this year&apos;s groups, moved up a year</button> or add groups one by one below.</p>
        ) : null}

        {YEARS.map((y) => (
          <div key={y} style={{ marginBottom: '0.75rem' }}>
            <strong>Year {y}</strong> <span style={{ color: '#666' }}>({byYear(y).length} group{byYear(y).length === 1 ? '' : 's'})</span>
            {byYear(y).length === 0 && <span style={{ color: '#a3232c' }}> — none yet</span>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.3rem' }}>
              {byYear(y).map((g) => {
                const mentorIds = assign.filter((a) => a.group_name === g.group_name).map((a) => a.staff_id);
                return (
                  <div key={g.plan_mentor_group_id} style={{ border: '1px solid var(--slate-200)', borderRadius: 8, padding: '0.5rem', minWidth: '14rem' }}>
                    {renaming[g.plan_mentor_group_id] !== undefined && !confirmed ? (
                      <span>
                        <input value={renaming[g.plan_mentor_group_id]} onChange={(e) => setRenaming({ ...renaming, [g.plan_mentor_group_id]: e.target.value })} style={{ width: '9rem' }} autoFocus />
                        <button onClick={() => renameGroup(g)}>OK</button>
                      </span>
                    ) : (
                      <strong>{g.group_name}</strong>
                    )}
                    {g.description && <small style={{ color: '#666' }}> · {g.description}</small>}
                    <div style={{ fontSize: '0.9em', margin: '0.3rem 0' }}>
                      {mentorIds.length === 0 ? <span style={{ color: '#a3232c' }}>No mentor</span> : mentorIds.map((id) => (
                        <span key={id} className="badge" style={{ marginRight: '0.3rem' }}>
                          {staffName(staffById[id])}
                          {!confirmed && <button className="secondary" style={{ marginLeft: '0.3rem', padding: '0 0.3rem', fontSize: '0.8em' }} onClick={() => removeMentor(g, id)} title="Remove mentor">×</button>}
                        </span>
                      ))}
                    </div>
                    {!confirmed && (
                      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                        <select value={picking[g.group_name] || ''} onChange={(e) => setPicking({ ...picking, [g.group_name]: e.target.value })} style={{ maxWidth: '10rem' }}>
                          <option value="">Add mentor…</option>
                          {staff.filter((s) => !mentorIds.includes(s.staff_id)).map((s) => <option key={s.staff_id} value={s.staff_id}>{staffName(s)}</option>)}
                        </select>
                        <button className="secondary" onClick={() => addMentor(g)} disabled={!picking[g.group_name]}>Add</button>
                        <button className="secondary" onClick={() => setRenaming({ ...renaming, [g.plan_mentor_group_id]: g.group_name })}>Rename</button>
                        <button className="secondary" onClick={() => removeGroup(g)}>Remove</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {!confirmed && (
          <>
            <form onSubmit={addGroup} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label>New group<input value={newGroup.name} onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })} placeholder="e.g. 7 Victoria" /></label>
              <label>Year
                <select value={newGroup.year} onChange={(e) => setNewGroup({ ...newGroup, year: e.target.value })}>
                  {YEARS.map((y) => <option key={y} value={y}>Year {y}</option>)}
                </select>
              </label>
              <button type="submit">Add group</button>
            </form>
            {groups.length > 0 && (
              <p style={{ marginBottom: 0 }}>
                <button onClick={() => confirm(true)}>Confirm the mentor structure</button>{' '}
                <small style={{ color: '#666' }}>
                  {YEARS.filter((y) => byYear(y).length === 0).length > 0 && `Years with no groups yet: ${YEARS.filter((y) => byYear(y).length === 0).join(', ')}. `}
                  {groups.filter((g) => !assign.some((a) => a.group_name === g.group_name)).length > 0 && `${groups.filter((g) => !assign.some((a) => a.group_name === g.group_name)).length} group(s) without a mentor. `}
                  You can reopen it later to make changes.
                </small>
              </p>
            )}
          </>
        )}
      </div>

      {/* Step 2 */}
      <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch', opacity: confirmed ? 1 : 0.55 }}>
        <h2 style={{ marginTop: 0 }}><span style={stepStyle(classes.length > 0)}>{classes.length > 0 ? '✓' : '2'}</span>Nova-T timetable for {year.label}</h2>
        {confirmed ? (
          <>
            <p style={{ marginTop: 0 }}>
              Upload next year&apos;s Nova-T <code>TBTRA.DAT</code>–<code>TBTRF.DAT</code> files. They go into {year.label}&apos;s
              plan only; the import works exactly like the usual one and can be run again as Nova-T changes.
            </p>
            <p><a href={`/admin/import-classes?plan=${year.academic_year_id}`}><button>Import {year.label} Nova-T timetable</button></a></p>
            <p style={{ marginBottom: 0 }}>
              So far: {classes.length} class{classes.length === 1 ? '' : 'es'}, {totalLessons} lesson{totalLessons === 1 ? '' : 's'} a week.
            </p>
          </>
        ) : (
          <p style={{ margin: 0 }}>Opens once the mentor structure is confirmed.</p>
        )}
      </div>

      {/* Step 3 */}
      {classes.length > 0 && (
        <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <h2 style={{ marginTop: 0 }}><span style={stepStyle(false)}>3</span>{year.label} classes</h2>
          <p style={{ marginTop: 0 }}>As imported from Nova-T. Placing students into these classes is the next step, still to come.</p>
          {YEARS.map((y) => {
            const list = classesByYear(y);
            if (list.length === 0) return null;
            return (
              <div key={y} style={{ marginBottom: '0.5rem' }}>
                <button className="secondary" onClick={() => setOpenYear(openYear === y ? null : y)}>
                  {openYear === y ? '▾' : '▸'} Year {y}: {list.length} classes
                </button>
                {openYear === y && (
                  <div className="table-scroll">
                    <table>
                      <thead><tr><th>Class</th><th>Subject</th><th>Teacher</th><th>Room</th><th>Lessons</th><th>Students</th></tr></thead>
                      <tbody>
                        {list.map((c) => (
                          <tr key={c.class_id}>
                            <td>{c.class_code}</td>
                            <td>{subjects[c.subject_id] || ''}</td>
                            <td>{staffName(staffById[c.staff_id])}</td>
                            <td>{c.room || ''}</td>
                            <td>{lessons[c.class_id] || 0}</td>
                            <td>{enrolled[c.class_id] || 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function NextYearPage() {
  return <RequireAuth><RequireResource resourceKey="/admin/next-year"><NextYearInner /></RequireResource></RequireAuth>;
}
