"use client";

import { useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
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

// --- Component -------------------------------------------------------------

export default function ImportTimetablePage() {
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total }
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

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
        .select("student_id, upn")
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
      const { data: existingLinks, error: elErr } = await supabase
        .from("student_class")
        .select("student_id, class_id, block_id, is_compound")
        .in("student_id", affectedStudentIds)
        .not("block_id", "is", null)
        .eq("is_compound", false);
      if (elErr) throw elErr;

      const existingByStudentBlock = new Map(
        existingLinks.map((l) => [`${l.student_id}:${l.block_id}`, l.class_id])
      );

      const toInsert = [];   // brand new link, no conflict
      const toSwap = [];     // student moving to a different class in same block
      const toRemove = [];   // old class_id being replaced
      const alreadyLinked = []; // exact match already exists, nothing to do

      for (const link of wantedLinks) {
        if (link.block_id && !link.is_compound) {
          const key = `${link.student_id}:${link.block_id}`;
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

      setPreview({
        totalRows: parsed.length,
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
      });
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
        alreadyLinked: preview.alreadyLinkedCount,
        failed,
      });
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const totalToApply = preview ? preview.toInsert.length + preview.toSwap.length : 0;

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "1rem" }}>
      <h1>Import Timetable (SIMS export)</h1>
      <p style={{ color: "#555" }}>
        Upload the UPN/Class export. It'll be parsed, matched against
        existing students and classes, and previewed before anything is
        written. Existing links are never duplicated — and if a student has
        moved to a different set within the same subject block, the old
        link is swapped out rather than causing a conflict.
      </p>

      <input type="file" accept=".csv" onChange={handleFile} disabled={busy} />

      {error && (
        <p style={{ color: "crimson", marginTop: "1rem" }}>Error: {error}</p>
      )}

      {busy && !progress && <p>Working…</p>}
      {progress && (
        <p>
          Importing… {progress.done} / {progress.total}
        </p>
      )}

      {preview && (
        <div style={{ marginTop: "1.5rem" }}>
          <h2>Preview</h2>
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
          </ul>

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

          <button
            onClick={handleImport}
            disabled={busy || totalToApply === 0}
            style={{ marginTop: "1rem", padding: "0.5rem 1rem" }}
          >
            Import {totalToApply} change(s)
          </button>
        </div>
      )}

      {result && (
        <div style={{ marginTop: "1rem" }}>
          <div style={{ color: "green" }}>
            Done. Added {result.inserted} new link(s), applied {result.swapped} set change(s),
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
        </div>
      )}
    </div>
  );
}
