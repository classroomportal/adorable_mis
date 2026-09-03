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
  const [pairs, setPairs] = useState([]);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
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
      setPairs(parsed);

      const uniqueUpns = [...new Set(parsed.map((p) => p.upn))];
      const uniqueCodes = [...new Set(parsed.map((p) => p.class_code))];

      const { data: students, error: sErr } = await supabase
        .from("students")
        .select("student_id, upn")
        .in("upn", uniqueUpns);
      if (sErr) throw sErr;

      const { data: classes, error: cErr } = await supabase
        .from("classes")
        .select("class_id, class_code")
        .in("class_code", uniqueCodes);
      if (cErr) throw cErr;

      const studentMap = new Map(students.map((s) => [s.upn, s.student_id]));
      const classMap = new Map(classes.map((c) => [c.class_code, c.class_id]));

      const matchedUpns = uniqueUpns.filter((u) => studentMap.has(u));
      const unmatchedUpns = uniqueUpns.filter((u) => !studentMap.has(u));
      const matchedCodes = uniqueCodes.filter((c) => classMap.has(c));
      const unmatchedCodes = uniqueCodes.filter((c) => !classMap.has(c));

      const linksToInsert = parsed
        .filter((p) => studentMap.has(p.upn) && classMap.has(p.class_code))
        .map((p) => ({
          student_id: studentMap.get(p.upn),
          class_id: classMap.get(p.class_code),
        }));

      setPreview({
        totalRows: parsed.length,
        uniqueStudents: uniqueUpns.length,
        matchedStudents: matchedUpns.length,
        unmatchedUpns,
        uniqueClasses: uniqueCodes.length,
        matchedClasses: matchedCodes.length,
        unmatchedCodes,
        linksToInsert,
      });
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleImport() {
    if (!preview?.linksToInsert?.length) return;
    setBusy(true);
    setError(null);
    try {
      // Dedup against existing links happens via upsert + ignoreDuplicates,
      // relying on a unique constraint on (student_id, class_id) in
      // student_class. If that constraint doesn't exist yet, add it:
      //   alter table student_class
      //     add constraint student_class_unique unique (student_id, class_id);
      const { error: upErr, count } = await supabase
        .from("student_class")
        .upsert(preview.linksToInsert, {
          onConflict: "student_id,class_id",
          ignoreDuplicates: true,
          count: "exact",
        });
      if (upErr) throw upErr;

      setResult({
        attempted: preview.linksToInsert.length,
        inserted: count ?? "unknown (check row count in table editor)",
      });
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "1rem" }}>
      <h1>Import Timetable (SIMS export)</h1>
      <p style={{ color: "#555" }}>
        Upload the UPN/Class export. It'll be parsed, matched against
        existing students and classes, and previewed before anything is
        written — existing links are never duplicated.
      </p>

      <input type="file" accept=".csv" onChange={handleFile} disabled={busy} />

      {error && (
        <p style={{ color: "crimson", marginTop: "1rem" }}>Error: {error}</p>
      )}

      {busy && <p>Working…</p>}

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
            <li>Links ready to import: {preview.linksToInsert.length}</li>
          </ul>

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
            disabled={busy || preview.linksToInsert.length === 0}
            style={{ marginTop: "1rem", padding: "0.5rem 1rem" }}
          >
            Import {preview.linksToInsert.length} link(s)
          </button>
        </div>
      )}

      {result && (
        <div style={{ marginTop: "1rem", color: "green" }}>
          Done. Attempted {result.attempted} links (existing links were
          skipped automatically).
        </div>
      )}
    </div>
  );
}
