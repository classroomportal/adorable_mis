'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { generateTranscript } from '../../lib/generateTranscript';

export default function TranscriptDownload({ studentId }) {
  const [terms, setTerms] = useState([]);
  const [termId, setTermId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('terms')
        .select('term_id, term_name, start_date')
        .order('start_date', { ascending: false });
      setTerms(data || []);
      if (data && data.length > 0) setTermId(data[0].term_id);
    }
    load();
  }, []);

  async function handleDownload() {
    setBusy(true);
    try {
      await generateTranscript(studentId, termId || null);
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
        {busy ? 'Generating...' : '📄 Download Transcript'}
      </button>
    </div>
  );
}
