'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import { useAuth } from '../../../lib/AuthContext';

const ALL_YEAR_GROUPS = [7, 8, 9, 10, 11, 12];

function YearGroupPicker({ selected, onToggle }) {
  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
      {ALL_YEAR_GROUPS.map((yg) => {
        const isOn = selected.includes(yg);
        return (
          <button
            key={yg}
            type="button"
            onClick={() => onToggle(yg)}
            className={isOn ? '' : 'secondary'}
            style={{ padding: '0.35rem 0.75rem', fontSize: '0.85rem', minWidth: 56 }}
          >
            Year {yg}
          </button>
        );
      })}
    </div>
  );
}

function ManagePeriodsInner() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [periods, setPeriods] = useState([]);
  const [terms, setTerms] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [checkersByPeriod, setCheckersByPeriod] = useState({}); // period_id -> [staff rows]
  const [status, setStatus] = useState(null);
  const [expanded, setExpanded] = useState(null); // period_id currently showing checker editor

  // New period form
  const [name, setName] = useState('');
  const [termId, setTermId] = useState('');
  const [selectedYears, setSelectedYears] = useState([]);
  const [commentsDue, setCommentsDue] = useState('');
  const [checkDue, setCheckDue] = useState('');

  // Checker add form (per expanded period)
  const [checkerStaffId, setCheckerStaffId] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    const { data: periodRows } = await supabase
      .from('report_periods')
      .select('*')
      .order('created_at', { ascending: false });
    setPeriods(periodRows || []);

    const { data: termRows } = await supabase.from('terms').select('*').order('start_date');
    setTerms(termRows || []);

    const { data: staffRows } = await supabase
      .from('staff')
      .select('staff_id, first_name, last_name')
      .order('last_name');
    setStaffList(staffRows || []);

    if (periodRows && periodRows.length) {
      const { data: checkerRows } = await supabase
        .from('report_checkers')
        .select('id, report_period_id, staff_id, scope_type, scope_value');
      const map = {};
      (checkerRows || []).forEach((c) => {
        if (!map[c.report_period_id]) map[c.report_period_id] = [];
        map[c.report_period_id].push(c);
      });
      setCheckersByPeriod(map);
    }
  }

  function toggleYear(yg) {
    setSelectedYears((prev) => (prev.includes(yg) ? prev.filter((y) => y !== yg) : [...prev, yg].sort((a, b) => a - b)));
  }

  async function createPeriod() {
    if (!name.trim()) { setStatus('Give the period a name.'); return; }
    if (!selectedYears.length) { setStatus('Select at least one year group.'); return; }

    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('report_periods').insert([{
      term_id: termId || null,
      name: name.trim(),
      year_groups: selectedYears,
      comments_due_date: commentsDue || null,
      check_due_date: checkDue || null,
      created_by: user?.id || null,
    }]);
    if (error) { setStatus(`Error: ${error.message}`); return; }

    setName(''); setTermId(''); setSelectedYears([]); setCommentsDue(''); setCheckDue('');
    setStatus('Report period created.');
    load();
  }

  async function togglePublish(period) {
    const { error } = await supabase
      .from('report_periods')
      .update({ is_published: !period.is_published })
      .eq('report_period_id', period.report_period_id);
    if (error) { setStatus(`Error: ${error.message}`); return; }
    load();
  }

  async function addChecker(periodId) {
    if (!checkerStaffId) return;
    const { error } = await supabase.from('report_checkers').insert([{
      report_period_id: periodId,
      staff_id: Number(checkerStaffId),
      scope_type: 'all',
      scope_value: null,
    }]);
    if (error) { setStatus(`Error adding checker: ${error.message}`); return; }
    setCheckerStaffId('');
    load();
  }

  async function removeChecker(checkerId) {
    await supabase.from('report_checkers').delete().eq('id', checkerId);
    load();
  }

  if (!isAdmin) {
    return <p>Only admins can manage report periods.</p>;
  }

  return (
    <div>
      <h1>Manage Report Periods</h1>
      {status && <p><strong>{status}</strong></p>}

      <div className="dash-section" style={{ marginBottom: '1.5rem' }}>
        <div className="dash-section-title">New Report Period</div>
        <form onSubmit={(e) => { e.preventDefault(); createPeriod(); }}>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. End of Term 1 Report" />
          </label>

          <label>
            Term
            <select value={termId} onChange={(e) => setTermId(e.target.value)}>
              <option value="">— None / not tied to a term —</option>
              {terms.map((t) => (
                <option key={t.term_id} value={t.term_id}>{t.term_name}</option>
              ))}
            </select>
          </label>

          <label>
            Comments due (end of week 1)
            <input type="date" value={commentsDue} onChange={(e) => setCommentsDue(e.target.value)} />
          </label>

          <label>
            Checking due (end of week 2)
            <input type="date" value={checkDue} onChange={(e) => setCheckDue(e.target.value)} />
          </label>

          <div style={{ flex: '1 1 100%' }}>
            <div style={{ fontSize: '0.85rem', color: 'var(--red-800)', marginBottom: '0.35rem' }}>Year groups covered</div>
            <YearGroupPicker selected={selectedYears} onToggle={toggleYear} />
          </div>

          <button type="submit" style={{ flex: '1 1 100%' }}>Create Report Period</button>
        </form>
      </div>

      <div className="dash-section">
        <div className="dash-section-title">Existing Report Periods</div>
        {periods.length === 0 && <p>No report periods yet.</p>}
        {periods.map((p) => {
          const checkers = checkersByPeriod[p.report_period_id] || [];
          const isExpanded = expanded === p.report_period_id;
          return (
            <div key={p.report_period_id} style={{ border: '1px solid #ddd', borderRadius: 8, padding: '0.75rem', marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                  <strong>{p.name}</strong>{' '}
                  <span style={{ color: '#666' }}>— Years {(p.year_groups || []).join(', ')}</span>
                  {p.is_published && <span style={{ marginLeft: '0.5rem', color: 'green' }}>Published</span>}
                  <div style={{ fontSize: '0.85rem', color: '#666' }}>
                    Comments due: {p.comments_due_date || '—'} &nbsp;|&nbsp; Checking due: {p.check_due_date || '—'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button onClick={() => setExpanded(isExpanded ? null : p.report_period_id)}>
                    {isExpanded ? 'Hide checkers' : `Checkers (${checkers.length})`}
                  </button>
                  <button onClick={() => togglePublish(p)}>
                    {p.is_published ? 'Unpublish' : 'Publish'}
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div style={{ marginTop: '0.75rem', borderTop: '1px solid #eee', paddingTop: '0.75rem' }}>
                  <div style={{ marginBottom: '0.5rem' }}>
                    {checkers.length === 0 && <p style={{ color: '#666' }}>No checkers assigned yet.</p>}
                    {checkers.map((c) => {
                      const s = staffList.find((st) => st.staff_id === c.staff_id);
                      return (
                        <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.25rem 0' }}>
                          <span>{s ? `${s.first_name} ${s.last_name}` : `Staff #${c.staff_id}`}</span>
                          <button onClick={() => removeChecker(c.id)}>Remove</button>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <select value={checkerStaffId} onChange={(e) => setCheckerStaffId(e.target.value)} style={{ width: 'auto', flex: '1 1 auto' }}>
                      <option value="">— Select staff —</option>
                      {staffList.map((s) => (
                        <option key={s.staff_id} value={s.staff_id}>{s.first_name} {s.last_name}</option>
                      ))}
                    </select>
                    <button onClick={() => addChecker(p.report_period_id)}>Add Checker</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ManagePeriodsPage() {
  return (
    <RequireAuth>
      <ManagePeriodsInner />
    </RequireAuth>
  );
}
