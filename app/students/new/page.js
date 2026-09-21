'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';

function NewStudentInner() {
  const router = useRouter();
  const [upn, setUpn] = useState('');
  const [form, setForm] = useState({
    first_name: '', last_name: '', middle_name: '', gender: '', year_group: '', form_class: '', dob: '',
  });
  const [status, setStatus] = useState(null);
  const [mentorGroups, setMentorGroups] = useState([]);

  useEffect(() => {
    async function loadUpn() {
      const { data, error } = await supabase.rpc('generate_next_upn');
      if (!error) setUpn(data);
    }
    loadUpn();
    async function loadMentorGroups() {
      const { data } = await supabase.from('mentor_groups').select('group_name').order('group_name');
      setMentorGroups((data || []).map((r) => r.group_name));
    }
    loadMentorGroups();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.first_name || !form.last_name) {
      setStatus('First and last name are required.');
      return;
    }
    if (!form.dob) {
      setStatus('Date of birth is required.');
      return;
    }
    setStatus('Creating...');
    const { data, error } = await supabase
      .from('students')
      .insert({
        upn,
        first_name: form.first_name,
        last_name: form.last_name,
        middle_name: form.middle_name || null,
        gender: form.gender || null,
        year_group: form.year_group ? Number(form.year_group) : null,
        form_class: form.form_class || null,
        dob: form.dob,
        status: 'active',
      })
      .select('student_id')
      .single();

    if (error) {
      setStatus(`Error: ${error.message}`);
    } else {
      router.push(`/students/${data.student_id}`);
    }
  }

  return (
    <div>
      <h1>New Student</h1>
      <p>UPN is generated automatically. Fill in the basics now — everything else (parents, timetable, houses, etc.) can be added from the student's own page afterwards.</p>

      <form onSubmit={handleSubmit} className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <label>
          UPN (auto-generated)
          <input value={upn} readOnly style={{ background: 'var(--slate-100)' }} />
        </label>
        <label>
          First name
          <input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} required />
        </label>
        <label>
          Last name
          <input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} required />
        </label>
        <label>
          Middle name
          <input value={form.middle_name} onChange={(e) => setForm({ ...form, middle_name: e.target.value })} />
        </label>
        <label>
          Gender
          <input value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })} />
        </label>
        <label>
          Date of birth
          <input type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} required />
        </label>
        <label>
          Year group
          <input type="number" value={form.year_group} onChange={(e) => setForm({ ...form, year_group: e.target.value })} placeholder="e.g. 9" />
        </label>
        <label>
          Form class / mentor group
          <select value={form.form_class} onChange={(e) => setForm({ ...form, form_class: e.target.value })}>
            <option value="">—</option>
            {mentorGroups.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>

        <button type="submit" style={{ width: 'fit-content' }}>Create student</button>
      </form>

      {status && <p>{status}</p>}
    </div>
  );
}

export default function NewStudentPage() {
  return <RequireAuth><NewStudentInner /></RequireAuth>;
}
