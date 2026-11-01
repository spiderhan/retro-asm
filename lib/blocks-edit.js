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

/** A new block with its settings filled in with sensible starting values. */
function newBlock(def, project) {
  const b = { block: def.id };
  const things = Object.keys((project && project.things) || {});
  for (const [name, p] of Object.entries(def.params || {})) {
    if (p.type === 'blocks') b[name] = [];
    else if (p.type === 'thing') b[name] = things[0] || '';
    else if (p.type === 'number') b[name] = p.default === undefined ? 0 : p.default;
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
  if (p && p.type === 'number') value = clamp(Number(value), p.min, p.max, p);
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

module.exports = { listAt, rootOf, newBlock, canDrop, insertBlock, removeBlock, moveBlock, setParam, setThing, isInside, adjustedPath, describe, catalogue };
