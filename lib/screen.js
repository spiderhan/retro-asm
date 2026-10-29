'use strict';
// A whole TI-99/4A bitmap screen, described by one comment line:
//     * @screen ti-bitmap bands=3 shared=no run=START grid=MAP gridat=>1800 patterns=P0,P1,P2 patat=>0000 ...
// This file reads that line, finds the tables it names, checks them and draws the picture.
// Nothing in here knows about VS Code.
//
// Words it does not know are ignored, so the line can grow later.

const MARK = /^[^\w@]*@screen\b\s*([^\s]*)([^\n]*)/i;

const BAND_BYTES = 2048;       // one band's shapes, or one band's colours
const GRID_BYTES = 768;        // 32 x 24 squares
const LIST_END = 0xD0;         // the sprite list stops at a Y of >D0
const WIDTH = 256, HEIGHT = 192;

// The sixteen colours of the TI-99/4A video chip. Colour 0 is "see-through".
const PALETTE = ['#000000', '#000000', '#21C842', '#5EDC78', '#5455ED', '#7D76FC', '#D4524D', '#42EBF5',
  '#FC5554', '#FF7978', '#D4C154', '#E6CE80', '#21B03B', '#C95BBA', '#CCCCCC', '#FFFFFF'];
const COLOUR_NAMES = ['see-through', 'black', 'medium green', 'light green', 'dark blue', 'light blue', 'dark red', 'cyan',
  'medium red', 'light red', 'dark yellow', 'light yellow', 'dark green', 'magenta', 'grey', 'white'];

/** A number written with the assembler's prefix (>1800, $1800, 0x1800) or plain hex. null if it isn't one. */
function hexValue(text) {
  const m = /^(?:>|\$|0x)?([0-9A-Fa-f]+)$/.exec(String(text || '').trim());
  return m ? parseInt(m[1], 16) : null;
}

const hex4 = (n) => '>' + n.toString(16).toUpperCase().padStart(4, '0');
const hex2 = (n) => '>' + n.toString(16).toUpperCase().padStart(2, '0');

function listOf(text) {
  if (text === undefined || text === '-' || text === '') return [];
  return text.split(',').filter(Boolean);
}

/**
 * Read the text of a @screen comment: { kind, bands, shared, run, grid, gridAt, patterns, patAt, colours, colAt,
 * sprites, sprAt, spriteList, listAt, regs, bad[] } or null if it is not a @screen comment.
 * `bad` lists words whose value could not be read (so they can be explained, not guessed at).
 */
function parseMarker(text) {
  const m = MARK.exec(text || '');
  if (!m) return null;
  const words = {};
  for (const w of m[2].split(/\s+/)) {
    const eq = w.indexOf('=');
    if (eq > 0) words[w.slice(0, eq).toLowerCase()] = w.slice(eq + 1);
  }
  const bad = [];
  const num = (key) => {
    if (words[key] === undefined || words[key] === '-') return null;
    const v = hexValue(words[key]);
    if (v === null) bad.push(key);
    return v;
  };
  const spec = {
    kind: (m[1] || '').toLowerCase(),
    bands: null, shared: words.shared !== undefined ? /^(yes|true|1)$/i.test(words.shared) : false,
    run: words.run && words.run !== '-' ? words.run : null,
    grid: words.grid && words.grid !== '-' ? words.grid : null, gridAt: num('gridat'),
    patterns: listOf(words.patterns), patAt: num('patat'),
    colours: listOf(words.colours), colAt: num('colat'),
    sprites: listOf(words.sprites), sprAt: num('sprat'),
    spriteList: words.spritelist && words.spritelist !== '-' ? words.spritelist : null, listAt: num('listat'),
    regs: null, bad
  };
  if (words.bands !== undefined) {
    const n = /^\d+$/.test(words.bands) ? parseInt(words.bands, 10) : null;
    if (n === null || n < 1 || n > 3) bad.push('bands'); else spec.bands = n;
  }
  if (words.regs !== undefined && words.regs !== '-') {
    const r = words.regs.split(',').map(hexValue);
    if (r.some(v => v === null || v > 255)) bad.push('regs'); else spec.regs = r;
  }
  return spec;
}

/** How many bands the screen has (3 when the line doesn't say). */
const bandCount = (spec) => spec.bands || 3;

