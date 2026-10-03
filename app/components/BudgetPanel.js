'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';
import RequireResource from '../RequireResource';
import { formatMoney, errorText } from '../../lib/admissions';
import BudgetTermForecast from './BudgetTermForecast';

// The pages on the Budget tile (the principal, 3 Oct 2026: "The budget
// process needs a big tile ... Different parts need to be in the big tile"):
// Term forecast (/finance/forecast), Fee income by fund (/finance/budget)
// and Funds & cost centres (/finance/funds). One component, shown by `view`,
// because the three read the same funds. Design in
// docs/finance-budget-design.md.
//
// Fee income by fund (migration 338). Every fee item pays into one cost centre; each payment
// is shared between the funds on its invoice pro rata (the principal's rule)
// by the database when it is recorded, and stored. This page only reads those
// totals (finance_fund_summary()), plus lets the principal or the college
// secretary add cost centres and choose each fee item's fund. Allocations,
// requisitions and spending come in later phases.
//
// While it is being built only the principal sees it (can_view_budget()).

const KIND_LABEL = {
  general_pool: 'General fund',
  allocated: 'Allocated from the general fund',
  ring_fenced: 'Ring-fenced (direct charges)',
  contingency: 'Contingency',
  held: 'Held for students (outside the budget)',
};
const KIND_ORDER = ['general_pool', 'allocated', 'ring_fenced', 'contingency', 'held'];

function money(v) {
  return formatMoney(Number(v || 0));
}

function pct(collected, charged) {
  if (!Number(charged)) return '';
  return `${Math.round((Number(collected) / Number(charged)) * 100)}%`;
}

const TITLES = {
  forecast: 'Term forecast',
  income: 'Fee income by fund',
  funds: 'Funds & cost centres',
};

