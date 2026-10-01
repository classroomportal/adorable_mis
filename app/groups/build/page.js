'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { useAuth } from '../../../lib/AuthContext';
import { schoolToday } from '../../../lib/schoolTime';
import { GROUP_KINDS, GROUP_RULES, OTHER_HALF_KIND, describeRule, canManageGroups } from '../../../lib/studentGroups';
import { formatUKDate } from '../../../lib/formatDate';
import { OH_DAYS, OH_DAY_NAMES, formatYearGroups, loadCurrentOtherHalfTermId } from '../../../lib/otherHalf';

// Build a student group from a rule (migrations 285, 301, 302). Every setting is
// chosen here, each time: the dates, thresholds, percentages, the exam, the
// number of subjects and which years, forms and houses (the principal: "system build parameters must be
// editable"). "Show students" asks the database who matches today; untick
// anyone to leave out, then save it as a dated, staff-only group.
// /groups/build?from=<group_id> starts from an earlier group's settings.

function Checklist({ label, options, chosen, onChange }) {
  const toggle = (v) => onChange(chosen.includes(v) ? chosen.filter((x) => x !== v) : [...chosen, v]);
  return (
    <fieldset style={{ border: '1px solid var(--slate-200)', borderRadius: '8px', padding: '0.4rem 0.75rem', margin: 0, flex: '1 1 100%' }}>
      <legend style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>{label} {chosen.length === 0 ? '(all)' : ''}</legend>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem 1rem', maxHeight: '8rem', overflowY: 'auto' }}>
        {options.map((o) => (
          <label key={o.value} className="checkbox-row" style={{ flex: '0 0 auto', margin: 0, fontSize: '0.9rem' }}>
            <input type="checkbox" checked={chosen.includes(o.value)} onChange={() => toggle(o.value)} /> {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function BuildInner() {
  const { profile, staffRoles } = useAuth();
  const canManage = canManageGroups(profile, staffRoles);

  const [rule, setRule] = useState('negative_behaviour');
  const [settings, setSettings] = useState(null);
  const [lookups, setLookups] = useState({ years: [], forms: [], houses: [], exams: [], subjects: [], grades: [] });
  const [preview, setPreview] = useState(null); // rows from student_group_rule_preview
  const [previewedFor, setPreviewedFor] = useState(null); // JSON of the settings the preview used
  const [ticked, setTicked] = useState(new Set());
  const [name, setName] = useState('');
  const [kind, setKind] = useState('intervention');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Kind "Other Half": which activity to place the saved group in, and the
  // lock (place_group_in_other_half(), migration 302).
  const [oh, setOh] = useState(null); // { termId, activities, taken } once loaded
  const [ohActivityId, setOhActivityId] = useState('');
  const [ohLock, setOhLock] = useState('until_unlocked'); // until_unlocked | until_date | none
  const [ohUntil, setOhUntil] = useState('');

  // Starting values: this term so far, the current school year, three
  // subjects, −6 / +40 points, the latest term exam with marks below 50%, and
  // attendance below 90% over at least 20 sessions. All of them can be
  // changed before building.
  useEffect(() => {
    (async () => {
      const today = schoolToday();
      const [{ data: term }, { data: year }, { data: pupils }, { data: houses }, { data: examSets }, { data: subjects }, { data: grades }] = await Promise.all([
        supabase.from('terms').select('start_date').lte('start_date', today).gte('end_date', today).maybeSingle(),
        supabase.from('academic_years').select('start_date').eq('status', 'current').maybeSingle(),
        supabase.from('students').select('year_group, form_class').eq('status', 'active'),
        supabase.from('boarding_houses').select('name').order('name'),
        // Each term's exams are one set per year group on the same date (migration 246).
        supabase.from('calendar_events').select('event_date, exam_term').not('exam_term', 'is', null).lte('event_date', today).order('event_date', { ascending: false }),
        supabase.from('subjects').select('subject_id, subject_name, display_name').order('subject_name'),
        supabase.from('grade_scale').select('grade, points').order('points', { ascending: false }),
      ]);
      const exams = [];
      (examSets || []).forEach((e) => {
        if (!exams.some((x) => x.value === e.event_date)) {
          exams.push({ value: e.event_date, label: `Term ${e.exam_term} exam, ${new Date(`${e.event_date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}` });
        }
      });
      setLookups({
        years: [...new Set((pupils || []).map((s) => s.year_group).filter((y) => y != null))].sort((a, b) => a - b).map((y) => ({ value: String(y), label: `Year ${y}` })),
        forms: [...new Set((pupils || []).map((s) => s.form_class).filter(Boolean))].sort().map((f) => ({ value: f, label: f })),
        houses: (houses || []).map((h) => ({ value: h.name, label: h.name })),
        exams,
        subjects: (subjects || []).map((x) => ({ value: String(x.subject_id), label: x.display_name || x.subject_name })),
        grades: (grades || []).map((g) => g.grade),
      });
      const defaults = {
        from: term?.start_date || today, to: today, threshold: -6, positive_threshold: 40,
        min_subjects: 3, since: year?.start_date || today,
        exam_date: exams[0]?.value || '', direction: 'below', exam_percent: 50,
        attendance_percent: 90, min_sessions: 20,
        subject_id: '', mode: 'below_target', grade: 'C',
        year_groups: [], forms: [], houses: [],
      };

      // "Build again": start from an earlier group's rule and settings.
      const fromId = new URLSearchParams(window.location.search).get('from');
      if (fromId && /^\d+$/.test(fromId)) {
        const { data: g } = await supabase.from('student_groups').select('name, kind, rule_type, rule_settings').eq('group_id', Number(fromId)).maybeSingle();
        if (g?.rule_type) {
          setRule(g.rule_type);
          setKind(g.kind);
          const saved = { ...g.rule_settings };
          // The form keeps each rule's number in its own field.
          if (g.rule_type === 'positive_behaviour') { saved.positive_threshold = saved.threshold; delete saved.threshold; }
          if (g.rule_type === 'term_exam') saved.exam_percent = saved.percent;
          if (g.rule_type === 'attendance') saved.attendance_percent = saved.percent;
          if (g.rule_type === 'subject_grade') saved.subject_id = String(saved.subject_id);
          delete saved.percent;
          const earlier = { ...defaults, ...saved };
          // A period that ended in the past moves up to today.
          if (['negative_behaviour', 'positive_behaviour', 'attendance'].includes(g.rule_type) && earlier.to < today) earlier.to = today;
          setSettings(earlier);
          return;
        }
      }
      setSettings(defaults);
    })();
  }, []);

  useEffect(() => {
    if (kind !== OTHER_HALF_KIND || oh) return;
    (async () => {
      const termId = await loadCurrentOtherHalfTermId();
      if (!termId) { setOh({ termId: null, activities: [], taken: {} }); return; }
      const [{ data: acts }, { data: counts }] = await Promise.all([
        supabase.from('other_half_activities').select('activity_id, activity_name, day_of_week, year_groups, capacity')
          .eq('term_id', termId).eq('is_active', true).order('activity_name'),
        supabase.rpc('other_half_places_taken', { p_term_id: termId }),
      ]);
      setOh({ termId, activities: acts || [], taken: Object.fromEntries((counts || []).map((c) => [c.activity_id, c.taken])) });
    })();
  }, [kind, oh]);

  if (!canManage) return <p>Only SMT, pastoral staff and the school office can build student groups.</p>;
  if (!settings) return <p>Loading…</p>;

  const set = (key, value) => setSettings((prev) => ({ ...prev, [key]: value }));

  // Only the settings the chosen rule uses are sent.
  function ruleSettings() {
    const common = { year_groups: settings.year_groups, forms: settings.forms, houses: settings.houses };
    if (rule === 'negative_behaviour') {
      return { ...common, from: settings.from, to: settings.to, threshold: -Math.abs(Number(settings.threshold)) };
    }
    if (rule === 'positive_behaviour') {
      return { ...common, from: settings.from, to: settings.to, threshold: Math.abs(Number(settings.positive_threshold)) };
    }
    if (rule === 'term_exam') {
      return { ...common, exam_date: settings.exam_date, direction: settings.direction, percent: Number(settings.exam_percent) };
    }
    if (rule === 'attendance') {
      return { ...common, from: settings.from, to: settings.to, percent: Number(settings.attendance_percent), min_sessions: Number(settings.min_sessions) };
    }
    if (rule === 'subject_grade') {
      return {
        ...common, subject_id: Number(settings.subject_id), mode: settings.mode, since: settings.since,
        ...(settings.mode === 'below_grade' ? { grade: settings.grade } : {}),
      };
    }
    return { ...common, min_subjects: Number(settings.min_subjects), since: settings.since };
  }

  const current = JSON.stringify({ rule, ...ruleSettings() });
  const stale = preview && previewedFor !== current;

  async function showStudents(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const s = ruleSettings();
    const { data, error: err } = await supabase.rpc('student_group_rule_preview', { p_rule: rule, p_settings: s });
    setBusy(false);
    if (err) { setError(err.message); setPreview(null); return; }
    setPreview(data || []);
    setPreviewedFor(current);
    setTicked(new Set((data || []).map((r) => r.student_id)));
    setName(`${describeRule(rule, s)} · built ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`.slice(0, 120));
  }

  async function save() {
    const placing = kind === OTHER_HALF_KIND && ohActivityId;
    const a = placing ? oh.activities.find((x) => String(x.activity_id) === String(ohActivityId)) : null;
    if (placing && ohLock === 'until_date' && !ohUntil) { setError('Choose the last day of the lock.'); return; }
    if (a) {
      // The same "anyway?" warnings as placing from the group's page.
      const ids = [...ticked];
      const { data: existing } = await supabase.from('other_half_choices').select('student_id, activity_id')
        .eq('term_id', oh.termId).eq('day_of_week', a.day_of_week).in('student_id', ids);
      const alreadyIn = (existing || []).filter((c) => c.activity_id === a.activity_id).length;
      const replacing = (existing || []).length - alreadyIn;
      const joining = ids.length - alreadyIn;
      const warnings = [];
      if (a.capacity != null) {
        const left = a.capacity - (oh.taken[a.activity_id] || 0);
        if (joining > left) warnings.push(`${a.activity_name} has ${Math.max(left, 0)} place${left === 1 ? '' : 's'} left and ${joining} student${joining === 1 ? '' : 's'} would join.`);
      }
      const wrongYear = preview.filter((r) => ticked.has(r.student_id) && !(a.year_groups || []).includes(r.year_group)).length;
      if (wrongYear) warnings.push(`${wrongYear} student${wrongYear === 1 ? ' is' : 's are'} not in its year groups (${formatYearGroups(a.year_groups)}).`);
      if (replacing) warnings.push(`${replacing} student${replacing === 1 ? '' : 's'} will lose the ${OH_DAY_NAMES[a.day_of_week]} activity they chose.`);
      const lockWords = ohLock === 'none' ? 'not locked' : ohLock === 'until_unlocked' ? 'locked until staff unlock it' : `locked until ${formatUKDate(ohUntil)}`;
      const question = `Save the group and put its ${ids.length} student${ids.length === 1 ? '' : 's'} in ${a.activity_name} on ${OH_DAY_NAMES[a.day_of_week]}s, ${lockWords}?`;
      if (!window.confirm([...warnings, question].join('\n\n'))) return;
    }

    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('build_student_group', {
      p_name: name, p_description: description, p_kind: kind, p_rule: rule,
      p_settings: ruleSettings(), p_student_ids: [...ticked],
    });
    if (err) { setBusy(false); setError(err.message); return; }
    if (a) {
      const { error: placeErr } = await supabase.rpc('place_group_in_other_half', {
        p_group_id: data, p_activity_id: a.activity_id,
        p_lock: ohLock !== 'none', p_locked_until: ohLock === 'until_date' ? ohUntil : null,
      });
      if (placeErr) {
        setBusy(false);
        setError(`The group was saved, but placing it in ${a.activity_name} failed: ${placeErr.message}. Open the group to try again.`);
        return;
      }
    }
    setBusy(false);
    window.location.href = `/groups/${data}`;
  }

  const toggle = (id) => setTicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div>
      <p><a href="/groups">← Student Groups</a></p>
      <h1>Build a group from a rule</h1>
      <p style={{ color: 'var(--ink-soft)' }}>
        Choose the rule and its settings, then show the students who match today. The group is saved as a dated list,
        seen by staff only. It doesn&apos;t change by itself afterwards; build it again for a fresh list.
      </p>
      {error && <p style={{ color: 'red' }}>{error}</p>}

      <form onSubmit={showStudents}>
        <label style={{ flexBasis: '100%' }}>Rule
          <select value={rule} onChange={(e) => setRule(e.target.value)}>
            {GROUP_RULES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <span style={{ fontSize: '0.85rem' }}>{GROUP_RULES.find((r) => r.value === rule)?.desc}</span>
        </label>

        {['negative_behaviour', 'positive_behaviour', 'attendance'].includes(rule) && (
          <>
            <label>From<input type="date" value={settings.from} onChange={(e) => set('from', e.target.value)} required /></label>
            <label>To<input type="date" value={settings.to} onChange={(e) => set('to', e.target.value)} required /></label>
          </>
        )}
        {rule === 'negative_behaviour' && (
          <label>Negative points, this many or worse
            <input type="number" max={-1} min={-1000} step={1} value={settings.threshold} onChange={(e) => set('threshold', e.target.value)} required />
          </label>
        )}
        {rule === 'positive_behaviour' && (
          <label>Positive points, this many or more
            <input type="number" min={1} max={1000} step={1} value={settings.positive_threshold} onChange={(e) => set('positive_threshold', e.target.value)} required />
          </label>
        )}
        {rule === 'attendance' && (
          <>
            <label>Attendance below (%)
              <input type="number" min={1} max={100} step="any" value={settings.attendance_percent} onChange={(e) => set('attendance_percent', e.target.value)} required />
            </label>
            <label>Only students with at least (sessions marked)
              <input type="number" min={1} max={10000} step={1} value={settings.min_sessions} onChange={(e) => set('min_sessions', e.target.value)} required />
            </label>
          </>
        )}
        {rule === 'term_exam' && (
          <>
            <label>Term exam
              <select value={settings.exam_date} onChange={(e) => set('exam_date', e.target.value)} required>
                {lookups.exams.length === 0 && <option value="">No term exams yet</option>}
                {lookups.exams.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
              </select>
            </label>
            <label>Average
              <select value={settings.direction} onChange={(e) => set('direction', e.target.value)}>
                <option value="below">below</option>
                <option value="at_or_above">at or above</option>
              </select>
            </label>
            <label>Percentage
              <input type="number" min={0} max={100} step="any" value={settings.exam_percent} onChange={(e) => set('exam_percent', e.target.value)} required />
            </label>
          </>
        )}
        {rule === 'subject_grade' && (
          <>
            <label>Subject
              <select value={settings.subject_id} onChange={(e) => set('subject_id', e.target.value)} required>
                <option value="">Choose a subject…</option>
                {lookups.subjects.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
              </select>
            </label>
            <label>Latest grade
              <select value={settings.mode} onChange={(e) => set('mode', e.target.value)}>
                <option value="below_target">below their target</option>
                <option value="below_grade">below a grade</option>
              </select>
            </label>
            {settings.mode === 'below_grade' && (
              <label>Grade
                <select value={settings.grade} onChange={(e) => set('grade', e.target.value)} required>
                  {lookups.grades.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </label>
            )}
            <label>Count results from
              <input type="date" value={settings.since} onChange={(e) => set('since', e.target.value)} required />
            </label>
          </>
        )}
        {rule === 'below_target' && (
          <>
            <label>Below target in at least (subjects)
              <input type="number" min={1} max={20} step={1} value={settings.min_subjects} onChange={(e) => set('min_subjects', e.target.value)} required />
            </label>
            <label>Count results from
              <input type="date" value={settings.since} onChange={(e) => set('since', e.target.value)} required />
            </label>
          </>
        )}

        <Checklist label="Year groups" options={lookups.years} chosen={settings.year_groups} onChange={(v) => set('year_groups', v)} />
        <Checklist label="Forms" options={lookups.forms} chosen={settings.forms} onChange={(v) => set('forms', v)} />
        <Checklist label="Boarding houses" options={lookups.houses} chosen={settings.houses} onChange={(v) => set('houses', v)} />

        <button type="submit" disabled={busy}>{busy ? 'Working…' : preview ? 'Show students again' : 'Show students'}</button>
      </form>

      {preview && (
        <>
          <h2>{preview.length} student{preview.length === 1 ? '' : 's'} match{preview.length === 1 ? 'es' : ''}</h2>
          {stale && <p style={{ color: '#a3232c' }}>You have changed the settings. Press &quot;Show students again&quot; before saving.</p>}
          {preview.length > 0 && (
            <>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th><input type="checkbox" aria-label="Tick all" checked={ticked.size === preview.length}
                        onChange={(e) => setTicked(e.target.checked ? new Set(preview.map((r) => r.student_id)) : new Set())} /></th>
                      <th>Name</th><th>Year</th><th>Form</th><th>Why</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((r) => (
                      <tr key={r.student_id}>
                        <td><input type="checkbox" checked={ticked.has(r.student_id)} onChange={() => toggle(r.student_id)} /></td>
                        <td><a href={`/students/${r.student_id}`} target="_blank" rel="noreferrer">{r.first_name} {r.last_name}</a></td>
                        <td>{r.year_group}</td>
                        <td>{r.form_class}</td>
                        <td style={{ minWidth: '16rem' }}>{r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <form onSubmit={(e) => { e.preventDefault(); save(); }} style={{ marginTop: '1rem' }}>
                <label style={{ flexBasis: '100%' }}>Group name<input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} /></label>
                <label>Kind
                  <select value={kind} onChange={(e) => setKind(e.target.value)}>
                    {GROUP_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                  </select>
                </label>
                {kind === OTHER_HALF_KIND && (
                  !oh ? <span style={{ flexBasis: '100%' }}>Loading Other Half activities…</span>
                    : !oh.termId ? <span style={{ flexBasis: '100%', color: 'var(--ink-soft)' }}>No Other Half term is running, so the group can&apos;t be placed yet.</span>
                      : (
                        <>
                          <label>Other Half activity
                            <select value={ohActivityId} onChange={(e) => setOhActivityId(e.target.value)}>
                              <option value="">Choose later on the group&apos;s page</option>
                              {OH_DAYS.map((d) => {
                                const list = oh.activities.filter((x) => x.day_of_week === d);
                                return list.length === 0 ? null : (
                                  <optgroup key={d} label={OH_DAY_NAMES[d]}>
                                    {list.map((x) => (
                                      <option key={x.activity_id} value={x.activity_id}>
                                        {x.activity_name} ({x.capacity == null ? 'no limit' : `${Math.max(x.capacity - (oh.taken[x.activity_id] || 0), 0)} left`})
                                      </option>
                                    ))}
                                  </optgroup>
                                );
                              })}
                            </select>
                          </label>
                          {ohActivityId && (
                            <label>Lock their choice
                              <select value={ohLock} onChange={(e) => setOhLock(e.target.value)}>
                                <option value="until_unlocked">until we unlock it</option>
                                <option value="until_date">until a date</option>
                                <option value="none">don&apos;t lock</option>
                              </select>
                            </label>
                          )}
                          {ohActivityId && ohLock === 'until_date' && (
                            <label>Last day locked<input type="date" min={schoolToday()} value={ohUntil} onChange={(e) => setOhUntil(e.target.value)} required /></label>
                          )}
                          <span style={{ flexBasis: '100%', fontSize: '0.85rem', color: 'var(--ink-soft)' }}>
                            Replaces each student&apos;s choice for that day only. Students and parents see &quot;Placed by the school&quot;, never why.
                          </span>
                        </>
                      )
                )}
                <label style={{ flexBasis: '100%' }}>Description (optional)
                  <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={2000} />
                </label>
                <button type="submit" disabled={busy || stale || ticked.size === 0 || !name.trim()}>
                  {kind === OTHER_HALF_KIND && ohActivityId ? 'Save and place' : 'Save'} group of {ticked.size} student{ticked.size === 1 ? '' : 's'}
                </button>
              </form>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default function BuildGroupPage() {
  return (
    <RequireAuth>
      <RequireResource resourceKey="/groups">
        <BuildInner />
      </RequireResource>
    </RequireAuth>
  );
}
