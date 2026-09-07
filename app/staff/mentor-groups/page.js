'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';

function MentorGroupsInner() {
  const [groups, setGroups] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [assignments, setAssignments] = useState({}); // group_name -> [{staff_id, first_name, last_name}]
  const [picking, setPicking] = useState({}); // group_name -> staff_id selected in the dropdown
  const [status, setStatus] = useState(null);

  async function load() {
    const { data: g } = await supabase.from('mentor_groups').select('*').order('group_name');
    setGroups(g || []);

    const { data: st } = await supabase.from('staff').select('staff_id, first_name, last_name').order('last_name');
    setStaffList(st || []);
    const staffMap = Object.fromEntries((st || []).map((s) => [s.staff_id, s]));

    const { data: roles } = await supabase
      .from('staff_roles')
      .select('staff_id, scope_value')
      .eq('role_name', 'mentor')
      .eq('scope_type', 'mentor_group');

    const map = {};
    (roles || []).forEach((r) => {
      if (!map[r.scope_value]) map[r.scope_value] = [];
      if (staffMap[r.staff_id]) map[r.scope_value].push(staffMap[r.staff_id]);
    });
    setAssignments(map);
  }

  useEffect(() => { load(); }, []);

  async function addMentor(groupName) {
    const staffId = picking[groupName];
    if (!staffId) { setStatus('Choose a staff member first.'); return; }
    const already = (assignments[groupName] || []).some((s) => s.staff_id === Number(staffId));
    if (already) { setStatus('That staff member is already assigned to this group.'); return; }

    const { error } = await supabase.from('staff_roles').insert({
      staff_id: Number(staffId),
      role_name: 'mentor',
      scope_type: 'mentor_group',
      scope_value: groupName,
    });
    if (error) { setStatus(`Error: ${error.message}`); return; }
    setStatus(null);
    setPicking((p) => ({ ...p, [groupName]: '' }));
    load();
  }

  async function removeMentor(groupName, staffId) {
    const { error } = await supabase
      .from('staff_roles')
      .delete()
      .eq('staff_id', staffId)
      .eq('role_name', 'mentor')
      .eq('scope_type', 'mentor_group')
      .eq('scope_value', groupName);
    if (error) { setStatus(`Error: ${error.message}`); return; }
    load();
  }

  return (
    <div>
      <h1>Mentor Groups</h1>
      <p>Assign one or two staff to each mentor group. Groups list is fixed once set up here — it does not change on Nova-T re-imports.</p>
      {status && <p>{status}</p>}

      <div className="table-scroll"><table>
        <thead>
          <tr>
            <th>Mentor group</th>
            <th>Assigned mentors</th>
            <th>Add mentor</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.mentor_group_id}>
              <td>{g.group_name}</td>
              <td>
                {(assignments[g.group_name] || []).length === 0
                  ? <span style={{ color: '#999' }}>None assigned</span>
                  : (assignments[g.group_name] || []).map((s) => (
                      <span key={s.staff_id} style={{ display: 'inline-block', marginRight: '0.5rem', marginBottom: '0.25rem' }}>
                        {s.first_name} {s.last_name}
                        <button
                          onClick={() => removeMentor(g.group_name, s.staff_id)}
                          style={{ marginLeft: '0.3rem', fontSize: '0.75rem' }}
                        >
                          Remove
                        </button>
                      </span>
                    ))}
              </td>
              <td>
                <select
                  value={picking[g.group_name] || ''}
                  onChange={(e) => setPicking((p) => ({ ...p, [g.group_name]: e.target.value }))}
                  style={{ marginRight: '0.3rem' }}
                >
                  <option value="">-- staff --</option>
                  {staffList.map((s) => (
                    <option key={s.staff_id} value={s.staff_id}>{s.first_name} {s.last_name}</option>
                  ))}
                </select>
                <button onClick={() => addMentor(g.group_name)}>Add</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

export default function MentorGroupsPage() {
  return <RequireAuth><MentorGroupsInner /></RequireAuth>;
}
