'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { formatUKDate } from '../../lib/formatDate';

export default function PublishedDocuments({ studentId }) {
  const [docs, setDocs] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (!studentId) return;
    supabase
      .from('student_documents')
      .select('id, document_type, title, storage_path, generated_at')
      .eq('student_id', studentId)
      .order('generated_at', { ascending: false })
      .then(({ data }) => setDocs(data || []));
  }, [studentId]);

  async function handleDownload(doc) {
    setBusyId(doc.id);
    setStatus(null);
    const { data, error } = await supabase.storage
      .from('student-documents')
      .createSignedUrl(doc.storage_path, 60);
    setBusyId(null);
    if (error || !data?.signedUrl) {
      setStatus(`Error: ${error?.message || 'Could not create a download link.'}`);
      return;
    }
    window.location.href = data.signedUrl;
  }

  if (!docs.length) return null;

  return (
    <div style={{ margin: '0.5rem 0' }}>
      <h3 style={{ margin: '0 0 0.35rem', fontSize: '0.95rem' }}>Available documents</h3>
      {status && <p style={{ color: 'red', fontSize: '0.85rem' }}>{status}</p>}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {docs.map((d) => (
          <li key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', padding: '0.3rem 0', borderBottom: '1px solid var(--slate-200)' }}>
            <span>{d.title} <span style={{ color: '#888', fontSize: '0.8rem' }}>({formatUKDate(d.generated_at.slice(0, 10))})</span></span>
            <button className="secondary" disabled={busyId === d.id} onClick={() => handleDownload(d)} style={{ fontSize: '0.8rem' }}>
              {busyId === d.id ? 'Preparing...' : 'Download'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
