'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { formatUKDate } from '../../../lib/formatDate';
import { schoolToday, schoolDateOffset, SCHOOL_TIMEZONE } from '../../../lib/schoolTime';

// Changes to registers, fees, behaviour, access, parent links and email
// reply settings, from change_history (migrations 218, 226). The database writes it and nobody can
// edit it; RLS limits reading to SMT and admins whatever this page shows.
// Grades have their own page, /assessments/grade-history.
//
// "Changed by" is whoever was signed in when the change was made, never a
// name stored on the record itself.

const LIMIT = 500;
const AREAS = {
  registers: 'Registers',
  fees: 'Fees',
  behaviour: 'Behaviour',
  access: 'Roles & logins',
  parent_links: 'Parent links',
  email: 'Email replies',
  admissions: 'Admissions',
  groups: 'Student groups',
  students: 'Student records',
};
const ACTIONS = { INSERT: 'Added', UPDATE: 'Changed', DELETE: 'Removed' };
const HIDDEN_FIELDS = new Set(['updated_at', 'updated_by', 'created_at', 'is_demo']);

function whenLabel(ts) {
  return new Date(ts).toLocaleString('en-GB', {
    timeZone: SCHOOL_TIMEZONE, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function schoolMidnight(isoDate) {
  return `${isoDate}T00:00:00+01:00`;
}

function nextDay(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function show(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  return String(v);
}

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function ChangeHistoryInner() {
  const [from, setFrom] = useState(schoolDateOffset(-30));
  const [to, setTo] = useState(schoolToday());
  const [area, setArea] = useState('');
  const [action, setAction] = useState('');
  const [staffFilter, setStaffFilter] = useState('');
  const [studentQuery, setStudentQuery] = useState('');
  const [rows, setRows] = useState([]);
  const [staff, setStaff] = useState([]);
  const [feeItems, setFeeItems] = useState({});
  const [discountTypes, setDiscountTypes] = useState({});
  const [students, setStudents] = useState({});
  const [parents, setParents] = useState({});
  const [loginNames, setLoginNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    supabase.from('staff').select('staff_id, first_name, last_name, staff_code').order('last_name')
      .then(({ data }) => setStaff(data || []));
    supabase.from('fee_items').select('id, name, display_name')
      .then(({ data }) => setFeeItems(Object.fromEntries((data || []).map((f) => [f.id, f.display_name || f.name]))));
    supabase.from('fee_discount_types').select('id, name')
      .then(({ data }) => setDiscountTypes(Object.fromEntries((data || []).map((d) => [d.id, d.name]))));
  }, []);

  const staffById = useMemo(() => Object.fromEntries(staff.map((s) => [s.staff_id, s])), [staff]);

  async function load() {
    setLoading(true);
    setError(null);

    let studentIds = null;
    const words = studentQuery.replace(/[,()*%]/g, ' ').split(/\s+/).filter(Boolean);
    if (words.length) {
      let sq = supabase.from('students').select('student_id');
      words.forEach((w) => { sq = sq.or(`first_name.ilike.%${w}%,last_name.ilike.%${w}%`); });
      const { data: found } = await sq.limit(200);
      studentIds = (found || []).map((s) => s.student_id);
      if (studentIds.length === 0) { setRows([]); setLoading(false); return; }
    }

    let query = supabase.from('change_history').select('*')
      .gte('changed_at', schoolMidnight(from))
      .lt('changed_at', schoolMidnight(nextDay(to)))
      .order('changed_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(LIMIT);
    if (area) query = query.eq('area', area);
    if (action) query = query.eq('action', action);
    if (staffFilter === 'none') query = query.is('changed_by_staff_id', null);
    else if (staffFilter) query = query.eq('changed_by_staff_id', Number(staffFilter));
    if (studentIds) query = query.in('student_id', studentIds);

    const { data, error: e } = await query;
    if (e) { setError(e.message); setRows([]); setLoading(false); return; }
    const list = data || [];

    // Names for the students and parents these rows mention.
    const rowOf = (h) => h.new_row || h.old_row || {};
    const needStudents = [...new Set(list.map((h) => h.student_id).filter((id) => id && !students[id]))];
    const needParents = [...new Set(list.map((h) => rowOf(h).parent_id).filter((id) => id && !parents[id]))];
    if (needStudents.length) {
      const { data: st } = await supabase.from('students').select('student_id, first_name, last_name, form_class').in('student_id', needStudents);
      setStudents((prev) => ({ ...prev, ...Object.fromEntries((st || []).map((s) => [s.student_id, s])) }));
    }
    if (needParents.length) {
      const { data: pa } = await supabase.from('parents').select('parent_id, first_name, last_name').in('parent_id', needParents);
      setParents((prev) => ({ ...prev, ...Object.fromEntries((pa || []).map((p) => [p.parent_id, p])) }));
    }
    // Entries from before migration 219 have no stored name for a parent or
    // student who made a change; look their login up (admins only, by RLS).
    const needLogins = [...new Set([
      ...list.filter((h) => h.changed_by && !h.changed_by_staff_id && !h.changed_by_name).map((h) => h.changed_by),
      // ...and whose login an older "login" row is about.
      ...list.filter((h) => h.table_name === 'profiles' && !h.record_key?.name).map((h) => rowOf(h).id),
    ].filter((id) => id && !loginNames[id]))];
    if (needLogins.length) {
      const { data: pr } = await supabase.from('profiles').select('id, staff_id, parent_id, student_id').in('id', needLogins);
      const pIds = (pr || []).map((p) => p.parent_id).filter(Boolean);
      const sIds = (pr || []).map((p) => p.student_id).filter(Boolean);
      const [{ data: pa }, { data: st }] = await Promise.all([
        pIds.length ? supabase.from('parents').select('parent_id, first_name, last_name').in('parent_id', pIds) : { data: [] },
        sIds.length ? supabase.from('students').select('student_id, first_name, last_name').in('student_id', sIds) : { data: [] },
      ]);
      const pn = Object.fromEntries((pa || []).map((p) => [p.parent_id, `${p.first_name || ''} ${p.last_name || ''}`.trim()]));
      const sn = Object.fromEntries((st || []).map((s) => [s.student_id, `${s.first_name} ${s.last_name}`]));
      const found = Object.fromEntries((pr || [])
        .map((p) => [p.id, pn[p.parent_id] || sn[p.student_id] || (p.staff_id && staffById[p.staff_id]
          ? `${staffById[p.staff_id].first_name} ${staffById[p.staff_id].last_name}` : null)])
        .filter(([, n]) => n));
      setLoginNames((prev) => ({ ...prev, ...found }));
    }
    setRows(list);
    setLoading(false);
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function staffName(id) {
    const s = staffById[id];
    return s ? `${s.first_name} ${s.last_name}${s.staff_code ? ` (${s.staff_code})` : ''}` : `staff #${id}`;
  }

  function studentName(id) {
    const s = students[id];
    return s ? `${s.first_name} ${s.last_name}` : id ? `Student #${id}` : '';
  }

  function parentName(id) {
    const p = parents[id];
    return p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() : `Parent #${id}`;
  }

  // Staff by their staff record; anyone else by the name the database stored
  // with the entry (migration 219), or, for entries from before that, by
  // looking up their login (only admins can read other people's logins, so
  // SMT see the role). A change made through the database connection has no
  // sign-in, and carries the note it was made with ("Principal (direct)").
  function changedBy(h) {
    if (h.changed_by_staff_id) return staffName(h.changed_by_staff_id);
    const name = h.changed_by_name || loginNames[h.changed_by];
    if (name) return `${name} (${h.changed_by_role || 'account'})`;
    if (h.changed_by_role) return h.changed_by_role === 'admin' ? 'Admin account' : `${h.changed_by_role} account`;
    if (h.note) return h.note;
    return 'Directly in the database (no one signed in)';
  }

  // One line saying what the record is.
  function describe(h) {
    const r = h.new_row || h.old_row || {};
    switch (h.table_name) {
      case 'attendance':
        return `Register mark, ${formatUKDate(r.attend_date)}, period ${r.period_number}`;
      case 'behaviour_events':
        return `Behaviour: ${r.type || ''} ${r.category ? `— ${r.category}` : ''} (${show(r.points)} pts), ${formatUKDate(r.event_date)}`;
      case 'invoice_line_items':
        return `Fee charge: ${r.description || feeItems[r.fee_item_id] || 'charge'}, ${show(r.amount)}`;
      case 'fee_payments':
        return `Payment of ${show(r.amount)} (${show(r.method)}), ${formatUKDate(r.paid_date)}`;
      case 'student_invoices':
        return `Invoice #${r.id}`;
      case 'student_discounts':
        return `Student discount: ${discountTypes[r.discount_type_id] || `type #${r.discount_type_id}`}`;
      case 'fee_discount_types':
        return `Discount type: ${r.name} (${show(r.value)} ${r.calc_type || ''})`;
      case 'fee_items':
        return `Fee item: ${r.display_name || r.name}, default ${show(r.default_amount)}`;
      case 'staff_roles':
        return `Role "${r.role_name}" for ${staffName(r.staff_id)}`;
      case 'role_permissions':
        return `Permission: ${r.role_name} can open ${r.resource_key}`;
      case 'profiles': {
        // Name and sign-in email stored with the entry since migration 219.
        const k = h.record_key || {};
        const who = [k.name || loginNames[r.id], k.email || r.email].filter(Boolean).join(', ');
        return `Login${who ? ` of ${who}` : ''} (${r.role || ''})`;
      }
      case 'student_parent':
        return `Parent link: ${parentName(r.parent_id)}`;
      case 'email_reply_routes':
        return `Where replies go: ${r.label}`;
      default:
        return h.table_name;
    }
  }

  // Field-by-field for a change; nothing extra for an add or remove.
  function fieldChanges(h) {
    if (h.action !== 'UPDATE') return [];
    return (h.changed_fields || [])
      .filter((f) => !HIDDEN_FIELDS.has(f))
      .map((f) => {
        const a = h.old_row?.[f];
        const b = h.new_row?.[f];
        const name = f.replace(/_/g, ' ');
        if (f === 'staff_id') return `${name}: ${a ? staffName(a) : '—'} → ${b ? staffName(b) : '—'}`;
        if (f === 'parent_id') return `parent: ${a ? parentName(a) : '—'} → ${b ? parentName(b) : '—'}`;
        if (f === 'discount_type_id') return `discount: ${discountTypes[a] || show(a)} → ${discountTypes[b] || show(b)}`;
        if (f === 'fee_item_id') return `fee item: ${feeItems[a] || show(a)} → ${feeItems[b] || show(b)}`;
        return `${name}: ${show(a)} → ${show(b)}`;
      });
  }

  function downloadCsv() {
    const header = ['When', 'Area', 'Action', 'Student', 'Record', 'Changes', 'Changed by'];
    const lines = rows.map((h) => [
      whenLabel(h.changed_at), AREAS[h.area], ACTIONS[h.action], studentName(h.student_id),
      describe(h), fieldChanges(h).join('; '), changedBy(h),
    ].map(csvCell).join(','));
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `change-history-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div>
      <h1>Change History</h1>
      <p>
        Changes to registers, fees, behaviour, roles and logins, and parent links, newest first.
        The database records this itself and nobody can edit or remove it. &quot;Changed by&quot; is
        whoever was signed in when the change was made. Taking a register and logging behaviour
        aren&apos;t listed; changing or removing them afterwards is. Grades are on{' '}
        <a href="/assessments/grade-history">Grade History</a>.
      </p>

      <div className="card" style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label>
          Area
          <select value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">All areas</option>
            {Object.entries(AREAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>
          Student
          <input type="text" value={studentQuery} onChange={(e) => setStudentQuery(e.target.value)} placeholder="Name" />
        </label>
        <label>
          Changed by
          <select value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)}>
            <option value="">Anyone</option>
            <option value="none">No staff record (database or admin account)</option>
            {staff.map((s) => <option key={s.staff_id} value={s.staff_id}>{s.first_name} {s.last_name}</option>)}
          </select>
        </label>
        <label>
          What
          <select value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">Added, changed or removed</option>
            {Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <button onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Show'}</button>
        <button onClick={downloadCsv} disabled={loading || rows.length === 0}>Download CSV</button>
      </div>

      {error && <p style={{ color: '#a3232c' }}>Error: {error}</p>}

      <div className="card">
        {loading ? <p>Loading…</p> : rows.length === 0 ? (
          <p>No changes match these filters.</p>
        ) : (
          <>
            {rows.length === LIMIT && (
              <p style={{ color: '#5b6472', fontSize: '0.9rem' }}>
                Showing the latest {LIMIT}. Narrow the dates or filters to see older changes.
              </p>
            )}
            <div className="table-scroll"><table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Area</th>
                  <th>Student</th>
                  <th>What</th>
                  <th>Changed by</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((h) => (
                  <tr key={h.id} style={h.action === 'DELETE' ? { background: '#fdf1f1' } : undefined}>
                    <td style={{ whiteSpace: 'nowrap' }}>{whenLabel(h.changed_at)}</td>
                    <td>{AREAS[h.area]}</td>
                    <td>
                      {studentName(h.student_id) || '—'}
                      {students[h.student_id]?.form_class && (
                        <span style={{ color: '#5b6472', fontSize: '0.85rem' }}> · {students[h.student_id].form_class}</span>
                      )}
                    </td>
                    <td>
                      <strong>{ACTIONS[h.action]}</strong> {describe(h)}
                      {fieldChanges(h).map((c) => (
                        <div key={c} style={{ fontSize: '0.85rem', color: '#5b6472' }}>{c}</div>
                      ))}
                    </td>
                    <td>{changedBy(h)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </>
        )}
      </div>
    </div>
  );
}

export default function ChangeHistoryPage() {
  return (
    <RequireAuth>
      <RequireResource resourceKey="/admin/change-history">
        <ChangeHistoryInner />
      </RequireResource>
    </RequireAuth>
  );
}