/** A plain-English line about a screen. */
function describe(spec) {
  if (spec.kind !== 'ti-bitmap') return `a whole screen of a kind I don't know yet ("${spec.kind || 'none given'}"); I know ti-bitmap`;
  const n = bandCount(spec);
  const parts = [`${n} ${n === 1 ? 'band' : 'bands'}${spec.shared ? ' sharing one set of shapes and colours' : ''}`];
  if (spec.patterns.length) parts.push('shapes at ' + (spec.patAt === null ? spec.patterns[0] : hex4(spec.patAt)));
  if (spec.colours.length) parts.push('colours at ' + (spec.colAt === null ? spec.colours[0] : hex4(spec.colAt)));
  if (spec.grid) parts.push('grid at ' + (spec.gridAt === null ? spec.grid : hex4(spec.gridAt)));
  if (spec.sprites.length || spec.spriteList) parts.push('sprites' + (spec.listAt === null ? '' : ' listed at ' + hex4(spec.listAt)));
  return 'a whole screen: ' + parts.join(', ');
}

/** Every @screen comment in a file: [{ line, spec }]. */
function markedScreens(model) {
  const out = [];
  for (let ln = 0; ln < model.lines.length; ln++) {
    const pl = model.lines[ln];
    if (!pl.comment) continue;
    const spec = parseMarker(pl.comment.text);
    if (spec) out.push({ line: ln, spec });
  }
  return out;
}

/** The line a label is defined on, or -1. A label in a different letter case is accepted if it is the only one. */
function labelLine(model, name) {
  let loose = -1, looseCount = 0;
  for (let i = 0; i < model.lines.length; i++) {
    const l = model.lines[i].label;
    if (!l) continue;
    if (l.name === name) return i;
    if (l.name.toUpperCase() === name.toUpperCase()) { if (loose < 0) loose = i; looseCount++; }
  }
  return looseCount === 1 ? loose : -1;
}

/**
 * Find the data behind every name the line gives. `dataBlock` is analysis.dataBlock.
 * Returns { tables: [{ role, label, at, line, bytes (or null if not found), why }] } where role is
 * 'patterns' | 'colours' | 'grid' | 'sprites' | 'list' | 'run'.
 */
function gather(project, file, spec, dataBlock) {
  const model = project.get(file);
  const tables = [];
  const add = (role, label, at, extra) => {
    const t = Object.assign({ role, label, at, line: -1, bytes: null, why: '' }, extra);
    const ln = labelLine(model, label);
    if (ln < 0) t.why = `There is no label called ${label} in this file.`;
    else {
      t.line = ln;
      if (role === 'run') return tables.push(t);
      const blk = dataBlock(project, file, ln);
      if (!blk) t.why = `${label} is not followed by BYTE or DATA lines made of plain numbers.`;
      else { t.bytes = blk.bytes; t.line = blk.labelLine; }
    }
    tables.push(t);
  };
  spec.patterns.forEach((l, i) => add('patterns', l, spec.patAt === null ? null : spec.patAt + i * BAND_BYTES, { index: i }));
  spec.colours.forEach((l, i) => add('colours', l, spec.colAt === null ? null : spec.colAt + i * BAND_BYTES, { index: i }));
  if (spec.grid) add('grid', spec.grid, spec.gridAt);
  spec.sprites.forEach((l) => add('sprites', l, null, { first: firstPicture(l) }));
  if (spec.spriteList) add('list', spec.spriteList, spec.listAt);
  if (spec.run) add('run', spec.run, null);
  return { tables };
}

