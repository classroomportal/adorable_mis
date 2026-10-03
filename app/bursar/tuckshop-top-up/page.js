'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../../lib/supabaseClient';
import { formatUKDate } from '../../../lib/formatDate';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';

// Puts a payment the bursar has already recorded (Record a Payment) onto the
// student's tuckshop balance, through add_tuckshop_top_up_from_payment()
// (migration 273). A payment can't be added for more than it was.

function naira(n) {
  return `₦${Number(n || 0).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;
}

const METHODS = {
  transfer: 'Bank transfer',
  bankers_draft: 'Bankers draft',
  zenith_app: 'Zenith app',
  cash: 'Cash',
  other: 'Other',
};

function TuckshopTopUpInner() {
  const [studentQuery, setStudentQuery] = useState('');
  const [studentResults, setStudentResults] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [balance, setBalance] = useState(null);
  const [payments, setPayments] = useState(null);

  const [paymentId, setPaymentId] = useState(null);
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  useEffect(() => {
    if (studentQuery.trim().length < 2 || selectedStudent) {
      setStudentResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      const { data } = await supabase
        .from('students')
        .select('student_id, first_name, last_name, form_class, year_group')
        .eq('status', 'active')
        .or(`first_name.ilike.%${studentQuery}%,last_name.ilike.%${studentQuery}%`)
        .limit(8);
      setStudentResults(data ?? []);
    }, 250);
    return () => clearTimeout(handle);
  }, [studentQuery, selectedStudent]);

  async function loadStudent(studentId) {
    const [{ data: bal }, { data: pays }] = await Promise.all([
      supabase.rpc('get_tuckshop_balance', { p_student_id: studentId }),
      supabase
        .from('fee_payments')
        .select('id, amount, method, reference, paid_date, student_invoices!inner(student_id)')
        .eq('student_invoices.student_id', studentId)
        .order('paid_date', { ascending: false })
        .order('id', { ascending: false }),
    ]);
    const ids = (pays ?? []).map((p) => p.id);
    const used = {};
    if (ids.length) {
      const { data: lines } = await supabase
        .from('invoice_line_items')
        .select('from_payment_id, amount')
        .in('from_payment_id', ids);
      for (const l of lines ?? []) used[l.from_payment_id] = (used[l.from_payment_id] || 0) + Number(l.amount);
    }
    setBalance(bal);
    setPayments((pays ?? []).map((p) => ({ ...p, used: used[p.id] || 0, left: Number(p.amount) - (used[p.id] || 0) })));
  }

  function pickStudent(s) {
    setSelectedStudent(s);
    setStudentQuery(`${s.first_name} ${s.last_name}`);
    setStudentResults([]);
    setBalance(null);
    setPayments(null);
    setPaymentId(null);
    setAmount('');
    setError('');
    setDone('');
    loadStudent(s.student_id);
  }

  function pickPayment(p) {
    setPaymentId(p.id);
    setAmount(String(p.left));
    setError('');
    setDone('');
  }

  const chosen = (payments ?? []).find((p) => p.id === paymentId);

  async function handleSave() {
    if (!chosen || !(Number(amount) > 0)) return;
    const who = `${selectedStudent.first_name} ${selectedStudent.last_name}`;
    if (!window.confirm(`Add ${naira(amount)} to ${who}'s tuckshop balance, from the ${naira(chosen.amount)} payment of ${formatUKDate(chosen.paid_date)}?`)) return;

    setSaving(true);
    setError('');
    setDone('');
    const { data, error: err } = await supabase.rpc('add_tuckshop_top_up_from_payment', {
      p_payment_id: chosen.id,
      p_amount: Number(amount),
    });
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    setDone(`Added ${naira(amount)}. ${who}'s tuckshop balance is now ${naira(data)}.`);
    setPaymentId(null);
    setAmount('');
    loadStudent(selectedStudent.student_id);
  }

  return (
    <div className="min-h-screen bg-[#FAF9F6] pb-24">
      <header className="bg-[#B23A2E] text-white px-5 pt-6 pb-5">
        <p className="text-sm text-white/70">Tuckshop</p>
        <h1 className="text-xl font-semibold mt-0.5">Add a paid top-up</h1>
        <p className="text-sm text-white/80 mt-1">
          Record the money on Record a Payment first, then add it to the student&apos;s tuckshop balance here.
        </p>
      </header>

      <main className="px-5 mt-5 space-y-5 max-w-lg mx-auto">
        <section className="bg-white rounded-xl border border-black/5 p-4 space-y-4">
          <div className="relative">
            <label className="text-sm font-medium text-neutral-700">Student</label>
            <input
              value={studentQuery}
              onChange={(e) => {
                setStudentQuery(e.target.value);
                setSelectedStudent(null);
              }}
              placeholder="Search by name…"
              className="mt-1 w-full border border-neutral-300 rounded-lg px-3 py-2.5 text-base"
            />
            {studentResults.length > 0 && (
              <ul className="mt-1 border border-neutral-200 rounded-lg overflow-hidden divide-y divide-neutral-100">
                {studentResults.map((s) => (
                  <li key={s.student_id}>
                    <button
                      type="button"
                      onClick={() => pickStudent(s)}
                      className="w-full text-left px-3 py-2.5 hover:bg-[#EEF3F8] text-sm"
                    >
                      {s.first_name} {s.last_name}{' '}
                      <span className="text-neutral-400">
                        · {s.form_class} · Year {s.year_group}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {selectedStudent && (
            <p className="text-sm text-neutral-600">
              Tuckshop balance now:{' '}
              <strong className="text-neutral-800">{balance === null ? '…' : naira(balance)}</strong>
            </p>
          )}
        </section>

        {selectedStudent && payments && (
          <section className="bg-white rounded-xl border border-black/5 p-4 space-y-3">
            <h2 className="text-sm font-medium text-neutral-700">Choose the payment</h2>
            {payments.length === 0 ? (
              <p className="text-sm text-neutral-500">
                No payments recorded for this student.{' '}
                <Link href={`/bursar/payments?student=${selectedStudent.student_id}`} className="underline">
                  Record a payment
                </Link>{' '}
                first.
              </p>
            ) : (
              <ul className="divide-y divide-neutral-100 text-sm">
                {payments.map((p) => (
                  <li key={p.id}>
                    <label className={`flex gap-3 py-2 items-start ${p.left > 0 ? 'cursor-pointer' : 'opacity-50'}`}>
                      <input
                        type="radio"
                        name="payment"
                        checked={paymentId === p.id}
                        disabled={p.left <= 0}
                        onChange={() => pickPayment(p)}
                        className="mt-1"
                      />
                      <span className="flex-1">
                        <span className="text-neutral-800">{naira(p.amount)}</span>{' '}
                        <span className="text-neutral-500">
                          · {formatUKDate(p.paid_date)} · {METHODS[p.method] ?? p.method}
                          {p.reference ? ` · ${p.reference}` : ''}
                        </span>
                        {p.used > 0 && (
                          <span className="block text-xs text-neutral-500">
                            {p.left > 0 ? `${naira(p.used)} already added to tuckshop` : 'Already added to tuckshop'}
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {chosen && (
          <section className="bg-white rounded-xl border border-black/5 p-4 space-y-4">
            <div>
              <label className="text-sm font-medium text-neutral-700">Amount for tuckshop (₦)</label>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                max={chosen.left}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1 w-full border border-neutral-300 rounded-lg px-3 py-2.5 text-base"
              />
              <p className="text-xs text-neutral-500 mt-1">
                Up to {naira(chosen.left)}. Lower it if part of this payment was for school fees.
              </p>
            </div>

            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !(Number(amount) > 0) || Number(amount) > chosen.left}
              className="w-full bg-[#B23A2E] text-white rounded-lg py-3 font-medium disabled:opacity-50"
            >
              {saving ? 'Adding…' : 'Add to tuckshop balance'}
            </button>
          </section>
        )}

        {error && <p className="text-sm text-red-700">{error}</p>}
        {done && <p className="text-sm text-green-700">{done}</p>}
      </main>
    </div>
  );
}

export default function TuckshopTopUpPage() {
  return (
    <RequireAuth><RequireResource resourceKey="/bursar/tuckshop-top-up">
      <TuckshopTopUpInner />
    </RequireResource></RequireAuth>
  );
}
