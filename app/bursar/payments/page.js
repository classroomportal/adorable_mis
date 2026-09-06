'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import { useAuth } from '../../../lib/AuthContext';
import { generateInvoicePdfForStudent } from '../../../lib/generateInvoicePdf';

const STATUS_STYLES = {
  paid: 'bg-green-50 text-green-700 border-green-200',
  partial: 'bg-amber-50 text-amber-700 border-amber-200',
  unpaid: 'bg-red-50 text-red-700 border-red-200',
};

function naira(n) {
  return `₦${Number(n || 0).toLocaleString()}`;
}

function RecordPaymentInner() {
  const { session } = useAuth();
  const searchParams = useSearchParams();
  const presetStudentId = searchParams.get('student');

  const [terms, setTerms] = useState([]);
  const [termId, setTermId] = useState('');

  const [studentQuery, setStudentQuery] = useState('');
  const [studentResults, setStudentResults] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);

  const [invoice, setInvoice] = useState(null);
  const [lineItems, setLineItems] = useState([]);
  const [payments, setPayments] = useState([]);

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('transfer');
  const [reference, setReference] = useState('');
  const [paidDate, setPaidDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [status, setStatus] = useState('idle');
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('fee_terms').select('id, name, is_current').order('id', { ascending: false });
      setTerms(data ?? []);
      const current = (data ?? []).find((t) => t.is_current);
      if (current) setTermId(String(current.id));
    })();
  }, []);

  useEffect(() => {
    if (!presetStudentId) return;
    (async () => {
      const { data } = await supabase
        .from('students')
        .select('student_id, first_name, last_name, form_class, year_group')
        .eq('student_id', Number(presetStudentId))
        .maybeSingle();
      if (data) {
        setSelectedStudent(data);
        setStudentQuery(`${data.first_name} ${data.last_name}`);
      }
    })();
  }, [presetStudentId]);


  useEffect(() => {
    if (studentQuery.trim().length < 2) {
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
  }, [studentQuery]);

  async function loadInvoice(studentId, term) {
    if (!studentId || !term) return;
    const { data: inv } = await supabase
      .from('student_invoices')
      .select('id, status')
      .eq('student_id', studentId)
      .eq('term_id', term)
      .maybeSingle();

    if (!inv) {
      setInvoice(null);
      setLineItems([]);
      setPayments([]);
      return;
    }
    setInvoice(inv);

    const [{ data: items }, { data: pays }] = await Promise.all([
      supabase
        .from('invoice_line_items')
        .select('id, description, amount, created_at, fee_items(name)')
        .eq('invoice_id', inv.id)
        .order('created_at'),
      supabase
        .from('fee_payments')
        .select('id, amount, method, reference, paid_date')
        .eq('invoice_id', inv.id)
        .order('paid_date', { ascending: false }),
    ]);
    setLineItems(items ?? []);
    setPayments(pays ?? []);
  }

  useEffect(() => {
    if (selectedStudent && termId) loadInvoice(selectedStudent.student_id, Number(termId));
  }, [selectedStudent, termId]);

  const totalDue = lineItems.reduce((sum, li) => sum + Number(li.amount), 0);
  const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const balance = totalDue - totalPaid;

  async function handleRecordPayment() {
    if (!invoice || !amount) return;
    setStatus('saving');
    setStatusMessage('');

    const { error } = await supabase.from('fee_payments').insert({
      invoice_id: invoice.id,
      amount: Number(amount),
      method,
      reference: reference || null,
      paid_date: paidDate,
      recorded_by: session?.user?.id ?? null,
    });

    if (error) {
      setStatus('error');
      setStatusMessage(error.message);
      return;
    }

    setStatus('done');
    setStatusMessage(`Recorded ${naira(amount)}.`);
    setAmount('');
    setReference('');
    await loadInvoice(selectedStudent.student_id, Number(termId));
  }

  return (
    <div className="min-h-screen bg-[#FAF9F6] pb-24">
      <header className="bg-[#B23A2E] text-white px-5 pt-6 pb-5">
        <p className="text-sm text-white/70">Fees & Bills</p>
        <h1 className="text-xl font-semibold mt-0.5">Record a payment</h1>
        <p className="text-sm text-white/80 mt-1">Find a student, then log what they've paid.</p>
      </header>

      <main className="px-5 mt-5 space-y-5 max-w-lg mx-auto">
        <section className="bg-white rounded-xl border border-black/5 p-4 space-y-4">
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

          <div className="relative">
            <label className="text-sm font-medium text-neutral-700">Student</label>
            <input
              value={studentQuery}
              onChange={(e) => {
                setStudentQuery(e.target.value);
                setSelectedStudent(null);
                setInvoice(null);
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
                      onClick={() => {
                        setSelectedStudent(s);
                        setStudentQuery(`${s.first_name} ${s.last_name}`);
                        setStudentResults([]);
                      }}
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
        </section>

        {selectedStudent && !invoice && (
          <p className="text-sm text-neutral-500 bg-white rounded-xl border border-black/5 p-4">
            No invoice found for this student this term yet — add a charge first.
          </p>
        )}

        {selectedStudent && invoice && (
          <>
            <section className="bg-white rounded-xl border border-black/5 p-4 space-y-2">
              <div className="flex justify-between items-center">
                <h2 className="font-medium text-neutral-800">
                  {selectedStudent.first_name} {selectedStudent.last_name}
                </h2>
                <span className={`text-xs px-2 py-1 rounded-full border font-medium ${STATUS_STYLES[invoice.status] ?? ''}`}>
                  {invoice.status}
                </span>
              </div>

              <button
                type="button"
                onClick={() => generateInvoicePdfForStudent(selectedStudent.student_id, Number(termId))}
                className="text-sm px-3 py-1.5 rounded-lg border border-neutral-300 hover:bg-neutral-50"
              >
                Download PDF
              </button>

              <ul className="divide-y divide-neutral-100 text-sm">
                {lineItems.map((li) => (
                  <li key={li.id} className="flex justify-between py-1.5">
                    <span className="text-neutral-600">{li.description || li.fee_items?.name}</span>
                    <span className="text-neutral-800">{naira(li.amount)}</span>
                  </li>
                ))}
              </ul>

              <div className="pt-2 border-t border-neutral-200 space-y-1 text-sm">
                <div className="flex justify-between text-neutral-500">
                  <span>Total due</span>
                  <span>{naira(totalDue)}</span>
                </div>
                <div className="flex justify-between text-neutral-500">
                  <span>Paid so far</span>
                  <span>{naira(totalPaid)}</span>
                </div>
                <div className="flex justify-between font-medium text-neutral-800">
                  <span>Balance</span>
                  <span>{naira(balance)}</span>
                </div>
              </div>
            </section>

            <section className="bg-white rounded-xl border border-black/5 p-4 space-y-4">
              <h2 className="text-sm font-medium text-neutral-700">Record a payment</h2>

              <div>
                <label className="text-sm font-medium text-neutral-700">Amount (₦)</label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="mt-1 w-full border border-neutral-300 rounded-lg px-3 py-2.5 text-base"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-neutral-700">Method</label>
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  className="mt-1 w-full border border-neutral-300 rounded-lg px-3 py-2.5 text-base"
                >
                  <option value="transfer">Bank transfer</option>
                  <option value="bankers_draft">Bankers draft</option>
                  <option value="zenith_app">Zenith bills & collection app</option>
                  <option value="cash">Cash</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label className="text-sm font-medium text-neutral-700">Reference</label>
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Transaction ref / receipt no."
                  className="mt-1 w-full border border-neutral-300 rounded-lg px-3 py-2.5 text-base"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-neutral-700">Date paid</label>
                <input
                  type="date"
                  value={paidDate}
                  onChange={(e) => setPaidDate(e.target.value)}
                  className="mt-1 w-full border border-neutral-300 rounded-lg px-3 py-2.5 text-base"
                />
              </div>

              <button
                type="button"
                disabled={!amount || status === 'saving'}
                onClick={handleRecordPayment}
                className="w-full bg-[#B23A2E] text-white rounded-lg py-3 text-base font-medium disabled:opacity-40"
              >
                {status === 'saving' ? 'Recording…' : 'Record payment'}
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
            </section>

            <section>
              <h2 className="text-sm font-medium text-neutral-500 mb-2">Payment history</h2>
              <ul className="space-y-2">
                {payments.map((p, i) => (
                  <li
                    key={p.id}
                    className={`rounded-lg px-3 py-2.5 text-sm border border-black/5 ${i % 2 === 0 ? 'bg-white' : 'bg-[#EEF3F8]'}`}
                  >
                    <div className="flex justify-between">
                      <span className="font-medium text-neutral-800">{naira(p.amount)}</span>
                      <span className="text-neutral-500">{p.paid_date}</span>
                    </div>
                    <p className="text-neutral-500 text-xs mt-0.5">
                      {p.method}
                      {p.reference ? ` · ${p.reference}` : ''}
                    </p>
                  </li>
                ))}
                {payments.length === 0 && <p className="text-sm text-neutral-400">No payments recorded yet.</p>}
              </ul>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

export default function RecordPaymentPage() {
  return (
    <RequireAuth>
      <Suspense fallback={<p className="p-5 text-sm text-neutral-500">Loading…</p>}>
        <RecordPaymentInner />
      </Suspense>
    </RequireAuth>
  );
}
