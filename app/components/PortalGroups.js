'use client';
import { kindLabel } from '../../lib/studentGroups';

// The groups a student is in, as the student and parent portals show them
// (migration 300): only groups marked to be shown, with who runs them. No
// other members and no marks.
export default function PortalGroups({ groups, firstName = null }) {
  if (!groups.length) {
    return <p>{firstName ? `${firstName} isn't in any groups shown here.` : "You aren't in any groups shown here."}</p>;
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '0.75rem' }}>
      {groups.map((g) => (
        <div key={g.group_id} className="card" style={{ margin: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
            <strong>{g.name}</strong>
            <span className="badge">{kindLabel(g.kind)}</span>
          </div>
          {g.description && <p style={{ margin: '0.4rem 0 0', whiteSpace: 'pre-wrap' }}>{g.description}</p>}
          {g.run_by && <p style={{ margin: '0.4rem 0 0', color: 'var(--ink-soft)', fontSize: '0.9rem' }}>Run by {g.run_by}</p>}
        </div>
      ))}
    </div>
  );
}
