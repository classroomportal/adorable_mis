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

  // Lookup lists kept around for the "create new class" form dropdowns.
  const [subjectsList, setSubjectsList] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [blocksList, setBlocksList] = useState([]);

  // newClassForm[class_code] = { subject_id, staff_id, room, block_choice, new_block_name, new_block_band, new_block_is_compound }
  const [newClassForm, setNewClassForm] = useState({});
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState(null);

  function updateNewClassField(classCode, field, value) {
    setNewClassForm((prev) => ({
      ...prev,
      [classCode]: { ...(prev[classCode] || {}), [field]: value },
    }));
  }

  async function handleFiles(e) {
    setError(null);
    setResult(null);
    setPreview(null);
    setCreateResult(null);
    setNewClassForm({});
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setBusy(true);
    try {
      const parsedClasses = await parseFiles(files);

      const [
        { data: existingClasses, error: cErr },
        { data: staff, error: sErr },
        { data: subjects, error: subErr },
        { data: blocks, error: bErr },
      ] = await Promise.all([
        supabase.from("classes").select("class_id, class_code, staff_id, room, subject_id"),
        supabase.from("staff").select("staff_id, staff_code, first_name, last_name"),
        supabase.from("subjects").select("subject_id, subject_code, subject_name"),
        supabase.from("curriculum_blocks").select("block_id, block_name, year_group, band, is_compound"),
      ]);
      if (cErr) throw cErr;
      if (sErr) throw sErr;
      if (subErr) throw subErr;
      if (bErr) throw bErr;

      setSubjectsList(subjects || []);
      setStaffList(staff || []);
      setBlocksList(blocks || []);

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

  async function createNewClasses() {
    if (!preview?.newClasses?.length) return;
    setCreating(true);
    setError(null);
    try {
      // Resolve any "create new block" choices first, one insert per
      // distinct (year_group, name, band) so classes sharing the same
      // new block description end up pointing at the same block_id.
      const blockKeyToId = new Map();
      for (const c of preview.newClasses) {
        const f = newClassForm[c.class_code] || {};
        if (f.block_choice !== "__new__") continue;
        const name = (f.new_block_name || "").trim();
        if (!name) continue;
        const band = (f.new_block_band || "").trim() || null;
        const key = `${c.year_group}|${name}|${band || ""}`;
        if (blockKeyToId.has(key)) continue;
        const { data: inserted, error: blockErr } = await supabase
          .from("curriculum_blocks")
          .insert({
            block_name: name,
            year_group: c.year_group,
            band,
            is_compound: !!f.new_block_is_compound,
          })
          .select("block_id")
          .single();
        if (blockErr) throw blockErr;
        blockKeyToId.set(key, inserted.block_id);
      }

      let created = 0;
      const failed = [];
      for (const c of preview.newClasses) {
        const f = newClassForm[c.class_code] || {};
        let blockId = null;
        if (f.block_choice === "__new__") {
          const name = (f.new_block_name || "").trim();
          const band = (f.new_block_band || "").trim() || null;
          const key = `${c.year_group}|${name}|${band || ""}`;
          blockId = blockKeyToId.get(key) || null;
        } else if (f.block_choice && f.block_choice !== "none") {
          blockId = Number(f.block_choice);
        }

        const { error: insErr } = await supabase.from("classes").insert({
          class_code: c.class_code,
          subject_id: f.subject_id ? Number(f.subject_id) : c.subject_id || null,
          staff_id: f.staff_id ? Number(f.staff_id) : c.staff_id || null,
          room: (f.room ?? c.room) || null,
          year_group: c.year_group,
          block_id: blockId,
        });
        if (insErr) {
          failed.push({ class_code: c.class_code, error: insErr.message });
        } else {
          created++;
        }
      }

      setCreateResult({ created, failed });
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "1rem" }}>
      <h1>Import Class / Teacher / Room Changes</h1>
      <p style={{ color: "#555" }}>
        Upload Nova-T's <code>TBTRA.DAT</code> – <code>TBTRF.DAT</code> files
        (select all of them at once). Existing classes' teacher/room/subject
        get updated here; it never touches <code>timetable_slots</code>
        (day/period), since that decoding needs manual verification each
        time rather than being trusted to an automatic import. Class codes
        not yet in the database are listed below so you can create them —
        with subject, teacher, room and a curriculum block (existing or new)
        — right here, instead of needing manual SQL.
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
            <details open style={{ marginTop: "1rem" }}>
              <summary style={{ color: "#b45309" }}>
                {preview.newClasses.length} class code(s) in the file but not in the database — create them below
              </summary>
              <p style={{ fontSize: "0.9em", color: "#555" }}>
                Subject/teacher/room are pre-filled from the file where matched. Pick an
                existing curriculum block for each new class, or create a new one — leave
                block as "None" for classes that aren't part of a block (e.g. mentor groups).
              </p>
              <table style={{ width: "100%", marginTop: "0.5rem", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Class</th>
                    <th style={{ textAlign: "left" }}>Subject</th>
                    <th style={{ textAlign: "left" }}>Teacher</th>
                    <th style={{ textAlign: "left" }}>Room</th>
                    <th style={{ textAlign: "left" }}>Block</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.newClasses.map((c) => {
                    const f = newClassForm[c.class_code] || {};
                    const yearBlocks = blocksList.filter((b) => b.year_group === c.year_group);
                    return (
                      <tr key={c.class_code} style={{ borderTop: "1px solid #eee" }}>
                        <td style={{ padding: "0.3rem 0.3rem 0.3rem 0" }}>
                          {c.class_code}
                          <div style={{ fontSize: "0.8em", color: "#888" }}>Year {c.year_group ?? "?"}</div>
                        </td>
                        <td style={{ padding: "0.3rem" }}>
                          <select
                            value={f.subject_id ?? c.subject_id ?? ""}
                            onChange={(e) => updateNewClassField(c.class_code, "subject_id", e.target.value)}
                          >
                            <option value="">—</option>
                            {subjectsList.map((s) => (
                              <option key={s.subject_id} value={s.subject_id}>
                                {s.subject_name || s.subject_code}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td style={{ padding: "0.3rem" }}>
                          <select
                            value={f.staff_id ?? c.staff_id ?? ""}
                            onChange={(e) => updateNewClassField(c.class_code, "staff_id", e.target.value)}
                          >
                            <option value="">—</option>
                            {staffList.map((s) => (
                              <option key={s.staff_id} value={s.staff_id}>
                                {s.first_name} {s.last_name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td style={{ padding: "0.3rem" }}>
                          <input
                            type="text"
                            value={f.room ?? c.room ?? ""}
                            onChange={(e) => updateNewClassField(c.class_code, "room", e.target.value)}
                            style={{ width: "5rem" }}
                          />
                        </td>
                        <td style={{ padding: "0.3rem" }}>
                          <select
                            value={f.block_choice ?? "none"}
                            onChange={(e) => updateNewClassField(c.class_code, "block_choice", e.target.value)}
                          >
                            <option value="none">None</option>
                            {yearBlocks.map((b) => (
                              <option key={b.block_id} value={b.block_id}>
                                {b.block_name}
                              </option>
                            ))}
                            <option value="__new__">+ Create new block…</option>
                          </select>
                          {f.block_choice === "__new__" && (
                            <div style={{ marginTop: "0.3rem", display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                              <input
                                type="text"
                                placeholder="New block name"
                                value={f.new_block_name ?? ""}
                                onChange={(e) => updateNewClassField(c.class_code, "new_block_name", e.target.value)}
                              />
                              <input
                                type="text"
                                placeholder="Band (optional)"
                                value={f.new_block_band ?? ""}
                                onChange={(e) => updateNewClassField(c.class_code, "new_block_band", e.target.value)}
                              />
                              <label style={{ fontSize: "0.85em" }}>
                                <input
                                  type="checkbox"
                                  checked={!!f.new_block_is_compound}
                                  onChange={(e) => updateNewClassField(c.class_code, "new_block_is_compound", e.target.checked)}
                                />{" "}
                                Compound (students can be in more than one class in this block)
                              </label>
                              <span style={{ fontSize: "0.8em", color: "#888" }}>
                                Reused automatically for other new classes here with the same name/year/band.
                              </span>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <button
                onClick={createNewClasses}
                disabled={creating}
                style={{ marginTop: "1rem", padding: "0.5rem 1rem" }}
              >
                {creating ? "Creating…" : `Create ${preview.newClasses.length} new class(es)`}
              </button>
              {createResult && (
                <div style={{ marginTop: "0.75rem" }}>
                  <p style={{ color: "green" }}>Created {createResult.created} class(es).</p>
                  {createResult.failed.length > 0 && (
                    <div style={{ color: "crimson" }}>
                      <p>{createResult.failed.length} failed:</p>
                      <pre style={{ whiteSpace: "pre-wrap" }}>
                        {createResult.failed.map((f) => `${f.class_code}: ${f.error}`).join("\n")}
                      </pre>
                    </div>
                  )}
                  <p style={{ fontSize: "0.9em", color: "#555" }}>
                    Once created, run the "Import Student Class Allocations" tool with your
                    SIMS student export to link students to these classes.
                  </p>
                </div>
              )}
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
