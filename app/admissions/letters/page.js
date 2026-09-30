'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { MERGE_FIELDS, errorText } from '../../../lib/admissions';
import { SCHOOL_TIMEZONE } from '../../../lib/schoolTime';

// The school's standard admissions letters (migration 256). Plain text with
// {{merge_fields}}, filled in by render_admission_letter() when a decision
// is posted. A letter with an empty body is skipped: the decision still goes
// through, just without a letter. Every change is logged in Change History.

function formatStamp(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('en-GB', {
    timeZone: SCHOOL_TIMEZONE, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function LettersInner() {
  const [templates, setTemplates] = useState([]);
  const [edits, setEdits] = useState({}); // letter_kind -> { subject, body }
  const [status, setStatus] = useState({}); // letter_kind -> { error, text }
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [active, setActive] = useState(null); // { kind, field } last focused
  const fieldRefs = useRef({});

  async function load() {
    const { data, error } = await supabase
      .from('admission_letter_templates')
      .select('letter_kind, label, sort_order, subject, body, updated_at')
      .order('sort_order');
    if (error) {
      setLoadError(errorText(error));
      setLoading(false);
      return;
    }
    setTemplates(data || []);
    const e = {};
    for (const t of data || []) e[t.letter_kind] = { subject: t.subject ?? '', body: t.body ?? '' };
    setEdits(e);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function edit(kind, field, value) {
    setEdits((prev) => ({ ...prev, [kind]: { ...prev[kind], [field]: value } }));
    setStatus((prev) => ({ ...prev, [kind]: null }));
  }

  function isChanged(t) {
    const e = edits[t.letter_kind];
    return e && (e.subject !== (t.subject ?? '') || e.body !== (t.body ?? ''));
  }

  // Put {{field}} where the cursor is in the subject or body last clicked.
  function insertField(name) {
    if (!active) return;
    const el = fieldRefs.current[`${active.kind}:${active.field}`];
    const current = edits[active.kind]?.[active.field] ?? '';
    const token = `{{${name}}}`;
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const next = current.slice(0, start) + token + current.slice(end);
    edit(active.kind, active.field, next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  async function save(t) {
    const e = edits[t.letter_kind];
    setStatus((prev) => ({ ...prev, [t.letter_kind]: { text: 'Saving...' } }));
    const { error } = await supabase
      .from('admission_letter_templates')
      .update({ subject: e.subject.trim() || null, body: e.body.trim() ? e.body.replace(/\s+$/, '') : null })
      .eq('letter_kind', t.letter_kind);
    if (error) {
      setStatus((prev) => ({ ...prev, [t.letter_kind]: { error: true, text: `Not saved: ${errorText(error)}` } }));
      return;
    }
    await load();
    setStatus((prev) => ({ ...prev, [t.letter_kind]: { text: 'Saved. Letters produced from now on use this.' } }));
  }

  if (loading) return <div><h1>Standard Letters</h1><p>Loading...</p></div>;
  if (loadError) return <div><h1>Standard Letters</h1><p style={{ color: '#a3232c' }}>Could not load: {loadError}</p></div>;

  const activeLabel = active ? templates.find((t) => t.letter_kind === active.kind)?.label : null;

  return (
    <div>
      <h1>Standard Letters</h1>
      <p>
        The letters sent to families at each step of an application. The principal will provide the school&apos;s
        wording; until a letter is set up, a decision at that step goes through without one. Write plain text: a
        blank line starts a new paragraph. Merge fields such as <code>{'{{child_first_name}}'}</code> are filled in for
        each applicant when the letter is produced. Each letter is kept exactly as it was sent, so changing the wording
        here doesn&apos;t change letters already sent.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 32rem', minWidth: 0 }}>
          {templates.map((t) => {
            const e = edits[t.letter_kind];
            const empty = !(t.body ?? '').trim();
            const st = status[t.letter_kind];
            return (
              <div className="card" key={t.letter_kind}>
                <h2 style={{ marginTop: 0, marginBottom: '0.25rem' }}>{t.label}</h2>
                <p style={{ color: '#666', marginTop: 0, fontSize: '0.9em' }}>
                  {empty
                    ? <span className="badge" style={{ background: '#fff1cc', color: '#7a5a00' }}>Not set up yet — decisions at this step go through without a letter</span>
                    : <>Last changed {formatStamp(t.updated_at)}</>}
                </p>
                <label style={{ marginBottom: '0.6rem' }}>
                  Subject (email subject line; the letter&apos;s name is used if blank)
                  <input
                    ref={(el) => { fieldRefs.current[`${t.letter_kind}:subject`] = el; }}
                    value={e.subject}
                    onChange={(ev) => edit(t.letter_kind, 'subject', ev.target.value)}
                    onFocus={() => setActive({ kind: t.letter_kind, field: 'subject' })}
                    placeholder={t.label}
                  />
                </label>
                <label>
                  Letter
                  <textarea
                    ref={(el) => { fieldRefs.current[`${t.letter_kind}:body`] = el; }}
                    value={e.body}
                    onChange={(ev) => edit(t.letter_kind, 'body', ev.target.value)}
                    onFocus={() => setActive({ kind: t.letter_kind, field: 'body' })}
                    rows={Math.max(10, e.body.split('\n').length + 2)}
                    style={{ width: '100%', fontFamily: 'inherit', fontSize: '1rem', lineHeight: 1.5, padding: '0.5rem 0.65rem', border: '1px solid var(--slate-200)', borderRadius: 8 }}
                    placeholder={'Dear {{parent_name}},\n\n...'}
                  />
                </label>
                <p style={{ marginBottom: 0 }}>
                  <button onClick={() => save(t)} disabled={!isChanged(t)}>Save</button>
                  {isChanged(t) && (
                    <button type="button" className="secondary" style={{ marginLeft: '0.5rem' }}
                      onClick={() => setEdits((prev) => ({ ...prev, [t.letter_kind]: { subject: t.subject ?? '', body: t.body ?? '' } }))}>
                      Undo changes
                    </button>
                  )}
                  {st && <span style={{ marginLeft: '0.75rem', color: st.error ? '#a3232c' : undefined }}>{st.text}</span>}
                </p>
              </div>
            );
          })}
        </div>

        <aside className="card" style={{ flex: '0 1 18rem', position: 'sticky', top: '1rem' }}>
          <h2 style={{ marginTop: 0 }}>Merge fields</h2>
          <p style={{ color: '#666', fontSize: '0.9em', marginTop: 0 }}>
            {activeLabel
              ? <>Click a field to put it at the cursor in <strong>{activeLabel}</strong> ({active.field}).</>
              : 'Click in a letter, then click a field to put it at the cursor.'}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {MERGE_FIELDS.map(([name, description]) => (
              <button
                key={name}
                type="button"
                className="secondary"
                disabled={!active}
                onMouseDown={(ev) => ev.preventDefault()}
                onClick={() => insertField(name)}
                style={{ textAlign: 'left', padding: '0.35rem 0.6rem' }}
                title={description}
              >
                <code>{`{{${name}}}`}</code>
                <div style={{ fontSize: '0.8em', color: '#555', fontWeight: 400 }}>{description}</div>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

export default function AdmissionLettersPage() {
  return (
    <RequireAuth>
      <RequireResource resourceKey="/admissions/letters">
        <LettersInner />
      </RequireResource>
    </RequireAuth>
  );
}
