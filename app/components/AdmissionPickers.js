'use client';
// Pickers shared by the new-application form and the applicant record
// (/admissions/new, /admissions/[id]): the previous school, from the
// previous_schools lookup so one school isn't three spellings, and an
// optional sibling already at the school.
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { CURRICULA, errorText } from '../../lib/admissions';

export function schoolLabel(s) {
  if (!s) return '';
  return s.town ? `${s.name}, ${s.town}` : s.name;
}

// value: school_id or null. schools: the previous_schools rows. onAdded is
// called with the new row so the caller can add it to its list.
export function PreviousSchoolPicker({ value, schools, onChange, onAdded }) {
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', town: '', state: '', curriculum: '' });
  const [status, setStatus] = useState(null);

  const chosen = schools.find((s) => s.school_id === value);
  const q = search.trim().toLowerCase();
  const matches = q
    ? schools.filter((s) => `${s.name} ${s.town || ''} ${s.state || ''}`.toLowerCase().includes(q)).slice(0, 8)
    : [];

  async function addSchool() {
    if (!draft.name.trim()) { setStatus('Give the school a name.'); return; }
    setStatus('Adding...');
    const { data, error } = await supabase
      .from('previous_schools')
      .insert({
        name: draft.name.trim(),
        town: draft.town.trim() || null,
        state: draft.state.trim() || null,
        curriculum: draft.curriculum || null,
      })
      .select('*')
      .single();
    if (error) {
      setStatus(error.code === '23505'
        ? 'That school (in that town) is already in the list. Search for it above.'
        : errorText(error));
      return;
    }
    onAdded?.(data);
    onChange(data.school_id);
    setAdding(false);
    setDraft({ name: '', town: '', state: '', curriculum: '' });
    setSearch('');
    setStatus(null);
  }

  return (
    <fieldset style={{ border: '1px solid #ddd', borderRadius: 6, padding: '0.5rem 0.75rem' }}>
      <legend>Previous school</legend>
      {chosen ? (
        <p style={{ margin: '0 0 0.4rem' }}>
          <strong>{schoolLabel(chosen)}</strong>
          {chosen.curriculum && <span style={{ color: '#666' }}> · {chosen.curriculum}</span>}{' '}
          <button type="button" className="secondary" onClick={() => onChange(null)}>Clear</button>
        </p>
      ) : (
        <p style={{ margin: '0 0 0.4rem', color: '#666' }}>None chosen.</p>
      )}
      {!adding && (
        <>
          <input placeholder="Search schools by name or town" value={search} onChange={(e) => setSearch(e.target.value)} />
          {q && (
            <div style={{ marginTop: '0.3rem' }}>
              {matches.length === 0 && <p style={{ color: '#666', margin: '0.2rem 0' }}>No school matches.</p>}
              {matches.map((s) => (
                <button
                  key={s.school_id}
                  type="button"
                  className="secondary"
                  style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: '0.2rem' }}
                  onClick={() => { onChange(s.school_id); setSearch(''); }}
                >
                  {schoolLabel(s)}{s.state ? ` (${s.state})` : ''}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className="secondary"
            style={{ marginTop: '0.4rem' }}
            onClick={() => { setAdding(true); setDraft({ name: search.trim(), town: '', state: '', curriculum: '' }); setStatus(null); }}
          >
            + Add a new school
          </button>
        </>
      )}
      {adding && (
        <div>
          <div className="form-grid">
            <label>Name<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
            <label>Town<input value={draft.town} onChange={(e) => setDraft({ ...draft, town: e.target.value })} /></label>
            <label>State<input value={draft.state} onChange={(e) => setDraft({ ...draft, state: e.target.value })} /></label>
            <label>
              Curriculum
              <select value={draft.curriculum} onChange={(e) => setDraft({ ...draft, curriculum: e.target.value })}>
                <option value="">Not known</option>
                {CURRICULA.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button type="button" onClick={addSchool}>Add school</button>
            <button type="button" className="secondary" onClick={() => { setAdding(false); setStatus(null); }}>Cancel</button>
          </div>
        </div>
      )}
      {status && <p style={{ marginBottom: 0 }}><strong>{status}</strong></p>}
    </fieldset>
  );
}

// value: { student_id, first_name, last_name, year_group } or null.
export function SiblingPicker({ value, onChange }) {
  const [search, setSearch] = useState('');
  const [matches, setMatches] = useState([]);

  useEffect(() => {
    // Letters, spaces, hyphens and apostrophes only, so a name can't break
    // the PostgREST filter syntax.
    const words = search.replace(/[^\p{L}\s'-]/gu, ' ').trim().split(/\s+/).filter((w) => w.length >= 2);
    if (words.length === 0) { setMatches([]); return undefined; }
    const timer = setTimeout(async () => {
      let query = supabase
        .from('students')
        .select('student_id, first_name, last_name, preferred_name, year_group, form_class')
        .eq('status', 'active');
      words.forEach((w) => {
        query = query.or(`first_name.ilike.%${w}%,last_name.ilike.%${w}%,preferred_name.ilike.%${w}%`);
      });
      const { data } = await query.order('last_name').limit(10);
      setMatches(data || []);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  return (
    <fieldset style={{ border: '1px solid #ddd', borderRadius: 6, padding: '0.5rem 0.75rem' }}>
      <legend>Sibling at the school (optional)</legend>
      {value ? (
        <p style={{ margin: '0 0 0.4rem' }}>
          <strong>{value.first_name} {value.last_name}</strong>
          {value.year_group != null && <span style={{ color: '#666' }}> · Year {value.year_group}</span>}{' '}
          <button type="button" className="secondary" onClick={() => onChange(null)}>Clear</button>
        </p>
      ) : (
        <>
          <input placeholder="Search current students by name" value={search} onChange={(e) => setSearch(e.target.value)} />
          {matches.length > 0 && (
            <div style={{ marginTop: '0.3rem' }}>
              {matches.map((s) => (
                <button
                  key={s.student_id}
                  type="button"
                  className="secondary"
                  style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: '0.2rem' }}
                  onClick={() => { onChange(s); setSearch(''); setMatches([]); }}
                >
                  {s.first_name} {s.last_name} · {s.form_class || `Year ${s.year_group}`}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </fieldset>
  );
}
