"use client";

import { useState, useRef } from "react";
import { supabase } from "../../../lib/supabaseClient";
import RequireAuth from "../../RequireAuth";
import RequireResource from "../../RequireResource";
// If your Supabase client lives elsewhere/has a different export name,
// adjust the import above (e.g. `import supabase from "../../../lib/supabase"`).

// --- CSV/encoding helpers -------------------------------------------------

// SIMS exports of this type come out as UTF-16 with a BOM, and use a
// "sparse" layout: UPN is only present on the first row for a student,
// then blank (a single space) for every subsequent class row until the
// next student's UPN appears. We forward-fill it.
async function parseTimetableFile(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);

  // Detect UTF-16 LE BOM (FF FE). Fall back to UTF-8 if not present.
  const isUtf16 = bytes[0] === 0xff && bytes[1] === 0xfe;
  const text = new TextDecoder(isUtf16 ? "utf-16le" : "utf-8").decode(buf);

  const lines = text.split(/\r\n|\n/).filter((l) => l.trim().length > 0);
  // drop header row
  const rows = lines.slice(1).map((line) => {
    // simple two-column quoted CSV parser: "UPN","Class"
    const match = line.match(/^\s*"?([^",]*)"?\s*,\s*"([^"]*)"\s*$/);
    if (!match) return null;
    return [match[1].trim(), match[2].trim()];
  }).filter(Boolean);

  const pairs = [];
  let currentUpn = null;
  for (const [upnField, classField] of rows) {
    if (upnField) currentUpn = upnField;
    if (currentUpn && classField) pairs.push({ upn: currentUpn, class_code: classField });
  }
  return pairs;
}

// Supabase silently caps an unranged select at 1000 rows (this school's
// student_class table alone has 4500+) — a plain .select() over "existing
// links for these students" would quietly return only the first 1000, with
// no error, and rows after that would just be missing from the result. On a
// full Nova-T re-import that means real set changes get misread as brand-new
// links and fail on uq_student_class_block instead of being swapped. Page
// through with .range() until a short page comes back so nothing gets dropped.
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

// --- Component -------------------------------------------------------------

// The four screens this wizard steps through. Kept as a plain ordered list
// (not a set of booleans) so "what's next" and "what's done" are always
// unambiguous from a single number, and so a stray click can't land the
// admin on two stages' content at once.
const STAGES = [
  { n: 1, label: "Upload" },
  { n: 2, label: "Review matches" },
  { n: 3, label: "Confirm & import" },
  { n: 4, label: "Done" },
];

