"use client";

import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabaseClient";

const YEARS = [7, 8, 9, 10, 11, 12];

export default function BlockAllocationPage() {
  const [year, setYear] = useState("");
  const [blocks, setBlocks] = useState([]);
  const [blockId, setBlockId] = useState("");
  const [block, setBlock] = useState(null);

  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  // selections[student_id] = Set of class_id (single entry unless compound block)
  const [selections, setSelections] = useState({});
  const [initialSelections, setInitialSelections] = useState({});

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  // --- Load blocks when year changes ---
  useEffect(() => {
    setBlockId("");
    setBlock(null);
    setClasses([]);
    setStudents([]);
    setSelections({});
    setMessage("");
    if (!year) {
      setBlocks([]);
      return;
    }
    (async () => {
      const { data, error } = await supabase
        .from("curriculum_blocks")
        .select("block_id, block_name, year_group, band, is_compound")
        .eq("year_group", Number(year))
        .order("block_name");
      if (error) {
        setMessage("Error loading blocks: " + error.message);
        return;
      }
      setBlocks(data || []);
      if (!data || data.length === 0) {
        setMessage(`No curriculum_blocks rows found for year_group = ${year}. (Query ran without error, just returned 0 rows.)`);
      }
    })();
  }, [year]);

  // --- Load classes + students + existing allocations when block changes ---
  useEffect(() => {
    setMessage("");
    if (!blockId) {
      setClasses([]);
      setStudents([]);
      setSelections({});
      setBlock(null);
      return;
    }
    const chosenBlock = blocks.find((b) => String(b.block_id) === String(blockId));
    setBlock(chosenBlock || null);

    (async () => {
      setLoading(true);

      const { data: classData, error: classErr } = await supabase
        .from("classes")
        .select("class_id, class_code, room, subjects(subject_name), staff(first_name, last_name)")
        .eq("block_id", blockId)
        .order("class_code");
      if (classErr) {
        setMessage("Error loading classes: " + classErr.message);
        setLoading(false);
        return;
      }

      const { data: studentData, error: studentErr } = await supabase
        .from("students")
        .select("student_id, first_name, last_name, form_class")
        .eq("year_group", year)
        .eq("status", "active")
        .order("form_class")
        .order("last_name");
      if (studentErr) {
        setMessage("Error loading students: " + studentErr.message);
        setLoading(false);
        return;
      }

      const classIds = (classData || []).map((c) => c.class_id);
      let existing = [];
      if (classIds.length > 0) {
        const { data: scData, error: scErr } = await supabase
          .from("student_class")
          .select("student_id, class_id")
          .in("class_id", classIds);
        if (scErr) {
          setMessage("Error loading current allocations: " + scErr.message);
          setLoading(false);
          return;
        }
        existing = scData || [];
      }

      const sel = {};
      for (const row of existing) {
        if (!sel[row.student_id]) sel[row.student_id] = new Set();
        sel[row.student_id].add(row.class_id);
      }

      setClasses(classData || []);
      setStudents(studentData || []);
      setSelections(cloneSelections(sel));
      setInitialSelections(cloneSelections(sel));
      setLoading(false);
    })();
  }, [blockId]); // eslint-disable-line react-hooks/exhaustive-deps

  function cloneSelections(sel) {
    const out = {};
    for (const k of Object.keys(sel)) out[k] = new Set(sel[k]);
    return out;
  }

  function toggle(studentId, classId) {
    setSelections((prev) => {
      const next = cloneSelections(prev);
      const current = next[studentId] || new Set();
      const isCompound = block?.is_compound;

      if (current.has(classId)) {
        current.delete(classId);
      } else {
        if (!isCompound) current.clear(); // single choice per block
        current.add(classId);
      }
      next[studentId] = current;
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setMessage("");

    const toInsert = [];
    const toDelete = [];

    const allStudentIds = new Set([
      ...Object.keys(selections),
      ...Object.keys(initialSelections),
    ]);

    for (const sid of allStudentIds) {
      const now = selections[sid] || new Set();
      const before = initialSelections[sid] || new Set();
      for (const cid of now) {
        if (!before.has(cid)) toInsert.push({ student_id: Number(sid), class_id: cid });
      }
      for (const cid of before) {
        if (!now.has(cid)) toDelete.push({ student_id: Number(sid), class_id: cid });
      }
    }

    if (toInsert.length === 0 && toDelete.length === 0) {
      setMessage("No changes to save.");
      setSaving(false);
      return;
    }

    for (const row of toDelete) {
      const { error } = await supabase
        .from("student_class")
        .delete()
        .eq("student_id", row.student_id)
        .eq("class_id", row.class_id);
      if (error) {
        setMessage("Error removing allocation: " + error.message);
        setSaving(false);
        return;
      }
    }

    if (toInsert.length > 0) {
      const { error } = await supabase
        .from("student_class")
        .upsert(toInsert, { onConflict: "student_id,class_id", ignoreDuplicates: true });
      if (error) {
        setMessage("Error saving allocations: " + error.message);
        setSaving(false);
        return;
      }
    }

    setInitialSelections(cloneSelections(selections));
    setMessage(
      `Saved. ${toInsert.length} added, ${toDelete.length} removed.`
    );
    setSaving(false);
  }

  const changedCount = (() => {
    let n = 0;
    const allStudentIds = new Set([
      ...Object.keys(selections),
      ...Object.keys(initialSelections),
    ]);
    for (const sid of allStudentIds) {
      const now = selections[sid] || new Set();
      const before = initialSelections[sid] || new Set();
      if (now.size !== before.size || [...now].some((c) => !before.has(c))) n++;
    }
    return n;
  })();

  return (
    <div style={{ padding: "1rem", maxWidth: 900, margin: "0 auto", fontFamily: "sans-serif" }}>
      <h1 style={{ fontSize: "1.3rem", marginBottom: "0.25rem" }}>Class Allocation by Block</h1>
      <p style={{ color: "#555", marginTop: 0, marginBottom: "1rem" }}>
        Choose a year group and a curriculum block, then tick which class each student belongs to.
      </p>

      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <label style={{ display: "flex", flexDirection: "column", fontSize: "0.85rem" }}>
          Year group
          <select
            value={year}
            onChange={(e) => setYear(e.target.value)}
            style={selectStyle}
          >
            <option value="">Select year…</option>
            {YEARS.map((y) => (
              <option key={y} value={y}>Year {y}</option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", fontSize: "0.85rem" }}>
          Block
          <select
            value={blockId}
            onChange={(e) => setBlockId(e.target.value)}
            disabled={!year || blocks.length === 0}
            style={selectStyle}
          >
            <option value="">Select block…</option>
            {blocks.map((b) => (
              <option key={b.block_id} value={b.block_id}>
                {b.block_name}{b.band ? ` (${b.band})` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      {message && classes.length === 0 && (
        <p style={{ background: "#fdecec", padding: "0.5rem 0.75rem", borderRadius: 6, fontSize: "0.85rem" }}>
          {message}
        </p>
      )}

      {block?.is_compound && (
        <p style={{ background: "#fff7e0", padding: "0.5rem 0.75rem", borderRadius: 6, fontSize: "0.85rem" }}>
          This is a compound block — students can be ticked into more than one class here (e.g. a Pathway bundling several subjects).
        </p>
      )}

      {loading && <p>Loading…</p>}

      {!loading && blockId && classes.length === 0 && (
        <p>No classes are linked to this block yet.</p>
      )}

      {!loading && classes.length > 0 && students.length > 0 && (
        <>
          <div style={{ overflowX: "auto", border: "1px solid #ddd", borderRadius: 6 }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ background: "#f5f5f5" }}>
                  <th style={thStyle}>Student</th>
                  <th style={thStyle}>Form</th>
                  {classes.map((c) => (
                    <th key={c.class_id} style={{ ...thStyle, textAlign: "center" }}>
                      {c.class_code}
                      <div style={{ fontWeight: 400, fontSize: "0.7rem", color: "#666" }}>
                        {c.subjects?.subject_name || ""}
                        {c.staff ? ` · ${c.staff.first_name?.[0] || ""}${c.staff.last_name || ""}` : ""}
                        {c.room ? ` · ${c.room}` : ""}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {students.map((s, i) => (
                  <tr key={s.student_id} style={{ background: i % 2 ? "#fafafa" : "#fff" }}>
                    <td style={tdStyle}>{s.last_name}, {s.first_name}</td>
                    <td style={tdStyle}>{s.form_class || ""}</td>
                    {classes.map((c) => (
                      <td key={c.class_id} style={{ ...tdStyle, textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={selections[s.student_id]?.has(c.class_id) || false}
                          onChange={() => toggle(s.student_id, c.class_id)}
                          style={{ width: 18, height: 18 }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: "1rem", display: "flex", alignItems: "center", gap: "1rem" }}>
            <button
              onClick={handleSave}
              disabled={saving || changedCount === 0}
              style={{
                padding: "0.6rem 1.2rem",
                background: changedCount === 0 ? "#ccc" : "#1a5fb4",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                fontSize: "0.9rem",
                cursor: changedCount === 0 ? "default" : "pointer",
              }}
            >
              {saving ? "Saving…" : `Save changes (${changedCount})`}
            </button>
            {message && <span style={{ fontSize: "0.85rem" }}>{message}</span>}
          </div>
        </>
      )}

      {!loading && blockId && classes.length > 0 && students.length === 0 && (
        <p>No active students found in Year {year}.</p>
      )}
    </div>
  );
}

const selectStyle = {
  padding: "0.4rem",
  fontSize: "0.9rem",
  marginTop: "0.25rem",
  minWidth: 180,
};

const thStyle = {
  padding: "0.5rem",
  textAlign: "left",
  borderBottom: "1px solid #ddd",
  whiteSpace: "nowrap",
};

const tdStyle = {
  padding: "0.4rem 0.5rem",
  borderBottom: "1px solid #eee",
  whiteSpace: "nowrap",
};
