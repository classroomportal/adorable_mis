"use client";

import { useState } from "react";
import { supabase } from "../../../lib/supabaseClient";

// --- Parsing -----------------------------------------------------------
// Nova-T TBTRA.DAT .. TBTRF.DAT rows (one file per year group), CSV-ish:
//   subcode, teacher_no, staff_code, room, group_full, course_id
// e.g.  A/Ma, 21, CBT, DG4, 10_1/Ma, 100920
//
// A class_code (group_full, e.g. "10_1/Ma") can appear on several rows
// (once per weekly slot) — usually with the same staff/room, occasionally
// not. We take the most frequently occurring staff_code/room per class.

function subjectCodeFromSub(subcode) {
  // "Ma1" -> "Ma", "Ma" -> "Ma"
  const base = subcode.replace(/[^/]*\//, "").replace(/\d+$/, "");
  return base || subcode;
}

function yearGroupFromClassCode(classCode) {
  const m = classCode.match(/^(\d{1,2})/);
  return m ? parseInt(m[1], 10) : null;
}

function mostCommon(arr) {
  const counts = new Map();
  for (const v of arr) {
    if (!v) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  let best = null, bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) { best = v; bestCount = c; }
  }
  return best;
}

async function parseFiles(files) {
  const rowsByClass = new Map(); // class_code -> {staffCodes: [], rooms: [], subcode}

  for (const file of files) {
    const text = await file.text();
    const lines = text.split(/\r\n|\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const cols = line.split(",").map((c) => c.trim());
      if (cols.length < 5) continue;
      const [subcode, , staffCode, room, groupFull] = cols;
      if (!groupFull) continue;
      if (!rowsByClass.has(groupFull)) {
        rowsByClass.set(groupFull, { staffCodes: [], rooms: [], subcode });
      }
      const entry = rowsByClass.get(groupFull);
      if (staffCode) entry.staffCodes.push(staffCode);
      if (room) entry.rooms.push(room);
    }
  }

  const classes = [];
  for (const [classCode, entry] of rowsByClass) {
    classes.push({
      class_code: classCode,
      staff_code: mostCommon(entry.staffCodes),
      room: mostCommon(entry.rooms),
      subject_code: subjectCodeFromSub(entry.subcode),
      year_group: yearGroupFromClassCode(classCode),
    });
  }
  return classes;
}

// --- Component -----------------------------------------------------------