function BudgetInner({ view }) {
  const [years, setYears] = useState([]);
  const [year, setYear] = useState('');
  const [rows, setRows] = useState(null);
  const [items, setItems] = useState([]);
  const [centres, setCentres] = useState([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [msg, setMsg] = useState(null);
  const [newCentre, setNewCentre] = useState({ name: '', kind: 'allocated', description: '' });
  const [renaming, setRenaming] = useState(null); // { id, name, description }

  useEffect(() => {
    supabase.from('academic_years').select('label, status').order('start_date').then(({ data }) => {
      const list = data || [];
      setYears(list);
      setYear((list.find((y) => y.status === 'current') || list[0] || {}).label || '');
    });
    supabase.rpc('is_budget_approver').then(({ data }) => setCanEdit(!!data));
  }, []);

  useEffect(() => { if (year) load(); }, [year]);

  async function load() {
    const [summary, funds, cc] = await Promise.all([
      supabase.rpc('finance_fund_summary', { p_academic_year: year }),
      supabase.rpc('finance_fee_item_funds'),
      supabase.from('cost_centres').select('id, name, kind, description, active, sort_order, archived_at').order('sort_order').order('name'),
    ]);
    const err = summary.error || funds.error || cc.error;
    if (err) { setLoadError(errorText(err)); setRows([]); return; }
    setLoadError(null);
    setRows(summary.data || []);
    setItems(funds.data || []);
    setCentres(cc.data || []);
  }

  async function act(promise, done) {
    setMsg(null);
    const { error } = await promise;
    if (error) { setMsg({ error: true, text: errorText(error) }); return; }
    setMsg({ text: done });
    await load();
  }

  function setFund(item, ccId) {
    if (!ccId) return;
    act(supabase.rpc('set_fee_item_cost_centre', { p_fee_item_id: item.fee_item_id, p_cost_centre_id: Number(ccId) }),
      `${item.name} now pays into ${centres.find((c) => c.id === Number(ccId))?.name}.`);
  }

  function addCentre(e) {
    e.preventDefault();
    if (!newCentre.name.trim()) return;
    act(supabase.from('cost_centres').insert({
      name: newCentre.name.trim(), kind: newCentre.kind, description: newCentre.description.trim() || null,
    }), `${newCentre.name.trim()} added.`);
    setNewCentre({ name: '', kind: 'allocated', description: '' });
  }

  function saveRename(e) {
    e.preventDefault();
    act(supabase.from('cost_centres').update({
      name: renaming.name.trim(), description: renaming.description.trim() || null,
    }).eq('id', renaming.id), 'Saved.');
    setRenaming(null);
  }

  function setActive(c, active) {
    if (!active && !window.confirm(`Archive ${c.name}? It is kept, with who archived it and when, and can be restored.`)) return;
    act(supabase.from('cost_centres').update({ active }).eq('id', c.id), active ? `${c.name} restored.` : `${c.name} archived.`);
  }

  if (rows === null) return <p>Loading…</p>;

  const itemName = Object.fromEntries(items.map((i) => [i.fee_item_id, i.name]));
  const feedsInto = {};
  items.forEach((i) => { if (i.cost_centre_id) (feedsInto[i.cost_centre_id] ||= []).push(i.name); });

  const funds = rows.filter((r) => r.cost_centre_id != null && (r.active || Number(r.charged) || Number(r.collected)));
  const unassigned = rows.filter((r) => r.cost_centre_id == null && (Number(r.charged) || Number(r.collected)));
  const inBudget = funds.filter((r) => r.kind !== 'held');
  const total = (list, f) => list.reduce((s, r) => s + Number(r[f] || 0), 0);
  const charged = total(inBudget, 'charged') + total(unassigned, 'charged');
  const collected = total(inBudget, 'collected') + total(unassigned, 'collected');

  return (
    <div>
      <p style={{ margin: 0 }}><a href="/">← Dashboard</a></p>
      <h1>{TITLES[view]}</h1>
      <p style={{ fontSize: '0.85rem', background: '#fff1cc', padding: '0.4rem 0.6rem', borderRadius: 4 }}>
        Only you can see the Budget while it is being built.
      </p>
      {msg && <p style={{ color: msg.error ? '#a3232c' : '#1a7a3d' }}>{msg.text}</p>}

      {view === 'forecast' && <BudgetTermForecast canEdit={canEdit} centres={centres} />}

      {view === 'income' && (<>
      <p style={{ color: '#666', fontSize: '0.9rem' }}>
        Tuition goes into the general fund, which will be shared out across the allocated cost centres;
        direct charges (swimming, sports, medical, ICT, exam entries) are ring-fenced for what they were
        charged for. A payment that covers part of an invoice is shared between its funds in proportion
        to what each is owed.
      </p>
      <label>Academic year{' '}
        <select value={year} onChange={(e) => setYear(e.target.value)}>
          {years.map((y) => <option key={y.label} value={y.label}>{y.label}</option>)}
        </select>
      </label>

      {loadError && <p style={{ color: '#a3232c' }}>{loadError}</p>}

      <div className="stat-card-row" style={{ marginTop: '1rem' }}>
        <div className="stat-card"><div><div className="stat-card-value">{money(charged)}</div><div className="stat-card-label">Charged to families</div></div></div>
        <div className="stat-card"><div><div className="stat-card-value">{money(collected)}</div><div className="stat-card-label">Collected ({pct(collected, charged) || '–'})</div></div></div>
        <div className="stat-card"><div><div className="stat-card-value">{money(charged - collected)}</div><div className="stat-card-label">Still owed</div></div></div>
      </div>
      <p style={{ color: '#666', fontSize: '0.85rem' }}>Tuck shop money is the students&apos; own and is not counted above.</p>

      {unassigned.length > 0 && (
        <div className="card" style={{ borderLeft: '4px solid #a3232c' }}>
          <strong>Fee items with no fund yet.</strong> Their money is counted below as &ldquo;not assigned&rdquo; until
          they are given one, then it moves there.
          <ul>{unassigned.map((r) => <li key={r.fee_item_id ?? 'none'}>{itemName[r.fee_item_id] || 'Charges with no fee item'}: {money(r.collected)} collected of {money(r.charged)}</li>)}</ul>
        </div>
      )}

      <div className="table-scroll">
        <table>
          <thead><tr><th>Fund</th><th>Paid for by</th><th style={{ textAlign: 'right' }}>Charged</th><th style={{ textAlign: 'right' }}>Collected</th><th style={{ textAlign: 'right' }}>Still owed</th><th style={{ textAlign: 'right' }}>Collected %</th></tr></thead>
          <tbody>
            {KIND_ORDER.map((kind) => {
              const list = funds.filter((r) => r.kind === kind).sort((a, b) => a.sort_order - b.sort_order);
              if (list.length === 0) return null;
              return [
                <tr key={`h-${kind}`}><td colSpan={6} style={{ background: '#f4f4f4', fontWeight: 600 }}>{KIND_LABEL[kind]}</td></tr>,
                ...list.map((r) => (
                  <tr key={r.cost_centre_id}>
                    <td>{r.name}{!r.active && <span style={{ color: '#888' }}> (archived)</span>}</td>
                    <td style={{ fontSize: '0.85rem', color: '#555' }}>
                      {(feedsInto[r.cost_centre_id] || []).join(', ') || (kind === 'allocated' ? 'An allocation from the general fund (phase 2)' : kind === 'contingency' ? 'Set aside in the budget (phase 2)' : '—')}
                      {Number(r.credit) > 0 && <div>Includes {money(r.credit)} paid before it was charged; it moves to the right fund when the charge is added.</div>}
                    </td>
                    <td style={{ textAlign: 'right' }}>{money(r.charged)}</td>
                    <td style={{ textAlign: 'right' }}>{money(r.collected)}</td>
                    <td style={{ textAlign: 'right' }}>{money(Number(r.charged) - Number(r.collected))}</td>
                    <td style={{ textAlign: 'right' }}>{pct(r.collected, r.charged)}</td>
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>
      </div>
      <p style={{ color: '#666', fontSize: '0.85rem' }}>Charged and collected are for invoices in the fee terms of {year}.</p>
      </>)}

      {view === 'funds' && (<>
      {loadError && <p style={{ color: '#a3232c' }}>{loadError}</p>}
      <h2>Which fund each fee item pays into</h2>
      <p style={{ color: '#666', fontSize: '0.9rem' }}>
        {canEdit
          ? 'Set by the principal or the college secretary. Once an item has been charged its fund can’t change; add a new fee item instead.'
          : 'Set by the principal or the college secretary.'}
      </p>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Fee item</th><th>Category</th><th>Fund</th></tr></thead>
          <tbody>
            {items.map((i) => {
              const locked = i.charged && i.cost_centre_id;
              return (
                <tr key={i.fee_item_id}>
                  <td>{i.name}</td>
                  <td>{i.category}</td>
                  <td>
                    {canEdit && !locked ? (
                      <select value={i.cost_centre_id ?? ''} onChange={(e) => setFund(i, e.target.value)}>
                        {!i.cost_centre_id && <option value="">Choose a fund…</option>}
                        {centres.filter((c) => c.active && c.kind !== 'contingency').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    ) : (
                      <>{centres.find((c) => c.id === i.cost_centre_id)?.name || <em>Not assigned</em>}{locked && canEdit && <span title="Already charged" style={{ color: '#888' }}> 🔒</span>}</>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2 style={{ marginTop: '2rem' }}>Cost centres</h2>
      <p style={{ color: '#666', fontSize: '0.9rem' }}>
        Cost centres are never deleted. An archived one is kept, with who archived it and when, and can be restored.
      </p>
      {canEdit && (
        <form onSubmit={addCentre} className="card" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label>Name<br /><input value={newCentre.name} onChange={(e) => setNewCentre({ ...newCentre, name: e.target.value })} required /></label>
          <label>Kind<br />
            <select value={newCentre.kind} onChange={(e) => setNewCentre({ ...newCentre, kind: e.target.value })}>
              <option value="allocated">Allocated from the general fund</option>
              <option value="ring_fenced">Ring-fenced (a direct charge)</option>
            </select>
          </label>
          <label style={{ flex: '1 1 14rem' }}>Note<br /><input value={newCentre.description} onChange={(e) => setNewCentre({ ...newCentre, description: e.target.value })} style={{ width: '100%' }} /></label>
          <button type="submit">Add cost centre</button>
        </form>
      )}
      <div className="table-scroll">
        <table>
          <thead><tr><th>Name</th><th>Kind</th><th>Note</th>{canEdit && <th></th>}</tr></thead>
          <tbody>
            {centres.map((c) => {
              const special = ['general_pool', 'contingency', 'held'].includes(c.kind);
              if (renaming?.id === c.id) {
                return (
                  <tr key={c.id}>
                    <td colSpan={canEdit ? 4 : 3}>
                      <form onSubmit={saveRename} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <input value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} required />
                        <input value={renaming.description} onChange={(e) => setRenaming({ ...renaming, description: e.target.value })} placeholder="Note" style={{ flex: '1 1 14rem' }} />
                        <button type="submit">Save</button>
                        <button type="button" onClick={() => setRenaming(null)}>Cancel</button>
                      </form>
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={c.id} style={c.active ? undefined : { color: '#888' }}>
                  <td>{c.name}{!c.active && ' (archived)'}</td>
                  <td>{KIND_LABEL[c.kind]}</td>
                  <td style={{ fontSize: '0.85rem' }}>{c.description}</td>
                  {canEdit && (
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button type="button" onClick={() => setRenaming({ id: c.id, name: c.name, description: c.description || '' })}>Rename</button>{' '}
                      {!special && (c.active
                        ? <button type="button" onClick={() => setActive(c, false)}>Archive</button>
                        : <button type="button" onClick={() => setActive(c, true)}>Restore</button>)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </>)}
    </div>
  );
}

export default function BudgetPanel({ view, resourceKey }) {
  return <RequireAuth><RequireResource resourceKey={resourceKey}><BudgetInner view={view} /></RequireResource></RequireAuth>;
}
