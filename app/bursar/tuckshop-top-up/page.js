'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { schoolToday } from '../../../lib/schoolTime';
import { formatUKDate } from '../../../lib/formatDate';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';

// Money a family has already paid in for tuckshop. record_tuckshop_top_up()
// (migration 273) adds it to the balance and records the matching payment
// together, so it never shows as an unpaid bill.

function naira(n) {
  return `₦${Number(n || 0).toLocaleString()}`;
}

const inputClass = 'mt-1 w-full border border-neutral-300 rounded-lg px-3 py-2.5 text-base';

function TuckshopTopUpInner() {
  const [studentQuery, setStudentQuery] = useState('');
  const [studentResults, setStudentResults] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [balance, setBalance] = useState(null);
  const [recent, setRecent] = useState([]);

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('transfer');
  const [reference, setReference] = useState('');
  const [paidDate, setPaidDate] = useState(() => schoolToday());

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
    const [{ data: bal }, { data: lines }] = await Promise.all([
      supabase.rpc('get_tuckshop_balance', { p_student_id: studentId }),
      supabase
        .from('invoice_line_items')
        .select('id, description, amount, created_at, student_invoices!inner(student_id)')
        .eq('student_invoices.student_id', studentId)
        .like('description', 'Tuck shop top-up (paid%')
        .order('created_at', { ascending: false })
        .limit(10),
    ]);
    setBalance(bal);
    setRecent(lines ?? []);
  }

  function pickStudent(s) {
    setSelectedStudent(s);
    setStudentQuery(`${s.first_name} ${s.last_name}`);
    setStudentResults([]);
    setBalance(null);
    setRecent([]);
    setError('');
    setDone('');
    loadStudent(s.student_id);
  }

  async function handleSave() {
    if (!selectedStudent || !(Number(amount) > 0)) return;
    const who = `${selectedStudent.first_name} ${selectedStudent.last_name}`;
    if (!window.confirm(`Add ${naira(amount)} to ${who}'s tuckshop balance, paid by ${method.replace('_', ' ')} on ${formatUKDate(paidDate)}?`)) return;

    setSaving(true);
    setError('');
    setDone('');
    const { data, error: err } = await supabase.rpc('record_tuckshop_top_up', {
      p_student_id: selectedStudent.student_id,
      p_amount: Number(amount),
      p_method: method,
      p_reference: reference,
      p_paid_date: paidDate,
    });
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    setDone(`Added ${naira(amount)}. ${who}'s balance is now ${naira(data)}.`);
    setAmount('');
    setReference('');
    loadStudent(selectedStudent.student_id);
  }

  return (
    <div className="min-h-screen bg-[#FAF9F6] pb-24">
      <header className="bg-[#B23A2E] text-white px-5 pt-6 pb-5">
        <p className="text-sm text-white/70">Tuckshop</p>
        <h1 className="text-xl font-semibold mt-0.5">Add a paid top-up</h1>
        <p className="text-sm text-white/80 mt-1">
          For money a family has already paid in for tuckshop. It goes straight onto the student&apos;s
          balance and is recorded as paid, so no bill is left for the parents.
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
              className={inputClass}
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

        {selectedStudent && (
          <section className="bg-white rounded-xl border border-black/5 p-4 space-y-4">
            <div>
              <label className="text-sm font-medium text-neutral-700">Amount paid (₦)</label>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className={inputClass}
              />
            </div>

            <div>
              <label className="text-sm font-medium text-neutral-700">Method</label>
              <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>
                <option value="transfer">Bank transfer</option>
                <option value="bankers_draft">Bankers draft</option>
                <option value="zenith_app">Zenith bills & collection app</option>
                <option value="cash">Cash</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label className="text-sm font-medium text-neutral-700">Reference / receipt no.</label>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="e.g. bank transfer reference"
                className={inputClass}
              />
            </div>

            <div>
              <label className="text-sm font-medium text-neutral-700">Date paid</label>
              <input
                type="date"
                value={paidDate}
                max={schoolToday()}
                onChange={(e) => setPaidDate(e.target.value)}
                className={inputClass}
              />
            </div>

            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !(Number(amount) > 0) || !paidDate}
              className="w-full bg-[#B23A2E] text-white rounded-lg py-3 font-medium disabled:opacity-50"
            >
              {saving ? 'Adding…' : 'Add to tuckshop balance'}
            </button>

            {error && <p className="text-sm text-red-700">{error}</p>}
            {done && <p className="text-sm text-green-700">{done}</p>}
          </section>
        )}

        {selectedStudent && recent.length > 0 && (
          <section className="bg-white rounded-xl border border-black/5 p-4 space-y-2">
            <h2 className="text-sm font-medium text-neutral-700">Paid top-ups already added</h2>
            <ul className="divide-y divide-neutral-100 text-sm">
              {recent.map((li) => (
                <li key={li.id} className="flex justify-between py-1.5 gap-3">
                  <span className="text-neutral-600">
                    {formatUKDate(li.created_at.slice(0, 10))} · {li.description}
                  </span>
                  <span className="text-neutral-800">{naira(li.amount)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
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
