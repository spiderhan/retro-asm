'use strict';
// The editing rules behind the blocks panel. Nothing here knows about VS Code or the screen,
// so it can be tested on its own. The panel's web page uses the very same functions.
//
// A project is the .blocks.json: { things, start: [blocks], every_frame: [blocks], data }.
// A block is { block: 'id', ...its settings }. A block like "if two things touch" holds a list of
// blocks of its own in "do". A list is named by a path: ['start'], or ['every_frame', 3, 'do'].

function listAt(project, listPath) {
  let cur = project;
  for (let i = 0; i < listPath.length; i++) {
    cur = cur && cur[listPath[i]];
    if (cur === undefined || cur === null) return null;
  }
  return Array.isArray(cur) ? cur : null;
}

/** Which list at the top a path belongs to ('start' or 'every_frame'). */
function rootOf(listPath) { return listPath[0]; }

/** The lines of data a project has: written in it, plus the ones from its pictures file (passed in, since this file reads no files). */
function dataOf(project, extra) { return ((project && project.data) || []).concat(extra || []); }

/** The sounds in some data lines (or a project's own): a "* @sound" line, then the label on the next line. */
function soundLabels(source, extra) {
  const out = [], d = Array.isArray(source) ? source : dataOf(source, extra);
  for (let i = 0; i < d.length; i++) {
    if (/^\*\s*@sound\b/i.test(d[i])) { const m = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(d[i + 1] || ''); if (m) out.push(m[1]); }
  }
  return out;
}

/** The pictures in some data lines: [{ label, w, h, order, spec, line }] for every "* @sprite ..." mark. */
function pictures(source, extra) {
  const out = [], d = Array.isArray(source) ? source : dataOf(source, extra);
  for (let i = 0; i < d.length; i++) {
    const m = /^\*\s*@sprite\b(.*)$/i.exec(d[i]);
    if (!m) continue;
    const lab = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(d[i + 1] || ''); if (!lab) continue;
    const size = /(\d+)\s*x\s*(\d+)/i.exec(m[1]);
    const order = (/\b(rows|columns|cells)\b/i.exec(m[1]) || [])[1];
    out.push({ label: lab[1], w: size ? +size[1] : 0, h: size ? +size[2] : 0, order: order ? order.toLowerCase() : '', spec: m[1].trim(), line: i + 1 });
  }
  return out;
}

/** A tile is a picture drawn on the screen in 8x8 pieces. How many pieces across and down, or an explanation if it can't be one. */
function tileShape(pic) {
  if (!pic) return { error: 'that picture is not in the data (it needs a "* @sprite" line above its label)' };
  if (!pic.w || !pic.h) return { error: `${pic.label} has no size: mark it like "* @sprite 16x8 cells"` };
  if (pic.w % 8 || pic.h % 8) return { error: `${pic.label} is ${pic.w}x${pic.h}: a tile has to be a whole number of 8x8 pieces (8, 16, 24 across or down...)` };
  const a = pic.w / 8, d = pic.h / 8;
  if (![1, 2, 4, 8].includes(a)) return { error: `${pic.label} is ${a} pieces wide: a tile can be 1, 2, 4 or 8 pieces across` };
  if (a * d > 8) return { error: `${pic.label} has ${a * d} pieces: a tile can have 8 at most` };
  // one piece wide, or one piece tall and left in the chip's usual order, is already stored the way a tile needs
  const alreadyRight = a === 1 || (d === 1 && (pic.order === '' || pic.order === 'columns'));
  if (a * d > 1 && pic.order !== 'cells' && !alreadyRight) return { error: `${pic.label} is bigger than 8x8, so mark it "* @sprite ${pic.w}x${pic.h} cells" (the pieces are then stored in the order the tile uses)`, fix: 'cells' };
  return { across: a, down: d, cells: a * d };
}

/**
 * The lines of one picture (its "* @sprite" line, its label line and the BYTE/DATA lines after it), copied under a new
 * label. `lines` is the whole pictures file. Returns { lines } or { error }.
 */
function copyPictureLines(lines, label, newLabel) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(newLabel || ''))) return { error: 'A name needs letters, digits and _, and starts with a letter.' };
  const at = lines.findIndex(l => new RegExp('^' + label + '(\\s|$)').test(l));
  if (at < 0) return { error: `${label} isn't in the pictures file.` };
  if (lines.some(l => new RegExp('^' + newLabel + '(\\s|$)', 'i').test(l))) return { error: `${newLabel} is already used.` };
  let first = at; if (at > 0 && /^\*\s*@sprite\b/i.test(lines[at - 1])) first = at - 1;
  let last = at;
  while (last + 1 < lines.length && /^\s+(BYTE|DATA)\b/i.test(lines[last + 1])) last++;
  const copy = lines.slice(first, last + 1).slice();
  const li = at - first;
  copy[li] = newLabel + copy[li].slice(label.length);
  return { lines: copy };
}

/** Is this setting shown? Some only matter for one choice of another (the bounce settings only matter when it bounces). */
function shown(def, block, name) {
  const w = def && def.params && def.params[name] && def.params[name].showWhen;
  if (!w) return true;
  return Object.keys(w).every(k => {
    const pd = def.params[k];
    const cur = block[k] === undefined && pd ? pd.default : block[k];
    return cur === w[k];
  });
}

