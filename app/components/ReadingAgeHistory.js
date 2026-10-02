'use client';
import { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { formatUKDate } from '../../lib/formatDate';
import {
  SOURCE_LABEL, formatMonths, formatGap, gapBand, formatChange, changeColour, monthsFromParts,
} from '../../lib/readingAge';

// One student's reading ages over time (migration 323): a chart of reading
// age against their age, and every reading with the gap. Used on the
// student's profile and on /reading-ages. School tests can be corrected or
// removed here by whoever has /reading-ages/record (RLS decides; `canRecord`
// only shows the buttons). Interview and NGRT readings are changed where
// they were entered: the applicant's page and the CAT4/NGRT section.

const SOURCE_COLOUR = { interview: '#7a3fa8', school: '#2f6fa8', ngrt: '#b06a00' };

function timeOf(iso) {
  return new Date(`${iso}T00:00:00Z`).getTime();
}

export function ReadingAgeChart({ readings, width = 640, height = 240 }) {
  const pts = (readings || []).filter((r) => r.reading_age_months != null);
  if (pts.length === 0) return null;
  const pad = { l: 44, r: 12, t: 12, b: 28 };
  const ts = pts.map((r) => timeOf(r.tested_on));
  let t0 = Math.min(...ts);
  let t1 = Math.max(...ts);
  if (t1 === t0) { t0 -= 1000 * 3600 * 24 * 90; t1 += 1000 * 3600 * 24 * 90; }
  const ys = pts.flatMap((r) => [r.reading_age_months, r.age_months]).filter((v) => v != null);
  const lo = Math.floor((Math.min(...ys) - 6) / 12) * 12;
  const hi = Math.ceil((Math.max(...ys) + 6) / 12) * 12;
  const x = (t) => pad.l + ((t - t0) * (width - pad.l - pad.r)) / (t1 - t0);
  const y = (v) => height - pad.b - ((v - lo) * (height - pad.t - pad.b)) / (hi - lo);
  const yearStep = hi - lo > 120 ? 24 : 12;
  const gridYears = [];
  for (let v = lo; v <= hi; v += yearStep) gridYears.push(v);
  const startYear = new Date(t0).getUTCFullYear();
  const endYear = new Date(t1).getUTCFullYear();
  const xTicks = [];
  for (let yr = startYear; yr <= endYear + 1; yr += 1) {
    const t = Date.UTC(yr, 0, 1);
    if (t >= t0 && t <= t1) xTicks.push({ t, label: String(yr) });
  }
  const line = (key) => pts.filter((r) => r[key] != null)
    .map((r) => `${x(timeOf(r.tested_on)).toFixed(1)},${y(r[key]).toFixed(1)}`).join(' ');

  return (
    <div style={{ maxWidth: `${width}px` }}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img"
        aria-label="Reading age against age over time">
        {gridYears.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} stroke="#e2e5ea" strokeWidth="1" />
            <text x={pad.l - 6} y={y(v) + 4} fontSize="11" textAnchor="end" fill="#5b6472">{v / 12} y</text>
          </g>
        ))}
        {xTicks.map((tk) => (
          <g key={tk.t}>
            <line x1={x(tk.t)} x2={x(tk.t)} y1={pad.t} y2={height - pad.b} stroke="#eef0f3" strokeWidth="1" />
            <text x={x(tk.t)} y={height - 8} fontSize="11" textAnchor="middle" fill="#5b6472">{tk.label}</text>
          </g>
        ))}
        {/* The gap, drawn as a band between the two lines at each reading. */}
        {pts.filter((r) => r.age_months != null).map((r, i) => (
          <line key={`gap${i}`} x1={x(timeOf(r.tested_on))} x2={x(timeOf(r.tested_on))}
            y1={y(r.age_months)} y2={y(r.reading_age_months)}
            stroke={r.gap_months < 0 ? '#e8a0a4' : '#9fd8b0'} strokeWidth="6" strokeLinecap="round" opacity="0.7" />
        ))}
        <polyline points={line('age_months')} fill="none" stroke="#8a93a0" strokeWidth="1.5" strokeDasharray="5 4" />
        <polyline points={line('reading_age_months')} fill="none" stroke="#2f6fa8" strokeWidth="2.5"
          strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((r, i) => (
          <circle key={i} cx={x(timeOf(r.tested_on))} cy={y(r.reading_age_months)} r="4.5"
            fill={SOURCE_COLOUR[r.source] || '#2f6fa8'} stroke="#fff" strokeWidth="1.5">
            <title>{`${formatUKDate(r.tested_on)}: reading age ${formatMonths(r.reading_age_months)}, gap ${formatGap(r.gap_months)} (${SOURCE_LABEL[r.source] || r.source})`}</title>
          </circle>
        ))}
      </svg>
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.8rem', color: '#5b6472' }}>
        <span><span style={{ color: '#2f6fa8', fontWeight: 700 }}>━</span> Reading age</span>
        <span><span style={{ color: '#8a93a0' }}>╌</span> Actual age</span>
        {Object.entries(SOURCE_LABEL).filter(([k]) => pts.some((r) => r.source === k)).map(([k, label]) => (
          <span key={k}><span style={{ color: SOURCE_COLOUR[k] }}>●</span> {label}</span>
        ))}
      </div>
    </div>
  );
}

