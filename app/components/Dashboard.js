'use client';
import { useEffect, useState } from 'react';

// The open section lives in the URL hash (#attendance), so the browser's Back
// button returns to the tiles rather than leaving the page, and a link can
// open a profile straight at one section.
export function useHashView() {
  const [view, setView] = useState(null);
  useEffect(() => {
    const read = () => setView(window.location.hash.slice(1) || null);
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  function open(next) {
    if (next) {
      window.location.hash = next;
      window.scrollTo(0, 0);
    } else if (window.location.hash) {
      // Drop the hash in place; hashchange doesn't fire for this, hence setView.
      history.replaceState(null, '', window.location.pathname + window.location.search);
      setView(null);
    }
  }
  return [view, open];
}

// One tile on a dashboard grid. Pass `href` for a tile that goes to another
// page, `onClick` for one that opens a section on this page.
export function DashboardTile({ label, icon, sub, href, onClick }) {
  const body = (
    <>
      <span className="dashboard-tile-label">{label}</span>
      <span className="dashboard-tile-icon" aria-hidden="true">{icon}</span>
      <span className="dashboard-tile-sub">{sub}</span>
    </>
  );
  return href
    ? <a href={href} className="dashboard-tile">{body}</a>
    : <button type="button" className="dashboard-tile" onClick={onClick}>{body}</button>;
}

export function DashboardBack({ onClick, children = 'Back to dashboard' }) {
  return (
    <button type="button" className="dashboard-back-btn no-print" onClick={onClick}>
      &larr; {children}
    </button>
  );
}
