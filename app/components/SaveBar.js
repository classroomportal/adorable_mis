'use client';
import { useCallback, useEffect, useState } from 'react';

// The Save button and its message for pages that save a long list at once
// (a register, a mark book, class allocation). The principal, 2 Oct 2026:
// the button sat under the last student, out of sight, and "Saved" appeared
// next to it, so nobody could tell whether a save had worked. The bar sits
// above the list and stays pinned to the top of the screen while scrolling,
// and every finished save also shows a notice just under it:
// green for a few seconds when it saved, red until closed when it didn't.

// Pages keep calling setStatus('Saved 3 marks.') as before. The tone comes
// from the wording unless given: "Saved…" is a success; "Error…", "Can't…",
// "Couldn't…" are failures; anything else (including "Not saved." after
// cancelling a question) is a plain note in the bar.
function toneOf(text) {
  if (/^saved\b/i.test(text)) return 'ok';
  if (/^(error|can't|cannot|couldn't|could not)/i.test(text)) return 'error';
  return 'info';
}

export function useSaveStatus() {
  const [status, setStatusState] = useState(null);
  // `at` makes saving the same thing twice ("Saved 3 marks." again) show the
  // notice again.
  const setStatus = useCallback((text, tone) => {
    setStatusState(text ? { text, tone: tone || toneOf(text), at: Date.now() } : null);
  }, []);
  return [status, setStatus];
}

const TONES = {
  ok: { color: '#166534', background: '#dcfce7', border: '#86efac', icon: '✓' },
  error: { color: '#991b1b', background: '#fee2e2', border: '#fca5a5', icon: '✕' },
  info: { color: 'var(--ink)', background: 'var(--slate-100)', border: 'var(--slate-200)', icon: '' },
};

export default function SaveBar({ status, children }) {
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (!status || status.tone === 'info') return undefined;
    setNotice(status);
    if (status.tone !== 'ok') return undefined;
    const t = setTimeout(() => setNotice((n) => (n === status ? null : n)), 5000);
    return () => clearTimeout(t);
  }, [status]);

  const tone = status ? TONES[status.tone] : null;
  const n = notice ? TONES[notice.tone] : null;

  return (
    <>
      <div
        style={{
          position: 'sticky', top: 0, zIndex: 20,
          display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap',
          background: 'white', padding: '0.6rem 0', marginBottom: '0.5rem',
          borderBottom: '1px solid var(--slate-200)',
        }}
      >
        {children}
        {status && (
          <span role="status" style={{ color: tone.color, fontWeight: status.tone === 'info' ? 400 : 600 }}>
            {tone.icon && `${tone.icon} `}{status.text}
          </span>
        )}
      </div>

      {notice && (
        <div
          role={notice.tone === 'error' ? 'alert' : 'status'}
          style={{
            position: 'fixed', top: '4.5rem', left: '50%', transform: 'translateX(-50%)', zIndex: 1100,
            maxWidth: 'calc(100vw - 2rem)', display: 'flex', alignItems: 'center', gap: '0.75rem',
            padding: '0.75rem 1rem', borderRadius: 10, fontWeight: 600, fontSize: '1rem',
            color: n.color, background: n.background, border: `2px solid ${n.border}`,
            boxShadow: '0 6px 20px rgba(15,23,42,0.18)',
          }}
        >
          <span>{n.icon} {notice.text}</span>
          <button
            type="button"
            className="secondary"
            onClick={() => setNotice(null)}
            aria-label="Close"
            style={{ padding: '0.15rem 0.5rem', width: 'auto' }}
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}
