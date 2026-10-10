import { supabase } from './supabaseClient';
import { fileTypeFor, fileSizeLabel } from './homework';
import { parseCardSort } from './cardSortParse';

// Worksheets on lessons (migrations 428-430, a trial switched on by subject in
// lesson_worksheet_subjects). A worksheet is either on one lesson of a class
// (class, date and period) or on a whole year group: "Year 10 Mathematics,
// week of 12 Oct, lesson 2", which every class of that subject and year gets
// at its own 2nd lesson that week. Students see it on their timetable but can
// open it only from the start of that lesson. Files live in the private
// lesson-worksheets bucket under '<class_id>/…' or 's<subject_id>-y<year>/…'
// and open through a short-lived signed link. The database decides who may add, remove and open
// them; nothing here is the security boundary.

const BUCKET = 'lesson-worksheets';

// 3 MB a worksheet (migration 429, the principal); the bucket and the table
// refuse anything larger too.
export const WORKSHEET_MAX_BYTES = 3 * 1024 * 1024;

// Why a file can't be added as a worksheet, or null if it can.
export function worksheetFileProblem(file) {
  if (!fileTypeFor(file.name)) return `${file.name}: this type of file can't be added (PDF, Word, PowerPoint, Excel, images, text or CSV).`;
  if (file.size > WORKSHEET_MAX_BYTES) return `${file.name} is ${fileSizeLabel(file.size)}; a worksheet can be at most 3 MB.`;
  return null;
}

export function worksheetKey(date, periodNumber, classId) {
  return `${date}|${periodNumber}|${classId}`;
}

// Whether the signed-in user can add worksheets to this class's lessons
// (teaches or leads it, and the subject's department is in the trial).
export async function canAddWorksheets(classId) {
  const { data } = await supabase.rpc('can_add_lesson_worksheet', { p_class_id: Number(classId) });
  return !!data;
}

// Whether the signed-in user can add worksheets for every class of this
// subject and year.
export async function canAddYearWorksheets(subjectId, yearGroup) {
  const { data } = await supabase.rpc('can_add_year_worksheet', { p_subject_id: subjectId, p_year_group: yearGroup });
  return !!data;
}

// The class's lessons between two dates, in term and not on holidays, each
// numbered within its week: lesson_number of lessons_in_week, week_start.
export async function loadClassLessons(classId, from, to) {
  const { data, error } = await supabase.rpc('class_week_lessons', { p_class_id: Number(classId), p_from: from, p_to: to });
  return { lessons: data || [], error };
}

// Monday of a date's week, as YYYY-MM-DD.
export function mondayOf(date) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

const WORKSHEET_COLUMNS = 'worksheet_id, class_id, lesson_date, period_number, opens_at, subject_id, year_group, week_start, lesson_number, title, storage_path, file_name, size_bytes, kind, max_mark';

// Staff: the worksheets on a class's lessons between two dates: its own, and
// its year group's for that subject (matched to a lesson by week_start and
// lesson_number).
export async function loadClassWorksheets(cls, from, to) {
  const [own, year] = await Promise.all([
    supabase.from('lesson_worksheets').select(WORKSHEET_COLUMNS)
      .eq('class_id', cls.class_id).gte('lesson_date', from).lte('lesson_date', to).order('worksheet_id'),
    supabase.from('lesson_worksheets').select(WORKSHEET_COLUMNS)
      .eq('subject_id', cls.subject_id).eq('year_group', cls.year_group)
      .gte('week_start', mondayOf(from)).lte('week_start', to).order('worksheet_id'),
  ]);
  return { worksheets: [...(own.data || []), ...(year.data || [])], error: own.error || year.error };
}

// Staff: where a year worksheet lands, class by class (lesson_date null = that
// class has fewer lessons that week, so it doesn't get it).
export async function loadYearWorksheetPlacements(worksheetId) {
  const { data } = await supabase.rpc('year_worksheet_placements', { p_worksheet_id: worksheetId });
  return data || [];
}

// Students: their worksheets between two dates. Ones not open yet come back
// with is_open false and no title or file. kind is 'file' or 'card_sort'
// (migration 432; a card sort's Word file is never returned), with the
// student's card-sort mark once checked (my_score / my_out_of).
export async function loadMyWorksheets(from, to) {
  const { data, error } = await supabase.rpc('my_timetable_worksheets', { p_from: from, p_to: to });
  return { worksheets: data || [], error };
}

