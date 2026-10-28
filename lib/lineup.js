'use strict';
// Line-up: puts the label, the instruction, the operands and the end-of-line comment of every
// line into set columns. Only the spaces between those parts change; the parts themselves
// (and the operands' own spacing) are copied exactly as typed.
// It reads lines with the same reader as everything else (parseLine), so each chip's layout
// rules apply. The columns come from the chip file's "lineUp" section, and can be overridden.
// Nothing in here knows about VS Code.

const { parseLine } = require('./parser');

// Columns count from 0: "instruction: 8" means the instruction starts after 8 characters.
// Used when a chip file has no "lineUp" section (or leaves a number out).
const DEFAULT_LINEUP = { instruction: 8, operands: 16, comment: 32, commentGap: 2 };
const KEYS = Object.keys(DEFAULT_LINEUP);

/** The chip file's "lineUp" section with anything missing filled in. Throws a readable Error for a bad value. */
function readLineUp(raw) {
  const out = Object.assign({}, DEFAULT_LINEUP);
  for (const k of Object.keys(raw || {})) {
    if (k.startsWith('_')) continue;
    if (!KEYS.includes(k)) throw new Error(`lineUp.${k}: the numbers are ${KEYS.join(', ')}`);
    const v = raw[k];
    if (!Number.isInteger(v) || v < 1 || v > 120) throw new Error(`lineUp.${k} must be a whole number from 1 to 120`);
    out[k] = v;
  }
  if (out.operands <= out.instruction) throw new Error('lineUp.operands must be bigger than lineUp.instruction (the operands come after the instruction)');
  if (out.comment <= out.operands) throw new Error('lineUp.comment must be bigger than lineUp.operands (the comment comes after the operands)');
  return out;
}

// "name = value" and "*=address" lines are not laid out like instructions
const ASSIGNMENT = /^\*?=\??$/;
// On the TI-99/4A a text starting like this after the operands carries on a sum ("LI R0,5 + 2")
const SUM_CONTINUES = /^[+\-\/&|^~]/;

/** Is this word an instruction or a directive of the chip? (`word` in capitals) */
const known = (D, word) => D.instructions.has(word) || D.directives.has(word);

/** `text` followed by spaces so that what comes next starts at `col`, with at least `gap` spaces between. */
function padTo(text, col, gap) {
  if (!text.length) return ' '.repeat(col);
  return text + ' '.repeat(Math.max(gap, col - text.length));
}

/**
 * One line, put into columns. Returns the new text, or null when the line is left exactly as it is
 * (blank lines, comment-only lines, and the kinds of line this doesn't try to lay out).
 */
function layoutLine(raw, pl, D, cols) {
  const head = pl.parts ? pl.parts[0] : pl;
  if (pl.open || pl.close) return null;                              // lines with { or } (scopes, loops)
  if (pl.comment && pl.comment.start === 0) return null;             // a comment-only line, or the end of a /* block */
  if (!head.label && !head.mnem) return null;
  if (head.mnem && ASSIGNMENT.test(head.mnem.text)) return null;
  if (pl.parts && !head.mnem) return null;                           // ".loop : LDA #1" (a label, then more statements)

  // A label pushed in from the left by accident ("   START LWPI WS"): the chip reads START as the
  // instruction, so the real instruction would be moved to the operands' place. Leave the line as typed.
  if (head.mnem && !head.label && raw.search(/\S/) > 0 && !known(D, head.mnem.upper) && head.operands.length &&
      known(D, head.operands[0].text.trim().split(/[\s,]/)[0].toUpperCase())) return null;

  const commentAt = pl.comment ? pl.comment.start : null;
  const codeEnd = raw.slice(0, commentAt === null ? raw.length : commentAt).trimEnd().length;
  const first = raw.search(/\S/);

  // the comment must really be a comment: "LI R0,5 + 2" on the TI-99/4A is a sum, so leave it
  if (pl.comment && D.checks.oneSpaceComment && head.operands.length && SUM_CONTINUES.test(pl.comment.text)) return null;

  let out = '';
  let labelEnd = 0;
  if (head.label) {
    const dotted = !!D.syntax.dotLabels;
    if (dotted ? raw[first] !== '.' : first !== head.label.start) return null;
    labelEnd = head.label.end + (raw[head.label.end] === ':' ? 1 : 0);
    out = raw.slice(first, labelEnd);
  }

  if (head.mnem) {
    const { start: ms, end: me } = head.mnem;
    if (ms < labelEnd || raw.slice(labelEnd, ms).replace(/:/g, '').trim().length) return null;   // something unexpected in between
    const rest = raw.slice(me, Math.max(me, codeEnd));
    out = padTo(out, cols.instruction, 1) + raw.slice(ms, me);
    if (rest.length && /^\s/.test(rest)) out = padTo(out, cols.operands, 1) + rest.trimStart();
    else out += rest;                                                 // BasicUpstart2(x) or LDA#5: nothing between, so nothing added
  }

  if (pl.comment) out = padTo(out, cols.comment, cols.commentGap) + raw.slice(commentAt).trimEnd();
  return out;
}

/**
 * The changes needed, as [{ line, start, end, text }] (line and columns count from 0).
 * options: columns (numbers that replace the chip file's), fromLine and toLine (only change those lines).
 */
function lineUpEdits(text, D, options) {
  const opt = options || {};
  const cols = readLineUp(Object.assign({}, D.lineUp || DEFAULT_LINEUP, opt.columns || {}));
  const lines = String(text).split(/\r?\n/);
  const st = {};
  const from = opt.fromLine === undefined ? 0 : Math.max(0, opt.fromLine);
  const to = opt.toLine === undefined ? lines.length - 1 : Math.min(lines.length - 1, opt.toLine);
  const edits = [];
  for (let i = 0; i < lines.length; i++) {
    const pl = parseLine(lines[i], D, st);                           // every line is read, so block comments are followed from the top
    if (i < from || i > to) continue;
    const now = layoutLine(lines[i], pl, D, cols);
    if (now === null || now === lines[i]) continue;
    // only the part in the middle that differs
    const was = lines[i];
    let a = 0;
    while (a < was.length && a < now.length && was[a] === now[a]) a++;
    let b = 0;
    while (b < was.length - a && b < now.length - a && was[was.length - 1 - b] === now[now.length - 1 - b]) b++;
    edits.push({ line: i, start: a, end: was.length - b, text: now.slice(a, now.length - b) });
  }
  return { edits, columns: cols };
}

module.exports = { readLineUp, lineUpEdits, DEFAULT_LINEUP };
