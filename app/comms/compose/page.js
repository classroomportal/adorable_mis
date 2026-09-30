'use client';
import { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { useAuth } from '../../../lib/AuthContext';

// Student groups can go to the students, their parents, or both
// (migration 277); parents in a group message are emailed as well as getting
// it in their inbox. Several groups of one kind can be ticked at once.
const TARGET_TYPES = [
  { value: 'individual', label: 'A specific person', kind: 'search' },
  { value: 'all_students', label: 'All students', kind: 'none', students: true },
  { value: 'year_group', label: 'Year group', kind: 'multi', optionsKey: 'years', students: true },
  { value: 'form_class', label: 'Form class', kind: 'multi', optionsKey: 'forms', students: true },
  { value: 'boarding_house', label: 'Boarding house', kind: 'multi', optionsKey: 'houses', students: true },
  { value: 'mentor_group', label: 'Mentor group', kind: 'multi', optionsKey: 'mentorGroups', students: true },
  { value: 'class', label: 'Teaching class', kind: 'multi', optionsKey: 'classes', students: true },
  { value: 'other_half', label: 'Other Half activity', kind: 'multi', optionsKey: 'otherHalf', students: true },
  { value: 'sports_house', label: 'Sports house', kind: 'multi', optionsKey: 'sportsHouses', students: true },
  { value: 'all_staff', label: 'All staff', kind: 'none' },
  { value: 'staff_role', label: 'Staff role', kind: 'multi', optionsKey: 'roles' },
];

const AUDIENCES = [
  { value: 'parents', label: 'Their parents (inbox and email)' },
  { value: 'students', label: 'The students (inbox only)' },
  { value: 'both', label: 'Both' },
];

const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function ComposeInner() {
  const { profile, staffRoles } = useAuth();
  const allowed = profile?.role === 'admin' || ['smt', 'pastoral', 'school_office'].some((r) => staffRoles.includes(r));

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [targetType, setTargetType] = useState('individual');
  const [targetValues, setTargetValues] = useState(new Set());
  const [audience, setAudience] = useState('parents');
  const [optionFilter, setOptionFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedPeople, setSelectedPeople] = useState([]); // [{profile_id, display_name, person_type}]
  const [preview, setPreview] = useState(null); // { total, students, parents, staff, parents_without_login, parent_emails_paused } | { error }
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  // Each option list is [{ value, label }]; values are what target_value stores.
  const [options, setOptions] = useState({});

  useEffect(() => {
    const put = (key, list) => setOptions((prev) => ({ ...prev, [key]: list }));
    const distinct = (rows, col) => [...new Set((rows || []).map((r) => r[col]).filter((v) => v !== null && v !== ''))];
    supabase.from('roles').select('role_name').order('role_name').then(({ data }) => put('roles', (data || []).map((r) => ({ value: r.role_name, label: r.role_name }))));
    supabase.from('boarding_houses').select('name').order('name').then(({ data }) => put('houses', (data || []).map((h) => ({ value: h.name, label: h.name }))));
    supabase.from('mentor_groups').select('mentor_group_id, group_name').order('group_name').then(({ data }) => put('mentorGroups', (data || []).map((g) => ({ value: String(g.mentor_group_id), label: g.group_name }))));
    supabase.from('classes').select('class_id, class_code').order('class_code').then(({ data }) => put('classes', (data || []).map((c) => ({ value: String(c.class_id), label: c.class_code }))));
    supabase.from('other_half_activities').select('activity_id, activity_name, day_of_week').eq('is_active', true).order('activity_name').then(({ data }) => {
      put('otherHalf', (data || []).map((a) => ({ value: String(a.activity_id), label: `${a.activity_name}${DAYS[a.day_of_week] ? ` (${DAYS[a.day_of_week]})` : ''}` })));
    });
    // Leavers aren't messaged (migration 237), so their old forms, years and houses aren't offered.
    supabase.from('students').select('year_group, form_class, sports_house').eq('status', 'active').then(({ data }) => {
      put('years', distinct(data, 'year_group').sort((a, b) => a - b).map((y) => ({ value: String(y), label: `Year ${y}` })));
      put('forms', distinct(data, 'form_class').sort().map((f) => ({ value: f, label: f })));
      put('sportsHouses', distinct(data, 'sports_house').sort().map((h) => ({ value: h, label: h })));
    });
  }, []);

  const targetDef = TARGET_TYPES.find((t) => t.value === targetType);

  async function handleSearch(q) {
    setSearchQuery(q);
    if (q.trim().length < 2) { setSearchResults([]); return; }
    const { data } = await supabase.rpc('search_people', { p_query: q });
    setSearchResults((data || []).filter((p) => !selectedPeople.some((sp) => sp.profile_id === p.profile_id)));
  }

  function addPerson(person) {
    setSelectedPeople((prev) => [...prev, person]);
    setSearchResults((prev) => prev.filter((p) => p.profile_id !== person.profile_id));
    setSearchQuery('');
  }

  function removePerson(profileId) {
    setSelectedPeople((prev) => prev.filter((p) => p.profile_id !== profileId));
  }

  const optionList = targetDef.optionsKey ? (options[targetDef.optionsKey] || []) : [];
  const filterText = optionFilter.trim().toLowerCase();
  const visibleOptions = filterText ? optionList.filter((o) => o.label.toLowerCase().includes(filterText)) : optionList;
  const messageAudience = targetDef.students ? audience : null;

  function currentValue() {
    if (targetType === 'individual') return selectedPeople.map((p) => p.profile_id).join(',');
    if (targetDef.kind === 'none') return null;
    // Kept in the order the list shows them, so the history reads sensibly.
    return optionList.filter((o) => targetValues.has(o.value)).map((o) => o.value).join(',');
  }

  function chosenLabels() {
    return optionList.filter((o) => targetValues.has(o.value)).map((o) => o.label);
  }

  function changeTarget(value) {
    setTargetType(value);
    setTargetValues(new Set());
    setOptionFilter('');
    setSelectedPeople([]);
    setSearchResults([]);
    setPreview(null);
  }

  function toggleValue(value) {
    setTargetValues((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
    setPreview(null);
  }

  function missingChoice() {
    if (targetType === 'individual' && selectedPeople.length === 0) return 'Search for and add at least one person.';
    if (targetDef.kind === 'multi' && targetValues.size === 0) return 'Tick at least one group first.';
    return null;
  }

  async function loadPreview() {
    const { data, error } = await supabase.rpc('message_recipient_preview', {
      p_target_type: targetType,
      p_target_value: currentValue(),
      p_audience: messageAudience,
    });
    return error ? { error: error.message } : data;
  }

  async function handlePreview() {
    const missing = missingChoice();
    if (missing) { setPreview({ error: missing }); return; }
    setPreview({ checking: true });
    setPreview(await loadPreview());
  }

  async function handleSend() {
    if (!subject.trim() || !body.trim()) { setResult('Enter a subject and message first.'); return; }
    const missing = missingChoice();
    if (missing) { setResult(missing); return; }
    // A message to parents is emailed to every one of them, so say how many
    // before it goes.
    if (targetType !== 'individual' && messageAudience !== 'students') {
      const p = await loadPreview();
      if (p.error) { setResult(`Failed: ${p.error}`); return; }
      setPreview(p);
      const how = p.parent_emails_paused ? 'in their inbox only (parent emails are paused)' : 'by email and in their inbox';
      const extra = messageAudience === 'both' ? ` and ${plural(p.students, 'student')} (inbox only)` : '';
      if (!window.confirm(`Send "${subject.trim()}" to ${plural(p.parents, 'parent')} ${how}${extra}?`)) return;
    }
    setSending(true);
    setResult(null);
    const { data, error } = await supabase.rpc('send_message', {
      p_subject: subject,
      p_body: body,
      p_target_type: targetType,
      p_target_value: currentValue(),
      p_audience: messageAudience,
    });
    setSending(false);
    if (error) { setResult(`Failed: ${error.message}`); return; }
    setResult(`Sent (message ${data}). See Message history for who it reached.`);
    setSubject('');
    setBody('');
    setSelectedPeople([]);
    setPreview(null);
  }

  if (!allowed) return <p>Only SMT, Pastoral, or School Office can send messages.</p>;

  return (
    <div>
      <h1>Compose message</h1>
      <div className="card">
        <label>Send to</label>
        <select value={targetType} onChange={(e) => changeTarget(e.target.value)}>
          <option value="individual">A specific person</option>
          <optgroup label="Students, or their parents">
            {TARGET_TYPES.filter((t) => t.students).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </optgroup>
          <optgroup label="Staff">
            {TARGET_TYPES.filter((t) => t.value === 'all_staff' || t.value === 'staff_role').map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </optgroup>
        </select>

        {targetDef.kind === 'search' && (
          <div style={{ marginTop: '0.5rem' }}>
            <input
              style={{ display: 'block', width: '100%' }}
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Type a name, or a parent's email, to search..."
            />
            {searchResults.length > 0 && (
              <ul style={{ border: '1px solid #ddd', marginTop: '0.25rem', padding: 0, listStyle: 'none' }}>
                {searchResults.map((p) => (
                  <li key={p.profile_id} style={{ padding: '0.4rem', cursor: 'pointer', borderBottom: '1px solid #eee' }} onClick={() => addPerson(p)}>
                    {p.display_name} <span style={{ color: '#888', fontSize: '0.85rem' }}>({p.person_type}{p.email ? `, ${p.email}` : ', no email on file'})</span>
                  </li>
                ))}
              </ul>
            )}
            {selectedPeople.length > 0 && (
              <div style={{ marginTop: '0.5rem' }}>
                {selectedPeople.map((p) => (
                  <span key={p.profile_id} style={{ display: 'inline-block', background: '#f0e6e0', borderRadius: '4px', padding: '0.25rem 0.5rem', marginRight: '0.25rem', marginBottom: '0.25rem' }}>
                    {p.display_name} ({p.person_type})
                    <button onClick={() => removePerson(p.profile_id)} style={{ marginLeft: '0.4rem', border: 'none', background: 'none', cursor: 'pointer' }}>✕</button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {targetDef.kind === 'multi' && (
          <div style={{ marginTop: '0.5rem' }}>
            {optionList.length > 12 && (
              <input
                type="search"
                value={optionFilter}
                onChange={(e) => setOptionFilter(e.target.value)}
                placeholder={`Filter ${targetDef.label.toLowerCase()}s...`}
                style={{ maxWidth: '20rem', marginBottom: '0.4rem' }}
              />
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem 1.1rem', maxHeight: '220px', overflowY: 'auto' }}>
              {visibleOptions.map((o) => (
                <label key={o.value} className="checkbox-row" style={{ margin: 0, fontSize: '0.95rem' }}>
                  <input type="checkbox" checked={targetValues.has(o.value)} onChange={() => toggleValue(o.value)} />
                  {o.label}
                </label>
              ))}
              {visibleOptions.length === 0 && <span style={{ color: '#888' }}>Nothing matches.</span>}
            </div>
            {targetValues.size > 0 && (
              <p style={{ margin: '0.4rem 0 0', fontSize: '0.9rem', color: '#555' }}>
                Chosen: {chosenLabels().join(', ')}{' '}
                <button type="button" className="secondary" onClick={() => { setTargetValues(new Set()); setPreview(null); }} style={{ padding: '0.1rem 0.5rem', fontSize: '0.8rem' }}>Clear</button>
              </p>
            )}
          </div>
        )}

        {targetDef.students && (
          <div style={{ marginTop: '0.75rem' }}>
            <label>Who gets it</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem 1.25rem' }}>
              {AUDIENCES.map((a) => (
                <label key={a.value} className="checkbox-row" style={{ margin: 0, fontSize: '0.95rem' }}>
                  <input type="radio" name="audience" checked={audience === a.value} onChange={() => { setAudience(a.value); setPreview(null); }} />
                  {a.label}
                </label>
              ))}
            </div>
          </div>
        )}

        <button onClick={handlePreview} style={{ marginTop: '0.75rem' }}>Check recipient count</button>
        {preview && (
          <div style={{ marginTop: '0.5rem' }}>
            {preview.checking ? <p>Checking…</p> : preview.error ? <p style={{ color: '#b91c1c' }}>{preview.error}</p> : (
              <>
                <p style={{ margin: '0.25rem 0' }}>
                  <strong>{preview.total}</strong> recipient{preview.total === 1 ? '' : 's'}
                  {preview.parents > 0 && ` · ${plural(preview.parents, 'parent')} (${targetType === 'individual' || !preview.parent_emails_paused ? 'inbox and email' : 'inbox only: parent emails are paused'})`}
                  {preview.students > 0 && ` · ${plural(preview.students, 'student')} (${targetType === 'individual' ? 'inbox and email' : 'inbox only'})`}
                  {preview.staff > 0 && ` · ${plural(preview.staff, 'member')} of staff (${targetType === 'individual' ? 'inbox and email' : 'inbox only'})`}
                </p>
                {preview.parents_without_login > 0 && (
                  <p style={{ margin: '0.25rem 0', color: '#b45309' }}>
                    {preview.parents_without_login === 1 ? '1 parent of these students has' : `${preview.parents_without_login} parents of these students have`}
                    {' '}no Formwork login yet, so won&apos;t get it. Send their welcome letter from <a href="/parents/welcome-emails">Parent welcome emails</a> first.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <label>Subject</label>
        <input style={{ display: 'block', width: '100%' }} value={subject} onChange={(e) => setSubject(e.target.value)} />
        <label style={{ marginTop: '0.5rem', display: 'block' }}>Message</label>
        <textarea rows={6} style={{ width: '100%' }} value={body} onChange={(e) => setBody(e.target.value)} />
        <button onClick={handleSend} disabled={sending} style={{ marginTop: '0.5rem' }}>
          {sending ? 'Sending...' : 'Send message'}
        </button>
      </div>

      {result && <p>{result}</p>}
    </div>
  );
}

export default function ComposePage() {
  return <RequireAuth><RequireResource resourceKey="/comms/compose"><ComposeInner /></RequireResource></RequireAuth>;
}
