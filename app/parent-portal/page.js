'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';
import { useAuth } from '../../lib/AuthContext';
import TranscriptDownload from '../components/TranscriptDownload';
import { generateInvoicePdfForStudent } from '../../lib/generateInvoicePdf';

function ParentPortalInner() {
  const { profile } = useAuth();
  const [resolvedParentId, setResolvedParentId] = useState(profile?.parent_id || null);
  const [children, setChildren] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [results, setResults] = useState([]);
  const [targets, setTargets] = useState([]);
  const [behaviour, setBehaviour] = useState([]);
  const [feeTerm, setFeeTerm] = useState(null);
  const [feeLineItems, setFeeLineItems] = useState([]);
  const [feePayments, setFeePayments] = useState([]);
  const [tuckshopBalance, setTuckshopBalance] = useState(null);
  const [tuckshopHistory, setTuckshopHistory] = useState([]);

  // A parent login already has profile.parent_id set. A staff member who is
  // also a parent doesn't — fall back to matching their login email against
  // the parents table so the same "My Children" view works for both.
  useEffect(() => {
    async function resolveParent() {
      if (profile?.parent_id) { setResolvedParentId(profile.parent_id); return; }
      if (!profile?.email) return;
      const { data } = await supabase
        .from('parents')
        .select('parent_id')
        .eq('email', profile.email)
        .maybeSingle();
      setResolvedParentId(data?.parent_id || null);
    }
    resolveParent();
  }, [profile]);

  const parentId = resolvedParentId;

  useEffect(() => {
    async function loadChildren() {
      if (!parentId) return;
      const { data } = await supabase
        .from('student_parent')
        .select('students(student_id, first_name, last_name, year_group, form_class)')
        .eq('parent_id', parentId);
      const list = (data || []).map((row) => row.students).filter(Boolean);
      setChildren(list);
      if (list.length > 0) setSelectedId(list[0].student_id);
    }
    loadChildren();
  }, [parentId]);

  useEffect(() => {
    async function loadChildData() {
      if (!selectedId) return;
      const { data: r } = await supabase.from('results').select('*, subjects(subject_name, display_name)').eq('student_id', selectedId).order('week_start_date', { ascending: false });
      setResults(r || []);
      const { data: tg } = await supabase.from('target_grades').select('subject_id, target_grade, subjects(subject_name, display_name)').eq('student_id', selectedId);
      setTargets(tg || []);
      const { data: b } = await supabase.from('behaviour_events').select('*').eq('student_id', selectedId).order('event_date', { ascending: false });
      setBehaviour(b || []);

      const { data: term } = await supabase.from('fee_terms').select('id, name, is_current, published_to_parents').eq('is_current', true).maybeSingle();
      const visibleTerm = term?.published_to_parents ? term : null;
      setFeeTerm(visibleTerm);
      if (visibleTerm) {
        const { data: invoice } = await supabase
          .from('student_invoices')
          .select('id, status')
          .eq('student_id', selectedId)
          .eq('term_id', term.id)
          .maybeSingle();
        if (invoice) {
          const [{ data: items }, { data: pays }] = await Promise.all([
            supabase
              .from('invoice_line_items')
              .select('id, description, amount, fee_items(name)')
              .eq('invoice_id', invoice.id)
              .order('created_at'),
            supabase
              .from('fee_payments')
              .select('id, amount, method, paid_date')
              .eq('invoice_id', invoice.id)
              .order('paid_date', { ascending: false }),
          ]);
          setFeeLineItems((items || []).map((li) => ({ ...li, status: invoice.status })));
          setFeePayments(pays || []);
        } else {
          setFeeLineItems([]);
          setFeePayments([]);
        }
      }

      const { data: bal } = await supabase.rpc('get_tuckshop_balance', { p_student_id: selectedId });
      setTuckshopBalance(bal);
      const { data: hist } = await supabase
        .from('tuckshop_purchases')
        .select('id, purchase_date, total_amount')
        .eq('student_id', selectedId)
        .order('purchase_date', { ascending: false })
        .limit(10);
      setTuckshopHistory(hist || []);
    }
    loadChildData();
  }, [selectedId]);

  if (!parentId) {
    return <p>Your account isn't linked to a parent record yet — contact the school office.</p>;
  }

  return (
    <div>
      <h1>My Children</h1>
      <p><a href="/inbox">📬 Inbox</a></p>

      {children.length > 1 && (
        <div className="card">
          <label>
            Child
            <select value={selectedId} onChange={(e) => setSelectedId(Number(e.target.value))}>
              {children.map((c) => (
                <option key={c.student_id} value={c.student_id}>{c.first_name} {c.last_name}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      {children.length === 0 ? <p>No linked children found.</p> : (
        <>
          <div className="card">
            <TranscriptDownload studentId={selectedId} />
          </div>

          <div className="card">
            <h2>Results vs Target</h2>
            {targets.length === 0 ? <p>No target grades set yet.</p> : (
              <div className="table-scroll"><table>
                <thead><tr><th>Subject</th><th>Target</th><th>Most recent grade</th></tr></thead>
                <tbody>
                  {targets.map((t) => {
                    const latest = results.find((r) => r.subject_id === t.subject_id);
                    return (
                      <tr key={t.subject_id}>
                        <td>{t.subjects?.display_name || t.subjects?.subject_name}</td>
                        <td>{t.target_grade}</td>
                        <td>{latest?.grade ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
            )}
          </div>

          <div className="card">
            <h2>Behaviour</h2>
            {behaviour.length === 0 ? <p>No events logged.</p> : (
              <div className="table-scroll"><table>
                <thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Points</th></tr></thead>
                <tbody>
                  {behaviour.map((b) => (
                    <tr key={b.event_id}>
                      <td>{b.event_date}</td>
                      <td><span className={`badge ${b.type === 'positive' ? 'badge-positive' : 'badge-negative'}`}>{b.type}</span></td>
                      <td>{b.category}</td>
                      <td>{b.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>

          {feeTerm && (() => {
            const totalDue = feeLineItems.reduce((sum, li) => sum + Number(li.amount), 0);
            const totalPaid = feePayments.reduce((sum, p) => sum + Number(p.amount), 0);
            const nowDue = totalDue - totalPaid;
            const status = feeLineItems[0]?.status;
            const paidInFull = status === 'paid';

            return (
              <div className="card">
                <details open={!paidInFull}>
                  <summary style={{ cursor: 'pointer', listStyle: 'none' }}>
                    <h2 style={{ display: 'inline' }}>Fees{feeTerm ? ` — ${feeTerm.name}` : ''}</h2>
                    {status && (
                      <span className={`badge ${status === 'paid' ? 'badge-positive' : 'badge-negative'}`} style={{ marginLeft: '0.6rem' }}>
                        {status}
                      </span>
                    )}
                  </summary>

                  {feeLineItems.length > 0 && (
                    <button
                      type="button"
                      onClick={() => generateInvoicePdfForStudent(selectedId, feeTerm.id)}
                      style={{ marginTop: '0.5rem' }}
                    >
                      Download PDF
                    </button>
                  )}

                  {feeLineItems.length === 0 ? (
                    <p>No invoice available yet for this term.</p>
                  ) : (
                    <>
                      <div className="table-scroll">
                        <table>
                          <thead><tr><th>Item</th><th>Amount</th></tr></thead>
                          <tbody>
                            {feeLineItems.map((li) => (
                              <tr key={li.id}>
                                <td>{li.description || li.fee_items?.name}</td>
                                <td>₦{Number(li.amount).toLocaleString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Total</span>
                          <span>₦{totalDue.toLocaleString()}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Paid</span>
                          <span>₦{totalPaid.toLocaleString()}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                          <span>Now due</span>
                          <span>₦{nowDue.toLocaleString()}</span>
                        </div>
                      </div>

                      {feePayments.length > 0 && (
                        <>
                          <h3 style={{ marginTop: '1rem' }}>Payment history</h3>
                          <div className="table-scroll">
                            <table>
                              <thead><tr><th>Date</th><th>Amount</th><th>Method</th></tr></thead>
                              <tbody>
                                {feePayments.map((p) => (
                                  <tr key={p.id}>
                                    <td>{p.paid_date}</td>
                                    <td>₦{Number(p.amount).toLocaleString()}</td>
                                    <td>{p.method}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </details>
              </div>
            );
          })()}

          {tuckshopHistory.length > 0 && (
            <div className="card">
              <h2>Tuckshop</h2>
              <p>
                Balance:{' '}
                <span style={{ fontWeight: 700, color: (tuckshopBalance ?? 0) < 0 ? '#a3232c' : '#1a7a3d' }}>
                  {tuckshopBalance === null ? '…' : `₦${Number(tuckshopBalance).toLocaleString()}`}
                </span>
              </p>
              <h3>Recent purchases</h3>
              <div className="table-scroll">
                <table>
                  <thead><tr><th>Date</th><th>Amount</th></tr></thead>
                  <tbody>
                    {tuckshopHistory.map((h) => (
                      <tr key={h.id}><td>{h.purchase_date}</td><td>₦{Number(h.total_amount).toLocaleString()}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function ParentPortalPage() {
  return <RequireAuth><ParentPortalInner /></RequireAuth>;
}
