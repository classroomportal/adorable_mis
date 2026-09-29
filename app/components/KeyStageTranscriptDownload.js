'use client';
import { useState } from 'react';
import { generateKeyStageTranscript, KEY_STAGE_GROUP_OPTIONS } from '../../lib/generateKeyStageTranscript';

// yearGroup (optional) hides transcripts for key stages the student hasn't
// reached yet (no KS4/5 transcript for a Year 8). compact drops "Download"
// from the button text, for layouts where a heading already says so.
export default function KeyStageTranscriptDownload({ studentId, yearGroup = null, compact = false }) {
  const options = KEY_STAGE_GROUP_OPTIONS.filter((o) => !yearGroup || yearGroup >= Math.min(...o.yearGroups));

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
      {options.map((opt) => (
        <button key={opt.value} className="secondary" onClick={() => handleDownload(opt.value)} disabled={!!busyGroup || !studentId}>
          {busyGroup === opt.value ? 'Generating...' : compact ? `📄 ${opt.label}` : `📄 Download ${opt.label}`}
        </button>
      ))}
    </div>
  );
}
