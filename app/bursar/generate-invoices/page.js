'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';

const YEAR_GROUPS = [7, 8, 9, 10, 11, 12];

function GenerateInvoicesInner() {
  const [feeItems, setFeeItems] = useState([]);
  const [terms, setTerms] = useState([]);
  const [feeItemId, setFeeItemId] = useState('');
  const [termId, setTermId] = useState('');
  const [description, setDescription] = useState('');
  const [amounts, setAmounts] = useState({}); // year_group -> amount string
  const [status, setStatus] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState({}); // year_group -> student count

  useEffect(() => {
    (async () => {
      const { data: items } = await supabase.from('fee_items').select('id, name').order('name');
      setFeeItems(items ?? []);
      const { data: t } = await supabase.from('fee_terms').select('id, name, is_current').order('id', { ascending: false });
      setTerms(t ?? []);
      const current = (t ?? []).find((x) => x.is_current);
      if (current) setTermId(String(current.id));

      const counts = {};
      for (const yg of YEAR_GROUPS) {
        const { count } = await supabase
          .from('students')
          .select('student_id', { count: 'exact', head: true })
          .eq('year_group', yg)
          .eq('status', 'active');
        counts[yg] = count ?? 0;
      }
      setPreview(counts);
    })();
  }, []);

  function setAmount(yg, value) {
    setAmounts((prev) => ({ ...prev, [yg]: value }));
  }

  async function submit(e) {
    e.preventDefault();
    if (!feeItemId || !termId) {
      setStatus('Choose a fee item and term first.');
      return;
    }
    setSubmitting(true);
    setStatus(null);

    const { data: userData } = await supabase.auth.getUser();
    const createdBy = userData?.user?.id;

    const results = [];
    for (const yg of YEAR_GROUPS) {
      const amt = Number(amounts[yg]);
      if (!amt || amt <= 0) continue;
      const { data, error } = await supabase.rpc('apply_fee_charge_batch', {
        p_fee_item_id: feeItemId,
        p_term_id: termId,
        p_description: description || null,
        p_amount: amt,
        p_target_type: 'year_group',
        p_target_value: String(yg),
        p_created_by: createdBy,
      });
      if (error) {
        results.push(`Year ${yg}: error — ${error.message}`);
      } else {
        const row = Array.isArray(data) ? data[0] : data;
        results.push(`Year ${yg}: charged ${row?.students_charged ?? '?'} students`);
      }
    }

    setStatus(results.length ? results.join(' · ') : 'No amounts entered — nothing was charged.');
    setSubmitting(false);
  }

  return (
    <div>
      <h1>Generate Invoices by Year Group</h1>
      <p style={{ color: '#666', fontSize: '0.9rem' }}>
        Set a different amount per year group for one fee item and apply it to every active
        student in that year group in one go. Runs the same charge-batch logic as the single
        "Add a Charge" screen, once per year group — each is undoable individually from there.
      </p>

      <form onSubmit={submit} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <label>
          Fee item
          <select value={feeItemId} onChange={(e) => setFeeItemId(e.target.value)} required>
            <option value="">-- choose --</option>
            {feeItems.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>

        <label>
          Term
          <select value={termId} onChange={(e) => setTermId(e.target.value)} required>
            {terms.map((t) => <option key={t.id} value={t.id}>{t.name}{t.is_current ? ' (current)' : ''}</option>)}
          </select>
        </label>

        <label>
          Description (optional, shown on the invoice line)
          <input value={description} onChange={(e) => setDescription(e.target.value)} style={{ width: '100%' }} />
        </label>

        <div className="table-scroll">
          <table>
            <thead><tr><th>Year group</th><th>Active students</th><th>Amount (₦)</th></tr></thead>
            <tbody>
              {YEAR_GROUPS.map((yg) => (
                <tr key={yg}>
                  <td>Year {yg}</td>
                  <td>{preview[yg] ?? '…'}</td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      placeholder="0"
                      value={amounts[yg] || ''}
                      onChange={(e) => setAmount(yg, e.target.value)}
                      style={{ width: '9rem' }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button type="submit" disabled={submitting}>
          {submitting ? 'Applying…' : 'Apply to all year groups'}
        </button>
        {status && <p>{status}</p>}
      </form>
    </div>
  );
}

export default function GenerateInvoicesPage() {
  return (
    <RequireAuth>
      <GenerateInvoicesInner />
    </RequireAuth>
  );
}