/** "SCRSPR96" starts at picture 96: the number on the end of the name (0 if there is none). */
function firstPicture(label) {
  const m = /(\d+)$/.exec(label);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * What is wrong, in plain English: [{ table (a role or 'marker'), label, text }].
 * Sizes: 2048 bytes for each band of shapes or colours, 768 for the grid, a sprite list that reaches a >D0.
 */
function check(spec, g) {
  const out = [];
  const say = (table, label, text, severity) => out.push({ table, label: label || null, text, severity: severity || 'warning' });
  if (spec.kind !== 'ti-bitmap') say('marker', null, `I only know the "ti-bitmap" kind of screen, so I can't check or draw "${spec.kind || ''}".`, 'info');
  spec.bad.forEach(k => say('marker', null, `I could not read the number given for "${k}".`));
  const n = bandCount(spec);
  const want = spec.shared ? 1 : n;
  for (const [role, word, list] of [['patterns', 'shapes', spec.patterns], ['colours', 'colours', spec.colours]]) {
    if (!list.length) say('marker', null, `The line gives no ${word} tables.`);
    else if (list.length !== want && list.length !== 1) say('marker', null, `${n} bands need ${want} ${word} table${want === 1 ? '' : 's'} (or 1 if every band is the same), but the line names ${list.length}.`);
  }
  if (!spec.grid) say('marker', null, 'The line gives no screen grid.');
  if (spec.regs && spec.regs.length !== 8) say('marker', null, `The video chip has 8 registers, but regs gives ${spec.regs.length} values.`);
  if (!spec.regs) say('marker', null, 'The line gives no register values, so the picture is drawn with the usual ones.', 'info');
  registerProblems(spec).forEach(p => out.push(p));
  for (const t of g.tables) {
    if (t.role === 'run') { if (t.why) say('run', t.label, t.why); continue; }
    if (t.why) { say(t.role, t.label, t.why); continue; }
    const len = t.bytes.length;
    if (t.role === 'patterns' || t.role === 'colours') {
      if (len !== BAND_BYTES) say(t.role, t.label, `${t.label} holds ${len} bytes, but one band of ${t.role === 'patterns' ? 'shapes' : 'colours'} is ${BAND_BYTES}.`);
    } else if (t.role === 'grid') {
      if (len !== GRID_BYTES) say('grid', t.label, `${t.label} holds ${len} bytes, but the screen grid is ${GRID_BYTES} (32 across by 24 down).`);
    } else if (t.role === 'sprites') {
      if (len % 8) say('sprites', t.label, `${t.label} holds ${len} bytes, which is not a whole number of sprite pictures (8 bytes each).`);
    } else if (t.role === 'list') {
      const end = listEnd(t.bytes);
      if (end < 0) say('list', t.label, `${t.label} never reaches ${hex2(LIST_END)}, which is what ends the sprite list (4 bytes a sprite, then ${hex2(LIST_END)}).`);
      else if (end / 4 > 32) say('list', t.label, `${t.label} lists ${end / 4} sprites, but the video chip only has 32.`);
    }
  }
  return out;
}

/**
 * Do the eight video register values agree with the addresses on the line? A register can only say where a table is
 * in steps (the grid in 1K steps, the sprite list in 128-byte steps ...), so a table at another address would be
 * looked for in the wrong place by the real chip. Returns [{ table, label, text, severity, word }].
 * Only what is certain is reported: how the bands are split is checked only when the line is clear about it.
 */
function registerProblems(spec) {
  const out = [], r = spec.regs;
  if (spec.kind !== 'ti-bitmap' || !r || r.length !== 8) return out;
  const say = (text, word, severity) => out.push({ table: 'marker', label: null, text, severity: severity || 'warning', word: word || null });
  if (!(r[0] & 0x02)) say(`Register 0 is ${hex2(r[0])}, which does not switch the bitmap screen on (it needs the ${hex2(0x02)} bit).`, 'regs');
  if (r[1] & 0x18) say(`Register 1 is ${hex2(r[1])}, which has the text-screen or multicolour bit set, so the chip would not draw a bitmap screen.`, 'regs');
  else if (!(r[1] & 0x40)) say(`Register 1 is ${hex2(r[1])}, which leaves the screen switched off. The line should give the values as they are once the screen is on.`, 'regs', 'info');
  const where = (reg, label, word, expected, given) => {
    if (given !== null && given !== expected) say(`Register ${reg} puts ${label} at ${hex4(expected)}, but ${word} on the line says ${hex4(given)}.`, word);
  };
  where(2, 'the screen grid', 'gridat', (r[2] & 0x0F) * 0x400, spec.gridAt);
  where(4, 'the shapes', 'patat', r[4] & 0x04 ? 0x2000 : 0, spec.patAt);
  where(3, 'the colours', 'colat', r[3] & 0x80 ? 0x2000 : 0, spec.colAt);
  where(5, 'the sprite list', 'listat', (r[5] & 0x7F) * 0x80, spec.listAt);
  where(6, 'the sprite pictures', 'sprat', (r[6] & 0x07) * 0x800, spec.sprAt);
  // are the bands separate? Only when the line is clear: "shared" means one set, a table for every band means separate.
  const n = bandCount(spec);
  const split = (reg, name, mask, word, list) => {
    const separate = (reg & mask) === mask;
    if (spec.shared && separate) say(`The line says every band shares one set of ${name}, but the register that places them asks the chip for a separate set for each band, so it would read tables that were never stored.`, word);
    else if (!spec.shared && n > 1 && list.length === n && !separate) say(`The line gives each band its own ${name}, but the register that places them makes the bands share the first set, so the other bands' ${name} would never be used.`, word);
  };
  split(r[4], 'shapes', 0x03, 'patterns', spec.patterns);
  split(r[3], 'colours', 0x60, 'colours', spec.colours);
  return out;
}

/** Where the sprite list ends: the index of the first >D0 that starts a 4-byte entry, or -1. */
function listEnd(bytes) {
  for (let i = 0; i < bytes.length; i += 4) if (bytes[i] === LIST_END) return i;
  return -1;
}

const pad = (bytes, n) => {
  const a = new Uint8Array(n);
  if (bytes) a.set(bytes.slice(0, n));
  return a;
};

/**
 * Draw the screen. Returns { pixels: Uint8Array(256*192) of colour numbers 0-15 (never 0: see-through is shown as the backdrop),
 * sprites: how many were drawn }. Tables that are missing or short are drawn as empty.
 * options.sprites = false leaves the sprites out.
 */
function render(spec, g, options) {
  const withSprites = !options || options.sprites !== false;
  const regs = spec.regs && spec.regs.length === 8 ? spec.regs : [0x02, 0xE2, 0x06, 0xFF, 0x03, 0x36, 0x03, 0x01];
  const find = (role) => g.tables.filter(t => t.role === role).sort((a, b) => (a.index || 0) - (b.index || 0));
  const n = bandCount(spec);
  const tab = (role) => {
    const list = find(role);
    return Array.from({ length: n }, (_, b) => {
      const t = list[spec.shared ? 0 : Math.min(b, list.length - 1)];
      return pad(t && t.bytes, BAND_BYTES);
    });
  };
  const pats = tab('patterns'), cols = tab('colours');
  const gridT = find('grid')[0];
  const grid = pad(gridT && gridT.bytes, GRID_BYTES);
  const backdrop = regs[7] & 15 || 1;               // a see-through backdrop is black on screen
  const px = new Uint8Array(WIDTH * HEIGHT);
  for (let row = 0; row < 24; row++) {
    const band = Math.min(Math.floor(row / 8), n - 1);
    for (let col = 0; col < 32; col++) {
      const t = grid[row * 32 + col] * 8;
      for (let y = 0; y < 8; y++) {
        const bits = pats[band][t + y], c = cols[band][t + y];
        const fg = c >> 4 || backdrop, bg = c & 15 || backdrop;
        const o = (row * 8 + y) * WIDTH + col * 8;
        for (let x = 0; x < 8; x++) px[o + x] = (bits >> (7 - x)) & 1 ? fg : bg;
      }
    }
  }
  let drawn = 0;
  const listT = find('list')[0];
  if (withSprites && listT && listT.bytes) {
    const pics = new Uint8Array(256 * 8);
    for (const t of find('sprites')) if (t.bytes) pics.set(t.bytes.slice(0, Math.max(0, pics.length - t.first * 8)), t.first * 8);
    const big = !!(regs[1] & 2), zoom = regs[1] & 1 ? 2 : 1, size = (big ? 16 : 8) * zoom;
    const end = listEnd(listT.bytes), count = Math.min(32, end < 0 ? Math.floor(listT.bytes.length / 4) : end / 4);
    for (let s = count - 1; s >= 0; s--) {      // lower numbers sit in front, so draw them last
      let y = listT.bytes[s * 4], x = listT.bytes[s * 4 + 1], name = listT.bytes[s * 4 + 2];
      const flags = listT.bytes[s * 4 + 3], colour = flags & 15;
      if (!colour) continue;
      if (y >= 0xE0) y -= 256;
      y += 1;
      if (flags & 0x80) x -= 32;
      if (big) name &= 0xFC;
      drawn++;
      for (let sy = 0; sy < size; sy++) {
        const py = y + sy;
        if (py < 0 || py >= HEIGHT) continue;
        const iy = Math.floor(sy / zoom);
        for (let sx = 0; sx < size; sx++) {
          const pxx = x + sx;
          if (pxx < 0 || pxx >= WIDTH) continue;
          const ix = Math.floor(sx / zoom);
          // a 16x16 sprite is four pictures: top-left, bottom-left, top-right, bottom-right
          const at = big ? name * 8 + (ix >= 8 ? 16 : 0) + (iy >= 8 ? 8 : 0) + (iy & 7) : name * 8 + iy;
          if ((pics[at] >> (7 - (ix & 7))) & 1) px[py * WIDTH + pxx] = colour;
        }
      }
    }
  }
  return { pixels: px, sprites: drawn, regs };
}

const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ROLE_NAMES = { patterns: 'Shapes', colours: 'Colours', grid: 'Screen grid', sprites: 'Sprite pictures', list: 'Sprite list', run: 'Starts at' };

/** If (line, character) is on the "@screen <kind>" words of a @screen comment: { spec, start, end, line }, else null. */
function markerAt(model, line, character) {
  const raw = model.rawLines[line], pl = model.lines[line];
  if (!raw || !pl || !pl.comment) return null;
  const m = /@screen\b(?:[ \t]+\S+)?/i.exec(raw);
  const spec = m && parseMarker(pl.comment.text);
  if (!spec || character < m.index || character > m.index + m[0].length) return null;
  return { spec, start: m.index, end: m.index + m[0].length, line };
}

/** What the tooltip on a @screen comment says, as paragraphs of Markdown. */
function hoverParts(spec, g, problems) {
  const d = describe(spec);
  const parts = ['**' + d.charAt(0).toUpperCase() + d.slice(1) + '**'];
  if (spec.kind !== 'ti-bitmap') return parts;
  const bad = (t) => problems.some(p => p.table === t.role && p.label === t.label);
  const rows = g.tables.map(t => {
    const where = t.role === 'run' ? '' : t.at === null ? '' : `, goes to video memory at ${hex4(t.at)}`;
    const size = t.role === 'run' ? (t.why ? ' (not found)' : '') : t.bytes ? ` (${t.bytes.length} bytes)` : ' (not found)';
    return `- ${bad(t) ? '⚠ ' : ''}${ROLE_NAMES[t.role]}: \`${t.label}\`${size}${where}`;
  });
  if (rows.length) parts.push('It is made from these tables:\n\n' + rows.join('\n'));
  parts.push(problems.length ? problems.map(p => '⚠ ' + p.text).join('\n\n') : 'Everything the line names was found and is the right size.');
  return parts;
}

/**
 * Warnings for the editor's wavy underlines and Problems list: [{ line, start, end, severity, message }].
 * A problem with a name in it is underlined on that name in the @screen comment; the rest on "@screen".
 * A kind of screen it does not know is left alone, not nagged about.
 */
function problemsFor(project, file, dataBlock) {
  const model = project.get(file), out = [];
  for (const m of markedScreens(model)) {
    if (m.spec.kind !== 'ti-bitmap') continue;
    const raw = model.rawLines[m.line], at = /@screen\b/i.exec(raw);
    if (!at) continue;
    const g = gather(project, file, m.spec, dataBlock);
    for (const p of check(m.spec, g)) {
      let start = at.index, end = at.index + 7;
      if (p.word) {
        const w = new RegExp('(?:^|\\s)(' + esc(p.word) + '=\\S*)').exec(raw.slice(at.index));
        if (w) { start = at.index + w.index + w[0].length - w[1].length; end = start + w[1].length; }
      } else if (p.label) {
        const hit = new RegExp('(?:^|[=,])(' + esc(p.label) + ')(?=[,\\s]|$)').exec(raw.slice(at.index));
        if (hit) { start = at.index + hit.index + hit[0].length - hit[1].length; end = start + hit[1].length; }
      }
      out.push({ line: m.line, start, end, severity: p.severity, message: p.text });
    }
  }
  return out;
}

module.exports = { registerProblems, markerAt, hoverParts, problemsFor, ROLE_NAMES, MARK, WIDTH, HEIGHT, BAND_BYTES, GRID_BYTES, LIST_END, PALETTE, COLOUR_NAMES, hexValue, hex4, parseMarker, describe, markedScreens, labelLine, gather, check, listEnd, firstPicture, render, bandCount };
