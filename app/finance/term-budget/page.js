'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { errorText } from '../../../lib/admissions';
import FinanceShell, { money } from '../../components/FinanceShell';

// 5. Budget (migration 346): share a term's money across the cost centres,
// approved by the principal and the college secretary together (one approval
// completes a practice budget). Shows where each cost centre stands
// (allocated, released from contingency, committed, spent, remaining) and
// lets the principal release money from Contingency.

const KIND = { allocated: 'Allocated', ring_fenced: 'Ring-fenced', contingency: 'Contingency' };

function TermBudget({ practice, termId }) {
  const [centres, setCentres] = useState([]);
  const [forecast, setForecast] = useState({ total: 0, byFund: {} });
  const [budgets, setBudgets] = useState([]);
  const [position, setPosition] = useState([]);
  const [releases, setReleases] = useState([]);
  const [lines, setLines] = useState({});
  const [note, setNote] = useState('');
  const [release, setRelease] = useState({ cc: '', amount: '', reason: '' });
  const [msg, setMsg] = useState(null);

  useEffect(() => { load(); }, [practice, termId]);

  async function load() {
    const [cc, fc, tb, pos, rel] = await Promise.all([
      supabase.from('cost_centres').select('id, name, kind, active, sort_order').order('sort_order'),
      supabase.rpc('budget_term_forecast', { p_term_id: termId }),
      supabase.from('term_budgets').select('*, term_budget_lines(cost_centre_id, amount)').eq('term_id', termId).eq('practice', practice).order('proposed_at', { ascending: false }),
      supabase.rpc('budget_position', { p_term_id: termId, p_practice: practice }),
      supabase.from('contingency_releases').select('*, cost_centres(name), requisitions(id, reason)').eq('term_id', termId).eq('practice', practice).order('released_at', { ascending: false }),
    ]);
    const err = cc.error || fc.error || tb.error || pos.error || rel.error;
    if (err) { setMsg({ error: true, text: errorText(err) }); return; }
    const budgetable = (cc.data || []).filter((c) => c.active && ['allocated', 'ring_fenced', 'contingency'].includes(c.kind));
    setCentres(budgetable);
    const byFund = {};
    let total = 0;
    (fc.data || []).forEach((r) => { byFund[r.cost_centre_id] = (byFund[r.cost_centre_id] || 0) + Number(r.amount); total += Number(r.amount); });
    setForecast({ total, byFund });
    setBudgets(tb.data || []);
    setPosition(pos.data || []);
    setReleases(rel.data || []);
    // Start the form from the approved budget, else ring-fenced funds' own forecast.
    const approved = (tb.data || []).find((b) => b.status === 'approved');
    const start = {};
    budgetable.forEach((c) => {
      const l = approved?.term_budget_lines?.find((x) => x.cost_centre_id === c.id);
      start[c.id] = l ? String(Number(l.amount)) : c.kind === 'ring_fenced' && byFund[c.id] ? String(Math.round(byFund[c.id])) : '';
    });
    setLines(start);
  }

  async function act(promise, done) {
    setMsg(null);
    const { data, error } = await promise;
    if (error) { setMsg({ error: true, text: errorText(error) }); return; }
    setMsg({ text: typeof done === 'function' ? done(data) : done });
    await load();
  }

  const allocatedTotal = Object.values(lines).reduce((s, v) => s + (Number(v) || 0), 0);
  const pending = budgets.find((b) => b.status === 'pending');
  const approved = budgets.find((b) => b.status === 'approved');
  const contingencyLeft = position.find((p) => p.kind === 'contingency')?.remaining ?? 0;
  const name = Object.fromEntries(centres.map((c) => [c.id, c.name]));

  return (
    <div>
      {msg && <p style={{ color: msg.error ? '#a3232c' : '#1a7a3d' }}>{msg.text}</p>}

      <h2>Where each cost centre stands</h2>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Cost centre</th><th style={{ textAlign: 'right' }}>Budget</th><th style={{ textAlign: 'right' }}>From contingency</th><th style={{ textAlign: 'right' }}>Committed</th><th style={{ textAlign: 'right' }}>Spent</th><th style={{ textAlign: 'right' }}>Remaining</th></tr></thead>
          <tbody>
            {position.map((p) => (
              <tr key={p.cost_centre_id}>
                <td>{p.name} <span style={{ fontSize: '0.75rem', color: '#666' }}>{KIND[p.kind]}</span></td>
                <td style={{ textAlign: 'right' }}>{money(p.allocated)}</td>
                <td style={{ textAlign: 'right' }}>{p.kind === 'contingency' ? (Number(p.released_out) ? `−${money(p.released_out)}` : '') : (Number(p.released_in) ? money(p.released_in) : '')}</td>
                <td style={{ textAlign: 'right' }}>{money(p.committed)}</td>
                <td style={{ textAlign: 'right' }}>{money(p.spent)}</td>
                <td style={{ textAlign: 'right', fontWeight: 600, color: Number(p.remaining) < 0 ? '#a3232c' : undefined }}>{money(p.remaining)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: '0.85rem', color: '#666' }}>
        Cash collected for this term so far: <strong>{money(position[0]?.cash_collected)}</strong>.
        {practice ? ' Practice entries aren’t held to it.' : ' Real requisitions can only be approved up to it (invoiced, spend to cash).'}
      </p>

      <h2 style={{ marginTop: '1.5rem' }}>The term&apos;s budget</h2>
      {approved && <p>Approved budget in force{approved.note ? `: ${approved.note}` : ''}.</p>}
      {pending ? (
        <div className="card" style={{ borderLeft: '4px solid #c07d1f' }}>
          <strong>Waiting for approval</strong>{pending.note ? `: ${pending.note}` : ''}
          <ul>{(pending.term_budget_lines || []).map((l) => <li key={l.cost_centre_id}>{name[l.cost_centre_id] || 'Cost centre'}: {money(l.amount)}</li>)}</ul>
          <p style={{ fontSize: '0.85rem' }}>
            {pending.principal_approved_at ? 'Principal approved. ' : ''}{pending.secretary_approved_at ? 'College secretary approved. ' : ''}
            {practice ? 'Practice: one approval is enough.' : 'Needs both the principal and the college secretary.'}
          </p>
          <button type="button" onClick={() => act(supabase.rpc('approve_term_budget', { p_id: pending.id }), (r) => (r === 'approved' ? 'Approved: this is now the term’s budget.' : 'Your approval is recorded; it needs the other approver.'))}>Approve</button>{' '}
          <button type="button" className="secondary" onClick={() => { const n = window.prompt('Why cancel it?'); if (n) act(supabase.rpc('cancel_term_budget', { p_id: pending.id, p_note: n }), 'Cancelled.'); }}>Cancel</button>
        </div>
      ) : (
        <form className="card" onSubmit={(e) => {
          e.preventDefault();
          const payload = {};
          Object.entries(lines).forEach(([k, v]) => { if (String(v).trim() !== '') payload[k] = Number(v); });
          act(supabase.rpc('propose_term_budget', { p_term_id: termId, p_lines: payload, p_practice: practice, p_note: note }),
            practice ? 'Proposed. Approve it below to put it in force.' : 'Proposed. It applies once you and the college secretary have both approved it.');
          setNote('');
        }}>
          <p style={{ margin: '0 0 0.5rem' }}>
            Forecast fee income for the term: <strong>{money(forecast.total)}</strong>{' '}
            (<a href="/finance/forecast">3. Forecast</a>). Shared out below: <strong>{money(allocatedTotal)}</strong>;{' '}
            <span style={{ color: forecast.total - allocatedTotal < 0 ? '#a3232c' : undefined }}>not yet shared out: {money(forecast.total - allocatedTotal)}</span>.
          </p>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Cost centre</th><th>Kind</th><th style={{ textAlign: 'right' }}>Its own fees (forecast)</th><th>Budget for the term (₦)</th></tr></thead>
              <tbody>
                {centres.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td style={{ fontSize: '0.85rem' }}>{KIND[c.kind]}</td>
                    <td style={{ textAlign: 'right' }}>{forecast.byFund[c.id] ? money(forecast.byFund[c.id]) : ''}</td>
                    <td><input type="number" min="0" value={lines[c.id] ?? ''} onChange={(e) => setLines({ ...lines, [c.id]: e.target.value })} style={{ width: '10rem' }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label>Note<br /><input value={note} onChange={(e) => setNote(e.target.value)} style={{ width: '100%' }} /></label>
          <p style={{ marginBottom: 0 }}><button type="submit">Propose this budget</button></p>
        </form>
      )}

      <h2 style={{ marginTop: '1.5rem' }}>Releases from contingency</h2>
      <p style={{ fontSize: '0.85rem', color: '#666' }}>
        A cost centre never goes below zero: a requisition that would overspend waits until the shortfall is released here
        (or from <a href="/finance/approvals">8. Approvals</a>). Contingency has <strong>{money(contingencyLeft)}</strong> left. Only the principal releases.
      </p>
      <form onSubmit={(e) => {
        e.preventDefault();
        act(supabase.rpc('release_contingency', { p_term_id: termId, p_cost_centre_id: Number(release.cc), p_amount: Number(release.amount), p_reason: release.reason, p_requisition_id: null, p_practice: practice }), 'Released.');
        setRelease({ cc: '', amount: '', reason: '' });
      }} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label>To<br />
          <select value={release.cc} onChange={(e) => setRelease({ ...release, cc: e.target.value })} required>
            <option value="">Choose…</option>
            {centres.filter((c) => c.kind !== 'contingency').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label>Amount (₦)<br /><input type="number" min="1" value={release.amount} onChange={(e) => setRelease({ ...release, amount: e.target.value })} required style={{ width: '9rem' }} /></label>
        <label style={{ flex: '1 1 14rem' }}>Reason<br /><input value={release.reason} onChange={(e) => setRelease({ ...release, reason: e.target.value })} required style={{ width: '100%' }} /></label>
        <button type="submit">Release</button>
      </form>
      {releases.length > 0 && (
        <ul>
          {releases.map((r) => (
            <li key={r.id} style={{ color: r.cancelled_at ? '#888' : undefined }}>
              {new Date(r.released_at).toLocaleDateString('en-GB')}: {money(r.amount)} to {r.cost_centres?.name}: {r.reason}
              {r.requisitions ? ` (requisition ${r.requisitions.id})` : ''}{r.cancelled_at ? ` (cancelled: ${r.cancel_note})` : ''}
            </li>
          ))}
        </ul>
      )}

      {practice && (
        <div className="card" style={{ marginTop: '1.5rem', borderLeft: '4px solid #a3232c' }}>
          <strong>Clear practice entries</strong>
          <p style={{ fontSize: '0.85rem' }}>
            Cancels every practice budget, requisition and release and archives every practice supplier, in every term.
            They stay on record as cleared; nothing is deleted. Real entries are not touched.
          </p>
          <button type="button" onClick={() => {
            if (!window.confirm('Clear all practice entries?')) return;
            act(supabase.rpc('clear_practice_entries'), (r) => `Cleared: ${r.budgets} budgets, ${r.requisitions} requisitions, ${r.releases} releases, ${r.suppliers} suppliers.`);
          }}>Clear practice entries</button>
        </div>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <FinanceShell resourceKey="/finance/term-budget" step={5} title="Budget"
      intro="Share the term's money across the cost centres. A budget applies once you and the college secretary have both approved it; approving a new one replaces the old.">
      {(p) => <TermBudget {...p} />}
    </FinanceShell>
  );
}
