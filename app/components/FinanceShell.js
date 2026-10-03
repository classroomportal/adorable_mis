'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';
import RequireResource from '../RequireResource';
import { formatMoney } from '../../lib/admissions';

// The frame for the Budget tile's process pages (migration 346): the title,
// a term picker, and the Practice switch. While the budget is being built the
// principal shows the process with practice entries (the principal, 3 Oct
// 2026): they never count in real totals and are cleared in one recorded
// step. The switch is remembered in this browser only; it defaults to
// Practice. Which entries a page shows and writes follows it; the database
// keeps practice and real entries apart whatever the page sends.

export const money = (v) => formatMoney(Number(v || 0));

export const STATUS_LABEL = {
  submitted: 'Waiting to be signed',
  signed: 'Waiting to be costed',
  costed: 'Waiting for approval',
  awaiting_release: 'Waiting for contingency',
  approved: 'Approved: waiting for delivery',
  part_received: 'Part delivered',
  received: 'Delivered: waiting for payment',
  paid: 'Paid',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

function readPractice() {
  try { return window.localStorage.getItem('financePractice') !== 'real'; } catch { return true; }
}

export function usePractice() {
  const [practice, setPracticeState] = useState(true);
  useEffect(() => { setPracticeState(readPractice()); }, []);
  function setPractice(v) {
    setPracticeState(v);
    try { window.localStorage.setItem('financePractice', v ? 'practice' : 'real'); } catch { /* not kept */ }
  }
  return [practice, setPractice];
}

export function useTerms() {
  const [terms, setTerms] = useState([]);
  const [termId, setTermId] = useState('');
  useEffect(() => {
    supabase.from('terms').select('term_id, term_name, start_date').order('start_date').then(({ data }) => {
      const list = data || [];
      setTerms(list);
      const today = new Date().toISOString().slice(0, 10);
      const next = list.find((t) => t.start_date > today) || list[list.length - 1];
      if (next) setTermId(String(next.term_id));
    });
  }, []);
  return [terms, termId, setTermId];
}

export default function FinanceShell({ resourceKey, step, title, intro, children, noTerm }) {
  return (
    <RequireAuth>
      <RequireResource resourceKey={resourceKey}>
        <ShellInner step={step} title={title} intro={intro} noTerm={noTerm}>{children}</ShellInner>
      </RequireResource>
    </RequireAuth>
  );
}

function ShellInner({ step, title, intro, children, noTerm }) {
  const [practice, setPractice] = usePractice();
  const [terms, termId, setTermId] = useTerms();
  return (
    <div>
      <p style={{ margin: 0 }}><a href="/">← Dashboard</a></p>
      <h1>{step ? `${step}. ` : ''}{title}</h1>
      <div style={{
        display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', padding: '0.5rem 0.75rem', borderRadius: 6,
        background: practice ? '#fff1cc' : '#e6f4ea', border: `1px solid ${practice ? '#e0c060' : '#8cc29a'}`,
      }}>
        <strong>{practice ? 'Practice' : 'Real entries'}</strong>
        <label style={{ margin: 0 }}>
          <input type="checkbox" checked={practice} onChange={(e) => setPractice(e.target.checked)} /> Practice
        </label>
        {!noTerm && (
          <label style={{ margin: 0 }}>Term{' '}
            <select value={termId} onChange={(e) => setTermId(e.target.value)}>
              {terms.map((t) => <option key={t.term_id} value={t.term_id}>{t.term_name}</option>)}
            </select>
          </label>
        )}
        <span style={{ fontSize: '0.8rem', color: '#555' }}>
          {practice
            ? 'Practice entries never count in real totals. You can do every step yourself to show the process; they are cleared before go-live.'
            : 'Real entries: every rule applies (two approvals, who may do each step, cash collected).'}
          {' '}Only you can see the Budget while it is being built.
        </span>
      </div>
      {intro && <p style={{ color: '#666', fontSize: '0.9rem' }}>{intro}</p>}
      {(noTerm || termId) && children({ practice, termId: termId ? Number(termId) : null, terms })}
    </div>
  );
}
