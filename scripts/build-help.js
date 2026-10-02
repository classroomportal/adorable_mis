#!/usr/bin/env node
// Builds the in-app help from the User Manual.
//
// docs/USER_MANUAL.md is the exported snapshot of the "Formwork — User Manual"
// Claude Doc (see .claude/skills/update-docs/SKILL.md). This turns it into one
// help entry per section (public/help/help.json) and copies the screenshots it
// uses into public/help/images, so the Help button (app/components/HelpButton.js)
// shows the same words and pictures as the manual and never falls behind it.
// Both outputs are generated and git-ignored: run on every build (`prebuild`) and
// before `next dev` (`predev`).
//
// Plain Node, no dependencies. The manual uses a small subset of Markdown
// (headings, paragraphs, bullet and numbered lists, pipe tables, images, links,
// bold and italic), and this converts exactly that. Every piece of text is
// HTML-escaped before any markup is added, so nothing in the manual can inject
// HTML into the app.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'docs', 'USER_MANUAL.md');
const IMAGES_IN = path.join(ROOT, 'docs', 'manual-images');
const OUT_DIR = path.join(ROOT, 'public', 'help');
const IMAGES_OUT = path.join(OUT_DIR, 'images');

// Sections the panel never shows: the doc's own front matter.
const SKIP = new Set(['contents', 'find-a-task']);

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// GitHub's heading anchor, which is also what the snapshot's own in-page links
// point to (the update-docs skill rewrites them that way).
function slugify(text) {
  return text.toLowerCase().replace(/[^\w\- ]/g, '').replace(/ /g, '-');
}

// The export writes a few characters as entities or backslash escapes.
function unescapeMarkdown(s) {
  return s
    .replace(/&#91;/g, '[')
    .replace(/&#93;/g, ']')
    .replace(/\\([\\`*_{}[\]()#+\-.!|])/g, '$1');
}

const usedImages = new Set();

function inline(raw) {
  // Pull images and links out first, so their URLs aren't touched by the
  // emphasis rules, then escape everything else.
  const tokens = [];
  const hold = (html) => `\u0000${tokens.push(html) - 1}\u0000`;
  let s = raw.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, src) => {
    const file = src.replace(/^manual-images\//, '');
    if (!/^[\w.-]+$/.test(file)) return '';
    usedImages.add(file);
    return hold(`<img src="/help/images/${escapeHtml(file)}" alt="${escapeHtml(unescapeMarkdown(alt))}" loading="lazy">`);
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, href) => {
    const label = inline(text);
    if (href.startsWith('#')) return hold(`<a href="#" data-help-section="${escapeHtml(href.slice(1))}">${label}</a>`);
    if (/^https?:\/\//.test(href)) return hold(`<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`);
    return label;
  });
  s = escapeHtml(unescapeMarkdown(s));
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?![*\w])/g, '$1<em>$2</em>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => tokens[Number(i)]);
}

function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
}

function blocksToHtml(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    if (/^\s*\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      const [head, , ...body] = rows;
      out.push('<div class="help-table"><table><thead><tr>'
        + splitRow(head).map((c) => `<th>${inline(c)}</th>`).join('')
        + '</tr></thead><tbody>'
        + body.map((r) => `<tr>${splitRow(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')
        + '</tbody></table></div>');
      continue;
    }

    const listMatch = line.match(/^(\s*)(-|\d+\.)\s+/);
    if (listMatch && listMatch[1].length === 0) {
      const ordered = listMatch[2] !== '-';
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)(-|\d+\.)\s+(.*)$/);
        if (m && m[1].length === 0 && (m[2] !== '-') === ordered) { items.push([m[3]]); i++; continue; }
        if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) { items[items.length - 1].push(lines[i].trim()); i++; continue; }
        break;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((parts) => {
        const [first, ...rest] = parts;
        const nested = rest.length ? `<ul>${rest.map((r) => `<li>${inline(r.replace(/^(-|\d+\.)\s+/, ''))}</li>`).join('')}</ul>` : '';
        return `<li>${inline(first.replace(/^\[ \]\s+/, ''))}${nested}</li>`;
      }).join('')}</${tag}>`);
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() && !/^\s*\|/.test(lines[i]) && !/^(-|\d+\.)\s+/.test(lines[i])) para.push(lines[i++].trim());
    const text = para.join(' ');
    // A paragraph that is only an image is shown as a figure with its caption.
    const img = text.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (img) out.push(`<figure>${inline(text)}${img[1] ? `<figcaption>${escapeHtml(unescapeMarkdown(img[1]))}</figcaption>` : ''}</figure>`);
    else out.push(`<p>${inline(text)}</p>`);
  }
  return out.join('\n');
}

function build() {
  if (!fs.existsSync(SOURCE)) {
    console.warn('build-help: docs/USER_MANUAL.md not found; skipping help.');
    return;
  }
  const md = fs.readFileSync(SOURCE, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const lines = md.split('\n');

  const sections = [];
  const slugCounts = {};
  let current = null;
  let currentH2 = null;
  for (const line of lines) {
    const h = line.match(/^(#{1,3}) (.+)$/);
    if (h) {
      const level = h[1].length;
      const title = unescapeMarkdown(h[2].trim());
      const base = slugify(title);
      const id = slugCounts[base] ? `${base}-${slugCounts[base]}` : base;
      slugCounts[base] = (slugCounts[base] || 0) + 1;
      if (level === 1) { current = null; continue; }
      current = { id, title, level, parent: level === 3 ? currentH2 : null, lines: [] };
      if (level === 2) currentH2 = id;
      sections.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }

  const kept = sections.filter((s) => !SKIP.has(s.id));
  const titles = Object.fromEntries(kept.map((s) => [s.id, s.title]));
  const help = kept.map((s) => ({
    id: s.id,
    title: s.title,
    level: s.level,
    parent: s.parent,
    parentTitle: s.parent ? titles[s.parent] || null : null,
    html: blocksToHtml(s.lines),
    text: s.lines.join(' ').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/[*_#|`>\[\]()]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000),
  }));

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(IMAGES_OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'help.json'), JSON.stringify({ built: new Date().toISOString(), sections: help }));
  let copied = 0;
  for (const file of usedImages) {
    const from = path.join(IMAGES_IN, file);
    if (fs.existsSync(from)) { fs.copyFileSync(from, path.join(IMAGES_OUT, file)); copied++; }
  }
  console.log(`build-help: ${help.length} help sections, ${copied} screenshots.`);
}

build();
