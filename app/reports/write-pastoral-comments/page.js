'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import { useAuth } from '../../../lib/AuthContext';
import { formatUKDate } from '../../../lib/formatDate';

const STATUS_LABEL = {
  draft: 'Draft',
  submitted: 'Submitted — awaiting check',
  checked: 'Checked',
};

const TYPE_LABEL = {
  mentor: 'Mentor',
  houseparent: 'Houseparent',
  smt: 'SMT',
};

function WritePastoralCommentsInner() {
  const { profile, staffRoles } = useAuth();
  const staffId = profile?.staff_id;
  const isAdmin = profile?.role === 'admin';

  const [availableTypes, setAvailableTypes] = useState([]); // ['mentor','houseparent','smt']
  const [houseScope, setHouseScope] = useState(null);
  const [commentType, setCommentType] = useState('');

  const [periods, setPeriods] = useState([]);
  const [periodId, setPeriodId] = useState('');

  const [roster, setRoster] = useState([]);
  const [rows, setRows] = useState({});
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [status, setStatus] = useState(null);

  const [yearFilter, setYearFilter] = useState(''); // SMT only — narrows a potentially large roster
  const [search, setSearch] = useState('');

  const selectedPeriod = periods.find((p) => String(p.report_period_id) === String(periodId));

  useEffect(() => {
    if (!staffId) return;
    supabase.from('report_periods').select('*').order('comments_due_date', { ascending: true })
      .then(({ data }) => setPeriods(data || []));

    async function resolveScopes() {
      const types = [];
      const { count: mentorCount } = await supabase
        .from('students').select('student_id', { count: 'exact', head: true }).eq('mentor_staff_id', staffId);
      if (mentorCount) types.push('mentor');

      const { data: scope } = await supabase.rpc('my_house_scope');
      if (scope) { types.push('houseparent'); setHouseScope(scope); }

      if (isAdmin || (staffRoles || []).includes('smt')) types.push('smt');

      setAvailableTypes(types);
      if (types.length === 1) setCommentType(types[0]);
    }
    resolveScopes();
  }, [staffId, isAdmin, staffRoles]);

  const loadRosterAndExisting = useCallback(async () => {
    if (!periodId || !commentType || !selectedPeriod) {
      setRoster([]);
      setRows({});
      return;
    }
    setLoadingRoster(true);
    setStatus(null);

    const yearGroups = selectedPeriod.year_groups || [];
    let query = supabase
      .from('students')
      .select('student_id, first_name, last_name, year_group, form_class, boarding_house, mentor_staff_id')
      .in('year_group', yearGroups.length ? yearGroups : [-1])
      .eq('status', 'active')
      .order('last_name');

    if (commentType === 'mentor') query = query.eq('mentor_staff_id', staffId);
    if (commentType === 'houseparent') query = query.eq('boarding_house', houseScope);
    if (commentType === 'smt') {
      if (yearFilter) query = query.eq('year_group', Number(yearFilter));
      if (search.trim()) query = query.or(`first_name.ilike.%${search.trim()}%,last_name.ilike.%${search.trim()}%`);
    }

    const { data: studentList } = await query;
    setRoster(studentList || []);

    const ids = (studentList || []).map((s) => s.student_id);
    const nextRows = {};
    if (ids.length > 0) {
      const { data: existing } = await supabase
        .from('report_pastoral_comments')
        .select('id, student_id, comment, status, checker_note')
        .eq('report_period_id', periodId)
        .eq('comment_type', commentType)
        .in('student_id', ids);
      for (const r of existing || []) {
        nextRows[r.student_id] = { id: r.id, comment: r.comment || '', status: r.status, checker_note: r.checker_note || '' };
      }
    }
    for (const s of studentList || []) {
      if (!nextRows[s.student_id]) nextRows[s.student_id] = { id: null, comment: '', status: 'draft', checker_note: '' };
    }
    setRows(nextRows);
    setLoadingRoster(false);
  }, [periodId, commentType, selectedPeriod, staffId, houseScope, yearFilter, search]);

  useEffect(() => { loadRosterAndExisting(); }, [loadRosterAndExisting]);

  function isLocked(row) { return row.status !== 'draft'; }

  function updateComment(studentId, value) {
    setRows((prev) => ({ ...prev, [studentId]: { ...prev[studentId], comment: value } }));
  }

  async function saveRow(studentId, newStatus) {
    const row = rows[studentId];
    if (!row) return;
    const payload = {
      report_period_id: Number(periodId),
      student_id: studentId,
      staff_id: staffId,
      comment_type: commentType,
      comment: row.comment || null,
      status: newStatus,
    };
    const { data, error } = await supabase
      .from('report_pastoral_comments')
      .upsert([payload], { onConflict: 'report_period_id,student_id,comment_type' })
      .select()
      .single();

    if (error) { setStatus(`Error saving: ${error.message}`); return; }
    setRows((prev) => ({ ...prev, [studentId]: { ...prev[studentId], id: data.id, status: data.status } }));
  }

  async function submitAllDrafts() {
    const toSubmit = roster.filter((s) => {
      const r = rows[s.student_id];
      return r && r.status === 'draft' && r.comment && r.comment.trim();
    });
    if (toSubmit.length === 0) { setStatus('Nothing to submit — write a comment for at least one student first.'); return; }
    setStatus('Submitting...');
    for (const s of toSubmit) await saveRow(s.student_id, 'submitted');
    setStatus(`Submitted ${toSubmit.length} comment(s) for checking.`);
  }

  if (availableTypes.length === 0) {
    return (
      <div>
        <h1>Write Pastoral Comments</h1>
        <p style={{ color: '#666' }}>You aren't currently scoped as a Mentor, Houseparent, or SMT — there's nothing to write here.</p>
      </div>
    );
  }

  return (
    <div>
      <h1>Write Pastoral Comments</h1>
      <p>Pick a report period and, if you hold more than one pastoral role, which comment you're writing.</p>

      <form onSubmit={(e) => e.preventDefault()}>
        <label>
          Report Period
          <select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
            <option value="">Select a report period...</option>
            {periods.map((p) => (
              <option key={p.report_period_id} value={p.report_period_id}>
                {p.name}{p.comments_due_date ? ` — due ${formatUKDate(p.comments_due_date)}` : ''}
              </option>
            ))}
          </select>
        </label>

        {availableTypes.length > 1 && (
          <label>
            Writing as
            <select value={commentType} onChange={(e) => setCommentType(e.target.value)}>
              <option value="">Select...</option>
              {availableTypes.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
          </label>
        )}

        {commentType === 'smt' && (
          <>
            <label>
              Year group
              <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
                <option value="">All</option>
                {(selectedPeriod?.year_groups || []).map((y) => <option key={y} value={y}>Year {y}</option>)}
              </select>
            </label>
            <label>
              Search
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Student name..." />
            </label>
          </>
        )}
      </form>

      {loadingRoster && <p>Loading roster...</p>}

      {!loadingRoster && commentType && roster.length > 0 && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {roster.map((s) => {
              const row = rows[s.student_id] || {};
              const locked = isLocked(row);
              return (
                <div key={s.student_id} className="card" style={{ marginBottom: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <strong>{s.first_name} {s.last_name}</strong>
                    <span style={{ fontSize: '0.8rem', color: '#666' }}>Year {s.year_group}{s.form_class ? ` / ${s.form_class}` : ''}</span>
                    <span style={{ fontSize: '0.8rem', color: locked ? '#1a7a3d' : '#666' }}>
                      {STATUS_LABEL[row.status] || 'Draft'}
                    </span>
                  </div>

                  {row.checker_note && (
                    <p style={{ background: '#fff7e0', border: '1px solid #eecb7a', borderRadius: 6, padding: '0.5rem', fontSize: '0.85rem', margin: '0.5rem 0' }}>
                      <strong>Checker note:</strong> {row.checker_note}
                    </p>
                  )}

                  <label style={{ display: 'block', marginTop: '0.5rem' }}>
                    Comment
                    <textarea
                      value={row.comment || ''}
                      onChange={(e) => updateComment(s.student_id, e.target.value)}
                      disabled={locked}
                      rows={3}
                      style={{ width: '100%', resize: 'vertical' }}
                    />
                  </label>

                  {!locked && (
                    <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
                      <button type="button" className="secondary" onClick={() => saveRow(s.student_id, 'draft')}>Save Draft</button>
                      <button type="button" onClick={() => saveRow(s.student_id, 'submitted')}>Submit</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button type="button" onClick={submitAllDrafts} style={{ marginTop: '1rem' }}>
            Submit All Drafts
          </button>
          {status && <p>{status}</p>}
        </>
      )}

      {!loadingRoster && commentType && periodId && roster.length === 0 && (
        <p style={{ color: '#666' }}>No students in your scope for this report period.</p>
      )}
    </div>
  );
}

export default function WritePastoralCommentsPage() {
  return <RequireAuth><WritePastoralCommentsInner /></RequireAuth>;
}
