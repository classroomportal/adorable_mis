'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';

function naira(n) {
  return `₦${Number(n || 0).toLocaleString()}`;
}

function targetLabel(b) {
  if (b.target_type === 'individual') return `Student #${b.target_value}`;
  if (b.target_type === 'form_class') return `Form ${b.target_value}`;
  if (b.target_type === 'year_group') return `Year ${b.target_value}`;
  return 'All students';
}

function AuditInner() {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [undoingId, setUndoingId] = useState(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);

    const { data: batchRows } = await supabase
      .from('fee_charge_batches')
      .select('id, description, amount, target_type, target_value, created_at, created_by, fee_items(name), fee_terms(name)')
      .order('created_at', { ascending: false })
      .limit(100);

    const creatorIds = Array.from(new Set((batchRows || []).map((b) => b.created_by).filter(Boolean)));
    let profileById = new Map();
    if (creatorIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, email, staff_id')
        .in('id', creatorIds);
      const staffIds = Array.from(new Set((profiles || []).map((p) => p.staff_id).filter(Boolean)));
      let staffById = new Map();
      if (staffIds.length > 0) {
        const { data: staffRows } = await supabase.from('staff').select('staff_id, first_name, last_name').in('staff_id', staffIds);
        staffById = new Map((staffRows || []).map((s) => [s.staff_id, s]));
      }
      profileById = new Map((profiles || []).map((p) => [p.id, {
        email: p.email,
        name: staffById.has(p.staff_id) ? `${staffById.get(p.staff_id).first_name} ${staffById.get(p.staff_id).last_name}` : null,
      }]));
    }

    const batchIds = (batchRows || []).map((b) => b.id);
    let remainingByBatch = new Map();
    if (batchIds.length > 0) {
      const { data: items } = await supabase.from('invoice_line_items').select('batch_id').in('batch_id', batchIds);
      (items || []).forEach((li) => remainingByBatch.set(li.batch_id, (remainingByBatch.get(li.batch_id) || 0) + 1));
    }

    const built = (batchRows || []).map((b) => {
      const creator = profileById.get(b.created_by);
      const remaining = remainingByBatch.get(b.id) || 0;
      return {
        ...b,
        creatorLabel: creator?.name || creator?.email || 'Unknown',
        remaining,
        fullyUndone: remaining === 0,
      };
    });

    setBatches(built);
    setLoading(false);
  }

  async function handleUndo(batchId) {
    setUndoingId(batchId);
    await supabase.rpc('undo_fee_charge_batch', { p_batch_id: batchId });
    await load();
    setUndoingId(null);
  }

  return (
    <div>
      <h1>Fees Audit</h1>
      <p style={{ color: '#666', fontSize: '0.9rem' }}>Last 100 charge batches, most recent first.</p>

      {loading ? <p>Loading…</p> : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>When</th><th>Who</th><th>Item</th><th>Term</th><th>Target</th>
                <th>Amount</th><th>Students affected</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id}>
                  <td>{new Date(b.created_at).toLocaleString()}</td>
                  <td>{b.creatorLabel}</td>
                  <td>{b.description || b.fee_items?.name}</td>
                  <td>{b.fee_terms?.name}</td>
                  <td>{targetLabel(b)}</td>
                  <td>{naira(b.amount)}</td>
                  <td>{b.remaining}</td>
                  <td>
                    <span className={`badge ${b.fullyUndone ? 'badge-negative' : 'badge-positive'}`}>
                      {b.fullyUndone ? 'undone' : 'active'}
                    </span>
                  </td>
                  <td>
                    {!b.fullyUndone && (
                      <button onClick={() => handleUndo(b.id)} disabled={undoingId === b.id}>
                        {undoingId === b.id ? 'Undoing…' : 'Undo'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function AuditPage() {
  return (
    <RequireAuth>
      <AuditInner />
    </RequireAuth>
  );
}
