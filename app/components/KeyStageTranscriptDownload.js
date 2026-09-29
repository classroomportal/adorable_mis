'use client';
import { useState } from 'react';
import { generateKeyStageTranscript, KEY_STAGE_GROUP_OPTIONS } from '../../lib/generateKeyStageTranscript';

// yearGroup (optional) hides transcripts for key stages the student hasn't
// reached yet (no KS4/5 transcript for a Year 8). compact drops "Download"
// from the button text, for layouts where a heading already says so.
// allowWord adds a Word (.docx) copy of each transcript beside the PDF, for
// the school office to tidy up before sending; staff pages only.
export default function KeyStageTranscriptDownload({ studentId, yearGroup = null, compact = false, allowWord = false }) {
  const options = KEY_STAGE_GROUP_OPTIONS.filter((o) => !yearGroup || yearGroup >= Math.min(...o.yearGroups));

  const [busy, setBusy] = useState(null); // `${group}-pdf` / `${group}-word`
  const [error, setError] = useState(null);

  async function handleDownload(group, format) {
    setBusy(`${group}-${format}`);
    setError(null);
    try {
      if (format === 'word') {
        const { downloadKeyStageTranscriptWord } = await import('../../lib/wordKeyStageTranscript');
        await downloadKeyStageTranscriptWord(studentId, group);
      } else {
        await generateKeyStageTranscript(studentId, group);
      }
    } catch (e) {
      setError(`Couldn't make the transcript: ${e.message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', margin: '0.5rem 0' }}>
        {options.map((opt) => (
          <span key={opt.value} style={{ display: 'inline-flex', gap: '0.25rem' }}>
            <button className="secondary" onClick={() => handleDownload(opt.value, 'pdf')} disabled={!!busy || !studentId}>
              {busy === `${opt.value}-pdf` ? 'Generating...' : compact ? `📄 ${opt.label}` : `📄 Download ${opt.label}`}
            </button>
            {allowWord && (
              <button
                className="secondary"
                onClick={() => handleDownload(opt.value, 'word')}
                disabled={!!busy || !studentId}
                title={`${opt.label} as a Word document you can edit`}
              >
                {busy === `${opt.value}-word` ? 'Generating...' : 'Word'}
              </button>
            )}
          </span>
        ))}
      </div>
      {error && <p style={{ color: '#a3232c', fontSize: '0.85rem', margin: 0 }}>{error}</p>}
    </>
  );
}
