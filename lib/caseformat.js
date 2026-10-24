'use strict';
// Letter case: puts instructions, directives, registers and (if the chip file asks for it) labels
// into upper or lower case. Comments, text in quotes and numbers are never touched.
// It reads lines with the same reader as everything else (parseLine and scan), so each chip's
// layout rules apply, and the word lists are the chip file's own.
// Nothing in here knows about VS Code.

const { parseLine, statements, scan } = require('./parser');

const CASES = ['upper', 'lower', 'keep'];
const KINDS = ['instructions', 'directives', 'registers', 'labels'];
// Used when a chip file has no "caseFormat" section (or leaves a part out)
const DEFAULT_CASE = { instructions: 'upper', directives: 'keep', registers: 'upper', labels: 'keep' };

/** The chip file's "caseFormat" section with anything missing filled in. Throws a readable Error for a bad value. */
function readCaseFormat(raw) {
  const out = Object.assign({}, DEFAULT_CASE);
  for (const k of Object.keys(raw || {})) {
    if (k.startsWith('_')) continue;
    if (!KINDS.includes(k)) throw new Error(`caseFormat.${k}: the parts are ${KINDS.join(', ')}`);
    if (!CASES.includes(raw[k])) throw new Error(`caseFormat.${k} must be "upper", "lower" or "keep"`);
    out[k] = raw[k];
  }
  return out;
}

const withCase = (text, rule) => (rule === 'upper' ? text.toUpperCase() : rule === 'lower' ? text.toLowerCase() : text);
const isName = (s) => /^[A-Za-z_][A-Za-z0-9_]*%?$/.test(s);

/**
 * What each label should be renamed to. A label is left alone when changing its case would make
 * it the same as another label (foo and FOO in an assembler that tells them apart).
 * Returns { map: key -> new name, skipped: [names left alone] }.
 */
function labelTargets(names, rule, D) {
  const map = new Map();
  const skipped = [];
  if (rule === 'keep') return { map, skipped };
  const groups = new Map();                       // what they would become -> the names that would become it
  for (const n of names) {
    const target = withCase(n, rule);
    const k = D.key(target);
    if (!groups.has(k)) groups.set(k, { target, from: new Map() });
    groups.get(k).from.set(D.key(n), n);
  }
  for (const g of groups.values()) {
    if (g.from.size > 1) { skipped.push(...g.from.values()); continue; }
    for (const k of g.from.keys()) map.set(k, g.target);
  }
  return { map, skipped };
}

/**
 * The changes needed, as [{ line, start, end, text }] (line and columns count from 0).
 * options: rules (overrides the chip file's), fromLine and toLine (only change those lines).
 * Labels are always collected from the whole file, so a label changes the same way everywhere.
 */
function caseEdits(text, D, options) {
  const opt = options || {};
  const rules = Object.assign({}, D.caseFormat || DEFAULT_CASE, opt.rules || {});
  const lines = String(text).split(/\r?\n/);
  const st = {};
  const parsed = lines.map(l => parseLine(l, D, st));

  // 1. every label this file defines, and what each one should become
  const names = new Set();
  for (const pl of parsed) for (const s of statements(pl)) if (s.label && isName(s.label.name)) names.add(s.label.name);
  const { map, skipped } = labelTargets(names, rules.labels, D);
  // names the chip file knows (VSBW, KSCAN ...) follow the label rule too, where the assembler doesn't tell cases apart
  const knownToo = rules.labels !== 'keep' && D.key('a') === D.key('A');

  // 2. the words to change
  const from = opt.fromLine === undefined ? 0 : Math.max(0, opt.fromLine);
  const to = opt.toLine === undefined ? lines.length - 1 : Math.min(lines.length - 1, opt.toLine);
  const edits = [];
  const put = (line, start, end, was, now) => { if (now !== was) edits.push({ line, start, end, text: now }); };
  for (let i = from; i <= to; i++) {
    for (const s of statements(parsed[i])) {
      if (s.label && isName(s.label.name) && map.has(D.key(s.label.name))) {
        put(i, s.label.start, s.label.end, s.label.name, map.get(D.key(s.label.name)));
      }
      let fileName = false;                        // INCLUDE / COPY lines: the operand is a file, not code
      if (s.mnem) {
        const up = s.mnem.upper;
        if (D.instructions.has(up)) put(i, s.mnem.start, s.mnem.end, s.mnem.text, withCase(s.mnem.text, rules.instructions));
        else if (D.directives.has(up)) {
          // directives that start with a dot (.byte, .ifdef) are left as typed: in some assemblers they only work in lower case
          if (s.mnem.text[0] !== '.') put(i, s.mnem.start, s.mnem.end, s.mnem.text, withCase(s.mnem.text, rules.directives));
          const kind = D.directives.get(up).kind;
          fileName = kind === 'include' || kind === 'import';
        }
      }
      if (fileName) continue;
      for (const op of s.operands) {
        for (const t of scan(op.text, op.start, D)) {
          if (t.type === 'reg') put(i, t.start, t.end, t.text, withCase(t.text, rules.registers));
          else if (t.type === 'ident') {
            const k = D.key(t.text);
            if (map.has(k)) put(i, t.start, t.end, t.text, map.get(k));
            else if (knownToo && D.knownSymbols.has(t.upper)) put(i, t.start, t.end, t.text, withCase(t.text, rules.labels));
          }
        }
      }
    }
  }
  return { edits, skippedLabels: skipped };
}

/** Apply edits from caseEdits to the text. Line endings are kept as they were. */
function applyEdits(text, edits) {
  const parts = String(text).split(/(\r\n|\n)/);   // even places hold lines, odd places the line endings
  const byLine = new Map();
  for (const e of edits) { if (!byLine.has(e.line)) byLine.set(e.line, []); byLine.get(e.line).push(e); }
  for (const [line, list] of byLine) {
    let s = parts[line * 2];
    for (const e of list.sort((a, b) => b.start - a.start)) s = s.slice(0, e.start) + e.text + s.slice(e.end);
    parts[line * 2] = s;
  }
  return parts.join('');
}

function formatText(text, D, options) {
  const r = caseEdits(text, D, options);
  return { text: applyEdits(text, r.edits), edits: r.edits, skippedLabels: r.skippedLabels };
}

module.exports = { readCaseFormat, caseEdits, applyEdits, formatText, DEFAULT_CASE };
