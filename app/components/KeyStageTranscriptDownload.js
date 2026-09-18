'use client';
import { useState } from 'react';
import { generateKeyStageTranscript, KEY_STAGE_GROUP_OPTIONS } from '../../lib/generateKeyStageTranscript';

export default function KeyStageTranscriptDownload({ studentId }) {
  const [busyGroup, setBusyGroup] = useState(null);

  async function handleDownload(group) {
    setBusyGroup(group);
    try {
      await generateKeyStageTranscript(studentId, group);
    } finally {
      setBusyGroup(null);
    }
  }

  return (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', margin: '0.5rem 0' }}>
      {KEY_STAGE_GROUP_OPTIONS.map((opt) => (
        <button key={opt.value} className="secondary" onClick={() => handleDownload(opt.value)} disabled={!!busyGroup || !studentId}>
          {busyGroup === opt.value ? 'Generating...' : `📄 Download ${opt.label}`}
        </button>
      ))}
    </div>
  );
}
