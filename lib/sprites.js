'use strict';
// Pictures kept as BYTE / DATA lines: sprites, characters, tiles, fonts.
// Reads a block of data as a grid of pixels, and turns an edited grid back into the same
// lines with only the numbers changed. Nothing in here knows about VS Code.
//
// A block is marked as a picture with a comment just above it (or at the end of its first line):
//     * @sprite 16x16
//     MAN    BYTE >03,>07,...
// After @sprite come, in any order and all optional: the name of one of the chip's picture
// shapes (from its chip file's "sprites" section), a size such as 16x8, and the order the
// bytes are stored in (rows, columns or cells).

const ORDERS = ['rows', 'columns', 'cells'];
// only at the start of a comment, so a comment that just mentions @sprite isn't taken as one
const MARK = /^[^\w@]*@sprite\b([^\n]*)/i;
const CHARS = ['··', '██', '▓▓', '▒▒', '░░', '##', '@@', '%%', '&&', '++', '==', 'oo', '**', 'xx', '~~', '::'];
const ONE_BIT = [[7], [6], [5], [4], [3], [2], [1], [0]];

/** The chip's "sprites" section, with defaults filled in. */
function settings(D) {
  const raw = D.sprites || {};
  return {
    about: raw.about || '',
    default: raw.default || '8x8',
    order: ORDERS.includes(raw.order) ? raw.order : 'rows',
    shapes: raw.shapes || { '8x8': { name: '8x8 picture', width: 8, height: 8 } },
    newSprite: raw.newSprite || {}
  };
}

function findShape(S, name) {
  const k = Object.keys(S.shapes).find(x => !x.startsWith('_') && x.toLowerCase() === String(name).toLowerCase());
  return k ? Object.assign({ key: k }, S.shapes[k]) : null;
}

/**
 * Work out a shape from the words after @sprite ('' for the chip's usual one).
 * Returns a ready-to-use shape, or { error }.
 */