/** A new block with its settings filled in with sensible starting values. */
function newBlock(def, project, sounds) {
  const b = { block: def.id };
  const things = Object.keys((project && project.things) || {});
  const usedThings = [];
  for (const [name, p] of Object.entries(def.params || {})) {
    if (p.type === 'blocks') b[name] = [];
    else if (p.type === 'thing') { b[name] = things.find(t => !usedThings.includes(t)) || things[0] || ''; usedThings.push(b[name]); }   // two thing settings start as two different things
    else if (p.type === 'number' || p.type === 'colour') b[name] = p.default === undefined ? 0 : p.default;
    else if (p.type === 'choice') b[name] = p.default !== undefined ? p.default : (p.options[0] || [''])[0];
    else if (p.type === 'tile') b[name] = Object.keys((project && project.tiles) || {})[0] || '';
    else if (name === 'sound') b[name] = (sounds || soundLabels(project))[0] || '';
    else b[name] = p.default === undefined ? '' : p.default;
  }
  return b;
}

/** Can this block go in this list? ("when the game starts" blocks can't go in the every-frame list, and the reverse.) */
function canDrop(def, listPath) {
  if (!def) return false;
  if (!def.when || def.when === 'any') return true;
  return (def.when === 'start') === (rootOf(listPath) === 'start');
}

function clamp(n, min, max, p) {
  if (!Number.isFinite(n)) return p && p.default !== undefined ? p.default : 0;
  if (min !== undefined && n < min) n = min;
  if (max !== undefined && n > max) n = max;
  return Math.round(n);
}

function insertBlock(project, listPath, index, block) {
  const l = listAt(project, listPath); if (!l) return false;
  const i = Math.max(0, Math.min(index, l.length));
  l.splice(i, 0, block);
  return true;
}

function removeBlock(project, listPath, index) {
  const l = listAt(project, listPath); if (!l || index < 0 || index >= l.length) return null;
  return l.splice(index, 1)[0];
}

/** Is `inner` the same list as `outer`, or inside one of its blocks? (Stops a block being dropped into itself.) */
function isInside(outer, inner) {
  if (inner.length < outer.length) return false;
  return outer.every((k, i) => inner[i] === k);
}

/**
 * Move a block to a new place. `index` is the gap it is dropped into, counted in the list as it is
 * before the move. Returns false (and changes nothing) when the move makes no sense.
 */
function moveBlock(project, fromList, fromIndex, toList, toIndex, blocks) {
  const src = listAt(project, fromList), dst = listAt(project, toList);
  if (!src || !dst || fromIndex < 0 || fromIndex >= src.length) return false;
  const b = src[fromIndex];
  // dropping a block into itself (or into a list inside itself) is not allowed
  if (isInside(fromList.concat([fromIndex]), toList)) return false;
  if (blocks && !canDrop(blocks[b.block], toList)) return false;
  let at = toIndex;
  const same = fromList.length === toList.length && fromList.every((k, i) => toList[i] === k);
  if (same && at > fromIndex) at--;                 // the list shrinks by one before the block goes back in
  if (same && at === fromIndex) return true;        // dropped where it already was
  // when moving up to a list in the same parent as a later sibling, paths may shift: work from the blocks themselves
  src.splice(fromIndex, 1);
  const dst2 = listAt(project, adjustedPath(toList, fromList, fromIndex));
  if (!dst2) { src.splice(fromIndex, 0, b); return false; }
  dst2.splice(Math.max(0, Math.min(at, dst2.length)), 0, b);
  return true;
}

/** After a block is taken out of `fromList` at `fromIndex`, later blocks in that list move up one place. */
function adjustedPath(path, fromList, fromIndex) {
  if (path.length <= fromList.length) return path;
  if (!fromList.every((k, i) => path[i] === k)) return path;
  const p = path.slice();
  const k = p[fromList.length];
  if (typeof k === 'number' && k > fromIndex) p[fromList.length] = k - 1;
  return p;
}

function setParam(project, listPath, index, name, value, def) {
  const l = listAt(project, listPath); if (!l || !l[index]) return false;
  const p = def && def.params && def.params[name];
  if (p && (p.type === 'number' || p.type === 'colour')) value = clamp(Number(value), p.min, p.max, p);
  if (p && p.type === 'choice' && !(p.options || []).some(o => o[0] === value)) value = p.default !== undefined ? p.default : p.options[0][0];
  l[index][name] = value;
  return true;
}

function setThing(project, name, key, value) {
  const t = project.things && project.things[name]; if (!t) return false;
  if (key === 'art' || key === 'color') { t[key] = key === 'color' ? clamp(Number(value), 0, 15) : String(value); return true; }
  if (!['x', 'y', 'w', 'h'].includes(key)) return false;
  t[key] = clamp(Number(value), 0, key === 'x' || key === 'w' ? 255 : 191);
  return true;
}

/** A plain-English line for a block, for its heading: "Put a thing here" etc. is the block's own name. */
function describe(def) { return def ? def.name : 'Unknown block'; }

/** Only what the panel needs to know about each block. */
function catalogue(blocks) {
  return Object.keys(blocks).filter(k => !k.startsWith('_')).map(k => {
    const d = blocks[k];
    return { id: d.id, name: d.name, when: d.when || 'any', category: d.category || 'Other', about: d.about || '', params: d.params || {} };
  });
}

/** Tiles: a name and a picture. */
function addTile(project, name, art) {
  if (!/^[A-Za-z][A-Za-z0-9_ ]*$/.test(String(name || '').trim())) return false;
  project.tiles = project.tiles || {};
  const key = String(name).trim();
  if (project.tiles[key]) return false;
  project.tiles[key] = { art: String(art || '') };
  return true;
}
function setTile(project, name, key, value) {
  const t = project.tiles && project.tiles[name]; if (!t || key !== 'art') return false;
  t.art = String(value); return true;
}

module.exports = { copyPictureLines, addTile, setTile, dataOf, pictures, tileShape, shown, soundLabels, listAt, rootOf, newBlock, canDrop, insertBlock, removeBlock, moveBlock, setParam, setThing, isInside, adjustedPath, describe, catalogue };
