'use client';

import { useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { decodeNovaTSlot } from '../../../lib/novaTSlots';

// Nova-T's NCLASS.DAT rows: "Meeting ,38,CBT,    " = label, slot number,
// staff code, room (always blank — a commitment has no room booking here).
// The slot is the same day-major number as TBTRA-F.DAT's (lib/novaTSlots):
// 38 is Friday Lesson 1. This page used to have its own period-major
// decode, which put 38 on Wednesday's Other Half, scattered the part-time
// teacher's Monday and Thursday off across the week, and set meetings on
// top of registrations the teachers were taking (migration 184 moved the
// stored ones to their real times).

function commitmentKey(staffId, dayOfWeek, periodNumber) {
  return `${staffId}|${dayOfWeek}|${periodNumber}`;
}

async function parseFile(file) {
  const text = await file.text();
  const lines = text.split(/\r\n|\n/).map((l) => l.trim()).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    const cols = line.split(',').map((c) => c.trim());
    if (cols.length < 3) continue;
    const [label, slotStr, staffCode] = cols;
    const decoded = decodeNovaTSlot(slotStr);
    if (!label || !staffCode || !decoded) continue;
    rows.push({ label, staff_code: staffCode, ...decoded });
  }
  return rows;
}

function ImportStaffCommitmentsInner() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [staleSelections, setStaleSelections] = useState({});
  const [deletingStale, setDeletingStale] = useState(false);
  const [deleteStaleResult, setDeleteStaleResult] = useState(null);

  async function handleFile(e) {
    setError(null);
    setResult(null);
    setPreview(null);
    setDeleteStaleResult(null);
    setStaleSelections({});
    const file = e.target.files?.[0];
    if (!file) return;

    setBusy(true);
    try {
      const rows = await parseFile(file);

      const { data: staff, error: sErr } = await supabase
        .from('staff')
        .select('staff_id, staff_code, first_name, last_name');
      if (sErr) throw sErr;
      const staffByCode = new Map((staff || []).map((s) => [s.staff_code, s]));

      const matched = [];
      const unmatchedStaff = new Set();
      const staffIdsInFile = new Set();
      for (const row of rows) {
        const s = staffByCode.get(row.staff_code);
        if (!s) {
          unmatchedStaff.add(row.staff_code);
          continue;
        }
        staffIdsInFile.add(s.staff_id);
        matched.push({
          staff_id: s.staff_id,
          staff_name: `${s.first_name} ${s.last_name}`,
          day_of_week: row.day_of_week,
          period_number: row.period_number,
          label: row.label,
        });
      }

      // NCLASS.DAT is Nova-T's whole list of commitments, so anything
      // already saved that this file doesn't have is stale — flag it for
      // removal. That includes staff the file doesn't mention at all: this
      // used to only look at staff who were in the file, so when the
      // Wednesday Lesson 4 meeting was cancelled, the 11 staff who had no
      // other commitment kept it forever (CUE's showed as a clash with
      // 9G1/Bs). A file with no usable rows flags nothing, so a wrong or
      // empty upload can't offer to wipe every commitment.
      let staleCommitments = [];
      if (staffIdsInFile.size > 0) {
        const { data: existing, error: exErr } = await supabase
          .from('staff_commitments')
          .select('commitment_id, staff_id, day_of_week, period_number, label, staff(first_name, last_name)');
        if (exErr) throw exErr;

        const newKeys = new Set(matched.map((m) => commitmentKey(m.staff_id, m.day_of_week, m.period_number)));
        staleCommitments = (existing || []).filter(
          (e) => !newKeys.has(commitmentKey(e.staff_id, e.day_of_week, e.period_number))
        );

        // A stale commitment has nothing else depending on it (no roster, no
        // register), so it's safe to default-select for removal — unlike
        // stale classes, there's no "students still linked" caution needed.
        const defaults = {};
        for (const c of staleCommitments) defaults[c.commitment_id] = true;
        setStaleSelections(defaults);
      }

      setPreview({
        totalParsed: rows.length,
        matched,
        unmatchedStaff: [...unmatchedStaff],
        staleCommitments,
      });
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function applyImport() {
    if (!preview?.matched?.length) return;
    setBusy(true);
    setError(null);
    try {
      const rows = preview.matched.map((m) => ({
        staff_id: m.staff_id,
        day_of_week: m.day_of_week,
        period_number: m.period_number,
        label: m.label,
      }));
      const { error: upErr } = await supabase
        .from('staff_commitments')
        .upsert(rows, { onConflict: 'staff_id,day_of_week,period_number,is_demo' });
      if (upErr) throw upErr;
      setResult({ imported: rows.length });
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  function toggleStaleSelection(commitmentId) {
    setStaleSelections((prev) => ({ ...prev, [commitmentId]: !prev[commitmentId] }));
  }

  async function deleteStaleCommitments() {
    const selectedIds = (preview?.staleCommitments || [])
      .filter((c) => staleSelections[c.commitment_id])
      .map((c) => c.commitment_id);
    if (selectedIds.length === 0) return;

    setDeletingStale(true);
    setError(null);
    try {
      const { error: delErr } = await supabase.from('staff_commitments').delete().in('commitment_id', selectedIds);
      if (delErr) throw delErr;
      setDeleteStaleResult({ deleted: selectedIds.length });
      setPreview((prev) => ({
        ...prev,
        staleCommitments: prev.staleCommitments.filter((c) => !selectedIds.includes(c.commitment_id)),
      }));
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setDeletingStale(false);
    }
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '1rem' }}>
      <h1>Import Staff Commitments (Nova-T NCLASS.DAT)</h1>
      <p style={{ color: '#555' }}>
        Upload Nova-T's <code>NCLASS.DAT</code> export — this covers a
        teacher's non-teaching commitments (meetings, part-time non-working
        periods, etc.) that don't have a student group or room, so they don't
        appear in the normal class timetable import. This only blocks the
        slot out on that staff member's own timetable; no register or roster
        is attached to it.
      </p>

      <input type="file" accept=".dat,.txt,text/plain,application/octet-stream,*/*" onChange={handleFile} disabled={busy} />

      {error && <p style={{ color: 'crimson', marginTop: '1rem' }}>Error: {error}</p>}
      {busy && <p>Working…</p>}

      {preview && (
        <div style={{ marginTop: '1.5rem' }}>
          <h2>Preview</h2>
          <p style={{ padding: '0.6rem 0.8rem', background: '#fff8e1', border: '1px solid #f0c419', borderRadius: 4 }}>
            <strong>Nothing has been saved yet.</strong> This would affect{' '}
            <strong>{new Set(preview.matched.map((m) => m.staff_id)).size} staff member{new Set(preview.matched.map((m) => m.staff_id)).size === 1 ? '' : 's'}</strong>{' '}
            {preview.staleCommitments.length > 0 && (
              <>and remove {preview.staleCommitments.length} commitment{preview.staleCommitments.length === 1 ? '' : 's'} that no longer appear in this file </>
            )}
            — review the table{preview.staleCommitments.length > 0 ? 's' : ''} below before importing anything.
          </p>
          <ul>
            <li>Total rows parsed: {preview.totalParsed}</li>
            <li>Matched to a staff member: {preview.matched.length}</li>
            <li>Unmatched staff codes: {preview.unmatchedStaff.length}</li>
          </ul>

          {preview.matched.length > 0 && (
            <details open>
              <summary>{preview.matched.length} commitment(s) to import</summary>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr><th>Staff</th><th>Day</th><th>Period</th><th>Label</th></tr>
                  </thead>
                  <tbody>
                    {preview.matched.map((m, i) => (
                      <tr key={i}>
                        <td>{m.staff_name}</td>
                        <td>{m.day_of_week}</td>
                        <td>{m.period_number}</td>
                        <td>{m.label}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button onClick={applyImport} disabled={busy} style={{ marginTop: '1rem', padding: '0.5rem 1rem' }}>
                Import {preview.matched.length} commitment(s)
              </button>
            </details>
          )}

          {preview.unmatchedStaff.length > 0 && (
            <details style={{ marginTop: '1rem' }}>
              <summary style={{ color: '#b45309' }}>
                {preview.unmatchedStaff.length} staff code(s) not found — those rows were skipped
              </summary>
              <pre style={{ whiteSpace: 'pre-wrap' }}>{preview.unmatchedStaff.join(', ')}</pre>
            </details>
          )}

          {preview.staleCommitments && preview.staleCommitments.length > 0 && (
            <details open style={{ marginTop: '1rem' }}>
              <summary style={{ color: 'crimson' }}>
                {preview.staleCommitments.length} commitment(s) already saved but not in this file anymore — review before removing
              </summary>
              <p style={{ fontSize: '0.9em', color: '#555' }}>
                A meeting that's been cancelled, or someone taken off one. This
                file is Nova-T's full list, so that includes staff it doesn't
                mention at all. Ticked ones will be deleted.
              </p>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr><th></th><th>Staff</th><th>Day</th><th>Period</th><th>Label</th></tr>
                  </thead>
                  <tbody>
                    {preview.staleCommitments.map((c) => (
                      <tr key={c.commitment_id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={!!staleSelections[c.commitment_id]}
                            onChange={() => toggleStaleSelection(c.commitment_id)}
                          />
                        </td>
                        <td>{c.staff?.first_name} {c.staff?.last_name}</td>
                        <td>{c.day_of_week}</td>
                        <td>{c.period_number}</td>
                        <td>{c.label}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                onClick={deleteStaleCommitments}
                disabled={deletingStale || preview.staleCommitments.every((c) => !staleSelections[c.commitment_id])}
                style={{ marginTop: '1rem', padding: '0.5rem 1rem' }}
              >
                {deletingStale
                  ? 'Deleting…'
                  : `Delete ${preview.staleCommitments.filter((c) => staleSelections[c.commitment_id]).length} selected commitment(s)`}
              </button>
              {deleteStaleResult && (
                <p style={{ marginTop: '0.5rem', color: 'green' }}>Deleted {deleteStaleResult.deleted} commitment(s).</p>
              )}
            </details>
          )}
        </div>
      )}

      {result && (
        <div style={{ marginTop: '1rem', color: 'green' }}>
          Done — imported {result.imported} commitment(s).
        </div>
      )}
    </div>
  );
}

export default function ImportStaffCommitmentsPage() {
  return <RequireAuth><RequireResource resourceKey="/admin/import-staff-commitments"><ImportStaffCommitmentsInner /></RequireResource></RequireAuth>;
}
