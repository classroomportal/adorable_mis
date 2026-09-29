'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { formatUKDate } from '../../../lib/formatDate';
import { schoolToday, SCHOOL_TIMEZONE } from '../../../lib/schoolTime';
import {
  STATUS_LABELS, statusBadgeStyle, formatMoney, loadAcademicYears, errorText,
} from '../../../lib/admissions';

// Admission form fees and deposits, for the bursar (migration 256).
//
// The bursar can't read the applicants table (it holds children's test
// results and interview notes); admission_fee_list() returns only what fees
// need. Payments are recorded through record_admission_form_fee() and
// record_admission_deposit(), which check the caller is the bursar and move
// the applicant on (enquiry -> form paid, accepted -> deposit paid). The
// amounts for an entry year change only when the principal and the college
// secretary have both approved (migration 259): this page proposes them
// through propose_admission_fees(), approved at /bursar/fee-approvals.

function AdmissionFormsInner() {
  const [years, setYears] = useState([]);
  const [yearId, setYearId] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [amounts, setAmounts] = useState({ form: '', deposit: '', reason: '' });
  const [amountStatus, setAmountStatus] = useState(null);
  const [forms, setForms] = useState({}); // `${kind}-${applicant_id}` -> { date, receipt, amount }
  const [rowStatus, setRowStatus] = useState({});

  async function loadYears(keepId) {
    const { years: ys, defaultYearId } = await loadAcademicYears();
    setYears(ys);
    const id = keepId ?? defaultYearId;
    setYearId(id);
    const y = ys.find((x) => x.academic_year_id === id);
    setAmounts({
      form: y?.admission_form_fee != null ? String(Number(y.admission_form_fee)) : '',
      deposit: y?.admission_deposit != null ? String(Number(y.admission_deposit)) : '',
      reason: '',
    });
    if (!id) setLoading(false);
  }

  useEffect(() => { loadYears(); }, []);

  async function loadRows(id) {
    setLoading(true);
    const { data, error } = await supabase.rpc('admission_fee_list', { p_academic_year_id: id });
    if (error) {
      setLoadError(errorText(error));
      setLoading(false);
      return;
    }
    setLoadError(null);
    setRows(data || []);
    setLoading(false);
  }

  useEffect(() => { if (yearId) loadRows(yearId); }, [yearId]);

  function chooseYear(id) {
    const y = years.find((x) => x.academic_year_id === id);
    setAmounts({
      form: y?.admission_form_fee != null ? String(Number(y.admission_form_fee)) : '',
      deposit: y?.admission_deposit != null ? String(Number(y.admission_deposit)) : '',
      reason: '',
    });
    setAmountStatus(null);
    setForms({});
    setRowStatus({});
    setYearId(id);
  }

  const year = years.find((y) => y.academic_year_id === yearId);

  async function saveAmounts(ev) {
    ev.preventDefault();
    // Blank means "not set" (the form price may not be decided yet).
    const form = amounts.form.trim() === '' ? null : Number(amounts.form);
    const deposit = amounts.deposit.trim() === '' ? null : Number(amounts.deposit);
    if ((form != null && !Number.isFinite(form)) || (deposit != null && !Number.isFinite(deposit))) {
      setAmountStatus({ error: true, text: 'Amounts must be numbers.' });
      return;
    }
    setAmountStatus({ text: 'Sending...' });
    const { error } = await supabase.rpc('propose_admission_fees', {
      p_academic_year_id: yearId, p_form_fee: form, p_deposit: deposit, p_reason: amounts.reason,
    });
    if (error) {
      setAmountStatus({ error: true, text: `Not sent: ${errorText(error)}` });
      return;
    }
    await loadYears(yearId);
    setAmountStatus({ text: 'Sent for approval. The amounts change once the principal and the college secretary have both approved.' });
  }

  function formFor(kind, id) {
    return forms[`${kind}-${id}`] || {
      date: schoolToday(),
      receipt: '',
      amount: year?.admission_deposit != null ? String(Number(year.admission_deposit)) : '',
    };
  }

  function editForm(kind, id, field, value) {
    const k = `${kind}-${id}`;
    setForms((prev) => ({ ...prev, [k]: { ...formFor(kind, id), [field]: value } }));
    setRowStatus((prev) => ({ ...prev, [k]: null }));
  }

  async function record(kind, r) {
    const k = `${kind}-${r.applicant_id}`;
    const f = formFor(kind, r.applicant_id);
    let result;
    if (kind === 'form') {
      result = await supabase.rpc('record_admission_form_fee', {
        p_applicant_id: r.applicant_id, p_paid_on: f.date || null, p_receipt: f.receipt,
      });
    } else {
      const amount = Number(f.amount);
      if (f.amount === '' || !Number.isFinite(amount)) {
        setRowStatus((prev) => ({ ...prev, [k]: { error: true, text: 'Give the amount paid.' } }));
        return;
      }
      result = await supabase.rpc('record_admission_deposit', {
        p_applicant_id: r.applicant_id, p_paid_on: f.date || null, p_amount: amount, p_receipt: f.receipt,
      });
    }
    if (result.error) {
      setRowStatus((prev) => ({ ...prev, [k]: { error: true, text: errorText(result.error) } }));
      return;
    }
    setForms((prev) => { const n = { ...prev }; delete n[k]; return n; });
    await loadRows(yearId);
  }

  function statusBadge(status) {
    return <span className="badge" style={statusBadgeStyle(status)}>{STATUS_LABELS[status] || status}</span>;
  }

  function contact(r) {
    return (
      <>
        {r.contact_name || <span style={{ color: '#999' }}>No contact</span>}
        {r.contact_phone && <div style={{ fontSize: '0.85em' }}>{r.contact_phone}</div>}
        {r.contact_email && <div style={{ fontSize: '0.85em', color: '#555' }}>{r.contact_email}</div>}
      </>
    );
  }

  function paymentForm(kind, r) {
    const k = `${kind}-${r.applicant_id}`;
    const f = formFor(kind, r.applicant_id);
    const st = rowStatus[k];
    const small = { padding: '0.3rem 0.45rem', fontSize: '0.9rem' };
    return (
      <div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}>
          <input type="date" style={{ ...small, width: '9.5rem' }} value={f.date} max={schoolToday()}
            aria-label="Date paid" onChange={(ev) => editForm(kind, r.applicant_id, 'date', ev.target.value)} />
          {kind === 'deposit' && (
            <input type="number" min="0" step="0.01" style={{ ...small, width: '8rem' }} value={f.amount}
              aria-label="Amount paid" placeholder="Amount" onChange={(ev) => editForm(kind, r.applicant_id, 'amount', ev.target.value)} />
          )}
          <input style={{ ...small, width: '8rem' }} value={f.receipt} placeholder="Receipt no."
            aria-label="Receipt number" onChange={(ev) => editForm(kind, r.applicant_id, 'receipt', ev.target.value)} />
          <button style={small} onClick={() => record(kind, r)}>Record payment</button>
        </div>
        {f.date && <div style={{ fontSize: '0.8em', color: '#666' }}>{formatUKDate(f.date, { weekday: true })}</div>}
        {st && <div style={{ fontSize: '0.85em', color: st.error ? '#a3232c' : undefined }}>{st.text}</div>}
      </div>
    );
  }

  function paidCell(date, amount, receipt) {
    return (
      <>
        <strong>{formatMoney(amount)}</strong> on {formatUKDate(date)}
        {receipt && <div style={{ fontSize: '0.85em', color: '#555' }}>Receipt {receipt}</div>}
      </>
    );
  }

  // A deposit already paid stays listed (greyed) if the family later withdraws.
  const deposits = rows.filter((r) => ['accepted', 'deposit_paid'].includes(r.status) || r.deposit_paid_on);
  const formsTotal = rows.reduce((sum, r) => sum + (r.form_fee_paid_on ? Number(r.form_fee_amount || 0) : 0), 0);
  const formsPaid = rows.filter((r) => r.form_fee_paid_on).length;
  const depositsTotal = deposits.reduce((sum, r) => sum + (r.deposit_paid_on ? Number(r.deposit_amount || 0) : 0), 0);
  const depositsPaid = deposits.filter((r) => r.deposit_paid_on).length;

  return (
    <div>
      <h1>Admission Payments</h1>
      <p>
        Admission form fees and deposits for children applying to the school. Recording the form fee lets
        admissions book the child&apos;s test; recording the deposit confirms an accepted place.
      </p>

      <div className="card">
        <label style={{ maxWidth: '14rem' }}>
          Entry year
          <select value={yearId ?? ''} onChange={(ev) => chooseYear(Number(ev.target.value))}>
            {years.map((y) => (
              <option key={y.academic_year_id} value={y.academic_year_id}>
                {y.label}{y.status === 'planning' ? ' (next year)' : y.status === 'current' ? ' (this year)' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      {year && (
        <form onSubmit={saveAmounts}>
          <div style={{ flexBasis: '100%' }}>
            <h2 style={{ margin: 0 }}>Amounts for {year.label} entry</h2>
            <p style={{ margin: '0.25rem 0 0', color: '#666', fontSize: '0.9em' }}>
              Currently: form fee {year.admission_form_fee != null ? formatMoney(year.admission_form_fee) : 'not set'},
              deposit {year.admission_deposit != null ? formatMoney(year.admission_deposit) : 'not set'}.
              These also appear in the letters sent to families. A change takes effect only once the
              principal and the college secretary have both approved it at <a href="/bursar/fee-approvals">Fee Approvals</a>.
            </p>
          </div>
          <label style={{ flex: '0 1 12rem' }}>
            Admission form fee (₦)
            <input type="number" min="0" step="0.01" value={amounts.form} onChange={(ev) => { setAmounts({ ...amounts, form: ev.target.value }); setAmountStatus(null); }} />
          </label>
          <label style={{ flex: '0 1 12rem' }}>
            Deposit (₦)
            <input type="number" min="0" step="0.01" value={amounts.deposit} onChange={(ev) => { setAmounts({ ...amounts, deposit: ev.target.value }); setAmountStatus(null); }} />
          </label>
          <label style={{ flex: '1 1 14rem' }}>
            Reason
            <input value={amounts.reason} onChange={(ev) => setAmounts({ ...amounts, reason: ev.target.value })} placeholder="e.g. agreed at SMT, 30 Sept" />
          </label>
          <button type="submit">Propose for approval</button>
          {amountStatus && <span style={{ alignSelf: 'center', color: amountStatus.error ? '#a3232c' : undefined }}>{amountStatus.text}</span>}
        </form>
      )}

      {loading ? <p>Loading...</p> : loadError ? <p style={{ color: '#a3232c' }}>Could not load: {loadError}</p> : (
        <>
          <h2>Admission forms</h2>
          {year && year.admission_form_fee == null && (
            <p style={{ color: '#a3232c' }}>Set the admission form fee above before recording form payments.</p>
          )}
          {!rows.length ? <p>No applications for {year?.label} entry yet.</p> : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Child</th>
                    <th>Year</th>
                    <th>Contact</th>
                    <th>Status</th>
                    <th>Form fee</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const withdrawn = r.status === 'withdrawn';
                    return (
                      <tr key={r.applicant_id} style={withdrawn ? { opacity: 0.5 } : undefined}>
                        <td>{r.child_name}</td>
                        <td>Year {r.entry_year_group}</td>
                        <td>{contact(r)}</td>
                        <td>{statusBadge(r.status)}</td>
                        <td>
                          {r.form_fee_paid_on
                            ? paidCell(r.form_fee_paid_on, r.form_fee_amount, r.form_fee_receipt)
                            : withdrawn ? <span style={{ color: '#666' }}>Not paid (withdrawn)</span>
                              : paymentForm('form', r)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4}><strong>Total received</strong> ({formsPaid} of {rows.length} paid)</td>
                    <td><strong>{formatMoney(formsTotal)}</strong></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <h2 style={{ marginTop: '2rem' }}>Deposits</h2>
          <p style={{ color: '#666', marginTop: 0 }}>Families who have accepted an offer of a place.</p>
          {!deposits.length ? <p>Nobody has accepted a place for {year?.label} entry yet.</p> : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Child</th>
                    <th>Year</th>
                    <th>Contact</th>
                    <th>Accepted</th>
                    <th>Deposit</th>
                  </tr>
                </thead>
                <tbody>
                  {deposits.map((r) => (
                    <tr key={r.applicant_id} style={r.status === 'withdrawn' ? { opacity: 0.5 } : undefined}>
                      <td>{r.child_name}</td>
                      <td>Year {r.entry_year_group}</td>
                      <td>{contact(r)}</td>
                      <td>
                        {statusBadge(r.status)}
                        {r.accepted_at && (
                          <div style={{ fontSize: '0.85em', color: '#555' }}>
                            {formatUKDate(new Date(r.accepted_at).toLocaleDateString('en-CA', { timeZone: SCHOOL_TIMEZONE }))}
                          </div>
                        )}
                      </td>
                      <td>
                        {r.deposit_paid_on
                          ? paidCell(r.deposit_paid_on, r.deposit_amount, r.deposit_receipt)
                          : r.status === 'accepted' ? paymentForm('deposit', r) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4}><strong>Total received</strong> ({depositsPaid} of {deposits.length} paid)</td>
                    <td><strong>{formatMoney(depositsTotal)}</strong></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function AdmissionFormsPage() {
  return (
    <RequireAuth>
      <RequireResource resourceKey="/bursar/admission-forms">
        <AdmissionFormsInner />
      </RequireResource>
    </RequireAuth>
  );
}
