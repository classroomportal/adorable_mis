import JSZip from 'jszip';

// Reads a card sort from its Word file (docs/card-sort-format.md) in the
// teacher's browser, before upload (migration 432). Returns the cards, the
// answer key and the rest of the sheet, or problems explaining what doesn't
// fit the format. Students never get the Word file: the answer key goes to
// card_sort_key, which they can't read, and checking is done by
// submit_card_sort().

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';

const LETTER = /^[A-Z]{1,2}$/;
const BOXES = { 'set 4 support': 'support', 'set 1 extension': 'extension', 'discuss with your partner': 'discuss' };

function kids(el, name, ns = W) {
  return Array.from(el.childNodes).filter((n) => n.nodeType === 1 && n.localName === name && n.namespaceURI === ns);
}

// One paragraph: its text (tabs as spaces, line breaks as \n) and pictures,
// with the width each picture has in the Word file (in screen pixels).
function readParagraph(p) {
  let text = '';
  const images = [];
  const widths = [];
  const walk = (node) => {
    Array.from(node.childNodes).forEach((n) => {
      if (n.nodeType !== 1) return;
      if (n.namespaceURI === W && n.localName === 't') text += n.textContent;
      else if (n.namespaceURI === W && n.localName === 'tab') text += ' ';
      else if (n.namespaceURI === W && (n.localName === 'br' || n.localName === 'cr')) text += '\n';
      else if (n.namespaceURI === WP && (n.localName === 'inline' || n.localName === 'anchor')) {
        const ext = Array.from(n.childNodes).find((x) => x.nodeType === 1 && x.localName === 'extent');
        const before = images.length;
        walk(n);
        if (images.length > before) widths[images.length - 1] = ext ? Math.round(Number(ext.getAttribute('cx')) / 9525) : null;
      } else if (n.namespaceURI === A && n.localName === 'blip') {
        const id = n.getAttributeNS(R, 'embed') || n.getAttribute('r:embed');
        if (id) images.push(id);
      } else walk(n);
    });
  };
  walk(p);
  return { text: text.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim(), images, widths };
}

function readCell(tc) {
  return kids(tc, 'p').map(readParagraph);
}

function readTable(tbl) {
  return kids(tbl, 'tr').map((tr) => kids(tr, 'tc').map(readCell));
}

