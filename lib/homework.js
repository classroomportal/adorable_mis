import { supabase } from './supabaseClient';
import { schoolToday } from './schoolTime';

// Homework (migration 278, docs/homework-design.md). Homework grades sit
// outside reporting: nothing here is read by reports, transcripts or result
// sets. What a student may see is decided in the database by my_homework(),
// which returns the signed-in student's own homework and, once the teacher has
// released them, their own marks for the current academic year only.

export const DAY_KEYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const OUTCOMES = ['Not handed in', 'Excused'];

// Date arithmetic on YYYY-MM-DD strings, done at UTC midnight so the device's
// timezone can't shift a day.
export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dayKey(iso) {
  return DAY_KEYS[(new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7];
}

export function weekStartOf(iso) {
  return addDays(iso, -DAY_KEYS.indexOf(dayKey(iso)));
}

// The week a student most likely wants: this one, or next week at the weekend.
export function defaultWeekStart() {
  const today = schoolToday();
  const k = dayKey(today);
  return k === 'Sat' || k === 'Sun' ? addDays(weekStartOf(today), 7) : weekStartOf(today);
}

// "Tue 6 Oct"
export function shortDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${dayKey(iso)} ${d.getUTCDate()} ${d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}`;
}

export async function loadMyHomework(from, to) {
  const { data, error } = await supabase.rpc('my_homework', { p_from: from, p_to: to });
  return { homework: data || [], error };
}

// The signed-in student's homework to do in a week (migration 352): each
// homework sits on its prep evening (the evening before its deadline), or
// on the earlier day the student has moved it to for their own planning
// (homework_plans). The homework table's student policy and the plans' own
// policy decide which rows come back; the rest of each homework (status,
// tick, grade) comes from my_homework(), so the cards match the rest of the
// portal. Returns my_homework() rows with prep_on, plan_on, minutes and
// show_on (the day the card is shown on) added.
export async function loadMyPrepHomework(weekStart) {
  const weekEnd = addDays(weekStart, 6);
  const cols = 'homework_id, prep_on, minutes, due_on';
  const [{ data: onPrep, error }, { data: movedHere }] = await Promise.all([
    supabase.from('homework').select(cols).eq('status', 'set').gte('prep_on', weekStart).lte('prep_on', weekEnd),
    supabase.from('homework_plans').select('homework_id, plan_on').gte('plan_on', weekStart).lte('plan_on', weekEnd),
  ]);
  if (error) return { homework: [], error };
  const rows = Object.fromEntries((onPrep || []).map((h) => [h.homework_id, h]));
  const extraIds = (movedHere || []).map((p) => p.homework_id).filter((id) => !rows[id]);
  if (extraIds.length) {
    const { data } = await supabase.from('homework').select(cols).eq('status', 'set').in('homework_id', extraIds);
    (data || []).forEach((h) => { rows[h.homework_id] = h; });
  }
  const ids = Object.keys(rows).map(Number);
  if (!ids.length) return { homework: [], error: null };
  const { data: plans } = await supabase.from('homework_plans').select('homework_id, plan_on').in('homework_id', ids);
  const planOf = Object.fromEntries((plans || []).map((p) => [p.homework_id, p.plan_on]));
  const firstDay = Object.values(planOf).reduce((m, d) => (d < m ? d : m), weekStart);
  const lastDue = Object.values(rows).reduce((m, h) => (h.due_on > m ? h.due_on : m), weekEnd);
  const { homework } = await loadMyHomework(firstDay, lastDue);
  return {
    homework: homework.filter((h) => rows[h.homework_id]).map((h) => {
      const r = rows[h.homework_id];
      // A graded homework stays on its prep evening, showing its grade (the
      // principal, 4 Oct 2026): the student's plan no longer moves it.
      const planOn = h.marked ? null : planOf[h.homework_id] || null;
      return { ...h, prep_on: r.prep_on, minutes: r.minutes, plan_on: planOn, show_on: planOn || r.prep_on };
    }).filter((h) => h.show_on >= weekStart && h.show_on <= weekEnd),
    error: null,
  };
}

// A student moves a homework's card to an earlier day for their own
// planning, or (day null, or its prep evening) back to its prep evening.
// The database only accepts their own plans, from today up to the day
// before the prep evening.
export async function setHomeworkPlan(hw, studentId, day) {
  if (!day || day === hw.prep_on) {
    const { error } = await supabase.from('homework_plans').delete()
      .eq('homework_id', hw.homework_id).eq('student_id', studentId);
    return error;
  }
  const { error } = await supabase.from('homework_plans')
    .upsert({ homework_id: hw.homework_id, student_id: studentId, plan_on: day }, { onConflict: 'homework_id,student_id' });
  return error;
}

// { 'YYYY-MM-DD': [homework…] } by the day each card is shown on (its plan
// or its prep evening), for each day of the week.
export function groupPrepByDay(homework, weekStart) {
  const byDay = {};
  for (let i = 0; i < 7; i += 1) byDay[addDays(weekStart, i)] = [];
  for (const hw of homework) {
    const day = hw.show_on || hw.prep_on;
    if (byDay[day]) byDay[day].push(hw);
  }
  return byDay;
}

// A mark as shown to a student or teacher: "14/20", "72%", "B", "Not handed in".
// A mark comes with the grade the database worked out from the subject's
// boundaries (migration 289): "11/14 · B".
export function markLabel(hw) {
  if (hw.score === null || hw.score === undefined) return hw.grade || null;
  const score = Number(hw.score);
  const mark = hw.scheme_name === 'Percentage' ? `${score}%` : hw.out_of ? `${score}/${Number(hw.out_of)}` : String(score);
  return hw.grade ? `${mark} · ${hw.grade}` : mark;
}

// The grade a percentage gets from a subject's boundaries, as the database
// works it out (migration 289): the highest band whose minimum it reaches.
// Used only to show the grade while a teacher types; the saved grade is the
// database's.
export function gradeFromBoundaries(pct, boundaries) {
  const band = (boundaries || [])
    .filter((b) => Number(b.min_score) <= Math.round(pct * 100) / 100)
    .sort((a, b) => Number(b.min_score) - Number(a.min_score))[0];
  return band ? band.grade : null;
}

// A term's homework for reports (migration 291): per student and subject,
// the average of number-marked homework due in the report period's term (any
// class, so it follows a student who changed class), its grade from the
// subject's boundaries, and how many were marked and not handed in. The
// database decides whose summaries the caller may see.
// Returns { "studentId:subjectId": { average_pct, grade, marked, not_handed_in } }.
export async function loadHomeworkReportSummary(reportPeriodId, studentIds, subjectId = null) {
  if (!reportPeriodId || !studentIds?.length) return {};
  const { data } = await supabase.rpc('homework_report_summary', {
    p_report_period_id: Number(reportPeriodId), p_student_ids: studentIds, p_subject_id: subjectId,
  });
  return Object.fromEntries((data || []).map((r) => [`${r.student_id}:${r.subject_id}`, r]));
}

// "72% · B, 5 marked, 1 not handed in", for staff.
export function homeworkSummaryLabel(h) {
  if (!h) return null;
  const parts = [];
  if (h.average_pct != null) parts.push(`${Math.round(Number(h.average_pct))}%${h.grade ? ` · ${h.grade}` : ''}`);
  parts.push(`${h.marked} marked`);
  if (h.not_handed_in) parts.push(`${h.not_handed_in} not handed in`);
  return parts.join(', ');
}

// The report's Homework judgement suggested from the term's average (the
// principal, 30 Sept 2026): 80%+ Excellent, 60–79 Good, 40–59 Satisfactory,
// under 40 Needs Improvement. Only a starting value: the teacher can change it.
export function suggestedHomeworkJudgement(h) {
  if (!h || h.average_pct == null) return null;
  const pct = Number(h.average_pct);
  if (pct >= 80) return 'Excellent';
  if (pct >= 60) return 'Good';
  if (pct >= 40) return 'Satisfactory';
  return 'Needs Improvement';
}

// Due / Overdue / Not handed in / Excused / Graded, for a homework returned by
// my_homework() (which only includes a mark once released).
export function homeworkStatus(hw, today = schoolToday()) {
  // Staff views that judge the class's marking rather than one student's
  // homework (the Homework Monitor's year view) supply their own status.
  if (hw.status_override) return hw.status_override;
  if (hw.marked) {
    if (OUTCOMES.includes(hw.grade)) return { key: hw.grade === 'Excused' ? 'excused' : 'missing', label: hw.grade };
    return { key: 'graded', label: `Graded: ${markLabel(hw)}` };
  }
  // The student's own tick (migration 288). A grade, once released, wins.
  if (hw.done) return { key: 'done', label: 'Done ✓' };
  if (hw.due_on < today) return { key: 'overdue', label: 'Overdue' };
  if (hw.due_on === today) return { key: 'today', label: 'Due today' };
  return { key: 'due', label: 'Due' };
}

// Still to do: not ticked done and no grade yet.
export function isOutstanding(hw) {
  return !hw.done && !hw.marked;
}

// A student ticks (or unticks) their own homework as done (migration 288).
// The database only accepts it for the signed-in student, on homework they
// can see, and stamps the time itself.
export async function setHomeworkDone(homeworkId, studentId, done) {
  const { error } = done
    ? await supabase.from('homework_done').insert({ homework_id: homeworkId, student_id: studentId })
    : await supabase.from('homework_done').delete().eq('homework_id', homeworkId).eq('student_id', studentId);
  // Ticking twice (two tabs) is not a problem worth reporting.
  return error?.code === '23505' ? null : error;
}

// Attach each homework to the timetable cell of the lesson it's due in. The
// cellMap entries must carry classId. Homework with no lesson goes in the
// class's first lesson that day; if the class has no lesson that day it is
// returned in `unplaced[day]` for a strip under that day's heading.
export function placeHomeworkInCells(cellMap, homework, periods) {
  const unplaced = {};
  const periodOrder = (periods || []).map((p) => p.period_number);
  for (const hw of homework) {
    const day = dayKey(hw.due_on);
    let target = null;
    if (hw.due_period != null) {
      target = (cellMap[`${day}-${hw.due_period}`] || []).find((e) => e.classId === hw.class_id);
    }
    if (!target) {
      for (const p of periodOrder) {
        target = (cellMap[`${day}-${p}`] || []).find((e) => e.classId === hw.class_id);
        if (target) break;
      }
    }
    if (target) target.homework = [...(target.homework || []), hw];
    else unplaced[day] = [...(unplaced[day] || []), hw];
  }
  return unplaced;
}

// { 'YYYY-MM-DD': [homework…] } for each day of the week starting weekStart.
export function groupHomeworkByDay(homework, weekStart) {
  const byDay = {};
  for (let i = 0; i < 7; i += 1) byDay[addDays(weekStart, i)] = [];
  for (const hw of homework) if (byDay[hw.due_on]) byDay[hw.due_on].push(hw);
  return byDay;
}

// Instructions are plain text. Only https links become links; nothing else
// is rendered as markup.
export function linkifyParts(text) {
  if (!text) return [];
  return text.split(/(https:\/\/[^\s<>"]+)/g).map((part, i) => ({
    text: part,
    isLink: i % 2 === 1,
  }));
}

// ---- Attachments (migration 281): files and links a teacher adds ----------
// Files live in the private homework-files bucket under '<homework_id>/…' and
// open through a short-lived signed link. Who may add, remove or see them is
// decided by the database (the homework's own rules).

export const HOMEWORK_FILE_MAX_BYTES = 20 * 1024 * 1024;
// Extension -> type, the same list the bucket accepts. Browsers sometimes give
// no type for Office files, so the type is taken from the extension.
const FILE_TYPES = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  odt: 'application/vnd.oasis.opendocument.text',
  odp: 'application/vnd.oasis.opendocument.presentation',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  txt: 'text/plain', csv: 'text/csv',
};
export const HOMEWORK_FILE_ACCEPT = Object.keys(FILE_TYPES).map((e) => `.${e}`).join(',');

// The type the bucket expects for a file name, or undefined if not accepted.
export function fileTypeFor(name) {
  return FILE_TYPES[(name.split('.').pop() || '').toLowerCase()];
}

export function homeworkFileProblem(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!FILE_TYPES[ext]) return `${file.name}: this type of file can't be attached (PDF, Word, PowerPoint, Excel, images, text or CSV).`;
  if (file.size > HOMEWORK_FILE_MAX_BYTES) return `${file.name} is over 20 MB.`;
  return null;
}

