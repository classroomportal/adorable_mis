'use client';
import { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import { useAuth } from '../../../lib/AuthContext';

const TARGET_TYPES = [
  { value: 'individual', label: 'A specific person', kind: 'search' },
  { value: 'all_parents', label: 'All parents', kind: 'none' },
  { value: 'all_students', label: 'All students', kind: 'none' },
  { value: 'all_staff', label: 'All staff', kind: 'none' },
  { value: 'year_group', label: 'Year group', kind: 'options', optionsKey: 'yearGroupOptions' },
  { value: 'form_class', label: 'Form class', kind: 'options', optionsKey: 'formClassOptions' },
  { value: 'boarding_house', label: 'Boarding house', kind: 'options', optionsKey: 'houseOptions' },
  { value: 'mentor_group', label: 'Mentor group', kind: 'mentor_group' },
  { value: 'staff_role', label: 'Staff role', kind: 'options', optionsKey: 'roleOptions' },
];

function ComposeInner() {
  const { profile, staffRoles } = useAuth();
  const allowed = profile?.role === 'admin' || ['smt', 'pastoral', 'school_office'].some((r) => staffRoles.includes(r));

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [targetType, setTargetType] = useState('individual');
  const [targetValue, setTargetValue] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedPeople, setSelectedPeople] = useState([]); // [{profile_id, display_name, person_type}]
  const [previewCount, setPreviewCount] = useState(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  const [roleOptions, setRoleOptions] = useState([]);
  const [houseOptions, setHouseOptions] = useState([]);
  const [mentorGroupOptions, setMentorGroupOptions] = useState([]);
  const [formClassOptions, setFormClassOptions] = useState([]);
  const [yearGroupOptions, setYearGroupOptions] = useState([]);

  useEffect(() => {
    supabase.from('roles').select('role_name').order('role_name').then(({ data }) => setRoleOptions((data || []).map((r) => r.role_name)));
    supabase.from('boarding_houses').select('name').order('name').then(({ data }) => setHouseOptions((data || []).map((h) => h.name)));
    supabase.from('mentor_groups').select('mentor_group_id, group_name').order('group_name').then(({ data }) => setMentorGroupOptions(data || []));
    supabase.from('students').select('form_class').not('form_class', 'is', null).then(({ data }) => {
      setFormClassOptions([...new Set((data || []).map((s) => s.form_class))].sort());
    });
    supabase.from('students').select('year_group').not('year_group', 'is', null).then(({ data }) => {
      setYearGroupOptions([...new Set((data || []).map((s) => s.year_group))].sort((a, b) => a - b));
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

  async function handlePreview() {
    if (targetType === 'individual') { setPreviewCount(selectedPeople.length); return; }
    setPreviewCount('checking...');
    const { data, error } = await supabase.rpc('resolve_message_recipients', {
      p_target_type: targetType,
      p_target_value: targetDef.kind !== 'none' ? targetValue : null,
    });
    if (error) { setPreviewCount(`error: ${error.message}`); return; }
    setPreviewCount(data?.length ?? 0);
  }

  async function handleSend() {
    if (!subject.trim() || !body.trim()) { setResult('Enter a subject and message first.'); return; }
    if (targetType === 'individual' && selectedPeople.length === 0) { setResult('Search for and add at least one person.'); return; }
    if (targetDef.kind !== 'none' && targetType !== 'individual' && !targetValue) { setResult('Choose an option from the list first.'); return; }
    setSending(true);
    setResult(null);
    const value = targetType === 'individual'
      ? selectedPeople.map((p) => p.profile_id).join(',')
      : (targetDef.kind !== 'none' ? targetValue : null);
    const { data, error } = await supabase.rpc('send_message', {
      p_subject: subject,
      p_body: body,
      p_target_type: targetType,
      p_target_value: value,
    });
    setSending(false);
    if (error) { setResult(`Failed: ${error.message}`); return; }
    setResult(`Sent to message id ${data}.`);
    setSubject('');
    setBody('');
    setSelectedPeople([]);
    setPreviewCount(null);
  }

  if (!allowed) return <p>Only SMT, Pastoral, or School Office can send messages.</p>;

  return (
    <div>
      <h1>Compose message</h1>
      <div className="card">
        <label>Send to</label>
        <select value={targetType} onChange={(e) => { setTargetType(e.target.value); setTargetValue(''); setSelectedPeople([]); setSearchResults([]); setPreviewCount(null); }}>
          {TARGET_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>

        {targetDef.kind === 'search' && (
          <div style={{ marginTop: '0.5rem' }}>
            <input
              style={{ display: 'block', width: '100%' }}
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Type a name to search..."
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

        {targetDef.kind === 'options' && (
          <select
            style={{ display: 'block', width: '100%', marginTop: '0.5rem' }}
            value={targetValue}
            onChange={(e) => { setTargetValue(e.target.value); setPreviewCount(null); }}
          >
            <option value="">Choose...</option>
            {(targetDef.optionsKey === 'yearGroupOptions' ? yearGroupOptions
              : targetDef.optionsKey === 'formClassOptions' ? formClassOptions
              : targetDef.optionsKey === 'houseOptions' ? houseOptions
              : roleOptions
            ).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        )}

        {targetDef.kind === 'mentor_group' && (
          <select
            style={{ display: 'block', width: '100%', marginTop: '0.5rem' }}
            value={targetValue}
            onChange={(e) => { setTargetValue(e.target.value); setPreviewCount(null); }}
          >
            <option value="">Choose...</option>
            {mentorGroupOptions.map((g) => <option key={g.mentor_group_id} value={g.mentor_group_id}>{g.group_name}</option>)}
          </select>
        )}

        <button onClick={handlePreview} style={{ marginTop: '0.5rem' }}>Check recipient count</button>
        {previewCount !== null && (
          <p>
            {previewCount} recipient(s) —{' '}
            {targetType === 'individual' ? 'will be emailed and shown in their inbox.' : 'in-app inbox only, no email.'}
          </p>
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
  return <RequireAuth><ComposeInner /></RequireAuth>;
}