const norm = (s) => (s || '').toLowerCase().replace(/[‘’'"“”]/g, '').replace(/\s+/g, ' ').trim();

// file: an ArrayBuffer of the .docx. DOMParserImpl: the browser's DOMParser
// (passed in so the same code can be tested outside a browser).
export async function parseCardSort(file, DOMParserImpl = globalThis.DOMParser) {
  const zip = await JSZip.loadAsync(file);
  const docXml = await zip.file('word/document.xml')?.async('string');
  if (!docXml) return { isCardSort: false };
  const relsXml = await zip.file('word/_rels/document.xml.rels')?.async('string');
  const dom = new DOMParserImpl().parseFromString(docXml, 'application/xml');
  const body = dom.getElementsByTagNameNS(W, 'body')[0];
  if (!body) return { isCardSort: false };

  const rels = {};
  if (relsXml) {
    const rd = new DOMParserImpl().parseFromString(relsXml, 'application/xml');
    Array.from(rd.getElementsByTagName('Relationship')).forEach((r) => { rels[r.getAttribute('Id')] = r.getAttribute('Target'); });
  }

  // Walk the body in order, remembering the last heading paragraph.
  const intro = [];
  const boxes = {};
  let cardsTable = null;
  let keyTable = null;
  let lastHeading = '';
  let seenTable = false;
  Array.from(body.childNodes).forEach((n) => {
    if (n.nodeType !== 1 || n.namespaceURI !== W) return;
    if (n.localName === 'p') {
      const { text } = readParagraph(n);
      if (!text) return;
      if (!seenTable) intro.push(text);
      lastHeading = text;
    } else if (n.localName === 'tbl') {
      seenTable = true;
      const rows = readTable(n);
      const first = rows[0]?.[0]?.find((p) => p.text)?.text || '';
      const box = BOXES[norm(first)];
      if (rows.length === 1 && rows[0].length === 1 && box) {
        boxes[box] = rows[0][0].map((p) => p.text).filter(Boolean).slice(1);
      } else if (/^answer key/i.test(lastHeading)) {
        keyTable = keyTable || rows;
      } else if (/blank cards/i.test(lastHeading)) {
        // Blank cards for students' own set: ignored.
      } else if (!cardsTable) {
        cardsTable = rows;
      }
    }
  });

  if (!keyTable) return { isCardSort: false };

  const problems = [];
  const [title = '', subtitle = '', ...instructionLines] = intro;

  // Cards, and headers (a first row of cells with no letter).
  const cards = [];
  let headers = null;
  (cardsTable || []).forEach((row, ri) => {
    const cells = row.map((paras) => {
      const nonEmpty = paras.filter((p) => p.text || p.images.length);
      const first = nonEmpty[0];
      if (first && LETTER.test(first.text) && !first.images.length) {
        const rest = nonEmpty.slice(1);
        return {
          letter: first.text,
          body: rest.map((p) => p.text).filter(Boolean).join('\n'),
          imageId: rest.flatMap((p) => p.images)[0] || null,
          imageWidth: rest.flatMap((p) => p.images.map((_, i) => p.widths[i] || null))[0] || null,
        };
      }
      return first ? { header: nonEmpty.map((p) => p.text).join(' ').trim() } : null;
    });
    if (ri === 0 && cells.some((c) => c?.header) && !cells.some((c) => c?.letter)) {
      headers = cells.filter((c) => c?.header).map((c) => c.header);
      return;
    }
    cells.forEach((c) => {
      if (c?.letter) cards.push(c);
      else if (c?.header) problems.push(`A card in the cards table has no letter: "${c.header.slice(0, 40)}".`);
    });
  });
  if (!cardsTable) problems.push('The cards table wasn\'t found.');

  // Answer key: label -> letters.
  const groups = [];
  keyTable.forEach((row) => {
    if (row.length < 2) return;
    const label = row[0].map((p) => p.text).filter(Boolean).join(' ').trim();
    const letters = [];
    row[1].forEach((p) => {
      const m = p.text.match(/^([A-Z]{1,2})\s*:/);
      if (m) letters.push(m[1]);
    });
    if (label && letters.length) groups.push({ label, letters });
  });

  const byLetter = new Map();
  cards.forEach((c) => {
    if (byLetter.has(c.letter)) problems.push(`Card ${c.letter} appears twice.`);
    byLetter.set(c.letter, c);
    if (!c.body && !c.imageId) problems.push(`Card ${c.letter} is empty.`);
  });
  const key = {};
  groups.forEach((g) => g.letters.forEach((l) => {
    if (key[l]) problems.push(`Card ${l} is in the answer key twice.`);
    key[l] = g.label;
    if (!byLetter.has(l)) problems.push(`The answer key lists card ${l}, which isn't in the cards table.`);
  }));
  cards.forEach((c) => { if (!key[c.letter]) problems.push(`Card ${c.letter} isn't in the answer key.`); });
  if (groups.length < 2) problems.push('The answer key needs at least two sets or headers.');

  const sortType = headers ? 'headers' : 'sets';
  if (headers) {
    groups.forEach((g) => {
      if (!headers.some((h) => norm(h) === norm(g.label))) problems.push(`The answer key's "${g.label}" isn't one of the headers.`);
    });
    // Use the headers' own wording for the key.
    groups.forEach((g) => {
      const h = headers.find((x) => norm(x) === norm(g.label));
      if (h) { g.label = h; g.letters.forEach((l) => { key[l] = h; }); }
    });
  }

  // "Help me start": the cards the support box places.
  const supportLines = boxes.support || [];
  let support = [];
  if (sortType === 'sets') {
    const m = supportLines.join(' ').match(/already matched for you\s*\(([^)]+)\)/i);
    if (m) {
      const tok = m[1].trim().replace(/^set\s+/i, '');
      const g = groups.find((x) => {
        const lab = x.label.replace(/^set\s+/i, '');
        return norm(lab) === norm(tok) || norm(lab.split(':')[0]) === norm(tok);
      });
      if (g) support = [g.letters.slice()];
      else problems.push(`The support box names "${m[1]}", which isn't a set in the answer key.`);
    }
  } else {
    supportLines.forEach((line) => {
      const m = line.match(/goes under\s*['‘’"“]([^'’"”]+)['’"”]\s*:\s*(.+)$/i);
      if (!m) return;
      const header = headers.find((h) => norm(h) === norm(m[1]));
      const what = m[2].trim();
      const card = LETTER.test(what) ? byLetter.get(what) : cards.find((c) => norm(c.body) === norm(what));
      if (!header || !card) problems.push(`The support box line "${line.slice(0, 60)}" doesn't match a header and card.`);
      else support.push({ letter: card.letter, header });
    });
  }

  // Pictures.
  const images = {};
  for (const c of cards) {
    if (!c.imageId) continue;
    const target = rels[c.imageId];
    const path = target ? (target.startsWith('/') ? target.slice(1) : `word/${target}`) : null;
    const f = path && zip.file(path);
    if (!f) { problems.push(`Card ${c.letter}'s picture wasn't found in the file.`); continue; }
    const ext = path.split('.').pop().toLowerCase();
    const type = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }[ext];
    if (!type) { problems.push(`Card ${c.letter}'s picture is a .${ext}; use PNG.`); continue; }
    images[c.letter] = { data: await f.async('uint8array'), ext: ext === 'jpeg' ? 'jpg' : ext, type };
  }

  return {
    isCardSort: true,
    problems: [...new Set(problems)],
    sort: {
      title,
      subtitle,
      instruction: instructionLines.join('\n'),
      supportText: supportLines.join('\n'),
      extensionText: (boxes.extension || []).join('\n'),
      discuss: (boxes.discuss || []).map((l) => l.replace(/^[•\-\s]+/, '').trim()).filter(Boolean),
      sortType,
      headers,
      setCount: sortType === 'sets' ? groups.length : null,
      support,
      cards: cards.map((c, i) => ({
        letter: c.letter, body: c.body, hasImage: !!images[c.letter], position: i,
        imageWidth: images[c.letter] && c.imageWidth > 0 ? c.imageWidth : null,
      })),
      key,
    },
    images,
  };
}
