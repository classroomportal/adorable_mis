'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import RequireAuth from '../../RequireAuth';
import { useAuth } from '../../../lib/AuthContext';
import {
  loadCardSort, loadMyCardSortMark, loadCardSortPartners, submitCardSort,
} from '../../../lib/cardSorts';

// A card sort on screen (migration 432, the principal 10 Oct 2026). Students
// work in pairs on one laptop: the signed-in student picks their partner,
// places every card (drag it, or click it and then click where it goes) and
// presses Check once. The database marks it against the answer key (which
// students never receive) and gives both the same count. Laid out for a
// laptop first: students only use laptops (the principal).

const POOL = 'pool';

function storageKey(id) { return `card-sort-${id}`; }
function loadSaved(id) {
  try { return JSON.parse(window.localStorage.getItem(storageKey(id)) || 'null'); } catch (e) { return null; }
}
function save(id, value) {
  try { window.localStorage.setItem(storageKey(id), JSON.stringify(value)); } catch (e) { /* private window */ }
}

function Card({ card, selected, locked, onClick, onDragStart }) {
  return (
    <button
      type="button"
      className={`cs-card${selected ? ' cs-selected' : ''}${locked ? ' cs-locked' : ''}`}
      onClick={onClick}
      draggable={!locked}
      onDragStart={onDragStart}
      title={locked ? 'Placed for you by "Help me start"' : 'Drag, or click then click where it goes'}
    >
      <span className="cs-letter">{card.letter}</span>
      {card.body && <span className="cs-body">{card.body}</span>}
      {card.imageUrl && (
        // Shown at the size it has on the printed sheet (a little larger), so
        // small fraction pictures don't fill the card.
        <img
          src={card.imageUrl} alt={`Card ${card.letter}`} className="cs-img" draggable={false}
          style={card.image_width ? { width: `${Math.min(Math.round(card.image_width * 1.25), 190)}px` } : undefined}
        />
      )}
      {locked && <span className="cs-help-tag">placed for you</span>}
    </button>
  );
}