export function isHttpsLink(url) {
  return /^https:\/\/[^\s<>"]+$/.test((url || '').trim());
}

export async function loadAttachments(homeworkId) {
  const { data } = await supabase.from('homework_attachments')
    .select('attachment_id, homework_id, kind, title, url, storage_path, file_name, mime_type, size_bytes')
    .eq('homework_id', homeworkId)
    .order('attachment_id');
  return data || [];
}

export async function addHomeworkLink(homeworkId, title, url) {
  const { error } = await supabase.from('homework_attachments')
    .insert({ homework_id: homeworkId, kind: 'link', title: title.trim() || url.trim(), url: url.trim() });
  return error;
}

// The row first, then the file: a file only exists once its row does, so it
// can always be opened and removed (the bucket's read and delete rules go
// through the row). If the upload fails, the row is taken away again.
export async function addHomeworkFile(homeworkId, file, title) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const safe = file.name.replace(/[^\w.-]+/g, '_').slice(-80);
  const path = `${homeworkId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
  const { data: row, error } = await supabase.from('homework_attachments')
    .insert({
      homework_id: homeworkId, kind: 'file', title: (title || file.name).trim(), storage_path: path,
      file_name: file.name, mime_type: FILE_TYPES[ext], size_bytes: file.size,
    })
    .select('attachment_id').single();
  if (error) return error;
  const { error: upErr } = await supabase.storage.from('homework-files')
    .upload(path, file, { contentType: FILE_TYPES[ext], upsert: false });
  if (upErr) {
    await supabase.from('homework_attachments').delete().eq('attachment_id', row.attachment_id);
    return upErr;
  }
  return null;
}

// The file first (its delete rule needs the row), then the row.
export async function removeAttachment(att) {
  if (att.kind === 'file') {
    const { error } = await supabase.storage.from('homework-files').remove([att.storage_path]);
    if (error) return error;
  }
  const { error } = await supabase.from('homework_attachments').delete().eq('attachment_id', att.attachment_id);
  return error;
}

// Opens a file in a new tab through a signed link valid for ten minutes.
export async function openAttachment(att) {
  if (att.kind === 'link') { window.open(att.url, '_blank', 'noopener,noreferrer'); return null; }
  // Opened first and pointed at the file afterwards, so the browser doesn't
  // treat it as an unrequested pop-up.
  const tab = window.open('', '_blank');
  const { data, error } = await supabase.storage.from('homework-files').createSignedUrl(att.storage_path, 600);
  if (error || !data?.signedUrl) { tab?.close(); return error || new Error('The file could not be opened.'); }
  if (tab) { tab.opener = null; tab.location.href = data.signedUrl; } else window.location.href = data.signedUrl;
  return null;
}

export function fileSizeLabel(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
