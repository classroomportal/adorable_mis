'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import { useAuth } from '../../../lib/AuthContext';
import TuckshopPurchases from '../../components/TuckshopPurchases';
import { findMyParentId } from '../../../lib/parentByEmail';

function ParentTuckshopInner() {
  const { profile, session } = useAuth();
  const [resolvedParentId, setResolvedParentId] = useState(profile?.parent_id || null);
  const [children, setChildren] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [tuckshopBalance, setTuckshopBalance] = useState(null);

  // Same parent-resolution fallback as the main parent portal, so this page
  // works the same way whether logged in as a parent or as staff-who-is-also-a-parent.
  useEffect(() => {
    async function resolveParent() {
      if (profile?.parent_id) { setResolvedParentId(profile.parent_id); return; }
      setResolvedParentId(await findMyParentId());
    }
    resolveParent();
  }, [profile, session]);

  const parentId = resolvedParentId;

  useEffect(() => {
    async function loadChildren() {
      if (!parentId) return;
      const { data } = await supabase
        .from('student_parent')
        .select('students(student_id, first_name, last_name, year_group, form_class, status)')
        .eq('parent_id', parentId);
      // Only children still at the school, as on the main parent portal.
      const list = (data || []).map((row) => row.students).filter((s) => s && s.status === 'active');
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
              {tuckshopBalance === null ? '…' : `₦${Number(tuckshopBalance).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`}
            </span>
          </p>
          <TuckshopPurchases studentId={selectedId} />
        </div>
      )}
    </div>
  );
}

export default function ParentTuckshopPage() {
  return <RequireAuth><ParentTuckshopInner /></RequireAuth>;
}
