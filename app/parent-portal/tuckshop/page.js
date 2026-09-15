'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import { useAuth } from '../../../lib/AuthContext';

function ParentTuckshopInner() {
  const { profile } = useAuth();
  const [resolvedParentId, setResolvedParentId] = useState(profile?.parent_id || null);
  const [children, setChildren] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [tuckshopBalance, setTuckshopBalance] = useState(null);
  const [tuckshopHistory, setTuckshopHistory] = useState([]);

  // Same parent-resolution fallback as the main parent portal, so this page
  // works the same way whether logged in as a parent or as staff-who-is-also-a-parent.
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
    async function loadTuckshop() {
      if (!selectedId) return;
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
    loadTuckshop();
  }, [selectedId]);

  if (!parentId) {
    return <p>Your account isn't linked to a parent record yet — contact the school office.</p>;
  }

  return (
    <div>
      <h1>Tuckshop</h1>

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

      {children.length === 0 ? (
        <p>No linked children found.</p>
      ) : (
        <div className="card">
          <p>
            Balance:{' '}
            <span style={{ fontWeight: 700, color: (tuckshopBalance ?? 0) < 0 ? '#a3232c' : '#1a7a3d' }}>
              {tuckshopBalance === null ? '…' : `₦${Number(tuckshopBalance).toLocaleString()}`}
            </span>
          </p>
          {tuckshopHistory.length === 0 ? (
            <p>No purchases yet.</p>
          ) : (
            <>
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
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function ParentTuckshopPage() {
  return <RequireAuth><ParentTuckshopInner /></RequireAuth>;
}
