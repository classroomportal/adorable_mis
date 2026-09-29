'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { formatUKDate } from '../../../lib/formatDate';

// Upload PDFs made outside Formwork (exam board results, external reports...)
// for a group of students in one go. Each file is matched to a student by its
// file name, the matches are checked on screen, and each PDF is published as
// a student_documents row under one title, which is what parents and students
// see in "Available documents". Re-uploading with the same title replaces that
// student's earlier copy rather than adding a second one.

const DOCUMENT_TYPE = 'uploaded';

function norm(s) {
  return (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function words(s) {
  return norm(s).split(' ').filter(Boolean);
}

function slugify(title) {
  return norm(title).replace(/ /g, '-').slice(0, 80) || 'document';
}

// Returns { studentId, how } where how is 'upn' | 'name' | 'surname' | 'ambiguous' | null.
function matchFile(fileName, students) {
  const base = fileName.replace(/\.pdf$/i, '');
  const lowered = base.toLowerCase();
  const tokens = new Set(words(base));

  const byUpn = students.filter((s) => s.upn && lowered.includes(s.upn.toLowerCase()));
  if (byUpn.length === 1) return { studentId: byUpn[0].student_id, how: 'upn' };

  const scored = [];
  const surnameOnly = [];
  for (const s of students) {
    const last = words(s.last_name);
    if (!last.length || !last.every((w) => tokens.has(w))) continue;
    const firsts = [s.first_name, s.preferred_name, s.legal_first_name]
      .map(words).filter((w) => w.length);
    const firstHit = firsts.find((w) => w.every((t) => tokens.has(t)));
    if (!firstHit) { surnameOnly.push(s); continue; }
    const middle = words(s.middle_name).filter((w) => tokens.has(w)).length;
    scored.push({ s, score: last.length + firstHit.length + middle });
  }
  if (scored.length) {
    const best = Math.max(...scored.map((x) => x.score));
    const top = scored.filter((x) => x.score === best);
    if (top.length === 1) return { studentId: top[0].s.student_id, how: 'name' };
    return { studentId: null, how: 'ambiguous' };
  }
  if (surnameOnly.length === 1) return { studentId: surnameOnly[0].student_id, how: 'surname' };
  return { studentId: null, how: surnameOnly.length > 1 ? 'ambiguous' : null };
}

const HOW_LABEL = {
  upn: { text: 'Matched by UPN', color: 'green' },
  name: { text: 'Matched by name', color: 'green' },
  surname: { text: 'Surname only — please check', color: '#8a6d00' },
  ambiguous: { text: 'More than one possible student — choose', color: '#8a6d00' },
  manual: { text: 'Chosen by hand', color: 'green' },
  none: { text: 'No match — choose a student or it will be skipped', color: 'red' },
};

function UploadDocumentsInner() {
  const [students, setStudents] = useState([]);
  const [who, setWho] = useState('current'); // current | left | all
  const [yearGroup, setYearGroup] = useState('');
  const [yearLeft, setYearLeft] = useState('');
  const [withParent, setWithParent] = useState(null); // Set of student_ids, null while unknown
  const [title, setTitle] = useState('');
  const [rows, setRows] = useState([]); // [{ key, file, studentId, how, result }]
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState(null);
  const [batches, setBatches] = useState([]);
  const [removing, setRemoving] = useState(null);

  useEffect(() => {
    supabase
      .from('students')
      .select('student_id, first_name, last_name, preferred_name, legal_first_name, middle_name, upn, year_group, status, leaving_date')
      .order('last_name')
      .order('first_name')
      .range(0, 9999)
      .then(({ data }) => setStudents(data || []));
    loadBatches();
  }, []);

  async function loadBatches() {
    const { data } = await supabase
      .from('student_documents')
      .select('id, title, storage_path, generated_at')
      .eq('document_type', DOCUMENT_TYPE)
      .order('generated_at', { ascending: false });
    const byTitle = new Map();
    for (const d of data || []) {
      const b = byTitle.get(d.title) || { title: d.title, count: 0, latest: d.generated_at, docs: [] };
      b.count += 1;
      b.docs.push(d);
      if (d.generated_at > b.latest) b.latest = d.generated_at;
      byTitle.set(d.title, b);
    }
    setBatches([...byTitle.values()]);
  }

  const byWho = useMemo(
    () => students.filter((s) => (who === 'all' ? true : who === 'left' ? s.status !== 'active' : s.status === 'active')),
    [students, who]
  );
  const yearsLeft = useMemo(
    () => [...new Set(byWho.filter((s) => s.status !== 'active' && s.leaving_date).map((s) => s.leaving_date.slice(0, 4)))].sort().reverse(),
    [byWho]
  );
  const afterYearLeft = useMemo(() => {
    if (!yearLeft || who === 'current') return byWho;
    return byWho.filter((s) => s.status !== 'active' && (yearLeft === 'none' ? !s.leaving_date : s.leaving_date?.startsWith(yearLeft)));
  }, [byWho, yearLeft, who]);
  const yearGroups = useMemo(
    () => [...new Set(afterYearLeft.map((s) => s.year_group))].sort((a, b) => a - b),
    [afterYearLeft]
  );
  const pool = useMemo(
    () => (yearGroup ? afterYearLeft.filter((s) => s.year_group === Number(yearGroup)) : afterYearLeft),
    [afterYearLeft, yearGroup]
  );
  const byId = useMemo(() => new Map(students.map((s) => [s.student_id, s])), [students]);

  // Re-match when the group changes, keeping anything chosen by hand.
  useEffect(() => {
    setRows((prev) => prev.map((r) => (r.how === 'manual' ? r : { ...r, ...matchOrNone(r.file.name) })));
  }, [pool]);

  function matchOrNone(name) {
    const m = matchFile(name, pool);
    return { studentId: m.studentId, how: m.how || 'none' };
  }

  function addFiles(fileList) {
    setStatus(null);
    const files = [...fileList];
    const notPdf = files.filter((f) => !/\.pdf$/i.test(f.name) && f.type !== 'application/pdf');
    const pdfs = files.filter((f) => !notPdf.includes(f));
    setRows((prev) => {
      const seen = new Set(prev.map((r) => r.file.name));
      const added = pdfs
        .filter((f) => !seen.has(f.name))
        .map((f) => ({ key: `${f.name}-${f.size}-${f.lastModified}`, file: f, result: null, ...matchOrNone(f.name) }));
      return [...prev, ...added].sort((a, b) => a.file.name.localeCompare(b.file.name));
    });
    if (notPdf.length) setStatus(`Left out ${notPdf.length} file${notPdf.length === 1 ? '' : 's'} that ${notPdf.length === 1 ? "isn't a PDF" : "aren't PDFs"}: ${notPdf.map((f) => f.name).join(', ')}`);
  }

  function setStudent(key, value) {
    setRows((prev) => prev.map((r) => (r.key === key
      ? { ...r, studentId: value ? Number(value) : null, how: value ? 'manual' : 'none', result: null }
      : r)));
  }

  function removeRow(key) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  const counts = useMemo(() => {
    const perStudent = new Map();
    for (const r of rows) if (r.studentId) perStudent.set(r.studentId, (perStudent.get(r.studentId) || 0) + 1);
    return perStudent;
  }, [rows]);
  const duplicates = [...counts.values()].some((n) => n > 1);

  // Which matched students have a parent who can sign in to see the document.
  const matchedKey = [...counts.keys()].sort((a, b) => a - b).join(',');
  useEffect(() => {
    const ids = matchedKey ? matchedKey.split(',').map(Number) : [];
    setWithParent(null);
    if (!ids.length) return;
    let stale = false;
    supabase.rpc('students_with_parent_login', { p_student_ids: ids })
      .then(({ data, error }) => {
        if (stale || error) return;
        setWithParent(new Set((data || []).map((x) => (typeof x === 'object' ? Object.values(x)[0] : x))));
      });
    return () => { stale = true; };
  }, [matchedKey]);
  const noParent = withParent ? [...counts.keys()].filter((id) => !withParent.has(id)) : [];
  const ready = rows.filter((r) => r.studentId);
  const needsCheck = rows.filter((r) => r.how === 'surname' || r.how === 'ambiguous').length;
  const cleanTitle = title.trim();

  // Storage sometimes answers with a gateway timeout (HTTP 504) after it has
  // in fact saved the file, so an error isn't proof nothing happened. Each
  // step is safe to repeat (the upload overwrites the same path, the row is
  // found by path and updated), so a failed file is simply tried again.
  async function withRetry(step) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt) await new Promise((res) => setTimeout(res, attempt * 3000));
      const { data, error } = await step();
      if (!error) return data;
      lastError = error;
    }
    throw lastError;
  }

  async function publishOne(r, userId) {
    const path = `${r.studentId}/${DOCUMENT_TYPE}-${slugify(cleanTitle)}.pdf`;
    await withRetry(() => supabase.storage
      .from('student-documents')
      .upload(path, r.file, { upsert: true, contentType: 'application/pdf' }));
    const payload = {
      student_id: r.studentId,
      document_type: DOCUMENT_TYPE,
      title: cleanTitle,
      storage_path: path,
      generated_at: new Date().toISOString(),
      generated_by: userId,
    };
    const existingRows = await withRetry(() => supabase
      .from('student_documents').select('id')
      .eq('student_id', r.studentId).eq('storage_path', path));
    await withRetry(() => (existingRows?.[0]
      ? supabase.from('student_documents').update(payload).eq('id', existingRows[0].id)
      : supabase.from('student_documents').insert(payload)));
  }

  async function publishRows(targets) {
    setRunning(true);
    setStatus(null);
    const keys = new Set(targets.map((r) => r.key));
    setRows((prev) => prev.map((r) => (keys.has(r.key) ? { ...r, result: 'pending' } : r)));
    const { data: { user } } = await supabase.auth.getUser();
    let ok = 0;
    for (const r of targets) {
      let result = 'ok';
      try {
        await publishOne(r, user?.id || null);
        ok += 1;
      } catch (e) {
        result = `Error: ${e.message || 'upload failed'}`;
      }
      setRows((prev) => prev.map((x) => (x.key === r.key ? { ...x, result } : x)));
    }
    setRunning(false);
    const failed = targets.length - ok;
    setStatus(failed
      ? `Published ${ok} of ${targets.length}. ${failed} failed — use "Retry failed" to try ${failed === 1 ? 'it' : 'them'} again.`
      : `Published ${ok} of ${targets.length}.`);
    loadBatches();
  }

  async function upload() {
    if (!cleanTitle) { setStatus('Give the document a title first — it is the name parents will see.'); return; }
    if (duplicates) { setStatus('Two files are matched to the same student. Fix that before uploading.'); return; }
    if (!ready.length) { setStatus('No files are matched to a student yet.'); return; }
    const skipped = rows.length - ready.length;
    const existing = batches.find((b) => b.title === cleanTitle);
    const lines = [
      `Publish ${ready.length} document${ready.length === 1 ? '' : 's'} as "${cleanTitle}"?`,
      'Parents and students will be able to see and download them straight away.',
    ];
    if (skipped) lines.push(`${skipped} file${skipped === 1 ? ' has' : 's have'} no student and will be skipped.`);
    if (existing) lines.push(`"${cleanTitle}" already exists for ${existing.count} student${existing.count === 1 ? '' : 's'}; their earlier copy will be replaced.`);
    if (!window.confirm(lines.join('\n\n'))) return;
    setRows((prev) => prev.map((r) => (r.studentId ? r : { ...r, result: 'skipped' })));
    await publishRows(ready);
  }

  const failedRows = rows.filter((r) => r.studentId && r.result && r.result.startsWith('Error'));

  async function removeBatch(batch) {
    if (!window.confirm(`Remove "${batch.title}" for all ${batch.count} student${batch.count === 1 ? '' : 's'}? Parents will no longer see it. This can't be undone.`)) return;
    setRemoving(batch.title);
    setStatus(null);
    const { error: storageError } = await supabase.storage
      .from('student-documents')
      .remove(batch.docs.map((d) => d.storage_path));
    const { error: dbError } = storageError
      ? { error: null }
      : await supabase.from('student_documents').delete().in('id', batch.docs.map((d) => d.id));
    setRemoving(null);
    const err = storageError || dbError;
    setStatus(err ? `Couldn't remove "${batch.title}": ${err.message}` : `Removed "${batch.title}".`);
    loadBatches();
  }

  const studentLabel = (s) => `${s.last_name}, ${s.preferred_name || s.first_name} (${s.status === 'active'
    ? `Year ${s.year_group}`
    : `left${s.leaving_date ? ` ${s.leaving_date.slice(0, 4)}` : ''}, Year ${s.year_group}`})`;

  return (
    <div>
      <h1>Upload Documents</h1>
      <p>
        Publish PDFs made outside Formwork to a group of students. Name each file after its student (for example
        <em> Ada Okafor.pdf</em> or <em>OKAFOR Ada - mock results.pdf</em>, or include the UPN). Each one is matched
        to a student and appears for that student&apos;s parents under &quot;Available documents&quot;.
      </p>

      <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <label>
          Title parents will see
          <input
            type="text"
            value={title}
            maxLength={120}
            placeholder="e.g. IGCSE Mock Results — January 2027"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <label style={{ flex: '1 1 180px' }}>
            Students
            <select value={who} onChange={(e) => { setWho(e.target.value); setYearLeft(''); setYearGroup(''); }}>
              <option value="current">Current students</option>
              <option value="left">Students who have left</option>
              <option value="all">Current and left</option>
            </select>
          </label>
          {who !== 'current' && (
            <label style={{ flex: '1 1 150px' }}>
              Year left
              <select value={yearLeft} onChange={(e) => { setYearLeft(e.target.value); setYearGroup(''); }}>
                <option value="">Any year</option>
                {yearsLeft.map((y) => <option key={y} value={y}>{y}</option>)}
                <option value="none">No leaving date</option>
              </select>
            </label>
          )}
          <label style={{ flex: '1 1 150px' }}>
            {who === 'current' ? 'Year group' : 'Year group (last year group for leavers)'}
            <select value={yearGroup} onChange={(e) => setYearGroup(e.target.value)}>
              <option value="">All year groups</option>
              {yearGroups.map((y) => <option key={y} value={y}>Year {y}</option>)}
            </select>
          </label>
        </div>
        <p style={{ color: '#666', fontSize: '0.9rem', margin: 0 }}>
          Matching against {pool.length} student{pool.length === 1 ? '' : 's'}.
        </p>

        <label>
          PDF files
          <input
            type="file"
            accept="application/pdf,.pdf"
            multiple
            onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
          />
        </label>

        {rows.length > 0 && (
          <p style={{ color: '#666', fontSize: '0.9rem', margin: 0 }}>
            {rows.length} file{rows.length === 1 ? '' : 's'} — {ready.length} matched
            {needsCheck ? `, ${needsCheck} to check` : ''}
            {rows.length - ready.length ? `, ${rows.length - ready.length} with no student (will be skipped)` : ''}.
          </p>
        )}

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button onClick={upload} disabled={running || !ready.length || !cleanTitle || duplicates} style={{ width: 'fit-content' }}>
            {running ? 'Uploading...' : `Publish ${ready.length} document${ready.length === 1 ? '' : 's'}`}
          </button>
          {failedRows.length > 0 && !running && (
            <button type="button" onClick={() => publishRows(failedRows)} disabled={!cleanTitle} style={{ width: 'fit-content' }}>
              Retry failed ({failedRows.length})
            </button>
          )}
          {rows.length > 0 && !running && (
            <button type="button" className="secondary" onClick={() => { setRows([]); setStatus(null); }} style={{ width: 'fit-content' }}>
              Clear list
            </button>
          )}
        </div>
        {noParent.length > 0 && (
          <p style={{ color: '#8a6d00', margin: 0 }}>
            {noParent.length} matched student{noParent.length === 1 ? ' has' : 's have'} no parent with a Formwork login, so
            no parent will see {noParent.length === 1 ? 'that document' : 'those documents'} until one is linked. They are marked below.
          </p>
        )}
        {duplicates && <p style={{ color: 'red', margin: 0 }}>Two or more files are matched to the same student — highlighted below.</p>}
        {status && <p style={{ margin: 0 }}>{status}</p>}
      </div>

      {rows.length > 0 && (
        <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <h2>Files</h2>
          <div className="table-scroll"><table>
            <thead><tr><th>File</th><th>Student</th><th>Match</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const how = HOW_LABEL[r.how] || HOW_LABEL.none;
                const dup = r.studentId && counts.get(r.studentId) > 1;
                const chosen = r.studentId ? byId.get(r.studentId) : null;
                const options = chosen && !pool.includes(chosen) ? [chosen, ...pool] : pool;
                return (
                  <tr key={r.key} style={dup ? { background: '#fdecea' } : undefined}>
                    <td style={{ wordBreak: 'break-word' }}>{r.file.name}</td>
                    <td>
                      <select value={r.studentId || ''} onChange={(e) => setStudent(r.key, e.target.value)} disabled={running}>
                        <option value="">— No student (skip) —</option>
                        {options.map((s) => <option key={s.student_id} value={s.student_id}>{studentLabel(s)}</option>)}
                      </select>
                    </td>
                    <td style={{ color: r.result ? undefined : how.color, fontSize: '0.9rem' }}>
                      {r.result === 'ok' && <span style={{ color: 'green' }}>Published</span>}
                      {r.result === 'pending' && <span style={{ color: '#666' }}>Waiting...</span>}
                      {r.result === 'skipped' && <span style={{ color: '#666' }}>Skipped</span>}
                      {r.result && r.result.startsWith('Error') && <span style={{ color: 'red' }}>{r.result}</span>}
                      {!r.result && (dup ? <span style={{ color: 'red' }}>Same student as another file</span> : how.text)}
                      {!r.result && r.studentId && withParent && !withParent.has(r.studentId) && (
                        <div style={{ color: '#8a6d00', fontSize: '0.8rem' }}>No parent login — parents won&apos;t see it yet</div>
                      )}
                    </td>
                    <td>
                      <button type="button" className="secondary" onClick={() => removeRow(r.key)} disabled={running} style={{ fontSize: '0.8rem' }}>
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </div>
      )}

      <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <h2>Uploaded documents</h2>
        {batches.length === 0 ? (
          <p style={{ color: '#666', margin: 0 }}>Nothing uploaded yet.</p>
        ) : (
          <div className="table-scroll"><table>
            <thead><tr><th>Title</th><th>Students</th><th>Last uploaded</th><th></th></tr></thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.title}>
                  <td>{b.title}</td>
                  <td>{b.count}</td>
                  <td>{formatUKDate(b.latest.slice(0, 10))}</td>
                  <td>
                    <button type="button" className="secondary" onClick={() => removeBatch(b)} disabled={removing === b.title || running} style={{ fontSize: '0.8rem' }}>
                      {removing === b.title ? 'Removing...' : 'Remove for everyone'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}

export default function UploadDocumentsPage() {
  return (
    <RequireAuth><RequireResource resourceKey="/reports/documents">
      <UploadDocumentsInner />
    </RequireResource></RequireAuth>
  );
}
