'use client';
// The "?" Help button in the top bar, for staff only. It opens a side panel with
// the User Manual sections for the page being viewed (lib/helpTopics.js), a link
// to the "How each person uses Formwork" section for the person's role, and a
// search over the whole manual.
//
// The help is public/help/help.json, built from docs/USER_MANUAL.md by
// scripts/build-help.js before every build. Its HTML is produced by that script
// from the repo's own manual with all text escaped, which is why it is safe to
// render with dangerouslySetInnerHTML. It holds nothing about real people.
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '../../lib/AuthContext';
import { sectionsFor, roleSectionFor } from '../../lib/helpTopics';

let helpCache = null;
async function loadHelp() {
  if (!helpCache) {
    helpCache = fetch('/help/help.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .catch((e) => { helpCache = null; throw e; });
  }
  return helpCache;
}

function searchSections(sections, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return sections
    .map((s) => {
      const title = s.title.toLowerCase();
      const text = s.text.toLowerCase();
      if (!words.every((w) => title.includes(w) || text.includes(w))) return null;
      const score = words.reduce((n, w) => n + (title.includes(w) ? 10 : 0) + (text.split(w).length - 1), 0);
      return { s, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((x) => x.s);
}

export default function HelpButton() {
  const { session, profile, staffRoles } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [viewing, setViewing] = useState(null); // a section opened from a link or search
  const bodyRef = useRef(null);

  const isStaff = !!session && !!profile && profile.role !== 'student' && profile.role !== 'parent';

  useEffect(() => {
    if (!open || help) return;
    loadHelp().then(setHelp).catch(() => setError('The help could not be loaded. Try again in a moment.'));
  }, [open, help]);

  // A new page starts on its own help.
  useEffect(() => { setViewing(null); setQuery(''); }, [pathname]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [viewing, query]);

  const sections = help?.sections || [];
  const byId = useMemo(() => Object.fromEntries(sections.map((s) => [s.id, s])), [sections]);
  const pageSections = useMemo(() => sectionsFor(pathname, sections), [pathname, sections]);
  const roleSection = useMemo(
    () => roleSectionFor(staffRoles, profile?.role === 'admin', sections),
    [staffRoles, profile, sections]
  );
  const results = useMemo(() => searchSections(sections, query), [sections, query]);

  if (!isStaff) return null;

  function openSection(id) {
    if (byId[id]) { setViewing(id); setQuery(''); }
  }

  // In-manual links (<a data-help-section="…">) open that section in the panel.
  function onBodyClick(e) {
    const a = e.target.closest('a[data-help-section]');
    if (!a) return;
    e.preventDefault();
    openSection(a.getAttribute('data-help-section'));
  }

  function renderSection(s, expanded) {
    return (
      <details key={s.id} className="help-section" open={expanded}>
        <summary>
          <span>
            {s.parentTitle && <span className="help-parent">{s.parentTitle}</span>}
            {s.title}
          </span>
        </summary>
        <div className="help-html" dangerouslySetInnerHTML={{ __html: s.html }} />
      </details>
    );
  }

  let content;
  if (error) content = <p className="help-note">{error}</p>;
  else if (!help) content = <p className="help-note">Loading help…</p>;
  else if (query.trim()) {
    content = results.length ? (
      <>
        <p className="help-note">{results.length === 20 ? 'Top 20 matches' : `${results.length} match${results.length === 1 ? '' : 'es'}`}</p>
        <ul className="help-results">
          {results.map((s) => (
            <li key={s.id}>
              <a href="#" onClick={(e) => { e.preventDefault(); openSection(s.id); }}>
                {s.parentTitle && <span className="help-parent">{s.parentTitle}</span>}
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </>
    ) : <p className="help-note">Nothing in the manual matches “{query.trim()}”.</p>;
  } else if (viewing && byId[viewing]) {
    content = (
      <>
        <button type="button" className="help-back" onClick={() => setViewing(null)}>← Help for this page</button>
        {renderSection(byId[viewing], true)}
      </>
    );
  } else {
    content = (
      <>
        <h3 className="help-heading">On this page</h3>
        {pageSections.map((s, i) => renderSection(s, i === 0))}
        {roleSection && (
          <>
            <h3 className="help-heading">For your role</h3>
            <p>
              <a href="#" onClick={(e) => { e.preventDefault(); openSection(roleSection.id); }}>
                {roleSection.title}: your day, week and term in Formwork
              </a>
            </p>
          </>
        )}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        className="help-button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="help-panel"
        title="Help for this page"
      >
        <span aria-hidden="true">?</span> Help
      </button>
      {open && (
        <>
          <div className="help-backdrop" onClick={() => setOpen(false)} />
          <aside id="help-panel" className="help-panel" role="dialog" aria-label="Help">
            <div className="help-top">
              <strong>Help</strong>
              <button type="button" className="help-close" onClick={() => setOpen(false)} aria-label="Close help">×</button>
            </div>
            <input
              type="search"
              className="help-search"
              placeholder="Search the manual…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            <div className="help-body" ref={bodyRef} onClick={onBodyClick}>
              {content}
            </div>
            <p className="help-foot">From the Formwork User Manual. Screenshots use invented students.</p>
          </aside>
        </>
      )}
    </>
  );
}
