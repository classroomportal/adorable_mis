"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { academicYearOf, groupBySchoolYear, schoolYearGroupLabel } from "../../lib/academicYear";
import { schoolToday } from "../../lib/schoolTime";

// Marks from chosen result sets beside the students on Class Allocation (the
// principal, 9 Oct 2026: "on the class allocation we need to see marks of
// particular result sets sometimes"), so sets can be made from a test. Each
// column is one result set and one subject, or the average of every subject
// the student has a mark in for that set. Read under the normal results RLS;
// nothing is written.

// PostgREST returns at most 1000 rows a request.
const PAGE_SIZE = 1000;
export const MAX_MARK_COLUMNS = 4;
export const ALL_SUBJECTS = "all";

function yearsAgoOf(isoDate) {
  const start = (iso) => Number(academicYearOf(iso).slice(0, 4));
  return start(schoolToday()) - start(isoDate);
}

// A set is offered for a year group if those students were in Year 7+ when it
// was sat, and, for an end-of-term exam or a special set (e.g. Year 12 mocks),
// only if it was their year group's.
export function setsForYear(sets, year) {
  return sets.filter((s) => {
    const yearThen = Number(year) - yearsAgoOf(s.event_date);
    if (yearThen < 7) return false;
    if (s.exam_year_group != null && s.exam_year_group !== yearThen) return false;
    if (s.special_year_groups?.length && !s.special_year_groups.includes(yearThen)) return false;
    return true;
  });
}

// Map of student_id -> { pct, grade, n } for one column.
export async function loadMarkColumn(set, subjectId, studentIds) {
  const values = new Map();
  if (!studentIds.length) return values;
  let rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let q = supabase
      .from("results")
      .select("result_id, student_id, score, max_score, grade")
      .in("student_id", studentIds)
      .gt("max_score", 0);
    // Older sets predate result_set_event_id and are linked by the set's date,
    // as on the Set Sheet and Top 10. A special set's marks are always tagged.
    q = set.special_year_groups?.length
      ? q.eq("result_set_event_id", set.event_id)
      : q.or(`result_set_event_id.eq.${set.event_id},and(result_set_event_id.is.null,week_start_date.eq.${set.event_date})`);
    if (subjectId !== ALL_SUBJECTS) q = q.eq("subject_id", subjectId);
    const { data, error } = await q.order("result_id").range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows = rows.concat(data || []);
    if (!data || data.length < PAGE_SIZE) break;
  }
  for (const r of rows) {
    if (r.score == null) continue;
    const cur = values.get(r.student_id) || { sum: 0, n: 0, grade: null };
    cur.sum += (Number(r.score) / Number(r.max_score)) * 100;
    cur.n += 1;
    // Rows come in result_id order, so the last grade seen is the latest.
    if (r.grade) cur.grade = r.grade;
    values.set(r.student_id, cur);
  }
  for (const v of values.values()) v.pct = v.sum / v.n;
  return values;
}

// The picker: a result set (this year group's only), a subject, Add.
export function MarkColumnPicker({ year, blockSubjects, columns, onAdd, onRemove, busy }) {
  const [sets, setSets] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [eventId, setEventId] = useState("");
  const [subjectId, setSubjectId] = useState("");

  useEffect(() => {
    supabase
      .from("calendar_events")
      .select("event_id, event_date, event_name, exam_year_group, special_year_groups")
      .eq("is_result_set", true)
      .lte("event_date", schoolToday())
      .then(({ data }) => setSets(data || []));
    supabase
      .from("subjects")
      .select("subject_id, subject_name, display_name")
      .order("subject_name")
      .then(({ data }) => setSubjects(data || []));
  }, []);

  // The block's own subject is the usual choice, so it is picked for you.
  useEffect(() => {
    setSubjectId(blockSubjects.length === 1 ? String(blockSubjects[0].subject_id) : ALL_SUBJECTS);
  }, [blockSubjects.map((s) => s.subject_id).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const offered = setsForYear(sets, year);
  useEffect(() => {
    if (eventId && !offered.some((s) => String(s.event_id) === eventId)) setEventId("");
  }, [year, sets.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const blockIds = new Set(blockSubjects.map((s) => s.subject_id));
  const others = subjects.filter((s) => !blockIds.has(s.subject_id));
  const subjectLabel = (s) => s.display_name || s.subject_name;

  function add() {
    const set = offered.find((s) => String(s.event_id) === eventId);
    if (!set || !subjectId) return;
    const subj = subjects.find((s) => String(s.subject_id) === subjectId);
    onAdd({
      key: `${set.event_id}:${subjectId}`,
      set,
      subjectId: subjectId === ALL_SUBJECTS ? ALL_SUBJECTS : Number(subjectId),
      setLabel: set.event_name,
      subjectLabel: subj ? subjectLabel(subj) : "All subjects (average)",
    });
  }

  const full = columns.length >= MAX_MARK_COLUMNS;
  const duplicate = columns.some((c) => c.key === `${eventId}:${subjectId}`);

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: "0.6rem 0.75rem", marginBottom: "1rem", background: "#fbfbfb" }}>
      <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.4rem" }}>Show marks</div>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={labelStyle}>
          Result set
          <select value={eventId} onChange={(e) => setEventId(e.target.value)} style={selectStyle}>
            <option value="">Select result set…</option>
            {groupBySchoolYear(offered).map((g) => (
              <optgroup key={g.year} label={schoolYearGroupLabel(g)}>
                {g.sets.map((s) => (
                  <option key={s.event_id} value={s.event_id}>{s.event_name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label style={labelStyle}>
          Subject
          <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} style={selectStyle}>
            {blockSubjects.length > 0 && (
              <optgroup label="This block">
                {blockSubjects.map((s) => (
                  <option key={s.subject_id} value={s.subject_id}>{subjectLabel(s)}</option>
                ))}
              </optgroup>
            )}
            <option value={ALL_SUBJECTS}>All subjects (average)</option>
            <optgroup label="Other subjects">
              {others.map((s) => (
                <option key={s.subject_id} value={s.subject_id}>{subjectLabel(s)}</option>
              ))}
            </optgroup>
          </select>
        </label>
        <button
          onClick={add}
          disabled={!eventId || !subjectId || full || duplicate || busy}
          style={{ padding: "0.45rem 0.9rem", fontSize: "0.85rem", borderRadius: 6, border: "1px solid #1a5fb4", background: "#fff", color: "#1a5fb4", cursor: "pointer" }}
        >
          {busy ? "Loading…" : "Add column"}
        </button>
      </div>
      {full && <div style={{ fontSize: "0.75rem", color: "#666", marginTop: "0.3rem" }}>Up to {MAX_MARK_COLUMNS} columns; remove one to add another.</div>}
      {columns.length > 0 && (
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
          {columns.map((c) => (
            <span key={c.key} style={{ fontSize: "0.78rem", background: "#e8f4fd", borderRadius: 12, padding: "0.15rem 0.3rem 0.15rem 0.6rem" }}>
              {c.setLabel} · {c.subjectLabel}
              <button
                onClick={() => onRemove(c.key)}
                title="Remove this column"
                style={{ marginLeft: 4, border: "none", background: "none", cursor: "pointer", fontSize: "0.85rem", color: "#555" }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const labelStyle = { display: "flex", flexDirection: "column", fontSize: "0.8rem" };
const selectStyle = { padding: "0.35rem", fontSize: "0.85rem", marginTop: "0.2rem", minWidth: 180 };