function CardSortInner() {
  const { profile } = useAuth();
  const studentId = profile?.student_id;
  // Staff open it as a preview: everything but Check.
  const preview = !!profile && !studentId;
  const [worksheetId, setWorksheetId] = useState(null);
  const [sort, setSort] = useState(null);
  const [cards, setCards] = useState([]);
  const [mark, setMark] = useState(undefined); // undefined = loading, null = not done
  const [partners, setPartners] = useState([]);
  const [partnerId, setPartnerId] = useState('');
  const [started, setStarted] = useState(false);
  const [place, setPlace] = useState({}); // letter -> zone id (header text or set index)
  const [locked, setLocked] = useState([]); // letters placed by Help me start
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get('w'));
    setWorksheetId(Number.isFinite(id) && id > 0 ? id : null);
  }, []);

  const load = useCallback(async () => {
    if (!worksheetId || !profile) return;
    const [{ sort: s, cards: c, error: e }, m] = await Promise.all([
      loadCardSort(worksheetId), studentId ? loadMyCardSortMark(worksheetId, studentId) : null,
    ]);
    if (e) { setError(e.message); return; }
    setSort(s);
    setCards(c);
    setMark(m);
    if (!studentId) { setStarted(true); return; }
    if (!m) {
      setPartners(await loadCardSortPartners(worksheetId));
      const saved = loadSaved(worksheetId);
      if (saved) {
        setPlace(saved.place || {});
        setLocked(saved.locked || []);
        setPartnerId(saved.partnerId || '');
        setStarted(!!saved.started);
      }
    }
  }, [worksheetId, studentId, profile]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (worksheetId && sort && mark === null && !preview) save(worksheetId, { place, locked, partnerId, started });
  }, [worksheetId, sort, mark, place, locked, partnerId, started, preview]);

  const zones = useMemo(() => {
    if (!sort) return [];
    return sort.sort_type === 'headers'
      ? sort.headers.map((h) => ({ id: h, label: h }))
      : Array.from({ length: sort.set_count }, (_, i) => ({ id: String(i + 1), label: `Set ${i + 1}` }));
  }, [sort]);

  if (!worksheetId) return <p>No card sort chosen. Go back to your timetable and open it from the lesson.</p>;
  if (error) return <div className="card"><p>{error}</p><a href="/portal#timetable">← Back to my timetable</a></div>;
  if (!sort || mark === undefined) return <p>Loading…</p>;

  const zoneOf = (letter) => place[letter] || POOL;
  const inZone = (zone) => cards.filter((c) => zoneOf(c.letter) === zone);
  const unplaced = inZone(POOL);

  function moveTo(letter, zone) {
    if (!letter || locked.includes(letter)) return;
    setPlace((p) => {
      const next = { ...p };
      if (zone === POOL) delete next[letter]; else next[letter] = zone;
      return next;
    });
    setSelected(null);
  }

  function clickZone(zone) {
    if (selected) moveTo(selected, zone);
  }

  function dropProps(zone) {
    return {
      onDragOver: (e) => e.preventDefault(),
      onDrop: (e) => { e.preventDefault(); moveTo(e.dataTransfer.getData('text/plain'), zone); },
      onClick: () => clickZone(zone),
    };
  }

  function helpMeStart() {
    const next = { ...place };
    const lockedNow = [];
    if (sort.sort_type === 'headers') {
      (sort.support || []).forEach(({ letter, header }) => { next[letter] = header; lockedNow.push(letter); });
    } else {
      // The support set goes in the first set box that is empty.
      const used = new Set(Object.values(next));
      const free = zones.find((z) => !used.has(z.id)) || zones[0];
      (sort.support[0] || []).forEach((letter) => { next[letter] = free.id; lockedNow.push(letter); });
    }
    setPlace(next);
    setLocked(lockedNow);
  }

  async function check() {
    if (unplaced.length) { setError(null); return; }
    const partnerName = partners.find((p) => String(p.student_id) === String(partnerId))?.name;
    const who = partnerName ? `you and ${partnerName}` : 'you';
    if (!window.confirm(`You can only check once, and the result is the mark for ${who}. Check now?`)) return;
    setBusy(true);
    setError(null);
    const answer = sort.sort_type === 'headers'
      ? Object.fromEntries(cards.map((c) => [c.letter, place[c.letter]]))
      : zones.map((z) => cards.filter((c) => place[c.letter] === z.id).map((c) => c.letter)).filter((s) => s.length);
    const { result: r, error: e } = await submitCardSort(worksheetId, partnerId ? Number(partnerId) : null, answer, locked.length > 0);
    setBusy(false);
    if (e) { setError(e.message); return; }
    setResult(r);
    try { window.localStorage.removeItem(storageKey(worksheetId)); } catch (err) { /* ignore */ }
  }

  const unit = sort.sort_type === 'headers' ? 'cards' : 'sets';
  const done = result || mark;

  return (
    <div className="cs-page">
      {preview
        ? <p className="cs-support"><strong>Preview.</strong> This is what students see once their lesson starts. Try it out; Check is for students only.</p>
        : <a href="/portal#timetable" className="no-print">← Back to my timetable</a>}
      <h1 style={{ marginBottom: '0.2rem' }}>{sort.title}</h1>
      {sort.instruction && <p className="cs-instruction">{sort.instruction}</p>}

      {done ? (
        <div className="card cs-result">
          <div className="cs-result-score">{Number(done.score)} of {Number(done.out_of)} {unit} right</div>
          <p style={{ margin: '0.4rem 0 0' }}>
            {result ? 'Your mark has been saved for you' + (partnerId ? ' and your partner.' : '.') : 'You have already done this card sort.'}
            {' '}Your teacher can see it.
          </p>
        </div>
      ) : !started ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Who are you working with?</h2>
          <p style={{ marginTop: 0 }}>You both get the mark, so choose carefully. Your partner can&apos;t do this card sort again afterwards.</p>
          <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)} style={{ maxWidth: '22rem' }}>
            <option value="">Working on my own</option>
            {partners.map((p) => <option key={p.student_id} value={p.student_id}>{p.name}</option>)}
          </select>
          <div style={{ marginTop: '0.75rem' }}>
            <button type="button" onClick={() => setStarted(true)}>Start</button>
          </div>
        </div>
      ) : (
        <>
          <div className="cs-toolbar">
            <span>
              {preview ? 'Preview' : partnerId ? <>Working with <strong>{partners.find((p) => String(p.student_id) === String(partnerId))?.name}</strong></> : 'Working on your own'}
              {' · '}{cards.length - unplaced.length} of {cards.length} cards placed
            </span>
            <span style={{ display: 'flex', gap: '0.5rem' }}>
              {locked.length === 0 && (sort.support || []).length > 0 && (
                <button type="button" className="secondary" onClick={helpMeStart}>Help me start</button>
              )}
              <button type="button" onClick={check} disabled={busy || preview || unplaced.length > 0}
                title={unplaced.length ? 'Place every card first' : 'Check once'}>
                {busy ? 'Checking…' : 'Check (once only)'}
              </button>
            </span>
          </div>
          {error && <p style={{ color: '#a3232c' }}>{error}</p>}
          {locked.length > 0 && sort.support_text && (
            <p className="cs-support">{sort.support_text}</p>
          )}

          <div className="cs-board">
            <div className={`cs-zones${sort.sort_type === 'headers' ? ' cs-headers' : ''}`}>
              {zones.map((z) => (
                <div key={z.id} className={`cs-zone${selected ? ' cs-target' : ''}`} {...dropProps(z.id)}>
                  <div className="cs-zone-label">{z.label}</div>
                  <div className="cs-zone-cards">
                    {inZone(z.id).map((c) => (
                      <Card
                        key={c.letter} card={c} locked={locked.includes(c.letter)} selected={selected === c.letter}
                        onClick={(e) => {
                          e.stopPropagation();
                          // With another card picked up, clicking a card in a zone drops it there.
                          if (selected && selected !== c.letter) { moveTo(selected, z.id); return; }
                          if (!locked.includes(c.letter)) setSelected(selected === c.letter ? null : c.letter);
                        }}
                        onDragStart={(e) => e.dataTransfer.setData('text/plain', c.letter)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className={`cs-pool${selected && zoneOf(selected) !== POOL ? ' cs-target' : ''}`} {...dropProps(POOL)}>
              <div className="cs-zone-label">Cards to place{unplaced.length ? ` (${unplaced.length})` : ''}</div>
              <div className="cs-zone-cards">
                {unplaced.map((c) => (
                  <Card
                    key={c.letter} card={c} selected={selected === c.letter}
                    onClick={(e) => {
                      e.stopPropagation();
                      // A placed card picked up and dropped on the pool goes back.
                      if (selected && zoneOf(selected) !== POOL) { moveTo(selected, POOL); return; }
                      setSelected(selected === c.letter ? null : c.letter);
                    }}
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', c.letter)}
                  />
                ))}
                {unplaced.length === 0 && <p style={{ margin: 0 }}>Every card is placed. Talk it through, then press Check.</p>}
              </div>
            </div>
          </div>
        </>
      )}

      {(sort.discuss?.length > 0 || sort.extension_text) && (
        <div className="card cs-extra">
          {sort.discuss?.length > 0 && (
            <>
              <h3 style={{ marginTop: 0 }}>Discuss with your partner</h3>
              <ul>{sort.discuss.map((q, i) => <li key={i}>{q}</li>)}</ul>
            </>
          )}
          {sort.extension_text && (
            <>
              <h3>Extension</h3>
              <p style={{ whiteSpace: 'pre-line', marginBottom: 0 }}>{sort.extension_text}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function CardSortPage() {
  return <RequireAuth><CardSortInner /></RequireAuth>;
}
