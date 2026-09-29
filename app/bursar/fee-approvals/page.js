'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { formatMoney, errorText } from '../../../lib/admissions';

// Fee prices are set and approved by the principal and the college secretary
// together (migration 259). Anyone who deals with fees proposes a change
// here (or from Fee Items / Lookups / Admission Payments); it takes effect
// only when both have approved, as two different people. The database does
// all the checking: approve_fee_price_change() looks at the caller's own
// staff roles, and the prices can't be changed any other way.

function money(v) {
  return v == null ? 'not set' : formatMoney(v);
}

function whenLabel(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('en-GB', {
    timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function describe(c) {
  if (c.kind === 'admission_fees') {
    const parts = [];
    if (c.old_values.form_fee !== c.new_values.form_fee) parts.push(`Admission form: ${money(c.old_values.form_fee)} → ${money(c.new_values.form_fee)}`);
    if (c.old_values.deposit !== c.new_values.deposit) parts.push(`Deposit: ${money(c.old_values.deposit)} → ${money(c.new_values.deposit)}`);
    return { what: `Admission fees, ${c.year_label} entry`, change: parts.join('; ') };
  }
  return { what: c.fee_item_name, change: `${money(c.old_values.amount)} → ${money(c.new_values.amount)}` };
}

const STATUS_STYLE = {
  pending: { background: '#fff1cc', color: '#7a5a00' },
  approved: { background: '#dcf5e3', color: '#1a7a3d' },
  rejected: { background: '#fbdede', color: '#a3232c' },
  cancelled: { background: '#eee', color: '#555' },
};

function FeeApprovalsInner() {
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [myRoles, setMyRoles] = useState([]);
  const [years, setYears] = useState([]);
  const [items, setItems] = useState([]);
  const [msg, setMsg] = useState(null);
  const [rejecting, setRejecting] = useState(null); // { id, note }
  const [yearForm, setYearForm] = useState({ id: '', form: '', deposit: '', reason: '' });
  const [itemForm, setItemForm] = useState({ id: '', amount: '', reason: '' });

  async function load() {
    const { data, error } = await supabase.rpc('fee_price_change_list');
    if (error) { setLoadError(errorText(error)); setRows([]); return; }
    setLoadError(null);
    setRows(data || []);
  }

  useEffect(() => {
    load();
    supabase.rpc('my_fee_approver_roles').then(({ data }) => setMyRoles(data || []));
    supabase.from('academic_years').select('academic_year_id, label, status, admission_form_fee, admission_deposit')
      .neq('status', 'closed').order('start_date').then(({ data }) => setYears(data || []));
    supabase.from('fee_items').select('id, name, display_name, default_amount').order('name')
      .then(({ data }) => setItems(data || []));
  }, []);

  const isApprover = myRoles.length > 0;

  async function act(fn, args, done) {
    setMsg(null);
    const { data, error } = await supabase.rpc(fn, args);
    if (error) { setMsg({ error: true, text: errorText(error) }); return; }
    setMsg({ text: done(data) });
    await load();
    // Prices may just have changed.
    supabase.from('academic_years').select('academic_year_id, label, status, admission_form_fee, admission_deposit')
      .neq('status', 'closed').order('start_date').then(({ data: y }) => setYears(y || []));
    supabase.from('fee_items').select('id, name, display_name, default_amount').order('name')
      .then(({ data: i }) => setItems(i || []));
  }

  function approve(c) {
    act('approve_fee_price_change', { p_id: c.id }, (r) => (r === 'applied'
      ? 'Approved by both. The new price is now in force.'
      : 'Your approval is recorded. It now needs the other approver.'));
  }

  function reject(e) {
    e.preventDefault();
    act('reject_fee_price_change', { p_id: rejecting.id, p_note: rejecting.note }, () => 'Rejected.');
    setRejecting(null);
  }

  function cancel(c) {
    if (!window.confirm('Cancel this proposal?')) return;
    act('cancel_fee_price_change', { p_id: c.id }, () => 'Cancelled.');
  }

  function amountOrNull(v) {
    return String(v).trim() === '' ? null : Number(v);
  }

  function proposeYear(e) {
    e.preventDefault();
    act('propose_admission_fees', {
      p_academic_year_id: Number(yearForm.id), p_form_fee: amountOrNull(yearForm.form),
      p_deposit: amountOrNull(yearForm.deposit), p_reason: yearForm.reason,
    }, () => 'Sent for approval.');
    setYearForm({ id: '', form: '', deposit: '', reason: '' });
  }

  function proposeItem(e) {
    e.preventDefault();
    act('propose_fee_item_price', {
      p_fee_item_id: Number(itemForm.id), p_amount: amountOrNull(itemForm.amount), p_reason: itemForm.reason,
    }, () => 'Sent for approval.');
    setItemForm({ id: '', amount: '', reason: '' });
  }

  const pending = (rows || []).filter((c) => c.status === 'pending');
  const closed = (rows || []).filter((c) => c.status !== 'pending');

  function approvalCell(at, name) {
    return at
      ? <span style={{ color: '#1a7a3d' }}>✓ {name}<br /><small>{whenLabel(at)}</small></span>
      : <span style={{ color: '#7a5a00' }}>Waiting</span>;
  }

  return (
    <div>
      <h1>Fee Approvals</h1>
      <p>
        Fees — admission forms, deposits and term fees — are <strong>set and approved by the principal and the
        college secretary together</strong>. A new price is proposed here and takes effect only once both have
        approved it. Nobody can change a price any other way.
      </p>
      {isApprover && (
        <p style={{ color: '#1d4a8f' }}>
          You approve as {myRoles.map((r) => (r === 'principal' ? 'the principal' : 'the college secretary')).join(' and ')}.
        </p>
      )}
      {msg && <p style={{ color: msg.error ? '#a3232c' : '#1a7a3d', fontWeight: 600 }}>{msg.text}</p>}
      {loadError && <p style={{ color: '#a3232c' }}>Could not load: {loadError}</p>}

      <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <h2 style={{ marginTop: 0 }}>Waiting for approval</h2>
        {rows === null ? <p>Loading...</p> : pending.length === 0 ? <p>Nothing waiting.</p> : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>What</th><th>Change</th><th>Reason</th><th>Proposed</th><th>Principal</th><th>College secretary</th><th></th></tr></thead>
              <tbody>
                {pending.map((c) => {
                  const d = describe(c);
                  return (
                    <tr key={c.id}>
                      <td>{d.what}</td>
                      <td>{d.change}</td>
                      <td>{c.reason || '—'}</td>
                      <td>{c.requested_by_name || 'Directly in the database'}<br /><small>{whenLabel(c.requested_at)}</small></td>
                      <td>{approvalCell(c.principal_approved_at, c.principal_name)}</td>
                      <td>{approvalCell(c.secretary_approved_at, c.secretary_name)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {rejecting?.id === c.id ? (
                          <form onSubmit={reject} style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                            <input value={rejecting.note} onChange={(e) => setRejecting({ ...rejecting, note: e.target.value })} placeholder="Why it's rejected" autoFocus required />
                            <span>
                              <button type="submit">Reject</button>{' '}
                              <button type="button" className="secondary" onClick={() => setRejecting(null)}>Back</button>
                            </span>
                          </form>
                        ) : (
                          <>
                            {isApprover && <><button onClick={() => approve(c)}>Approve</button>{' '}</>}
                            {isApprover && <><button className="secondary" onClick={() => setRejecting({ id: c.id, note: '' })}>Reject</button>{' '}</>}
                            {(c.mine || isApprover) && <button className="secondary" onClick={() => cancel(c)}>Cancel</button>}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <h2 style={{ marginTop: 0 }}>Propose a change</h2>
        <form onSubmit={proposeYear} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label>Admission fees for
            <select value={yearForm.id} required onChange={(e) => {
              const y = years.find((x) => String(x.academic_year_id) === e.target.value);
              setYearForm({ ...yearForm, id: e.target.value, form: y?.admission_form_fee ?? '', deposit: y?.admission_deposit ?? '' });
            }}>
              <option value="">Choose entry year</option>
              {years.map((y) => <option key={y.academic_year_id} value={y.academic_year_id}>{y.label} entry</option>)}
            </select>
          </label>
          <label>Admission form (₦)<input type="number" min="0" step="0.01" value={yearForm.form} onChange={(e) => setYearForm({ ...yearForm, form: e.target.value })} placeholder="Not set" style={{ width: '9rem' }} /></label>
          <label>Deposit (₦)<input type="number" min="0" step="0.01" value={yearForm.deposit} onChange={(e) => setYearForm({ ...yearForm, deposit: e.target.value })} placeholder="Not set" style={{ width: '9rem' }} /></label>
          <label style={{ flex: '1 1 12rem' }}>Reason<input value={yearForm.reason} onChange={(e) => setYearForm({ ...yearForm, reason: e.target.value })} /></label>
          <button type="submit">Propose</button>
        </form>
        {items.length > 0 && (
          <form onSubmit={proposeItem} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: '0.75rem' }}>
            <label>Term fee item
              <select value={itemForm.id} required onChange={(e) => {
                const it = items.find((x) => String(x.id) === e.target.value);
                setItemForm({ ...itemForm, id: e.target.value, amount: it?.default_amount ?? '' });
              }}>
                <option value="">Choose fee item</option>
                {items.map((i) => <option key={i.id} value={i.id}>{i.display_name || i.name} ({money(i.default_amount)})</option>)}
              </select>
            </label>
            <label>New price (₦)<input type="number" min="0" step="0.01" value={itemForm.amount} onChange={(e) => setItemForm({ ...itemForm, amount: e.target.value })} placeholder="Not set" style={{ width: '9rem' }} /></label>
            <label style={{ flex: '1 1 12rem' }}>Reason<input value={itemForm.reason} onChange={(e) => setItemForm({ ...itemForm, reason: e.target.value })} /></label>
            <button type="submit">Propose</button>
          </form>
        )}
      </div>

      <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <h2 style={{ marginTop: 0 }}>Decided</h2>
        {closed.length === 0 ? <p>None yet.</p> : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>What</th><th>Change</th><th>Outcome</th><th>Proposed</th><th>Principal</th><th>College secretary</th></tr></thead>
              <tbody>
                {closed.map((c) => {
                  const d = describe(c);
                  return (
                    <tr key={c.id}>
                      <td>{d.what}</td>
                      <td>{d.change}{c.reason ? <><br /><small>{c.reason}</small></> : null}</td>
                      <td>
                        <span className="badge" style={STATUS_STYLE[c.status]}>{c.status}</span>
                        {c.status !== 'approved' && c.closed_by_name && <><br /><small>by {c.closed_by_name}</small></>}
                        {c.close_note && <><br /><small>{c.close_note}</small></>}
                        <br /><small>{whenLabel(c.closed_at)}</small>
                      </td>
                      <td>{c.requested_by_name || 'Directly in the database'}<br /><small>{whenLabel(c.requested_at)}</small></td>
                      <td>{c.principal_approved_at ? <>{c.principal_name}<br /><small>{whenLabel(c.principal_approved_at)}</small></> : '—'}</td>
                      <td>{c.secretary_approved_at ? <>{c.secretary_name}<br /><small>{whenLabel(c.secretary_approved_at)}</small></> : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function FeeApprovalsPage() {
  return <RequireAuth><RequireResource resourceKey="/bursar/fee-approvals"><FeeApprovalsInner /></RequireResource></RequireAuth>;
}