function shapeFor(D, spec) {
  const S = settings(D);
  const words = String(spec || '').trim().split(/[\s,]+/).filter(Boolean);
  let base = null, size = null, order = null;
  for (const w of words) {
    const m = /^(\d+)x(\d+)$/i.exec(w);
    if (m) { size = [parseInt(m[1], 10), parseInt(m[2], 10)]; continue; }
    if (ORDERS.includes(w.toLowerCase())) { order = w.toLowerCase(); continue; }
    const s = findShape(S, w);
    if (s) { base = s; continue; }
    if (/^[-(]/.test(w) || /^[A-Za-z]/.test(w) === false) break;     // the rest is ordinary comment text
    if (!base && !size) return { error: `"${w}" is not a picture shape for ${D.short}. It knows: ${Object.keys(S.shapes).filter(k => !k.startsWith('_')).join(', ')}, or a size such as 16x16.` };
    break;
  }
  if (!base) {
    const exact = size && Object.keys(S.shapes).find(k => /^\d+x\d+$/.test(k) && k === `${size[0]}x${size[1]}`);
    base = exact ? findShape(S, exact) : size ? { key: `${size[0]}x${size[1]}`, name: `${size[0]}x${size[1]} picture` } : findShape(S, S.default) || { key: '8x8', name: '8x8 picture', width: 8, height: 8 };
  }
  const shape = Object.assign({}, base);
  if (size) { shape.width = size[0]; shape.height = size[1]; if (base.width && (base.width !== size[0] || base.height !== size[1])) shape.name = `${base.name.replace(/^\d+x\d+\s*/, '')} (${size[0]}x${size[1]})`; }
  shape.order = order || shape.order || S.order;
  return prepareShape(shape, D);
}

/** Check a shape and add the numbers the rest of the code needs. */
function prepareShape(s, D) {
  const out = Object.assign({}, s);
  out.pixelBits = Array.isArray(s.pixelBits) && s.pixelBits.length ? s.pixelBits : ONE_BIT;
  out.perByte = out.pixelBits.length;
  out.bitsPerPixel = out.pixelBits[0].length;
  out.colourCount = 1 << out.bitsPerPixel;
  out.pixelWidth = s.pixelWidth || 1;
  out.blockHeight = s.blockHeight || 8;
  if (!(out.width > 0 && out.height > 0)) return { error: 'A picture needs a width and height, such as 8x8.' };
  if (out.width > 256 || out.height > 256) return { error: 'That picture is too big to edit (256x256 at most).' };
  if (out.width % out.perByte) return { error: `The width must be a multiple of ${out.perByte} (that many pixels share each byte).` };
  if (out.order !== 'rows' && out.height % out.blockHeight) return { error: `Stored in ${out.order}, the height must be a multiple of ${out.blockHeight}.` };
  out.bytesPerRow = out.width / out.perByte;
  out.frameBytes = out.bytesPerRow * out.height;
  out.stride = Math.max(s.stride || 0, out.frameBytes);
  const greys = ['#00000000', '#e8e8e8', '#9a9a9a', '#5a5a5a'];
  out.colours = Array.isArray(s.colours) && s.colours.length >= out.colourCount ? s.colours.slice(0, out.colourCount)
    : out.colourCount === 2 ? ['#00000000', '#5b7cfa'] : Array.from({ length: out.colourCount }, (_, i) => greys[i] || `hsl(${i * 47},70%,55%)`);
  out.colourNames = Array.isArray(s.colourNames) ? s.colourNames.slice(0, out.colourCount) : out.colourCount === 2 ? ['off (0)', 'on (1)'] : out.colours.map((_, i) => `colour ${i}`);
  out.orderText = out.order === 'rows' ? `one row after another, ${out.bytesPerRow === 1 ? '1 byte' : out.bytesPerRow + ' bytes'} a row`
    : out.order === 'columns' ? `in ${out.blockHeight}-row strips, ${out.bytesPerRow > 1 ? 'down the left-hand column first, then the next column across' : 'top to bottom'}`
      : `in ${out.blockHeight}-row cells, across the top row of cells first, then the next row down`;
  out.spec = s.key || `${out.width}x${out.height}`;
  return out;
}

/** Where byte `bx` of picture row `y` is kept, counting from the start of the picture. */
function byteIndex(shape, y, bx) {
  if (shape.order === 'columns') return bx * shape.height + y;
  if (shape.order === 'cells') { const H = shape.blockHeight; return (Math.floor(y / H) * shape.bytesPerRow + bx) * H + (y % H); }
  return y * shape.bytesPerRow + bx;
}

/** One picture from the bytes: an array of colour numbers, row by row. */
function decode(bytes, at, shape) {
  const px = new Array(shape.width * shape.height).fill(0);
  for (let y = 0; y < shape.height; y++) {
    for (let x = 0; x < shape.width; x++) {
      const b = bytes[at + byteIndex(shape, y, Math.floor(x / shape.perByte))] || 0;
      let v = 0;
      for (const bit of shape.pixelBits[x % shape.perByte]) v = (v << 1) | ((b >> bit) & 1);
      px[y * shape.width + x] = v;
    }
  }
  return px;
}

/** The bytes for one picture. */
function encode(px, shape) {
  const out = new Array(shape.frameBytes).fill(0);
  for (let y = 0; y < shape.height; y++) {
    for (let x = 0; x < shape.width; x++) {
      const v = px[y * shape.width + x] || 0;
      const bits = shape.pixelBits[x % shape.perByte];
      const i = byteIndex(shape, y, Math.floor(x / shape.perByte));
      bits.forEach((bit, k) => { if ((v >> (bits.length - 1 - k)) & 1) out[i] |= 1 << bit; });
    }
  }
  return out;
}

/** How many whole pictures fit in `length` bytes. */
function frameCount(length, shape) {
  if (length < shape.frameBytes) return 0;
  return Math.floor((length - shape.frameBytes) / shape.stride) + 1;
}

/** The picture as text, for a tooltip. */
function drawText(px, shape) {
  const rows = [];
  const cell = (v) => (CHARS[v] || '??').repeat(shape.pixelWidth);
  for (let y = 0; y < shape.height; y++) rows.push(px.slice(y * shape.width, (y + 1) * shape.width).map(cell).join(''));
  return rows.join('\n');
}

// ---------------------------------------------------------------------------
// Numbers written the way the source writes them
// ---------------------------------------------------------------------------
/** How a plain number is written ($3C, >3c, %00111100, 60, 3Ch ...), or null if it isn't a plain number. */
function numberStyle(text, D) {
  const t = String(text).trim();
  const syn = D.syntax;
  for (const p of syn.binPrefixes || []) {
    if (p && t.startsWith(p) && /^[01]+$/.test(t.slice(p.length))) return { base: 2, prefix: p, suffix: '', digits: t.length - p.length };
  }
  if (/^0b[01]+$/i.test(t)) return { base: 2, prefix: t.slice(0, 2), suffix: '', digits: t.length - 2 };
  for (const p of syn.hexPrefixes || []) {
    if (!p || p === '0x' ? !t.toLowerCase().startsWith('0x') : !t.startsWith(p)) continue;
    const d = t.slice(p.length);
    if (/^[0-9a-f]+$/i.test(d)) return { base: 16, prefix: t.slice(0, p.length), suffix: '', digits: d.length, lower: /[a-f]/.test(d) && !/[A-F]/.test(d) };
  }
  if (syn.hexSuffix && /^[0-9][0-9a-f]*h$/i.test(t)) { const d = t.slice(0, -1); return { base: 16, prefix: '', suffix: t.slice(-1), digits: d.length, lower: /[a-f]/.test(d) && !/[A-F]/.test(d) }; }
  if (/^\d+$/.test(t)) return { base: 10, prefix: '', suffix: '', digits: 0 };
  return null;
}

function formatNumber(v, style) {
  let d = v.toString(style.base);
  if (style.base === 16) d = style.lower ? d.toLowerCase() : d.toUpperCase();
  if (style.digits) d = d.padStart(style.digits, '0');
  if (style.base === 16 && style.suffix && /^[a-f]/i.test(d)) d = '0' + d;   // 0FFh, not FFh (that would be a name)
  return style.prefix + d + style.suffix;
}

// ---------------------------------------------------------------------------
// Blocks of data in a file
// ---------------------------------------------------------------------------
/** The @sprite comment for a block: { spec, line } or null. */
function markerFor(model, labelLine, firstLine) {
  const D = model.D;
  const lines = [];
  let k = labelLine - 1;
  while (k >= 0 && model.lines[k].label && !model.lines[k].mnem) k--;
  for (; k >= 0 && k >= labelLine - 40; k--) {
    const pl = model.lines[k];
    if (pl.label || pl.mnem || !pl.comment) break;
    lines.push({ line: k, text: pl.comment.text });
  }
  for (const ln of [labelLine, firstLine]) {
    const pl = model.lines[ln];
    if (pl && pl.comment) lines.push({ line: ln, text: pl.comment.text });
  }
  for (const c of lines) {
    const m = MARK.exec(c.text);
    if (!m) continue;
    let spec = m[1];
    const block = D.syntax.blockComment || [];
    if (block.length === 2 && spec.includes(block[1])) spec = spec.slice(0, spec.indexOf(block[1]));
    return { spec: spec.trim(), line: c.line };
  }
  return null;
}

/** Turn a data block (from analysis.dataBlock) into a picture: { shape, frames, ... } or { error }. */
function pictureOf(project, file, blk, spec) {
  const model = project.get(file);
  const shape = shapeFor(model.D, spec);
  if (shape.error) return { error: shape.error, blk };
  const n = frameCount(blk.bytes.length, shape);
  if (!n) return { error: `${blk.label || 'This block'} holds ${blk.bytes.length} bytes, but one ${shape.width}x${shape.height} picture needs ${shape.frameBytes}.`, blk, shape };
  const frames = [];
  for (let f = 0; f < n; f++) frames.push(decode(blk.bytes, f * shape.stride, shape));
  const spare = blk.bytes.length - ((n - 1) * shape.stride + shape.frameBytes);
  return { blk, shape, frames, spare, editable: blk.editable, why: blk.why };
}

/** Every marked block in the file: [{ line, label, spec, marker }] (line is where the block's label is). */
function markedBlocks(project, file, dataBlock) {
  const model = project.get(file);
  if (!model) return [];
  const out = [];
  const seen = new Set();
  for (let ln = 0; ln < model.lines.length; ln++) {
    const pl = model.lines[ln];
    if (!pl.comment || !MARK.test(pl.comment.text)) continue;
    // the data starts on this line or within a few lines below
    for (let k = ln; k < model.lines.length && k <= ln + 6; k++) {
      const q = model.lines[k];
      if (!q.mnem) continue;
      const d = model.D.directive(q.mnem.upper);
      if (!d || d.kind !== 'data') break;
      const blk = dataBlock(project, file, k);
      if (blk && !seen.has(blk.labelLine)) {
        const mk = markerFor(model, blk.labelLine, blk.firstLine);
        if (mk) { seen.add(blk.labelLine); out.push({ line: blk.labelLine, label: blk.label, spec: mk.spec, marker: mk.line }); }
      }
      break;
    }
  }
  return out;
}

/**
 * The text changes that store `bytes` (a whole new copy of the block's bytes) in the block,
 * changing only the numbers that are different. [{ line, start, end, text }]
 */
function editsFor(project, file, blk, bytes) {
  const D = project.get(file).D;
  const out = [];
  for (const it of blk.items) {
    let v = 0;
    for (let k = 0; k < it.unit; k++) {
      const b = bytes[it.at + k] & 0xFF;
      v = blk.littleEndian ? v | (b << (8 * k)) : (v << 8) | b;
    }
    v >>>= 0;
    if (v === it.value) continue;
    out.push({ line: it.line, start: it.start, end: it.end, text: formatNumber(v, it.style) });
  }
  return out;
}

/** The comment line that marks a block, written the chip's way. */
function markerLine(D, spec) {
  const c = (D.syntax.col0Comment && D.syntax.col0Comment[0]) || D.syntax.lineComment[0] || ';';
  return `${c} @sprite ${spec}`.trimEnd();
}

/** Lines for a brand new, empty picture (marker, label and zero bytes). */
function newSpriteLines(D, name, shape, frames) {
  const S = settings(D);
  const ns = S.newSprite;
  const dir = ns.directive || 'BYTE';
  const indent = ns.indent || 8;
  const hex = (D.syntax.hexDisplay || '$') + '00';
  const per = shape.order === 'rows' ? Math.min(shape.bytesPerRow, 16) : shape.blockHeight;
  const total = (frames - 1) * shape.stride + shape.frameBytes;
  const lines = [markerLine(D, shape.spec)];
  const label = (ns.labelPrefix || '') + name + (ns.labelSuffix || '');
  if (ns.labelOnOwnLine) lines.push(label);
  let first = !ns.labelOnOwnLine;
  for (let i = 0; i < total; i += per) {
    const vals = new Array(Math.min(per, total - i)).fill(hex).join(',');
    const lead = first ? (label.length < indent ? label.padEnd(indent) : label + ' ') : ' '.repeat(indent);
    lines.push(lead + dir + ' ' + vals);
    first = false;
  }
  return lines;
}

/** The chip's shapes, for a pick list: [{ spec, name, about, frameBytes }]. */
function shapeList(D) {
  const S = settings(D);
  return Object.keys(S.shapes).filter(k => !k.startsWith('_')).map(k => {
    const s = shapeFor(D, k);
    return { spec: k, name: (S.shapes[k].name || k), about: S.shapes[k].about || '', frameBytes: s.frameBytes || 0, stride: s.stride || 0 };
  });
}

module.exports = { MARK, settings, shapeFor, decode, encode, frameCount, drawText, numberStyle, formatNumber, markerFor, pictureOf, markedBlocks, editsFor, markerLine, newSpriteLines, shapeList, byteIndex };
