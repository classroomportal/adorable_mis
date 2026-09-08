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
  const [mode, setMode] = useState('band'); // 'band' | 'year_group'
  const [amounts, setAmounts] = useState({}); // key -> amount string
  const [status, setStatus] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState({}); // key -> student count
  const [feeLevels, setFeeLevels] = useState([]);

  const keys = mode === 'band' ? feeLevels : YEAR_GROUPS;

  useEffect(() => {
    (async () => {
      const { data: items } = await supabase.from('fee_items').select('id, name').or('category.is.null,category.neq.Tuckshop').order('name');
      setFeeItems(items ?? []);
      const { data: t } = await supabase.from('fee_terms').select('id, name, is_current').order('id', { ascending: false });
      setTerms(t ?? []);
      const current = (t ?? []).find((x) => x.is_current);
      if (current) setTermId(String(current.id));
      const { data: levels } = await supabase.from('fee_levels').select('name').order('name');
      setFeeLevels((levels ?? []).map((l) => l.name));
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const counts = {};
      for (const key of keys) {
        const q = supabase.from('students').select('student_id', { count: 'exact', head: true }).eq('status', 'active');
        const { count } = mode === 'band' ? await q.eq('fee_band', key) : await q.eq('year_group', key);
        counts[key] = count ?? 0;
      }
      setPreview(counts);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  function setAmount(key, value) {
    setAmounts((prev) => ({ ...prev, [key]: value }));
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
    const targetType = mode === 'band' ? 'band' : 'year_group';

    const results = [];
    for (const key of keys) {
      const amt = Number(amounts[key]);
      if (!amt || amt <= 0) continue;
      const { data, error } = await supabase.rpc('apply_fee_charge_batch', {
        p_fee_item_id: feeItemId,
        p_term_id: termId,
        p_description: description || null,
        p_amount: amt,
        p_target_type: targetType,
        p_target_value: String(key),
        p_created_by: createdBy,
      });
      if (error) {
        results.push(`${mode === 'band' ? 'Level' : 'Year'} ${key}: error — ${error.message}`);
      } else {
        const row = Array.isArray(data) ? data[0] : data;
        results.push(`${mode === 'band' ? 'Level' : 'Year'} ${key}: charged ${row?.students_charged ?? '?'} students`);
      }
    }

    setStatus(results.length ? results.join(' · ') : 'No amounts entered — nothing was charged.');
    setSubmitting(false);
  }

  return (
    <div>
      <h1>Allocate Same Amount to a Group</h1>
      <p style={{ color: '#666', fontSize: '0.9rem' }}>
        Set a different amount per band (or year group, for items that don't vary by band) for one
        fee item, and apply it to everyone in that group in one go. Each application is undoable
        individually from the Audit screen.
      </p>

      <div className="card" style={{ display: 'flex', gap: '1rem' }}>
        <label>
          <input type="radio" checked={mode === 'band'} onChange={() => setMode('band')} /> By fee level
        </label>
        <label>
          <input type="radio" checked={mode === 'year_group'} onChange={() => setMode('year_group')} /> By year group
        </label>
      </div>

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
            <thead><tr><th>{mode === 'band' ? 'Fee level' : 'Year group'}</th><th>Active students</th><th>Amount (₦)</th></tr></thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key}>
                  <td>{mode === 'band' ? key : `Year ${key}`}</td>
                  <td>{preview[key] ?? '…'}</td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      placeholder="0"
                      value={amounts[key] || ''}
                      onChange={(e) => setAmount(key, e.target.value)}
                      style={{ width: '9rem' }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button type="submit" disabled={submitting}>
          {submitting ? 'Applying…' : `Apply to all ${mode === 'band' ? 'bands' : 'year groups'}`}
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
