'use strict';
// The original game, side by side. Comments in the source can name an address in the
// original program, for example "(Spectrum $A420)". This file reads a SkoolKit .skool
// disassembly so those addresses can be looked up, previewed and opened.
// Nothing in here knows about VS Code.
//
// How a .skool file marks addresses (SkoolKit format):
//   c$a420 call $ab9e    ; first line of an entry: a type letter (b c g i s t u w),
//                         ; then the address ($hex or decimal), then the instruction
//    $a423 ld a,$01      ; other lines start with a space ...
//   *$9d16 ex de,hl      ; ... or * when other code jumps there
//   ; Some text           ; comment lines above an entry describe it (the first is its title)
//   @label=main_loop     ; @ lines are instructions to SkoolKit; @label names the entry

const fs = require('fs');
const path = require('path');

const LINE_RX = /^([bcgistuw*!|> ])(\$[0-9A-Fa-f]{1,4}|\d{1,5})(?=\s|$)/;
const ENTRY_TYPES = 'bcgistuw';

/** SkoolKit text has macros in it (#R$a515, #REGhl ...). Make it plain. */
function tidy(text) {
  return text
    .replace(/#R\$([0-9A-Fa-f]{4})(@\w+)?(#\w+)?(\([^)]*\))?/g, (a, h) => '$' + h.toUpperCase())
    .replace(/#REG([a-z']+)/g, (a, r) => r.toUpperCase())
    .replace(/#(HTML|FONT|SCR|UDG|LINK|CALL|PEEK|POKES|SPACE|LIST|TABLE)\b\S*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Read the text of a .skool file into an index of addresses. */
function parseSkool(text) {
  const lines = text.split(/\r?\n/);
  const instrs = [];          // { addr, line, entry } in file order
  const entries = [];         // { addr, line, type, title, label, headerLine }
  let header = [];            // comment lines seen since the last entry
  let headerLine = -1;
  let label = null;
  let entry = null;           // the entry being read; a blank line ends it
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) { entry = null; continue; }
    if (l[0] === ';') {
      if (entry) continue;      // a comment between the instructions of an entry
      if (!header.length) headerLine = i;
      header.push(l.replace(/^;\s?/, ''));
      continue;
    }
    if (l[0] === '@') {
      const m = /^@label=([A-Za-z_][A-Za-z0-9_]{0,39})\b/.exec(l);   // only plain names: they go into tooltips
      if (m) label = m[1];
      continue;
    }
    const m = LINE_RX.exec(l);
    if (!m) continue;
    const addr = m[2][0] === '$' ? parseInt(m[2].slice(1), 16) : parseInt(m[2], 10);
    if (!(addr >= 0 && addr <= 0xFFFF)) continue;
    if (ENTRY_TYPES.includes(m[1])) {
      const paras = header.join('\n').split(/\n\s*\n/);
      entry = { addr, line: i, type: m[1], title: tidy(paras[0] || ''), label, headerLine: header.length ? headerLine : i };
      entries.push(entry);
      header = []; label = null;
    }
    if (!entry) continue;
    instrs.push({ addr, line: i, entry });
  }
  // keep the first line for each address, sorted by address
  const byAddr = new Map();
  for (const x of instrs) if (!byAddr.has(x.addr)) byAddr.set(x.addr, x);
  const sorted = [...byAddr.values()].sort((a, b) => a.addr - b.addr);
  const min = sorted.length ? sorted[0].addr : 0;
  const max = sorted.length ? Math.min(0xFFFF, sorted[sorted.length - 1].addr + 0xFF) : -1;
  return { lines, entries, instrs: sorted, min, max };
}

/**
 * Where is `addr` in the file? Returns null when it is outside the file, otherwise
 * { addr, line, exact, entry, at } where `at` is the address of the line found
 * (the nearest line at or before `addr` when there isn't one exactly there).
 */
function lookup(index, addr) {
  if (!index || addr < index.min || addr > index.max) return null;
  const a = index.instrs;
  let lo = 0, hi = a.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid].addr <= addr) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (best < 0) return null;
  const x = a[best];
  return { addr, line: x.line, exact: x.addr === addr, entry: x.entry, at: x.addr };
}

/** A few lines of the file from `line` on: instruction lines and the comments between them. */
function previewLines(index, line, count) {
  const out = [];
  for (let i = line; i < index.lines.length && out.length < count; i++) {
    const l = index.lines[i];
    if (l[0] === '@') continue;
    if (!l.trim()) { if (out.length) break; continue; }   // a blank line ends the entry
    out.push(l.replace(/\s+$/, ''));
  }
  return out;
}

/** "$A420" style addresses in a piece of comment text: [{ addr, start, end }] (start/end within `text`). */
const REF_RX = /(^|[^0-9A-Za-z_$#])\$([0-9A-Fa-f]{4})(?![0-9A-Za-z_])/g;
function findRefsInText(text) {
  const out = [];
  REF_RX.lastIndex = 0;
  let m;
  while ((m = REF_RX.exec(text))) {
    const start = m.index + m[1].length;
    out.push({ addr: parseInt(m[2], 16), start, end: start + 5 });
  }
  return out;
}

const hex4 = (n) => '$' + n.toString(16).toUpperCase().padStart(4, '0');

// ---------------------------------------------------------------------------
// finding the .skool file
// ---------------------------------------------------------------------------
const SKIP_DIRS = new Set(['node_modules', '.git', '.vscode', '__pycache__', '.vscode-test']);

/** Every .skool file in `dir` and up to `depth` folders below it. */
function skoolFilesIn(dir, depth, budget) {
  budget = budget || { n: 3000 };
  let names;
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return []; }
  const out = [];
  for (const d of names) {
    if (--budget.n < 0) break;
    if (d.isFile() && d.name.toLowerCase().endsWith('.skool')) out.push(path.join(dir, d.name));
  }
  if (depth > 0) for (const d of names) {
    if (budget.n < 0) break;
    if (d.isDirectory() && !SKIP_DIRS.has(d.name) && !d.name.startsWith('.')) out.push(...skoolFilesIn(path.join(dir, d.name), depth - 1, budget));
  }
  return out;
}

const sizeOf = (f) => { try { return fs.statSync(f).size; } catch (e) { return 0; } };

/**
 * Work out which .skool file to use for a source file.
 * `setting` may be empty (look near the source), a .skool file, or a folder holding one.
 * Relative settings are taken from `baseDir` (the workspace folder). When several files
 * turn up together the biggest wins, since that is usually the game rather than its loader.
 */
function findSkool(sourceFile, setting, baseDir) {
  const pickBiggest = (list) => list.sort((a, b) => sizeOf(b) - sizeOf(a))[0] || null;
  if (setting && setting.trim()) {
    let p = setting.trim();
    if (!path.isAbsolute(p)) p = path.resolve(baseDir || path.dirname(sourceFile), p);
    let st = null;
    try { st = fs.statSync(p); } catch (e) { return null; }
    if (st.isFile()) return p;
    if (st.isDirectory()) return pickBiggest(skoolFilesIn(p, 2));
    return null;
  }
  // the source's own folder (and two levels inside it), then the folder above
  const dir = path.dirname(sourceFile);
  const here = skoolFilesIn(dir, 2);
  if (here.length) return pickBiggest(here);
  const up = path.dirname(dir);
  if (up !== dir) { const there = skoolFilesIn(up, 1); if (there.length) return pickBiggest(there); }
  return null;
}

module.exports = { tidy, parseSkool, lookup, previewLines, findRefsInText, findSkool, skoolFilesIn, hex4 };
