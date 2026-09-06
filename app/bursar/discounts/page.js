'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';

function naira(n) {
  return `₦${Number(n || 0).toLocaleString()}`;
}

function DiscountsInner() {
  const [discountTypes, setDiscountTypes] = useState([]);
  const [terms, setTerms] = useState([]);
  const [termId, setTermId] = useState('');

  const [typeName, setTypeName] = useState('');
  const [calcType, setCalcType] = useState('percentage');
  const [value, setValue] = useState('');
  const [appliesTo, setAppliesTo] = useState('tuition');
  const [addingType, setAddingType] = useState(false);

  const [studentQuery, setStudentQuery] = useState('');
  const [studentResults, setStudentResults] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [assignTypeId, setAssignTypeId] = useState('');
  const [notes, setNotes] = useState('');
  const [assignments, setAssignments] = useState([]);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    loadTypes();
    (async () => {
      const { data } = await supabase.from('fee_terms').select('id, name, is_current').order('id', { ascending: false });
      setTerms(data ?? []);
      const current = (data ?? []).find((t) => t.is_current);
      if (current) setTermId(String(current.id));
    })();
  }, []);

  async function loadTypes() {
    const { data } = await supabase.from('fee_discount_types').select('id, name, calc_type, value, applies_to').order('name');
    setDiscountTypes(data ?? []);
  }

  async function addType(e) {
    e.preventDefault();
    if (!typeName.trim() || !value) return;
    setAddingType(true);
    const { error } = await supabase.from('fee_discount_types').insert({
      name: typeName.trim(),
      calc_type: calcType,
      value: Number(value),
      applies_to: appliesTo,
    });
    if (!error) {
      setTypeName('');
      setValue('');
      await loadTypes();
    }
    setAddingType(false);
  }

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

  async function selectStudent(s) {
    setSelectedStudent(s);
    setStudentQuery(`${s.first_name} ${s.last_name}`);
    setStudentResults([]);
    await loadAssignments(s.student_id);
  }

  async function loadAssignments(studentId) {
    const { data } = await supabase
      .from('student_discounts')
      .select('id, notes, created_at, fee_discount_types(name, calc_type, value)')
      .eq('student_id', studentId)
      .order('created_at', { ascending: false });
    setAssignments(data ?? []);
  }

  async function assignDiscount(e) {
    e.preventDefault();
    if (!selectedStudent || !assignTypeId) return;
    setStatus('Assigning…');
    const { error } = await supabase.from('student_discounts').insert({
      student_id: selectedStudent.student_id,
      discount_type_id: assignTypeId,
      notes: notes || null,
    });
    if (error) {
      setStatus(`Error: ${error.message}`);
    } else {
      setStatus('Assigned. Now apply it to an invoice below.');
      setNotes('');
      await loadAssignments(selectedStudent.student_id);
    }
  }

  async function applyToInvoice(studentDiscountId) {
    setStatus('Applying…');
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.rpc('apply_student_discount', {
      p_student_discount_id: studentDiscountId,
      p_term_id: termId,
      p_created_by: userData?.user?.id,
    });
    setStatus(error ? `Error: ${error.message}` : 'Applied to invoice.');
  }

  return (
    <div>
      <h1>Discounts</h1>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <strong>Discount types</strong>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Name</th><th>Type</th><th>Value</th><th>Applies to</th></tr></thead>
            <tbody>
              {discountTypes.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{t.calc_type}</td>
                  <td>{t.calc_type === 'percentage' ? `${t.value}%` : naira(t.value)}</td>
                  <td>{t.applies_to}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <form onSubmit={addType} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: '0.5rem' }}>
          <label>Name<br /><input value={typeName} onChange={(e) => setTypeName(e.target.value)} placeholder="e.g. 3rd Child Sibling" /></label>
          <label>Type<br />
            <select value={calcType} onChange={(e) => setCalcType(e.target.value)}>
              <option value="percentage">Percentage</option>
              <option value="fixed">Fixed amount</option>
            </select>
          </label>
          <label>Value<br /><input type="number" min="0" value={value} onChange={(e) => setValue(e.target.value)} style={{ width: '7rem' }} /></label>
          <label>Applies to<br /><input value={appliesTo} onChange={(e) => setAppliesTo(e.target.value)} style={{ width: '8rem' }} placeholder="tuition" /></label>
          <button type="submit" disabled={addingType}>Add type</button>
        </form>
      </div>

      <div className="card">
        <strong>Assign a discount to a student</strong>
        <div style={{ position: 'relative', marginTop: '0.5rem' }}>
          <input
            value={studentQuery}
            onChange={(e) => { setStudentQuery(e.target.value); setSelectedStudent(null); }}
            placeholder="Search student name"
            style={{ width: '100%' }}
          />
          {studentResults.length > 0 && (
            <div className="card" style={{ position: 'absolute', zIndex: 10, width: '100%' }}>
              {studentResults.map((s) => (
                <div key={s.student_id} onClick={() => selectStudent(s)} style={{ padding: '0.4rem', cursor: 'pointer' }}>
                  {s.first_name} {s.last_name} — Year {s.year_group} {s.form_class}
                </div>
              ))}
            </div>
          )}
        </div>

        {selectedStudent && (
          <>
            <form onSubmit={assignDiscount} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: '0.75rem' }}>
              <label>Discount type<br />
                <select value={assignTypeId} onChange={(e) => setAssignTypeId(e.target.value)} required>
                  <option value="">-- choose --</option>
                  {discountTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
              <label>Notes<br /><input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
              <button type="submit">Assign</button>
            </form>

            <h3 style={{ marginTop: '1rem' }}>Assigned discounts</h3>
            <div className="table-scroll">
              <table>
                <thead><tr><th>Discount</th><th>Value</th><th>Notes</th><th></th></tr></thead>
                <tbody>
                  {assignments.map((a) => (
                    <tr key={a.id}>
                      <td>{a.fee_discount_types?.name}</td>
                      <td>{a.fee_discount_types?.calc_type === 'percentage' ? `${a.fee_discount_types.value}%` : naira(a.fee_discount_types?.value)}</td>
                      <td>{a.notes}</td>
                      <td>
                        <label>
                          Apply to
                          <select value={termId} onChange={(e) => setTermId(e.target.value)}>
                            {terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        </label>
                        <button onClick={() => applyToInvoice(a.id)}>Apply</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {status && <p>{status}</p>}
          </>
        )}
      </div>
    </div>
  );
}

export default function DiscountsPage() {
  return (
    <RequireAuth>
      <DiscountsInner />
    </RequireAuth>
  );
}