export default function ImportClassesPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);

  async function handleFiles(e) {
    setError(null);
    setResult(null);
    setPreview(null);
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setBusy(true);
    try {
      const parsedClasses = await parseFiles(files);

      const [{ data: existingClasses, error: cErr }, { data: staff, error: sErr }, { data: subjects, error: subErr }] =
        await Promise.all([
          supabase.from("classes").select("class_id, class_code, staff_id, room, subject_id"),
          supabase.from("staff").select("staff_id, staff_code"),
          supabase.from("subjects").select("subject_id, subject_code"),
        ]);
      if (cErr) throw cErr;
      if (sErr) throw sErr;
      if (subErr) throw subErr;

      const classByCode = new Map(existingClasses.map((c) => [c.class_code, c]));
      const staffByCode = new Map(staff.map((s) => [s.staff_code, s.staff_id]));
      const subjectByCode = new Map(subjects.map((s) => [s.subject_code, s.subject_id]));

      const updates = [];       // existing class, some field changed
      const unchanged = [];     // existing class, nothing changed
      const newClasses = [];    // class_code not in classes at all
      const unmatchedStaff = new Set();
      const unmatchedSubjects = new Set();

      for (const row of parsedClasses) {
        const staffId = row.staff_code ? staffByCode.get(row.staff_code) : null;
        if (row.staff_code && !staffId) unmatchedStaff.add(row.staff_code);

        const subjectId = row.subject_code ? subjectByCode.get(row.subject_code) : null;
        if (row.subject_code && !subjectId) unmatchedSubjects.add(row.subject_code);

        const existing = classByCode.get(row.class_code);

        if (!existing) {
          newClasses.push({
            class_code: row.class_code,
            staff_id: staffId || null,
            room: row.room || null,
            subject_id: subjectId || null,
            year_group: row.year_group,
          });
          continue;
        }

        const diffs = [];
        if (staffId && staffId !== existing.staff_id) diffs.push("teacher");
        if (row.room && row.room !== existing.room) diffs.push("room");
        if (subjectId && subjectId !== existing.subject_id) diffs.push("subject");

        if (diffs.length > 0) {
          updates.push({
            class_id: existing.class_id,
            class_code: row.class_code,
            diffs,
            staff_id: staffId || existing.staff_id,
            room: row.room || existing.room,
            subject_id: subjectId || existing.subject_id,
          });
        } else {
          unchanged.push(row.class_code);
        }
      }

      setPreview({
        totalParsed: parsedClasses.length,
        updates,
        unchangedCount: unchanged.length,
        newClasses,
        unmatchedStaff: [...unmatchedStaff],
        unmatchedSubjects: [...unmatchedSubjects],
      });
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function applyUpdatesOnly() {
    if (!preview?.updates?.length) return;
    setBusy(true);
    setError(null);
    try {
      let count = 0;
      for (const u of preview.updates) {
        const { error: upErr } = await supabase
          .from("classes")
          .update({ staff_id: u.staff_id, room: u.room, subject_id: u.subject_id })
          .eq("class_id", u.class_id);
        if (upErr) throw upErr;
        count++;
      }
      setResult({ updated: count });
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "1rem" }}>
      <h1>Import Class / Teacher / Room Changes</h1>
      <p style={{ color: "#555" }}>
        Upload Nova-T's <code>TBTRA.DAT</code> – <code>TBTRF.DAT</code> files
        (select all of them at once). This only ever <strong>updates
        existing classes</strong>' teacher/room/subject — it never touches
        <code>timetable_slots</code> (day/period), since that decoding needs
        manual verification each time rather than being trusted to an
        automatic import. New class codes are flagged for you to review
        manually, not created automatically.
      </p>

      <input type="file" multiple accept=".dat,.txt,text/plain,application/octet-stream,*/*" onChange={handleFiles} disabled={busy} />

      {error && <p style={{ color: "crimson", marginTop: "1rem" }}>Error: {error}</p>}
      {busy && <p>Working…</p>}

      {preview && (
        <div style={{ marginTop: "1.5rem" }}>
          <h2>Preview</h2>
          <ul>
            <li>Total classes parsed from file: {preview.totalParsed}</li>
            <li>Unchanged (matches DB already): {preview.unchangedCount}</li>
            <li>Existing classes with changes: {preview.updates.length}</li>
            <li>Class codes not found in DB: {preview.newClasses.length}</li>
          </ul>

          {preview.updates.length > 0 && (
            <details open>
              <summary>{preview.updates.length} class(es) with changes</summary>
              <table style={{ width: "100%", marginTop: "0.5rem", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Class</th>
                    <th style={{ textAlign: "left" }}>Changed fields</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.updates.map((u) => (
                    <tr key={u.class_id}>
                      <td>{u.class_code}</td>
                      <td>{u.diffs.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button
                onClick={applyUpdatesOnly}
                disabled={busy}
                style={{ marginTop: "1rem", padding: "0.5rem 1rem" }}
              >
                Apply {preview.updates.length} update(s)
              </button>
            </details>
          )}

          {preview.newClasses.length > 0 && (
            <details style={{ marginTop: "1rem" }}>
              <summary style={{ color: "#b45309" }}>
                {preview.newClasses.length} class code(s) in the file but not in the database — review manually
              </summary>
              <pre style={{ whiteSpace: "pre-wrap" }}>
                {preview.newClasses.map((c) => c.class_code).join(", ")}
              </pre>
              <p style={{ fontSize: "0.9em", color: "#555" }}>
                These aren't created automatically — if they're genuinely new
                classes (not a naming mismatch with an existing one), add
                them via the normal class-creation flow, then re-run this
                import to pick up their teacher/room.
              </p>
            </details>
          )}

          {preview.unmatchedStaff.length > 0 && (
            <details style={{ marginTop: "1rem" }}>
              <summary style={{ color: "#b45309" }}>
                {preview.unmatchedStaff.length} staff code(s) not found — those classes keep their existing teacher
              </summary>
              <pre style={{ whiteSpace: "pre-wrap" }}>{preview.unmatchedStaff.join(", ")}</pre>
            </details>
          )}

          {preview.unmatchedSubjects.length > 0 && (
            <details style={{ marginTop: "1rem" }}>
              <summary style={{ color: "#b45309" }}>
                {preview.unmatchedSubjects.length} subject code(s) not found — those classes keep their existing subject
              </summary>
              <pre style={{ whiteSpace: "pre-wrap" }}>{preview.unmatchedSubjects.join(", ")}</pre>
            </details>
          )}
        </div>
      )}

      {result && (
        <div style={{ marginTop: "1rem", color: "green" }}>
          Done — updated {result.updated} class(es).
        </div>
      )}
    </div>
  );
}
