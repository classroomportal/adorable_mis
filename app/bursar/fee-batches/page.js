'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import { useAuth } from '../../../lib/AuthContext';

const TARGET_LABELS = {
  individual: 'One student',
  form_class: 'Form class',
  year_group: 'Year group',
  all: 'Every student',
};

function FeeChargeBatchInner() {
  const { session } = useAuth();

  const [feeItems, setFeeItems] = useState([]);
  const [terms, setTerms] = useState([]);
  const [recentBatches, setRecentBatches] = useState([]);

  const [feeItemId, setFeeItemId] = useState('');
  const [termId, setTermId] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [targetType, setTargetType] = useState('year_group');
  const [targetValue, setTargetValue] = useState('');

  const [studentQuery, setStudentQuery] = useState('');
  const [studentResults, setStudentResults] = useState([]);

  const [status, setStatus] = useState('idle'); // idle | saving | done | error
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    (async () => {
      const [{ data: items }, { data: termRows }, { data: batches }] = await Promise.all([
        supabase.from('fee_items').select('id, name, category, is_optional, default_amount').order('name'),
        supabase.from('fee_terms').select('id, name, is_current').order('id', { ascending: false }),
        supabase
          .from('fee_charge_batches')
          .select('id, description, amount, target_type, target_value, created_at')
          .order('created_at', { ascending: false })
          .limit(8),
      ]);
      setFeeItems(items ?? []);
      setTerms(termRows ?? []);
      const current = (termRows ?? []).find((t) => t.is_current);
      if (current) setTermId(String(current.id));
      setRecentBatches(batches ?? []);
    })();
  }, []);

  useEffect(() => {
    const item = feeItems.find((f) => String(f.id) === feeItemId);
    if (item) {
      if (!description) setDescription(item.name);
      if (item.default_amount && !amount) setAmount(String(item.default_amount));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feeItemId]);

  useEffect(() => {
    if (targetType !== 'individual' || studentQuery.trim().length < 2) {
      setStudentResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      const { data } = await supabase
        .from('students')
        .select('student_id, first_name, last_name, form_class')
        .eq('status', 'active')
        .or(`first_name.ilike.%${studentQuery}%,last_name.ilike.%${studentQuery}%`)
        .limit(8);
      setStudentResults(data ?? []);
    }, 250);
    return () => clearTimeout(handle);
  }, [studentQuery, targetType]);

  const canSubmit = feeItemId && termId && amount && targetType && targetValue;

  async function handleSubmit() {
    setStatus('saving');
    setStatusMessage('');

    const { data, error } = await supabase.rpc('apply_fee_charge_batch', {
      p_fee_item_id: Number(feeItemId),
      p_term_id: Number(termId),
      p_description: description || null,
      p_amount: Number(amount),
      p_target_type: targetType,
      p_target_value: targetValue,
      p_created_by: session?.user?.id ?? null,
    });

    if (error) {
      setStatus('error');
      setStatusMessage(error.message);
      return;
    }

    const result = Array.isArray(data) ? data[0] : data;
    setStatus('done');
    setStatusMessage(
      `Applied to ${result?.students_charged ?? 0} student${result?.students_charged === 1 ? '' : 's'}.`
    );

    setRecentBatches((prev) => [
      {
        id: result?.batch_id,
        description,
        amount: Number(amount),
        target_type: targetType,
        target_value: targetValue,
        created_at: new Date().toISOString(),
        students_charged: result?.students_charged,
      },
      ...prev,
    ]);

    setDescription('');
    setAmount('');
    setTargetValue('');
    setStudentQuery('');
  }

  async function handleUndo(batchId) {
    if (!confirm('Remove this charge from every student it was applied to?')) return;
    const { error } = await supabase.rpc('undo_fee_charge_batch', { p_batch_id: batchId });
    if (!error) {
      setRecentBatches((prev) => prev.filter((b) => b.id !== batchId));
    }
  }

  return (
    <div className="min-h-screen bg-[#FAF9F6] pb-24">
      <header className="bg-[#B23A2E] text-white px-5 pt-6 pb-5">
        <p className="text-sm text-white/70">Fees & Bills</p>
        <h1 className="text-xl font-semibold mt-0.5">Add a charge</h1>
        <p className="text-sm text-white/80 mt-1">
          Apply a fee to one student, a form class, a year group, or everyone.
        </p>
      </header>

      <main className="px-5 mt-5 space-y-5 max-w-lg mx-auto">
        <section className="bg-white rounded-xl border border-black/5 p-4 space-y-4">
          <div>
            <label className="text-sm font-medium text-neutral-700">Fee item</label>
            <select
              value={feeItemId}
              onChange={(e) => setFeeItemId(e.target.value)}
              className="mt-1 w-full border border-neutral-300 rounded-lg px-3 py-2.5 text-base"
            >
              <option value="">Choose a fee item…</option>
              {feeItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.is_optional ? ' (optional)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-neutral-700">Term</label>
            <select
              value={termId}
              onChange={(e) => setTermId(e.target.value)}
              className="mt-1 w-full border border-neutral-300 rounded-lg px-3 py-2.5 text-base"
            >
              <option value="">Choose a term…</option>
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.is_current ? ' (current)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-neutral-700">Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Broken window, Block C"
              className="mt-1 w-full border border-neutral-300 rounded-lg px-3 py-2.5 text-base"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-neutral-700">Amount per student (₦)</label>
            <input
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="mt-1 w-full border border-neutral-300 rounded-lg px-3 py-2.5 text-base"
            />
          </div>
        </section>

        <section className="bg-white rounded-xl border border-black/5 p-4 space-y-4">
          <label className="text-sm font-medium text-neutral-700">Who is this for?</label>
          <div className="grid grid-cols-2 gap-2">
            {['individual', 'form_class', 'year_group', 'all'].map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  setTargetType(opt);
                  setTargetValue(opt === 'all' ? 'all' : '');
                }}
                className={`rounded-lg border px-3 py-2.5 text-sm font-medium text-center ${
                  targetType === opt
                    ? 'bg-[#B23A2E] text-white border-[#B23A2E]'
                    : 'border-neutral-300 text-neutral-700'
                }`}
              >
                {TARGET_LABELS[opt]}
              </button>
            ))}
          </div>

          {targetType === 'individual' && (
            <div className="relative">
              <input
                value={studentQuery}
                onChange={(e) => {
                  setStudentQuery(e.target.value);
                  setTargetValue('');
                }}
                placeholder="Search student by name…"
                className="w-full border border-neutral-300 rounded-lg px-3 py-2.5 text-base"
              />
              {studentResults.length > 0 && (
                <ul className="mt-1 border border-neutral-200 rounded-lg overflow-hidden divide-y divide-neutral-100">
                  {studentResults.map((s) => (
                    <li key={s.student_id}>
                      <button
                        type="button"
                        onClick={() => {
                          setTargetValue(String(s.student_id));
                          setStudentQuery(`${s.first_name} ${s.last_name}`);
                          setStudentResults([]);
                        }}
                        className="w-full text-left px-3 py-2.5 hover:bg-[#EEF3F8] text-sm"
                      >
                        {s.first_name} {s.last_name} <span className="text-neutral-400">· {s.form_class}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {targetValue && studentResults.length === 0 && (
                <p className="text-xs text-neutral-500 mt-1">Selected: {studentQuery}</p>
              )}
            </div>
          )}

          {targetType === 'form_class' && (
            <input
              value={targetValue}
              onChange={(e) => setTargetValue(e.target.value)}
              placeholder="e.g. 10A"
              className="w-full border border-neutral-300 rounded-lg px-3 py-2.5 text-base"
            />
          )}

          {targetType === 'year_group' && (
            <select
              value={targetValue}
              onChange={(e) => setTargetValue(e.target.value)}
              className="w-full border border-neutral-300 rounded-lg px-3 py-2.5 text-base"
            >
              <option value="">Choose a year group…</option>
              {[7, 8, 9, 10, 11, 12].map((y) => (
                <option key={y} value={y}>
                  Year {y}
                </option>
              ))}
            </select>
          )}
        </section>

        <button
          type="button"
          disabled={!canSubmit || status === 'saving'}
          onClick={handleSubmit}
          className="w-full bg-[#B23A2E] text-white rounded-lg py-3 text-base font-medium disabled:opacity-40"
        >
          {status === 'saving' ? 'Applying…' : 'Apply charge'}
        </button>

        {status === 'done' && (
          <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2.5">
            {statusMessage}
          </p>
        )}
        {status === 'error' && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
            {statusMessage}
          </p>
        )}

        <section>
          <h2 className="text-sm font-medium text-neutral-500 mb-2">Recent charges</h2>
          <ul className="space-y-2">
            {recentBatches.map((b, i) => (
              <li
                key={b.id ?? i}
                className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-sm ${
                  i % 2 === 0 ? 'bg-white' : 'bg-[#EEF3F8]'
                } border border-black/5`}
              >
                <div>
                  <p className="font-medium text-neutral-800">{b.description || 'Charge'}</p>
                  <p className="text-neutral-500 text-xs mt-0.5">
                    {TARGET_LABELS[b.target_type]} {b.target_value ? `· ${b.target_value}` : ''} · ₦
                    {Number(b.amount).toLocaleString()}
                    {b.students_charged != null ? ` · ${b.students_charged} students` : ''}
                  </p>
                </div>
                {b.id && (
                  <button onClick={() => handleUndo(b.id)} className="text-xs text-[#B23A2E] font-medium shrink-0 ml-2">
                    Undo
                  </button>
                )}
              </li>
            ))}
            {recentBatches.length === 0 && <p className="text-sm text-neutral-400">No charges applied yet.</p>}
          </ul>
        </section>
      </main>
    </div>
  );
}

export default function FeeChargeBatchPage() {
  return (
    <RequireAuth>
      <FeeChargeBatchInner />
    </RequireAuth>
  );
}