export function GapBadge({ gap }) {
  const band = gapBand(gap);
  if (!band) return <span style={{ color: '#888' }}>—</span>;
  return (
    <span className="badge" style={{ ...band.style, whiteSpace: 'nowrap' }} title={band.label}>
      {formatGap(gap)}
    </span>
  );
}

export default function ReadingAgeHistory({ readings, canRecord, onChanged, noDob }) {
  const [editId, setEditId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [msg, setMsg] = useState(null);

  if (!readings || readings.length === 0) {
    return <p>No reading age recorded yet.</p>;
  }

  function startEdit(r) {
    setEditId(r.test_id);
    setMsg(null);
    setDraft({
      tested_on: r.tested_on,
      years: String(Math.floor(r.reading_age_months / 12)),
      months: String(r.reading_age_months % 12),
      test_name: r.test_name,
    });
  }

  async function saveEdit() {
    const months = monthsFromParts(draft.years, draft.months);
    if (months == null) { setMsg('Reading age: whole years from 3 to 20, and months from 0 to 11.'); return; }
    if (!draft.tested_on) { setMsg('Give the date of the test.'); return; }
    const { error } = await supabase.from('reading_age_tests')
      .update({ tested_on: draft.tested_on, reading_age_months: months, test_name: draft.test_name || 'School reading test' })
      .eq('id', editId);
    if (error) { setMsg(`Not saved: ${error.message}`); return; }
    setEditId(null);
    onChanged?.();
  }

  async function remove(r) {
    if (!window.confirm(`Remove the reading age of ${formatMonths(r.reading_age_months)} from ${formatUKDate(r.tested_on)}?`)) return;
    const { error } = await supabase.from('reading_age_tests').delete().eq('id', r.test_id);
    if (error) { setMsg(`Not removed: ${error.message}`); return; }
    onChanged?.();
  }

  return (
    <div>
      {noDob && <p style={{ color: '#a3232c' }}>No date of birth on record, so the gap can&apos;t be worked out.</p>}
      <ReadingAgeChart readings={readings} />
      {msg && <p style={{ color: '#a3232c' }}>{msg}</p>}
      <div className="table-scroll" style={{ marginTop: '0.75rem' }}>
        <table>
          <thead>
            <tr><th>Date</th><th>Test</th><th>Age then</th><th>Reading age</th><th>Gap</th><th>Since last</th>{canRecord && <th></th>}</tr>
          </thead>
          <tbody>
            {readings.map((r, i) => {
              const prev = i > 0 ? readings[i - 1] : null;
              const since = prev && prev.gap_months != null && r.gap_months != null ? r.gap_months - prev.gap_months : null;
              const editing = editId != null && r.test_id === editId;
              return (
                <tr key={`${r.source}-${r.test_id ?? i}-${r.tested_on}`}>
                  <td>
                    {editing
                      ? <input type="date" value={draft.tested_on} onChange={(e) => setDraft({ ...draft, tested_on: e.target.value })} />
                      : formatUKDate(r.tested_on)}
                  </td>
                  <td>
                    {editing
                      ? <input type="text" value={draft.test_name} maxLength={80} style={{ width: '11rem' }} onChange={(e) => setDraft({ ...draft, test_name: e.target.value })} />
                      : <>{r.test_name}{r.source !== 'school' && r.test_name !== SOURCE_LABEL[r.source] && <><br /><span style={{ color: '#666', fontSize: '0.85em' }}>{SOURCE_LABEL[r.source]}</span></>}</>}
                  </td>
                  <td>{formatMonths(r.age_months) || '—'}</td>
                  <td>
                    {editing ? (
                      <span style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center' }}>
                        <input type="number" min="3" max="20" style={{ width: '4rem' }} value={draft.years} onChange={(e) => setDraft({ ...draft, years: e.target.value })} /> y
                        <input type="number" min="0" max="11" style={{ width: '4rem' }} value={draft.months} onChange={(e) => setDraft({ ...draft, months: e.target.value })} /> m
                      </span>
                    ) : formatMonths(r.reading_age_months)}
                  </td>
                  <td><GapBadge gap={r.gap_months} /></td>
                  <td style={{ color: changeColour(since), whiteSpace: 'nowrap' }}>{prev ? formatChange(since) : 'First reading'}</td>
                  {canRecord && (
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {r.source === 'school' && (editing ? (
                        <>
                          <button type="button" onClick={saveEdit}>Save</button>{' '}
                          <button type="button" className="secondary" onClick={() => setEditId(null)}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="secondary" onClick={() => startEdit(r)}>Edit</button>{' '}
                          <button type="button" className="secondary" onClick={() => remove(r)}>Remove</button>
                        </>
                      ))}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ color: '#666', fontSize: '0.85em' }}>
        Gap = reading age minus the student&apos;s age on the day of the test. Negative means reading below their age.
        &ldquo;Since last&rdquo; shows whether the gap closed (▲) or widened (▼) since the reading before.
      </p>
    </div>
  );
}
