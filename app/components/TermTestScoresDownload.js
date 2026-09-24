'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { schoolToday } from '../../lib/schoolTime';
import { generateTermTestScores } from '../../lib/generateTermTestScores';

export default function TermTestScoresDownload({ studentId }) {
  const [terms, setTerms] = useState([]);
  const [termId, setTermId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('terms')
        .select('term_id, term_name, start_date, end_date')
        .order('start_date', { ascending: false });
      setTerms(data || []);

      const today = schoolToday();
      const sorted = [...(data || [])].sort((a, b) => a.start_date.localeCompare(b.start_date));
      const current = sorted.find((t) => t.start_date <= today && t.end_date >= today);
      // If no term's date range actually contains today (a gap between
      // terms, or a term's dates not set up yet), fall back to the most
      // recently *started* term rather than blindly picking the first row
      // of the (newest-first) list — which would jump to the furthest
      // future term instead of a sensible "current-ish" one.
      const started = sorted.filter((t) => t.start_date <= today);
      const fallback = started.length > 0 ? started[started.length - 1] : sorted[0];
      const pick = current || fallback;
      if (pick) setTermId(pick.term_id);
    }
    load();
  }, []);

  async function handleDownload() {
    setBusy(true);
    try {
      await generateTermTestScores(studentId, termId || null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', margin: '0.5rem 0' }}>
      <select value={termId} onChange={(e) => setTermId(Number(e.target.value))}>
        {terms.map((t) => (
          <option key={t.term_id} value={t.term_id}>{t.term_name}</option>
        ))}
        <option value="">All terms</option>
      </select>
      <button onClick={handleDownload} disabled={busy || !studentId}>
        {busy ? 'Generating...' : '📄 Download Report'}
      </button>
    </div>
  );
}
