"use client";

import { useState, useRef } from "react";
import { supabase } from "../../../lib/supabaseClient";
import RequireAuth from "../../RequireAuth";
import RequireResource from "../../RequireResource";

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

// This school's Nova-T exports name whole-form-class groups by form LETTER
// ("9A/Ar"), but some classes were originally created under an older
// numeric-band scheme ("91/Ar") before that. Both name the exact same real
// class — so a plain class_code string match would treat "9A/Ar" as brand
// new and duplicate a class that already has a teacher, room and enrolled
// students. formLetterFromRowCode/formLetterFromFormClass let the importer
// recognize that case by cross-checking against who's actually enrolled.
function formLetterFromRowCode(classCode) {
  const m = classCode.match(/^\d{1,2}([A-Za-z]+)\d*\//);
  return m ? m[1].toUpperCase() : null;
}

function formLetterFromFormClass(formClass) {
  const m = (formClass || "").match(/^\d{1,2}\s*([A-Za-z])/);
  return m ? m[1].toUpperCase() : null;
}

// Supabase silently caps an unranged select at 1000 rows (this school's
// student_class table alone has 4500+) — a plain .select() over "all
// enrolments for these classes" would quietly return only the first 1000,
// with no error, and everything after that would just be missing from the
// result. Page through with .range() until a short page comes back so nothing
// gets dropped.
async function fetchAllRows(buildQuery) {
  const pageSize = 1000;
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return all;
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

function ImportClassesInner() {
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

  // staleSelections[class_id] = boolean (whether to delete it)
  const [staleSelections, setStaleSelections] = useState({});
  const [deletingStale, setDeletingStale] = useState(false);
  const [deleteStaleResult, setDeleteStaleResult] = useState(null);

  const fileInputRef = useRef(null);

  function handleCancel() {
    setError(null);
    setResult(null);
    setPreview(null);
    setCreateResult(null);
    setNewClassForm({});
    setDeleteStaleResult(null);
    setStaleSelections({});
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

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
    setDeleteStaleResult(null);
    setStaleSelections({});
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
        supabase.from("classes").select("class_id, class_code, staff_id, room, subject_id, year_group"),
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
      // Keyed on the lower-cased code: subjects.subject_code is maintained by
      // hand in SQL (it isn't editable from /admin/subject-settings), so its
      // casing drifts from what Nova-T writes in the group name. "Personal
      // Study" was stored as "PS" while the export writes 12a/Ps1, and an
      // exact-match lookup quietly dropped those classes into the "subject
      // code not found" list for months. Match case-insensitively; the codes
      // are all distinct regardless of case.
      const subjectByCode = new Map(
        subjects
          .filter((s) => s.subject_code)
          .map((s) => [s.subject_code.toLowerCase(), s.subject_id])
      );
      const staffNameById = new Map(staff.map((s) => [s.staff_id, `${s.first_name} ${s.last_name}`]));
      const subjectNameById = new Map(subjects.map((s) => [s.subject_id, s.subject_name]));

      // Work out which form letter each existing class's enrolled students
      // actually belong to, so a row like "9A/Ar" can be matched against an
      // existing "91/Ar" class even though the code itself differs.
      const existingClassIds = existingClasses.map((c) => c.class_id);
      const enrolRows = await fetchAllRows(() =>
        supabase.from("student_class").select("class_id, students(form_class)").in("class_id", existingClassIds)
      );

      const formLetterCountsByClass = new Map();
      for (const r of enrolRows || []) {
        const letter = formLetterFromFormClass(r.students?.form_class);
        if (!letter) continue;
        if (!formLetterCountsByClass.has(r.class_id)) formLetterCountsByClass.set(r.class_id, new Map());
        const counts = formLetterCountsByClass.get(r.class_id);
        counts.set(letter, (counts.get(letter) || 0) + 1);
      }
      const primaryFormLetterByClass = new Map();
      for (const [classId, counts] of formLetterCountsByClass) {
        let best = null, bestCount = 0;
        for (const [letter, c] of counts) if (c > bestCount) { best = letter; bestCount = c; }
        primaryFormLetterByClass.set(classId, best);
      }
      const existingByYearSubject = new Map();
      for (const c of existingClasses) {
        const key = `${c.year_group}|${c.subject_id}`;
        if (!existingByYearSubject.has(key)) existingByYearSubject.set(key, []);
        existingByYearSubject.get(key).push({ ...c, formLetter: primaryFormLetterByClass.get(c.class_id) || null });
      }
      const claimedClassIds = new Set();

      const updates = [];       // existing class, some field changed
      const unchanged = [];     // existing class, nothing changed
      const newClasses = [];    // class_code not in classes at all
      const unmatchedStaff = new Set();
      const unmatchedSubjects = new Set();
      const parsedCodes = new Set();
      const yearGroupsInFile = new Set();

      for (const row of parsedClasses) {
        parsedCodes.add(row.class_code);
        if (row.year_group != null) yearGroupsInFile.add(row.year_group);

        const staffId = row.staff_code ? staffByCode.get(row.staff_code) : null;
        if (row.staff_code && !staffId) unmatchedStaff.add(row.staff_code);

        const subjectId = row.subject_code ? subjectByCode.get(row.subject_code.toLowerCase()) : null;
        if (row.subject_code && !subjectId) unmatchedSubjects.add(row.subject_code);

        const existing = classByCode.get(row.class_code);

        if (!existing) {
          let contentMatch = null;
          const rowFormLetter = formLetterFromRowCode(row.class_code);
          if (rowFormLetter && subjectId && row.year_group != null) {
            const key = `${row.year_group}|${subjectId}`;
            const candidates = (existingByYearSubject.get(key) || []).filter(
              (c) => !claimedClassIds.has(c.class_id) && c.formLetter === rowFormLetter
            );
            if (candidates.length === 1) contentMatch = candidates[0];
          }

          if (contentMatch) {
            // Not actually new — this is an existing, enrolled class that
            // Nova-T now names differently. Treat the class_code itself as
            // just another field that changed, same as teacher/room/subject.
            claimedClassIds.add(contentMatch.class_id);
            const diffs = ["class code"];
            if (staffId && staffId !== contentMatch.staff_id) diffs.push("teacher");
            if (row.room && row.room !== contentMatch.room) diffs.push("room");
            updates.push({
              class_id: contentMatch.class_id,
              class_code: row.class_code,
              old_class_code: contentMatch.class_code,
              class_code_changed: true,
              diffs,
              staff_id: staffId || contentMatch.staff_id,
              room: row.room || contentMatch.room,
              subject_id: subjectId || contentMatch.subject_id,
              old_staff_name: staffNameById.get(contentMatch.staff_id) || "—",
              new_staff_name: staffNameById.get(staffId || contentMatch.staff_id) || "—",
              old_room: contentMatch.room || "—",
              new_room: row.room || contentMatch.room || "—",
              old_subject_name: subjectNameById.get(contentMatch.subject_id) || "—",
              new_subject_name: subjectNameById.get(subjectId || contentMatch.subject_id) || "—",
            });
            continue;
          }

          newClasses.push({
            class_code: row.class_code,
            staff_id: staffId || null,
            room: row.room || null,
            subject_id: subjectId || null,
            year_group: row.year_group,
          });
          continue;
        }

        claimedClassIds.add(existing.class_id);
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
            old_staff_name: staffNameById.get(existing.staff_id) || '—',
            new_staff_name: staffNameById.get(staffId || existing.staff_id) || '—',
            old_room: existing.room || '—',
            new_room: row.room || existing.room || '—',
            old_subject_name: subjectNameById.get(existing.subject_id) || '—',
            new_subject_name: subjectNameById.get(subjectId || existing.subject_id) || '—',
          });
        } else {
          unchanged.push(row.class_code);
        }
      }

      // Classes already in the DB, in a year group covered by the files you
      // just uploaded, but not mentioned anywhere in those files at all —
      // these are candidates for removal (e.g. the old OH1 classes after a
      // block was renamed to PS1/PS2). Only years actually present in the
      // upload are considered, so a partial upload (e.g. just one year's
      // files) won't flag every other year's classes as stale.
      const staleCandidates = existingClasses.filter(
        (c) => yearGroupsInFile.has(c.year_group) && !parsedCodes.has(c.class_code)
      );

      let staleClasses = [];
      if (staleCandidates.length > 0) {
        const staleIds = staleCandidates.map((c) => c.class_id);
        const [scRows, tsRows] = await Promise.all([
          fetchAllRows(() => supabase.from("student_class").select("class_id").in("class_id", staleIds)),
          fetchAllRows(() => supabase.from("timetable_slots").select("class_id").in("class_id", staleIds)),
        ]);
        const studentCounts = new Map();
        for (const r of scRows || []) studentCounts.set(r.class_id, (studentCounts.get(r.class_id) || 0) + 1);
        const slotCounts = new Map();
        for (const r of tsRows || []) slotCounts.set(r.class_id, (slotCounts.get(r.class_id) || 0) + 1);

        staleClasses = staleCandidates.map((c) => ({
          ...c,
          studentCount: studentCounts.get(c.class_id) || 0,
          slotCount: slotCounts.get(c.class_id) || 0,
        }));

        // Default-select only the ones with no students still linked —
        // anything with students still on it needs a human decision.
        const defaults = {};
        for (const c of staleClasses) defaults[c.class_id] = c.studentCount === 0;
        setStaleSelections(defaults);
      }

      // Before anything is written: who does this actually touch? A field
      // changing on a class isn't just an abstract diff — it's a real
      // teacher's timetable changing and real students sitting in that
      // class. Count students currently enrolled on each class being
      // updated, and roll up a plain-English "N staff, M students" summary
      // so that's visible before the Apply button, not after.
      let updatesWithStudentCounts = updates;
      const affectedStaffIds = new Set();
      const affectedStudentIds = new Set();
      if (updates.length > 0) {
        const updateIds = updates.map((u) => u.class_id);
        const scRows = await fetchAllRows(() =>
          supabase.from("student_class").select("class_id, student_id").in("class_id", updateIds)
        );
        const studentsByClass = new Map();
        for (const r of scRows || []) {
          if (!studentsByClass.has(r.class_id)) studentsByClass.set(r.class_id, []);
          studentsByClass.get(r.class_id).push(r.student_id);
        }
        updatesWithStudentCounts = updates.map((u) => ({
          ...u,
          studentCount: (studentsByClass.get(u.class_id) || []).length,
        }));
        for (const u of updates) {
          affectedStaffIds.add(u.staff_id);
          for (const sid of studentsByClass.get(u.class_id) || []) affectedStudentIds.add(sid);
        }
      }
      for (const c of newClasses) if (c.staff_id) affectedStaffIds.add(c.staff_id);
      for (const c of staleClasses) if (staleSelections[c.class_id] !== false) affectedStaffIds.add(c.staff_id);

      setPreview({
        totalParsed: parsedClasses.length,
        updates: updatesWithStudentCounts,
        unchangedCount: unchanged.length,
        newClasses,
        unmatchedStaff: [...unmatchedStaff],
        unmatchedSubjects: [...unmatchedSubjects],
        staleClasses,
        yearGroupsInFile: [...yearGroupsInFile].sort((a, b) => a - b),
        affectedStaffCount: affectedStaffIds.size,
        affectedStudentCount: affectedStudentIds.size,
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
          .update({
            staff_id: u.staff_id,
            room: u.room,
            subject_id: u.subject_id,
            ...(u.class_code_changed ? { class_code: u.class_code } : {}),
          })
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

  function toggleStaleSelection(classId) {
    setStaleSelections((prev) => ({ ...prev, [classId]: !prev[classId] }));
  }

  async function deleteStaleClasses() {
    if (!preview?.staleClasses?.length) return;
    const selectedIds = preview.staleClasses
      .filter((c) => staleSelections[c.class_id])
      .map((c) => c.class_id);
    if (selectedIds.length === 0) return;

    setDeletingStale(true);
    setError(null);
    try {
      // Order matters: slots and student links first, then the class
      // itself, so no foreign key is left dangling.
      const { error: slotsErr } = await supabase
        .from("timetable_slots")
        .delete()
        .in("class_id", selectedIds);
      if (slotsErr) throw slotsErr;

      const { error: scErr } = await supabase
        .from("student_class")
        .delete()
        .in("class_id", selectedIds);
      if (scErr) throw scErr;

      const { error: classErr } = await supabase
        .from("classes")
        .delete()
        .in("class_id", selectedIds);
      if (classErr) throw classErr;

      setDeleteStaleResult({ deleted: selectedIds.length });
      setPreview((prev) => ({
        ...prev,
        staleClasses: prev.staleClasses.filter((c) => !selectedIds.includes(c.class_id)),
      }));
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setDeletingStale(false);
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
        — right here, instead of needing manual SQL. Classes that used to
        exist for a year group covered by this upload, but aren't mentioned
        anywhere in the file, are flagged for review and optional deletion
        too (e.g. after renaming a block).
      </p>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".dat,.txt,text/plain,application/octet-stream,*/*"
        onChange={handleFiles}
        disabled={busy}
      />

      {error && <p style={{ color: "crimson", marginTop: "1rem" }}>Error: {error}</p>}
      {busy && <p>Working…</p>}

      {preview && (
        <div style={{ marginTop: "1.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <h2 style={{ margin: 0 }}>Preview</h2>
            <button type="button" className="secondary" onClick={handleCancel} disabled={busy}>
              Cancel
            </button>
          </div>
          <p style={{ padding: "0.6rem 0.8rem", background: "#fff8e1", border: "1px solid #f0c419", borderRadius: 4 }}>
            <strong>Nothing has been saved yet.</strong> This upload would affect{" "}
            <strong>{preview.affectedStaffCount} staff member{preview.affectedStaffCount === 1 ? "" : "s"}</strong> and{" "}
            <strong>{preview.affectedStudentCount} student{preview.affectedStudentCount === 1 ? "" : "s"}</strong> currently
            enrolled in a changed class. Review who's affected below before applying anything.
          </p>
          <ul>
            <li>Total classes parsed from file: {preview.totalParsed}</li>
            <li>Unchanged (matches DB already): {preview.unchangedCount}</li>
            <li>Existing classes with changes: {preview.updates.length}</li>
            <li>Class codes not found in DB: {preview.newClasses.length}</li>
          </ul>

          {preview.updates.length > 0 && (
            <details open>
              <summary>{preview.updates.length} class(es) with changes</summary>
              {preview.updates.some((u) => u.class_code_changed) && (
                <p style={{ fontSize: "0.85em", color: "#555" }}>
                  Rows showing a class code change weren't matched by code at all — they were
                  matched to an existing class by who's actually enrolled in it. Nova-T appears to
                  have renamed these since they were last imported, rather than them being new.
                </p>
              )}
              <table style={{ width: "100%", marginTop: "0.5rem", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Class</th>
                    <th style={{ textAlign: "left" }}>Teacher</th>
                    <th style={{ textAlign: "left" }}>Room</th>
                    <th style={{ textAlign: "left" }}>Subject</th>
                    <th style={{ textAlign: "left" }}>Students enrolled</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.updates.map((u) => (
                    <tr key={u.class_id} style={{ borderTop: "1px solid #eee" }}>
                      <td>
                        {u.class_code_changed
                          ? <>{u.old_class_code} → <strong>{u.class_code}</strong></>
                          : u.class_code}
                      </td>
                      <td>
                        {u.old_staff_name === u.new_staff_name
                          ? u.old_staff_name
                          : <>{u.old_staff_name} → <strong>{u.new_staff_name}</strong></>}
                      </td>
                      <td>
                        {u.old_room === u.new_room
                          ? u.old_room
                          : <>{u.old_room} → <strong>{u.new_room}</strong></>}
                      </td>
                      <td>
                        {u.old_subject_name === u.new_subject_name
                          ? u.old_subject_name
                          : <>{u.old_subject_name} → <strong>{u.new_subject_name}</strong></>}
                      </td>
                      <td style={{ fontWeight: u.studentCount > 0 ? "bold" : "normal" }}>{u.studentCount}</td>
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

          {preview.staleClasses && preview.staleClasses.length > 0 && (
            <details open style={{ marginTop: "1rem" }}>
              <summary style={{ color: "crimson" }}>
                {preview.staleClasses.length} class(es) in the database, for year group(s){" "}
                {preview.yearGroupsInFile.join(", ")}, that aren't in this file at all — review before deleting
              </summary>
              <p style={{ fontSize: "0.9em", color: "#555" }}>
                These are typically retired classes (e.g. a renamed block, like OH1 →
                PS1/PS2). Ticked ones will have their timetable slots, any remaining
                student links, and the class itself all deleted. Unticked by default
                whenever students are still linked — check those carefully first.
              </p>
              <table style={{ width: "100%", marginTop: "0.5rem", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th></th>
                    <th style={{ textAlign: "left" }}>Class</th>
                    <th style={{ textAlign: "left" }}>Students linked</th>
                    <th style={{ textAlign: "left" }}>Timetable slots</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.staleClasses.map((c) => (
                    <tr key={c.class_id} style={{ borderTop: "1px solid #eee" }}>
                      <td>
                        <input
                          type="checkbox"
                          checked={!!staleSelections[c.class_id]}
                          onChange={() => toggleStaleSelection(c.class_id)}
                        />
                      </td>
                      <td style={{ padding: "0.3rem" }}>{c.class_code}</td>
                      <td
                        style={{
                          padding: "0.3rem",
                          color: c.studentCount > 0 ? "crimson" : "inherit",
                          fontWeight: c.studentCount > 0 ? "bold" : "normal",
                        }}
                      >
                        {c.studentCount}
                      </td>
                      <td style={{ padding: "0.3rem" }}>{c.slotCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button
                onClick={deleteStaleClasses}
                disabled={deletingStale || preview.staleClasses.every((c) => !staleSelections[c.class_id])}
                style={{ marginTop: "1rem", padding: "0.5rem 1rem" }}
              >
                {deletingStale
                  ? "Deleting…"
                  : `Delete ${preview.staleClasses.filter((c) => staleSelections[c.class_id]).length} selected class(es)`}
              </button>
              {deleteStaleResult && (
                <p style={{ marginTop: "0.5rem", color: "green" }}>
                  Deleted {deleteStaleResult.deleted} class(es).
                </p>
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

export default function ImportClassesPage() {
  return (
    <RequireAuth>
      <RequireResource resourceKey="/admin/import-classes">
        <ImportClassesInner />
      </RequireResource>
    </RequireAuth>
  );
}
