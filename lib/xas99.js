'use strict';
// Convert a TI-99/4A file to the way xas99 (in its normal mode) wants it written. It fixes the two
// things the extension already warns about, and changes nothing else:
//   1. A comment at the end of a line gets two spaces before it (one space makes xas99 read the
//      comment as part of the operands).
//   2. A space next to a comma in the operands is taken out (xas99 stops reading at the first space).
// Quotes, whole-line comments and sums such as "LI R0,5 + 2" are left alone.
// Only for chips whose assembler ends the operands at the first space (the TI-99/4A).
// Nothing in here knows about VS Code.

const { parseLine, opensQuote } = require('./parser');

const SUM_CONTINUES = /^[+\-\/&|^~]/;

/**
 * The changes needed, as [{ line, start, end, text }] (line and columns count from 0), in the same
 * form as lib/caseformat.js, so applyEdits there works on them.
 * Returns { applies, edits, commas, comments }: applies is false for a chip this is not meant for.
 */
function xas99Edits(text, D) {
  const out = { applies: !!D.syntax.operandsEndAtSpace, edits: [], commas: 0, comments: 0 };
  if (!out.applies) return out;
  const lines = String(text).split(/\r?\n/);
  const st = {};
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const pl = parseLine(raw, D, st);
    if (!pl.mnem && !pl.label) continue;
    if (pl.comment && pl.comment.start === 0) continue;

    // 1. spaces next to a comma in the operands (not inside quotes)
    if (pl.operands.length) {
      const a = pl.operands[0].start, b = pl.operands[pl.operands.length - 1].end;
      let q = null;
      for (let k = a; k < b; k++) {
        const c = raw[k];
        if (q) { if (c === q) q = null; continue; }
        if (opensQuote(raw, k, D.syntax)) { q = c; continue; }
        if (c !== ' ' && c !== '\t') continue;
        let e = k;
        while (e < b && (raw[e] === ' ' || raw[e] === '\t')) e++;
        if (raw[k - 1] === ',' || raw[e] === ',') { out.edits.push({ line: i, start: k, end: e, text: '' }); out.commas++; }
        k = e - 1;
      }
    }

    // 2. two spaces (or a Tab) before a comment that follows code
    if (pl.comment) {
      if (pl.operands.length && SUM_CONTINUES.test(pl.comment.text)) continue;   // a sum that carries on, not a comment
      const cs = pl.comment.start;
      let g = cs;
      while (g > 0 && (raw[g - 1] === ' ' || raw[g - 1] === '\t')) g--;
      const gap = raw.slice(g, cs);
      if (gap.length < 2 && !gap.includes('\t')) { out.edits.push({ line: i, start: cs, end: cs, text: ' '.repeat(2 - gap.length) }); out.comments++; }
    }
  }
  return out;
}

module.exports = { xas99Edits };
