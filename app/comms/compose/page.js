'use client';
import { useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import { useAuth } from '../../../lib/AuthContext';

const TARGET_TYPES = [
  { value: 'all_parents', label: 'All parents', needsValue: false },
  { value: 'all_students', label: 'All students', needsValue: false },
  { value: 'all_staff', label: 'All staff', needsValue: false },
  { value: 'year_group', label: 'Year group', needsValue: true, placeholder: 'e.g. 9' },
  { value: 'form_class', label: 'Form class', needsValue: true, placeholder: 'e.g. 9B' },
  { value: 'boarding_house', label: 'Boarding house', needsValue: true, placeholder: 'e.g. Boys House' },
  { value: 'mentor_group', label: 'Mentor group (by id)', needsValue: true, placeholder: 'e.g. 3' },
  { value: 'staff_role', label: 'Staff role', needsValue: true, placeholder: 'e.g. teacher' },
  { value: 'individual', label: 'Individual (comma-separated emails)', needsValue: true, placeholder: 'a@abc.sch.ng, b@abc.sch.ng' },
];

const EMAIL_THRESHOLD = 30;

function ComposeInner() {
  const { profile, staffRoles } = useAuth();
  const allowed = profile?.role === 'admin' || ['smt', 'pastoral', 'school_office'].some((r) => staffRoles.includes(r));

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [targetType, setTargetType] = useState('all_parents');
  const [targetValue, setTargetValue] = useState('');
  const [previewCount, setPreviewCount] = useState(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  const targetDef = TARGET_TYPES.find((t) => t.value === targetType);

  async function handlePreview() {
    setPreviewCount('checking...');
    const { data, error } = await supabase.rpc('resolve_message_recipients', {
      p_target_type: targetType,
      p_target_value: targetDef.needsValue ? targetValue : null,
    });
    if (error) { setPreviewCount(`error: ${error.message}`); return; }
    setPreviewCount(data?.length ?? 0);
  }

  async function handleSend() {
    if (!subject.trim() || !body.trim()) { setResult('Enter a subject and message first.'); return; }
    setSending(true);
    setResult(null);
    const { data, error } = await supabase.rpc('send_message', {
      p_subject: subject,
      p_body: body,
      p_target_type: targetType,
      p_target_value: targetDef.needsValue ? targetValue : null,
    });
    setSending(false);
    if (error) { setResult(`Failed: ${error.message}`); return; }
    setResult(`Sent to message id ${data}.`);
    setSubject('');
    setBody('');
    setPreviewCount(null);
  }

  if (!allowed) return <p>Only SMT, Pastoral, or School Office can send messages.</p>;

  return (
    <div>
      <h1>Compose message</h1>
      <div className="card">
        <label>Send to</label>
        <select value={targetType} onChange={(e) => { setTargetType(e.target.value); setTargetValue(''); setPreviewCount(null); }}>
          {TARGET_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>

        {targetDef.needsValue && (
          <input
            style={{ display: 'block', width: '100%', marginTop: '0.5rem' }}
            value={targetValue}
            onChange={(e) => { setTargetValue(e.target.value); setPreviewCount(null); }}
            placeholder={targetDef.placeholder}
          />
        )}

        <button onClick={handlePreview} style={{ marginTop: '0.5rem' }}>Check recipient count</button>
        {previewCount !== null && (
          <p>
            {previewCount} recipient(s).{' '}
            {typeof previewCount === 'number' && (
              previewCount > EMAIL_THRESHOLD
                ? `Over ${EMAIL_THRESHOLD} — will be in-app inbox only, no email fanout.`
                : `${EMAIL_THRESHOLD} or under — will also email each recipient.`
            )}
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
