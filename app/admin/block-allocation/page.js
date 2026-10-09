"use client";

import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabaseClient";
import RequireAuth from "../../RequireAuth";
import RequireResource from "../../RequireResource";
import { groupClassesByKey } from "../../../lib/blockGroups";
import SaveBar, { useSaveStatus } from "../../components/SaveBar";
import { MarkColumnPicker, loadMarkColumn } from "../../components/AllocationMarks";

const YEARS = [7, 8, 9, 10, 11, 12];

function BlockAllocationInner() {
  const [year, setYear] = useState("");
  const [blocks, setBlocks] = useState([]);
  const [blockId, setBlockId] = useState("");
  const [block, setBlock] = useState(null);

  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  // selections[student_id] = Set of class_id (one class, or every class of one group in a compound block)
  const [selections, setSelections] = useState({});
  const [initialSelections, setInitialSelections] = useState({});

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(""); // loading problems
  const [saveStatus, setSaveStatus] = useSaveStatus();

  // Marks from chosen result sets, shown beside the students (AllocationMarks.js).
  const [markColumns, setMarkColumns] = useState([]); // { key, set, subjectId, setLabel, subjectLabel, values }
  const [markBusy, setMarkBusy] = useState(false);
  const [markError, setMarkError] = useState("");
  const [sortKey, setSortKey] = useState("name"); // "name" or a mark column's key

  // --- Load blocks when year changes ---
  useEffect(() => {
    setBlockId("");
    setBlock(null);
    setClasses([]);
    setStudents([]);
    setSelections({});
    setMessage("");
    setSaveStatus(null);
    setMarkColumns([]);
    setSortKey("name");
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
  }, [year]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Load classes + students + existing allocations when block changes ---
  useEffect(() => {
    setMessage("");
    setSaveStatus(null);
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
        .select("class_id, class_code, block_group, room, subject_id, subjects(subject_name, display_name), staff(first_name, last_name)")
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
        .order("last_name")
        .order("first_name");
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

  // Columns are kept from block to block within a year (same students), and
  // reloaded if the student list itself changes.
  const studentKey = students.map((s) => s.student_id).join(",");
  useEffect(() => {
    if (!markColumns.length) return;
    let cancelled = false;
    (async () => {
      setMarkBusy(true);
      setMarkError("");
      try {
        const ids = students.map((s) => s.student_id);
        const reloaded = [];
        for (const c of markColumns) reloaded.push({ ...c, values: await loadMarkColumn(c.set, c.subjectId, ids) });
        if (!cancelled) setMarkColumns(reloaded);
      } catch (e) {
        if (!cancelled) setMarkError("Error loading marks: " + e.message);
      }
      if (!cancelled) setMarkBusy(false);
    })();
    return () => { cancelled = true; };
  }, [studentKey]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addMarkColumn(col) {
    setMarkBusy(true);
    setMarkError("");
    try {
      const values = await loadMarkColumn(col.set, col.subjectId, students.map((s) => s.student_id));
      setMarkColumns((prev) => [...prev, { ...col, values }]);
    } catch (e) {
      setMarkError("Error loading marks: " + e.message);
    }
    setMarkBusy(false);
  }

  function removeMarkColumn(key) {
    setMarkColumns((prev) => prev.filter((c) => c.key !== key));
    if (sortKey === key) setSortKey("name");
  }

  const blockSubjects = [...new Map(
    classes.filter((c) => c.subject_id).map((c) => [c.subject_id, { subject_id: c.subject_id, ...c.subjects }])
  ).values()];

  // Highest mark first; students with no mark in that column go last, by name.
  const sortCol = markColumns.find((c) => c.key === sortKey);
  const shownStudents = sortCol
    ? [...students].sort((a, b) => {
        const pa = sortCol.values?.get(a.student_id)?.pct;
        const pb = sortCol.values?.get(b.student_id)?.pct;
        if (pa == null && pb == null) return 0;
        if (pa == null) return 1;
        if (pb == null) return -1;
        return pb - pa;
      })
    : students;

  function cloneSelections(sel) {
    const out = {};
    for (const k of Object.keys(sel)) out[k] = new Set(sel[k]);
    return out;
  }

  // A compound block (Class, Pathway, Vocational) is a choice of one group per
  // student, where a group can bundle several subjects — "7A1" is every
  // subject that form group takes, Pathway "101" is Bi+Ch+Co+Cv+Ph, Year 12's
  // "Science 1" is 12a/Bi1+Ch1+Ph1. Each subject is still its own class so it
  // keeps its real teacher/room/timetable from Nova-T, but a student is never
  // in one of them without the rest, so the group is allocated as one.
  const isGroupBlock = !!block?.is_compound;

  const groups = isGroupBlock
    ? [...groupClassesByKey(classes).entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, groupClasses]) => ({
          key,
          classIds: groupClasses.map((c) => c.class_id),
          subjectsLabel: groupClasses.map((c) => c.subjects?.subject_name || c.class_code).join(", "),
        }))
    : [];

  function toggle(studentId, classId) {
    setSelections((prev) => {
      const next = cloneSelections(prev);
      const current = next[studentId] || new Set();

      if (current.has(classId)) {
        current.delete(classId);
      } else {
        current.clear(); // single choice per block
        current.add(classId);
      }
      next[studentId] = current;
      return next;
    });
  }

  function toggleGroup(studentId, groupClassIds) {
    setSelections((prev) => {
      const next = cloneSelections(prev);
      const current = next[studentId] || new Set();
      const fullySelected = groupClassIds.every((id) => current.has(id));

      if (fullySelected) {
        for (const id of groupClassIds) current.delete(id);
      } else {
        // Single group choice: drop any other group's classes first.
        for (const g of groups) {
          if (g.classIds !== groupClassIds) for (const id of g.classIds) current.delete(id);
        }
        for (const id of groupClassIds) current.add(id);
      }
      next[studentId] = current;
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setSaveStatus("Saving…");

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
      setSaveStatus("No changes to save.");
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
        setSaveStatus("Error removing allocation: " + error.message);
        setSaving(false);
        return;
      }
    }

    if (toInsert.length > 0) {
      const { error } = await supabase
        .from("student_class")
        .upsert(toInsert, { onConflict: "student_id,class_id", ignoreDuplicates: true });
      if (error) {
        setSaveStatus("Error saving allocations: " + error.message);
        setSaving(false);
        return;
      }
    }

    setInitialSelections(cloneSelections(selections));
    setSaveStatus(
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

      {!loading && classes.length > 0 && students.length > 0 && (
        <MarkColumnPicker
          year={year}
          blockSubjects={blockSubjects}
          columns={markColumns}
          onAdd={addMarkColumn}
          onRemove={removeMarkColumn}
          busy={markBusy}
        />
      )}
      {markError && (
        <p style={{ background: "#fdecec", padding: "0.5rem 0.75rem", borderRadius: 6, fontSize: "0.85rem" }}>{markError}</p>
      )}

      {isGroupBlock && (
        <p style={{ background: "#e8f4fd", padding: "0.5rem 0.75rem", borderRadius: 6, fontSize: "0.85rem" }}>
          Each column is a whole teaching group — ticking one allocates the student to every subject in that group at once (hover a column for the subject list).
        </p>
      )}

      {loading && <p>Loading…</p>}

      {!loading && blockId && classes.length === 0 && (
        <p>No classes are linked to this block yet.</p>
      )}

      {!loading && classes.length > 0 && students.length > 0 && (
        <>
          <SaveBar status={saveStatus}>
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
          </SaveBar>
          <div style={{ overflowX: "auto", border: "1px solid #ddd", borderRadius: 6 }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ background: "#f5f5f5" }}>
                  <th
                    style={{ ...thStyle, cursor: markColumns.length ? "pointer" : "default" }}
                    onClick={() => setSortKey("name")}
                    title={markColumns.length ? "Sort by name" : undefined}
                  >
                    Student{sortKey === "name" && markColumns.length ? " ▲" : ""}
                  </th>
                  <th style={thStyle}>Form</th>
                  {markColumns.map((c) => (
                    <th
                      key={c.key}
                      onClick={() => setSortKey(c.key)}
                      title="Sort by this mark, highest first"
                      style={{ ...thStyle, textAlign: "center", background: "#eef6ee", cursor: "pointer", whiteSpace: "normal", minWidth: 80, maxWidth: 130 }}
                    >
                      {c.setLabel}{sortKey === c.key ? " ▼" : ""}
                      <div style={{ fontWeight: 400, fontSize: "0.7rem", color: "#666" }}>{c.subjectLabel}</div>
                    </th>
                  ))}
                  {isGroupBlock
                    ? groups.map((g) => {
                        const count = students.filter((s) =>
                          g.classIds.every((id) => selections[s.student_id]?.has(id))
                        ).length;
                        return (
                          <th key={g.key} style={{ ...thStyle, textAlign: "center" }} title={g.subjectsLabel}>
                            {g.key}
                            <div style={{ fontWeight: 700, fontSize: "0.8rem" }}>
                              {count} student{count === 1 ? "" : "s"}
                            </div>
                            <div style={{ fontWeight: 400, fontSize: "0.7rem", color: "#666" }}>
                              {g.classIds.length} subject{g.classIds.length === 1 ? "" : "s"}
                            </div>
                          </th>
                        );
                      })
                    : classes.map((c) => {
                        const count = students.filter((s) => selections[s.student_id]?.has(c.class_id)).length;
                        return (
                          <th key={c.class_id} style={{ ...thStyle, textAlign: "center" }}>
                            {c.class_code}
                            <div style={{ fontWeight: 700, fontSize: "0.8rem" }}>
                              {count} student{count === 1 ? "" : "s"}
                            </div>
                            <div style={{ fontWeight: 400, fontSize: "0.7rem", color: "#666" }}>
                              {c.subjects?.subject_name || ""}
                              {c.staff ? ` · ${c.staff.first_name?.[0] || ""}${c.staff.last_name || ""}` : ""}
                              {c.room ? ` · ${c.room}` : ""}
                            </div>
                          </th>
                        );
                      })}
                </tr>
              </thead>
              <tbody>
                {shownStudents.map((s, i) => (
                  <tr key={s.student_id} style={{ background: i % 2 ? "#fafafa" : "#fff" }}>
                    <td style={tdStyle}>{s.last_name}, {s.first_name}</td>
                    <td style={tdStyle}>{s.form_class || ""}</td>
                    {markColumns.map((c) => {
                      const v = c.values?.get(s.student_id);
                      const avg = c.subjectId === "all";
                      return (
                        <td
                          key={c.key}
                          style={{ ...tdStyle, textAlign: "center", background: "#f6faf6" }}
                          title={v && avg ? `Average of ${v.n} mark${v.n === 1 ? "" : "s"}` : undefined}
                        >
                          {v ? `${Math.round(v.pct)}%` : <span style={{ color: "#bbb" }}>–</span>}
                          {v && !avg && v.grade ? <span style={{ color: "#666", marginLeft: 4 }}>{v.grade}</span> : null}
                        </td>
                      );
                    })}
                    {isGroupBlock
                      ? groups.map((g) => (
                          <td key={g.key} style={{ ...tdStyle, textAlign: "center" }}>
                            <input
                              type="checkbox"
                              checked={g.classIds.every((id) => selections[s.student_id]?.has(id)) || false}
                              onChange={() => toggleGroup(s.student_id, g.classIds)}
                              style={{ width: 18, height: 18 }}
                            />
                          </td>
                        ))
                      : classes.map((c) => (
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

export default function BlockAllocationPage() {
  return (
    <RequireAuth>
      <RequireResource resourceKey="/admin/block-allocation">
        <BlockAllocationInner />
      </RequireResource>
    </RequireAuth>
  );
}
