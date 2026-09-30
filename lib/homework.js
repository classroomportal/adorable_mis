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

// A mark as shown to a student or teacher: "14/20", "72%", "B", "Not handed in".
export function markLabel(hw) {
  if (hw.grade) return hw.grade;
  if (hw.score === null || hw.score === undefined) return null;
  const score = Number(hw.score);
  if (hw.scheme_name === 'Percentage') return `${score}%`;
  return hw.out_of ? `${score}/${Number(hw.out_of)}` : String(score);
}

// Due / Overdue / Not handed in / Excused / Graded, for a homework returned by
// my_homework() (which only includes a mark once released).
export function homeworkStatus(hw, today = schoolToday()) {
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
