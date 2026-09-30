'use client';
import { useEffect, useState } from 'react';
import {
  loadAttachments, openAttachment, fileSizeLabel, homeworkFileProblem, isHttpsLink, HOMEWORK_FILE_ACCEPT,
} from '../../lib/homework';

// Files and links on a homework (migration 281).

// Read-only list, for students (in the homework panel) and staff. The
// database only returns attachments of homework the viewer can see.
export function AttachmentList({ homeworkId }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    setItems(null);
    loadAttachments(homeworkId).then((a) => { if (live) setItems(a); });
    return () => { live = false; };
  }, [homeworkId]);
  if (!items || items.length === 0) return null;
  return (
    <div className="hw-attachments">
      <div className="hw-attachments-head">Resources</div>
      <ul>
        {items.map((a) => (
          <li key={a.attachment_id}>
            <button
              type="button" className="hw-attachment"
              onClick={async () => { setError(null); const e = await openAttachment(a); if (e) setError(e.message); }}
            >
              <span aria-hidden="true">{a.kind === 'link' ? '🔗' : '📎'}</span>
              <span className="hw-attachment-title">{a.title}</span>
              {a.kind === 'file' && <span className="hw-attachment-meta">{fileSizeLabel(a.size_bytes)}</span>}
            </button>
          </li>
        ))}
      </ul>
      {error && <p style={{ color: '#a3232c', margin: '0.3rem 0 0' }}>{error}</p>}
    </div>
  );
}

// Editing inside the set / edit homework form. Nothing is saved until the
// form is saved: `value` holds the existing attachments, those to remove, and
// the new files and links to add.
export function AttachmentEditor({ value, onChange, disabled }) {
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [problem, setProblem] = useState(null);
  const { existing = [], removeIds = [], newLinks = [], newFiles = [] } = value;

  function addLink() {
    setProblem(null);
    if (!isHttpsLink(linkUrl)) { setProblem('A link must start with https://'); return; }
    onChange({ ...value, newLinks: [...newLinks, { title: linkTitle.trim(), url: linkUrl.trim() }] });
    setLinkTitle('');
    setLinkUrl('');
  }

  function addFiles(list) {
    setProblem(null);
    const ok = [];
    const problems = [];
    Array.from(list || []).forEach((f) => {
      const p = homeworkFileProblem(f);
      if (p) problems.push(p); else ok.push({ file: f, title: f.name.replace(/\.[^.]+$/, '') });
    });
    if (problems.length) setProblem(problems.join(' '));
    if (ok.length) onChange({ ...value, newFiles: [...newFiles, ...ok] });
  }

  const shown = existing.filter((a) => !removeIds.includes(a.attachment_id));

  return (
    <div className="hw-attach-editor">
      <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginBottom: '0.3rem' }}>Files and links for students</div>
      {(shown.length > 0 || newLinks.length > 0 || newFiles.length > 0) && (
        <ul className="hw-attach-list">
          {shown.map((a) => (
            <li key={`e${a.attachment_id}`}>
              <span aria-hidden="true">{a.kind === 'link' ? '🔗' : '📎'}</span>
              <span className="hw-attachment-title">{a.title}</span>
              {a.kind === 'file' && <span className="hw-attachment-meta">{fileSizeLabel(a.size_bytes)}</span>}
              <button type="button" className="secondary" disabled={disabled}
                onClick={() => onChange({ ...value, removeIds: [...removeIds, a.attachment_id] })}>Remove</button>
            </li>
          ))}
          {newLinks.map((l, i) => (
            <li key={`l${i}`}>
              <span aria-hidden="true">🔗</span>
              <span className="hw-attachment-title">{l.title || l.url}</span>
              <span className="hw-attachment-meta">new</span>
              <button type="button" className="secondary" disabled={disabled}
                onClick={() => onChange({ ...value, newLinks: newLinks.filter((_, j) => j !== i) })}>Remove</button>
            </li>
          ))}
          {newFiles.map((f, i) => (
            <li key={`f${i}`}>
              <span aria-hidden="true">📎</span>
              <input
                value={f.title} maxLength={200} disabled={disabled} aria-label="File title"
                onChange={(e) => onChange({ ...value, newFiles: newFiles.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })}
                style={{ flex: 1, padding: '0.25rem 0.4rem', fontSize: '0.9rem' }}
              />
              <span className="hw-attachment-meta">{fileSizeLabel(f.file.size)} · new</span>
              <button type="button" className="secondary" disabled={disabled}
                onClick={() => onChange({ ...value, newFiles: newFiles.filter((_, j) => j !== i) })}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <label className="secondary hw-file-button" style={disabled ? { opacity: 0.5, pointerEvents: 'none' } : undefined}>
          📎 Add files
          <input
            type="file" multiple accept={HOMEWORK_FILE_ACCEPT} disabled={disabled}
            onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
            style={{ display: 'none' }}
          />
        </label>
        <span style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>PDF, Word, PowerPoint, Excel, images, text · up to 20 MB each</span>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
        <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://… (a video, website or shared document)" disabled={disabled}
          style={{ flex: '2 1 16rem' }} aria-label="Link address" />
        <input value={linkTitle} onChange={(e) => setLinkTitle(e.target.value)} placeholder="Name shown to students (optional)" maxLength={200} disabled={disabled}
          style={{ flex: '1 1 10rem' }} aria-label="Link name" />
        <button type="button" className="secondary" onClick={addLink} disabled={disabled || !linkUrl.trim()}>🔗 Add link</button>
      </div>
      {problem && <p style={{ color: '#a3232c', margin: '0.4rem 0 0' }}>{problem}</p>}
    </div>
  );
}