function ImportTimetableInner() {
  const [stage, setStage] = useState(1);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total }
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [dropLeft, setDropLeft] = useState(true); // remove enrolments the export no longer lists
  const fileInputRef = useRef(null);

  // Back to stage 1 with a clean slate — used both by "Start another
  // import" after a successful run and by "Choose a different file" while
  // still reviewing a preview.
  function resetToUpload() {
    setError(null);
    setResult(null);
    setPreview(null);
    setProgress(null);
    setStage(1);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function goToConfirm() {
    setStage(3);
  }

  function goBackToPreview() {
    setError(null);
    setStage(2);
  }

  async function handleFile(e) {
    setError(null);
    setResult(null);
    setPreview(null);
    const file = e.target.files?.[0];
    if (!file) return;

    setBusy(true);
    try {
      const parsed = await parseTimetableFile(file);

      const uniqueUpns = [...new Set(parsed.map((p) => p.upn))];
      const uniqueCodes = [...new Set(parsed.map((p) => p.class_code))];

      const { data: students, error: sErr } = await supabase
        .from("students")
        .select("student_id, upn, first_name, last_name")
        .in("upn", uniqueUpns);
      if (sErr) throw sErr;

      // Need block_id/is_compound so we can detect "student already in a
      // different class within the same non-compound block" -> a set change,
      // not a duplicate. See uq_student_class_block (unique on
      // (student_id, block_id) where block_id is not null and is_compound = false).
      // is_compound lives on curriculum_blocks, not classes, so fetch both.
      const { data: classes, error: cErr } = await supabase
        .from("classes")
        .select("class_id, class_code, block_id")
        .in("class_code", uniqueCodes);
      if (cErr) throw cErr;

      const blockIds = [...new Set(classes.map((c) => c.block_id).filter(Boolean))];
      const { data: blocks, error: bErr } = blockIds.length
        ? await supabase.from("curriculum_blocks").select("block_id, is_compound").in("block_id", blockIds)
        : { data: [], error: null };
      if (bErr) throw bErr;
      const compoundByBlock = new Map(blocks.map((b) => [b.block_id, b.is_compound]));

      const studentMap = new Map(students.map((s) => [s.upn, s.student_id]));
      const classMap = new Map(
        classes.map((c) => [
          c.class_code,
          { ...c, is_compound: c.block_id ? !!compoundByBlock.get(c.block_id) : false },
        ])
      );

      const matchedUpns = uniqueUpns.filter((u) => studentMap.has(u));
      const unmatchedUpns = uniqueUpns.filter((u) => !studentMap.has(u));
      const matchedCodes = uniqueCodes.filter((c) => classMap.has(c));
      const unmatchedCodes = uniqueCodes.filter((c) => !classMap.has(c));

      const wantedLinks = parsed
        .filter((p) => studentMap.has(p.upn) && classMap.has(p.class_code))
        .map((p) => {
          const cls = classMap.get(p.class_code);
          return {
            student_id: studentMap.get(p.upn),
            class_id: cls.class_id,
            class_code: p.class_code,
            block_id: cls.block_id,
            is_compound: cls.is_compound,
          };
        });

      // Fetch every existing student_class row for the affected students
      // that sits in a non-compound block, so we can spot set changes:
      // student already linked to a DIFFERENT class in the same block.
      // student_class does carry its own is_compound column (copied at
      // link time), so this one's fine as-is.
      const affectedStudentIds = [...new Set(wantedLinks.map((l) => l.student_id))];
      const existingLinks = await fetchAllRows(() =>
        supabase
          .from("student_class")
          .select("student_id, class_id, block_id, is_compound")
          .in("student_id", affectedStudentIds)
          .not("block_id", "is", null)
          .eq("is_compound", false)
      );

      const existingByStudentBlock = new Map(
        existingLinks.map((l) => [`${l.student_id}:${l.block_id}`, l.class_id])
      );

      const toInsert = [];   // brand new link, no conflict
      const toSwap = [];     // student moving to a different class in same block
      const toRemove = [];   // old class_id being replaced
      const alreadyLinked = []; // exact match already exists, nothing to do
      const ambiguous = [];  // file itself assigns a student >1 class in the same block

      // Group wantedLinks by (student_id, block_id) for non-compound blocks
      // FIRST, so we can catch a student appearing against two different
      // classes in the same block within the file itself — that can't be
      // resolved automatically and must not be sent to the database at all.
      const byStudentBlock = new Map();
      for (const link of wantedLinks) {
        if (link.block_id && !link.is_compound) {
          const key = `${link.student_id}:${link.block_id}`;
          if (!byStudentBlock.has(key)) byStudentBlock.set(key, []);
          byStudentBlock.get(key).push(link);
        }
      }

      const ambiguousKeys = new Set();
      for (const [key, links] of byStudentBlock) {
        const distinctClassIds = new Set(links.map((l) => l.class_id));
        if (distinctClassIds.size > 1) {
          ambiguousKeys.add(key);
          ambiguous.push({
            student_id: links[0].student_id,
            options: links.map((l) => l.class_code),
          });
        }
      }

      for (const link of wantedLinks) {
        if (link.block_id && !link.is_compound) {
          const key = `${link.student_id}:${link.block_id}`;
          if (ambiguousKeys.has(key)) continue; // handled above, skip entirely

          const currentClassId = existingByStudentBlock.get(key);
          if (currentClassId === link.class_id) {
            alreadyLinked.push(link);
            continue;
          }
          if (currentClassId && currentClassId !== link.class_id) {
            toSwap.push(link);
            toRemove.push({ student_id: link.student_id, class_id: currentClassId });
            continue;
          }
        }
        toInsert.push(link);
      }

      // The export lists every class a pupil is in, so a class Formwork still
      // has them in that the file doesn't list is one they've left. This
      // import used to only ever add (and swap sets within one block), so
      // when 12 pupils moved from 7A/7C/7G into the new 7L form they kept
      // their old 7A1/7C1/7G1 PE groups alongside 7L1/Pe — and sat two
      // lessons at once. Only pupils in the file are touched, and not any
      // pupil the file lists against a class code Formwork doesn't know
      // (that's probably a renamed class: fix the code, then re-import).
      const fileCodesByStudent = new Map();
      const unknownCodeStudents = new Set();
      for (const p of parsed) {
        const sid = studentMap.get(p.upn);
        if (!sid) continue;
        if (!classMap.has(p.class_code)) { unknownCodeStudents.add(sid); continue; }
        if (!fileCodesByStudent.has(sid)) fileCodesByStudent.set(sid, new Set());
        fileCodesByStudent.get(sid).add(p.class_code);
      }
      const allLinks = await fetchAllRows(() =>
        supabase
          .from("student_class")
          .select("student_id, class_id, classes(class_code)")
          .in("student_id", [...fileCodesByStudent.keys()])
      );
      const swapRemovals = new Set(toRemove.map((r) => `${r.student_id}:${r.class_id}`));
      const nameById = new Map(students.map((s) => [s.student_id, `${s.first_name} ${s.last_name}`]));
      const toDrop = allLinks
        .filter((l) => l.classes?.class_code && !unknownCodeStudents.has(l.student_id))
        .filter((l) => !fileCodesByStudent.get(l.student_id).has(l.classes.class_code))
        .filter((l) => !swapRemovals.has(`${l.student_id}:${l.class_id}`))
        .map((l) => ({
          student_id: l.student_id,
          class_id: l.class_id,
          class_code: l.classes.class_code,
          student_name: nameById.get(l.student_id) || `student_id ${l.student_id}`,
        }))
        .sort((a, b) => a.student_name.localeCompare(b.student_name) || a.class_code.localeCompare(b.class_code));

      setPreview({
        totalRows: parsed.length,
        toDrop,
        notTidied: unknownCodeStudents.size,
        uniqueStudents: uniqueUpns.length,
        matchedStudents: matchedUpns.length,
        unmatchedUpns,
        uniqueClasses: uniqueCodes.length,
        matchedClasses: matchedCodes.length,
        unmatchedCodes,
        toInsert,
        toSwap,
        toRemove,
        alreadyLinkedCount: alreadyLinked.length,
        ambiguous,
      });
      setStage(2);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleImport() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      // 1. Remove the old side of any set change first, so the unique
      //    index on (student_id, block_id) doesn't block the new insert.
      for (const rem of preview.toRemove) {
        const { error: delErr } = await supabase
          .from("student_class")
          .delete()
          .eq("student_id", rem.student_id)
          .eq("class_id", rem.class_id);
        if (delErr) throw delErr;
      }

      // 1b. Enrolments the export no longer lists.
      let droppedCount = 0;
      if (dropLeft) {
        for (const d of preview.toDrop) {
          const { error: delErr } = await supabase
            .from("student_class")
            .delete()
            .eq("student_id", d.student_id)
            .eq("class_id", d.class_id);
          if (delErr) throw delErr;
          droppedCount++;
        }
      }

      // 2. Insert new links one at a time (both genuinely new ones and the
      //    "new side" of swaps). We do this row-by-row rather than one big
      //    batch: ON CONFLICT only protects against rows already in the
      //    table, not against duplicates within the same INSERT statement.
      //    If the source file itself contains two rows for the same student
      //    in the same non-compound block (a data issue upstream, not
      //    something we can safely guess our way around), a batch insert
      //    fails outright on uq_student_class_block even though the preview
      //    correctly found no conflict against the database. Going row by
      //    row means only the genuinely conflicting row fails, and we can
      //    report exactly which one.
      const rowsToInsert = [...preview.toInsert, ...preview.toSwap].map((l) => ({
        student_id: l.student_id,
        class_id: l.class_id,
        class_code: l.class_code,
        block_id: l.block_id,
        is_compound: l.is_compound,
      }));

      let insertedCount = 0;
      const failed = [];
      const CONCURRENCY = 10;
      setProgress({ done: 0, total: rowsToInsert.length });

      for (let i = 0; i < rowsToInsert.length; i += CONCURRENCY) {
        const chunk = rowsToInsert.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
          chunk.map((row) =>
            supabase
              .from("student_class")
              .upsert(
                {
                  student_id: row.student_id,
                  class_id: row.class_id,
                  block_id: row.block_id,
                  is_compound: row.is_compound,
                },
                { onConflict: "student_id,class_id", ignoreDuplicates: true }
              )
              .then(({ error: upErr }) => ({ row, upErr }))
          )
        );
        for (const { row, upErr } of results) {
          if (upErr) {
            failed.push({ ...row, error: upErr.message });
          } else {
            insertedCount++;
          }
        }
        setProgress({ done: Math.min(i + CONCURRENCY, rowsToInsert.length), total: rowsToInsert.length });
      }

      setResult({
        inserted: insertedCount,
        swapped: preview.toSwap.length,
        dropped: droppedCount,
        alreadyLinked: preview.alreadyLinkedCount,
        failed,
      });
      setStage(4);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const totalToApply = preview ? preview.toInsert.length + preview.toSwap.length + (dropLeft ? preview.toDrop.length : 0) : 0;

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "1rem" }}>
      <h1>Import Timetable (SIMS export)</h1>

      <Stepper stage={stage} />

      {error && (
        <p style={{ color: "crimson", marginTop: "1rem" }}>Error: {error}</p>
      )}

      {stage === 1 && (
        <div style={{ marginTop: "1.5rem" }}>
          <p style={{ color: "#555" }}>
            Upload the UPN/Class export. It'll be parsed, matched against
            existing students and classes, and previewed on the next screen
            before anything is written. Existing links are never duplicated —
            and if a student has moved to a different set within the same
            subject block, the old link is swapped out rather than causing a
            conflict. A class a pupil is in here but not in the export is
            listed for removal.
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFile}
            disabled={busy}
          />

          {busy && <p style={{ marginTop: "1rem" }}>Parsing and matching…</p>}
        </div>
      )}

      {stage === 2 && preview && (
        <div style={{ marginTop: "1.5rem" }}>
          <h2>Review matches</h2>
          <ul>
            <li>Total rows parsed: {preview.totalRows}</li>
            <li>
              Students matched: {preview.matchedStudents} / {preview.uniqueStudents}
            </li>
            <li>
              Classes matched: {preview.matchedClasses} / {preview.uniqueClasses}
            </li>
            <li>Already linked, no change needed: {preview.alreadyLinkedCount}</li>
            <li>New links to add: {preview.toInsert.length}</li>
            <li>Set changes (student moving class within a block): {preview.toSwap.length}</li>
            <li>Classes pupils have left (in Formwork, not in the export): {preview.toDrop.length}</li>
            {preview.ambiguous.length > 0 && (
              <li style={{ color: "crimson" }}>
                Ambiguous in file itself (excluded from import): {preview.ambiguous.length}
              </li>
            )}
          </ul>

          {preview.ambiguous.length > 0 && (
            <details open>
              <summary style={{ color: "crimson" }}>
                {preview.ambiguous.length} student(s) listed against more than
                one class in the same block — these are skipped entirely, not guessed at
              </summary>
              <pre style={{ whiteSpace: "pre-wrap" }}>
                {preview.ambiguous
                  .map((a) => `student_id ${a.student_id}: ${a.options.join(" vs ")}`)
                  .join("\n")}
              </pre>
              <p style={{ fontSize: "0.9em", color: "#555" }}>
                This is a data issue in the source export itself, not
                something this page can safely resolve — check these
                students' actual set assignment in Nova-T/SIMS, fix or
                clarify it there, then re-run this import.
              </p>
            </details>
          )}

          {preview.toSwap.length > 0 && (
            <details open>
              <summary style={{ color: "#b45309" }}>
                {preview.toSwap.length} set change(s) — review before importing
              </summary>
              <pre style={{ whiteSpace: "pre-wrap" }}>
                {preview.toSwap.map((s) => `student_id ${s.student_id} -> ${s.class_code}`).join("\n")}
              </pre>
            </details>
          )}

          {preview.toDrop.length > 0 && (
            <details open>
              <summary style={{ color: "#b45309" }}>
                {preview.toDrop.length} enrolment(s) the export no longer lists — review before importing
              </summary>
              <label style={{ display: "block", margin: "0.5rem 0" }}>
                <input type="checkbox" checked={dropLeft} onChange={(e) => setDropLeft(e.target.checked)} />{" "}
                Remove these pupils from these classes
              </label>
              <pre style={{ whiteSpace: "pre-wrap" }}>
                {preview.toDrop.map((d) => `${d.student_name}: ${d.class_code}`).join("\n")}
              </pre>
              <p style={{ fontSize: "0.9em", color: "#555" }}>
                Past registers and marks are kept — only class membership changes.
              </p>
            </details>
          )}
          {preview.notTidied > 0 && (
            <p style={{ color: "#b45309" }}>
              {preview.notTidied} pupil(s) are listed against a class code Formwork doesn't
              have (below), so none of their old classes are removed this time.
            </p>
          )}

          {preview.unmatchedUpns.length > 0 && (
            <details>
              <summary style={{ color: "#b45309" }}>
                {preview.unmatchedUpns.length} UPN(s) not found in students — will be skipped
              </summary>
              <pre style={{ whiteSpace: "pre-wrap" }}>
                {preview.unmatchedUpns.join(", ")}
              </pre>
            </details>
          )}

          {preview.unmatchedCodes.length > 0 && (
            <details>
              <summary style={{ color: "#b45309" }}>
                {preview.unmatchedCodes.length} class code(s) not found in classes — will be skipped
              </summary>
              <pre style={{ whiteSpace: "pre-wrap" }}>
                {preview.unmatchedCodes.join(", ")}
              </pre>
              <p style={{ fontSize: "0.9em", color: "#555" }}>
                Add these to <code>classes</code> first (with matching{" "}
                <code>class_code</code>) if they should be linked, then
                re-upload the file.
              </p>
            </details>
          )}

          <div style={{ marginTop: "1.5rem", display: "flex", gap: "0.75rem" }}>
            <button onClick={resetToUpload} disabled={busy} style={{ padding: "0.5rem 1rem" }}>
              ← Choose a different file
            </button>
            <button
              onClick={goToConfirm}
              disabled={busy}
              style={{ padding: "0.5rem 1rem", fontWeight: "bold" }}
            >
              Continue to confirm →
            </button>
          </div>
        </div>
      )}

      {stage === 3 && preview && (
        <div style={{ marginTop: "1.5rem" }}>
          <h2>Confirm & import</h2>
          <p style={{ color: "#555" }}>
            Nothing has been written yet. This will apply:
          </p>
          <ul>
            <li>{preview.toInsert.length} new link(s)</li>
            <li>{preview.toSwap.length} set change(s) (old link removed, new one added)</li>
            <li>
              {dropLeft ? preview.toDrop.length : 0} enrolment(s) removed (classes pupils have left)
              {!dropLeft && preview.toDrop.length > 0 && " — you unticked removing them"}
            </li>
            {preview.ambiguous.length > 0 && (
              <li style={{ color: "#b45309" }}>{preview.ambiguous.length} ambiguous row(s) — skipped</li>
            )}
            {preview.unmatchedUpns.length > 0 && (
              <li style={{ color: "#b45309" }}>{preview.unmatchedUpns.length} unmatched UPN(s) — skipped</li>
            )}
            {preview.unmatchedCodes.length > 0 && (
              <li style={{ color: "#b45309" }}>{preview.unmatchedCodes.length} unmatched class code(s) — skipped</li>
            )}
            <li>{preview.alreadyLinkedCount} row(s) already matched — no change needed</li>
          </ul>

          {progress && (
            <p>
              Importing… {progress.done} / {progress.total}
            </p>
          )}

          <div style={{ marginTop: "1.5rem", display: "flex", gap: "0.75rem" }}>
            <button onClick={goBackToPreview} disabled={busy} style={{ padding: "0.5rem 1rem" }}>
              ← Back to review
            </button>
            <button
              onClick={handleImport}
              disabled={busy || totalToApply === 0}
              style={{ padding: "0.5rem 1rem", fontWeight: "bold" }}
            >
              {busy ? "Importing…" : `Import ${totalToApply} change(s)`}
            </button>
          </div>
        </div>
      )}

      {stage === 4 && result && (
        <div style={{ marginTop: "1.5rem" }}>
          <h2>Done</h2>
          <div style={{ color: "green" }}>
            Added {result.inserted} new link(s), applied {result.swapped} set change(s),
            {" "}removed {result.dropped} enrolment(s) pupils have left,
            {" "}{result.alreadyLinked} row(s) already matched and needed no change.
          </div>
          {result.failed.length > 0 && (
            <details open style={{ marginTop: "0.5rem" }}>
              <summary style={{ color: "crimson" }}>
                {result.failed.length} row(s) failed — likely two classes for the
                same student in the same block within the source file itself
              </summary>
              <pre style={{ whiteSpace: "pre-wrap" }}>
                {result.failed
                  .map((f) => `student_id ${f.student_id} -> ${f.class_code}: ${f.error}`)
                  .join("\n")}
              </pre>
              <p style={{ fontSize: "0.9em", color: "#555" }}>
                Worth checking these students in Nova-T/SIMS directly — this
                usually means the export has conflicting set assignments for
                them that need resolving at the source, not just skipping here.
              </p>
            </details>
          )}

          <button onClick={resetToUpload} style={{ marginTop: "1.5rem", padding: "0.5rem 1rem" }}>
            Start another import
          </button>
        </div>
      )}
    </div>
  );
}

// --- Stepper -----------------------------------------------------------

function Stepper({ stage }) {
  return (
    <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", flexWrap: "wrap" }}>
      {STAGES.map((s, i) => {
        const isCurrent = s.n === stage;
        const isDone = s.n < stage;
        return (
          <div key={s.n} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.25rem 0.6rem",
                borderRadius: 999,
                fontSize: "0.85em",
                fontWeight: isCurrent ? "bold" : "normal",
                color: isCurrent ? "#fff" : isDone ? "#2e7d32" : "#888",
                background: isCurrent ? "#1a73e8" : isDone ? "#e6f4ea" : "#f1f1f1",
                border: isDone ? "1px solid #2e7d32" : "1px solid transparent",
              }}
            >
              {isDone ? "✓" : s.n}. {s.label}
            </span>
            {i < STAGES.length - 1 && <span style={{ color: "#ccc" }}>→</span>}
          </div>
        );
      })}
    </div>
  );
}

export default function ImportTimetablePage() {
  return (
    <RequireAuth>
      <RequireResource resourceKey="/admin/import-timetable">
        <ImportTimetableInner />
      </RequireResource>
    </RequireAuth>
  );
}
