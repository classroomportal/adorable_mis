'use client';
import { useState } from 'react';
import { money, STATUS_LABEL } from './FinanceShell';

// One requisition, as shown on 7. Requests and 8. Approvals (migration 346):
// its items, prices, totals and the timeline of who did what and when. The
// actions for its current step are passed in as children.

export default function RequisitionCard({ r, requester, children }) {
  const [open, setOpen] = useState(false);
  const items = r.requisition_items || [];
  const events = (r.requisition_events || []).slice().sort((a, b) => a.id - b.id);
  return (
    <div className="card" style={{ marginBottom: '0.75rem', borderLeft: `4px solid ${['rejected', 'cancelled'].includes(r.status) ? '#aaa' : r.status === 'paid' ? '#1a7a3d' : '#c07d1f'}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
        <div>
          <strong>REQ-{String(r.id).padStart(4, '0')}{r.practice ? ' (practice)' : ''}</strong>: {r.reason}
          <div style={{ fontSize: '0.85rem', color: '#555' }}>
            {requester ? `${requester} · ` : ''}{r.cost_centres?.name || 'No cost centre yet'}
            {r.suppliers?.name ? ` · ${r.suppliers.name}` : ''}
            {r.needed_by ? ` · needed by ${new Date(`${r.needed_by}T00:00:00`).toLocaleDateString('en-GB')}` : ''}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span className="badge">{STATUS_LABEL[r.status]}</span>
          {r.total != null && <div style={{ fontSize: '0.85rem' }}>Total {money(r.total)}{Number(r.paid_total) ? ` · paid ${money(r.paid_total)}` : ''}</div>}
        </div>
      </div>
      <table style={{ marginTop: '0.4rem' }}>
        <thead><tr><th>Item</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Unit price</th><th style={{ textAlign: 'right' }}>Received</th></tr></thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id}>
              <td>{it.description}{it.unit ? ` (${it.unit})` : ''}</td>
              <td style={{ textAlign: 'right' }}>{Number(it.quantity)}</td>
              <td style={{ textAlign: 'right' }}>{it.unit_price != null ? money(it.unit_price) : ''}</td>
              <td style={{ textAlign: 'right' }}>{Number(it.quantity_received) || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {children}
      <button type="button" className="secondary" style={{ fontSize: '0.8rem', marginTop: '0.4rem' }} onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide timeline' : `Timeline (${events.length})`}
      </button>
      {open && (
        <ol style={{ fontSize: '0.85rem', marginTop: '0.4rem' }}>
          {events.map((e) => (
            <li key={e.id}>
              <strong>{e.event}</strong> · {e.done_by_name || 'Someone'} · {new Date(e.done_at).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' })}
              {e.note ? `: ${e.note}` : ''}
            </li>
          ))}
        </ol>
      )}
      {r.close_note && <p style={{ fontSize: '0.85rem', color: '#666', margin: '0.3rem 0 0' }}>{r.status === 'rejected' ? 'Rejected' : 'Closed'}: {r.close_note}</p>}
    </div>
  );
}