// The row first, then the file: the bucket's read rule goes through the row,
// so a file without one could never be opened. If the upload fails, the row
// is taken away again.
//
// A Word file in the card sort format (docs/card-sort-format.md) becomes an
// on-screen card sort (migration 432): its cards, answer key and pictures are
// saved with the worksheet. One that has an answer key but doesn't fit the
// format is refused with the reasons, rather than uploaded as a file that
// would show students the answers.
async function addWorksheet(folder, fields, file, title) {
  const type = fileTypeFor(file.name);
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const safe = file.name.replace(/[^\w.-]+/g, '_').slice(-80);
  const path = `${folder}/${stamp}-${safe}`;

  let parsed = null;
  if (/\.docx$/i.test(file.name)) {
    try {
      parsed = await parseCardSort(await file.arrayBuffer());
    } catch (e) {
      parsed = null; // not readable as a card sort: an ordinary file
    }
    if (parsed?.isCardSort && parsed.problems.length) {
      return new Error(`This looks like a card sort but doesn't fit the card sort format, so it wasn't added: ${parsed.problems.slice(0, 5).join(' ')}`);
    }
    if (!parsed?.isCardSort) parsed = null;
  }
  const sort = parsed?.sort;

  const { data: row, error } = await supabase.from('lesson_worksheets')
    .insert({
      ...fields,
      kind: sort ? 'card_sort' : 'file',
      title: (sort?.title || title || file.name).trim(), storage_path: path,
      file_name: file.name, mime_type: type, size_bytes: file.size,
    })
    .select('worksheet_id').single();
  if (error) return error;
  const id = row.worksheet_id;
  const uploaded = [];
  const undo = async (err) => {
    if (uploaded.length) await supabase.storage.from(BUCKET).remove(uploaded);
    await supabase.from('lesson_worksheets').delete().eq('worksheet_id', id);
    return err;
  };

  if (sort) {
    const imagePath = (letter) => `${folder}/${stamp}-card-${letter}.${parsed.images[letter].ext}`;
    const { error: e1 } = await supabase.from('card_sorts').insert({
      worksheet_id: id, sort_type: sort.sortType, title: sort.title, instruction: sort.instruction,
      support_text: sort.supportText, extension_text: sort.extensionText, discuss: sort.discuss,
      headers: sort.headers, set_count: sort.setCount, support: sort.support,
    });
    if (e1) return undo(e1);
    const { error: e2 } = await supabase.from('card_sort_cards').insert(sort.cards.map((c) => ({
      worksheet_id: id, letter: c.letter, body: c.body || null, position: c.position,
      image_path: c.hasImage ? imagePath(c.letter) : null,
      image_width: c.imageWidth,
    })));
    if (e2) return undo(e2);
    const { error: e3 } = await supabase.from('card_sort_key').insert(
      Object.entries(sort.key).map(([letter, label]) => ({ worksheet_id: id, letter, group_label: label })),
    );
    if (e3) return undo(e3);
    for (const [letter, img] of Object.entries(parsed.images)) {
      const p = imagePath(letter);
      const { error: e4 } = await supabase.storage.from(BUCKET)
        .upload(p, new Blob([img.data], { type: img.type }), { contentType: img.type, upsert: false });
      if (e4) return undo(e4);
      uploaded.push(p);
    }
  }

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: type, upsert: false });
  if (upErr) return undo(upErr);
  return null;
}

// On one lesson of one class.
export function addLessonWorksheet(classId, lessonDate, periodNumber, file, title) {
  return addWorksheet(String(classId), { class_id: Number(classId), lesson_date: lessonDate, period_number: periodNumber }, file, title);
}

// On every class of a subject and year, at its lesson of that number in the
// week starting weekStart (a Monday).
export function addYearWorksheet(subjectId, yearGroup, weekStart, lessonNumber, file, title) {
  return addWorksheet(`s${subjectId}-y${yearGroup}`, {
    subject_id: subjectId, year_group: yearGroup, week_start: weekStart, lesson_number: lessonNumber,
  }, file, title);
}

// The file first, then the row, so a failed removal never leaves a file
// that no row points to.
export async function removeLessonWorksheet(ws) {
  // A card sort's pictures go with it (its card rows go by cascade).
  const { data: pics } = await supabase.from('card_sort_cards').select('image_path')
    .eq('worksheet_id', ws.worksheet_id).not('image_path', 'is', null);
  const paths = [ws.storage_path, ...(pics || []).map((p) => p.image_path)];
  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error) return error;
  const { error: rowErr } = await supabase.from('lesson_worksheets').delete().eq('worksheet_id', ws.worksheet_id);
  return rowErr;
}

// Opens a worksheet in a new tab through a signed link valid for ten minutes.
// Refused by the database for a student before the lesson starts.
export async function openLessonWorksheet(ws) {
  // Opened first and pointed at the file afterwards, so the browser doesn't
  // treat it as an unrequested pop-up.
  const tab = window.open('', '_blank');
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(ws.storage_path, 600);
  if (error || !data?.signedUrl) { tab?.close(); return error || new Error('The worksheet could not be opened.'); }
  if (tab) { tab.opener = null; tab.location.href = data.signedUrl; } else window.location.href = data.signedUrl;
  return null;
}

// "10:20" from opens_at ("2026-10-12T10:20:00", school time).
export function opensAtClock(opensAt) {
  return (opensAt || '').slice(11, 16);
}
