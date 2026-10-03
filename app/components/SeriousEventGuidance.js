'use client';

// What is and isn't a Stage 5 (migration 335, the principal, 3 Oct 2026):
// some staff were logging serious events for minor offences. The text is
// behaviour_rules.serious_event_guidance, edited at /admin/lookups. Lines
// starting "•" or "-" are shown as a list, and a line ending ":" as a heading.
export function GuidanceText({ text }) {
  if (!text) return null;
  const blocks = [];
  let list = null;
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    const item = line.match(/^[•\-*]\s*(.*)$/);
    if (item) {
      if (!list) { list = []; blocks.push({ key: i, list }); }
      list.push(item[1]);
      return;
    }
    list = null;
    if (line) blocks.push({ key: i, line, heading: line.endsWith(':') });
  });
  return (
    <div className="bl-guidance">
      {blocks.map((b) => (b.list ? (
        <ul key={b.key}>{b.list.map((t, j) => <li key={j}>{t}</li>)}</ul>
      ) : b.heading ? (
        <strong key={b.key} className="bl-guidance-heading">{b.line}</strong>
      ) : (
        <p key={b.key}>{b.line}</p>
      )))}
    </div>
  );
}

// The confirmation tick asked for before a serious event is saved. It is a
// prompt on the page only; the database still decides what can be saved.
export function SeriousConfirmTick({ checked, onChange }) {
  return (
    <label className="bl-confirm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        I confirm this is a single serious incident, as described in the guidance, and not
        low-level or repeated minor behaviour.
      </span>
    </label>
  );
}
