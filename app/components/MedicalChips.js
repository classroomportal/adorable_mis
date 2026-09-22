'use client';

// The two presentational atoms the medical screens share: a coloured pill
// and a headline number. Both are used by the per-student card and by the
// Clinic pages, so they live outside either one.

export const TONE_STYLE = {
  good: { background: '#dcf5e3', color: '#1a7a3d' },
  warn: { background: '#fdecad', color: '#7a5a10' },
  bad: { background: '#fbdede', color: '#a3232c' },
  neutral: { background: 'var(--slate-100)', color: 'var(--ink-soft)' },
};

export function Chip({ children, tone = 'neutral', title }) {
  return (
    <span className="badge" style={{ ...TONE_STYLE[tone], marginRight: '0.4rem' }} title={title}>
      {children}
    </span>
  );
}

export function Stat({ label, value, sub }) {
  return (
    <div style={{ background: 'var(--slate-50)', border: '1px solid var(--slate-200)', borderRadius: 10, padding: '0.6rem 0.85rem', minWidth: '7.5rem' }}>
      <div style={{ fontSize: '0.7rem', color: 'var(--ink-soft)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>{value}</div>
      {sub && <div style={{ fontSize: '0.7rem', color: 'var(--ink-soft)' }}>{sub}</div>}
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <label style={{ display: 'block', marginBottom: '0.6rem' }}>
      <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--ink-soft)', fontWeight: 600 }}>{label}</span>
      {children}
    </label>
  );
}
