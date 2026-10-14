'use strict';
// Loads a dialect (one JSON file per chip) and adds a few quick-lookup helpers.
// Nothing in here knows about VS Code, so it can be tested with plain Node.

const fs = require('fs');
const path = require('path');
const { parseLine } = require('./parser');
const { prepareTiming } = require('./timing');

const SYNTAX_DEFAULTS = {
  lineComment: [';'],
  col0Comment: [],
  spaceStarComment: false,
  operandsEndAtSpace: false,
  col0IsAlwaysLabel: false,
  indentedLabels: true,
  stringQuotes: ['"', "'"],
  hexPrefixes: ['$', '0x'],
  binPrefixes: ['%'],
  hexSuffix: true,
  hexDisplay: '$',
  addressPrefix: '',
  leftToRightMath: false,
  wordBits: 16,
  littleEndian: false,
  byteName: 'byte',
  wordName: 'word',
  highByteName: 'high byte',
  lowByteName: 'low byte'
};

function syn_caseSensitive(raw) { return !!(raw.syntax && raw.syntax.caseSensitive); }

function upperKeys(obj) {
  const out = new Map();
  for (const k of Object.keys(obj || {})) if (!k.startsWith('_')) out.set(k.toUpperCase(), Object.assign({ key: k }, typeof obj[k] === 'string' ? { text: obj[k] } : obj[k]));
  return out;
}

/**
 * Chip files hold search patterns. A badly written one, such as (a+)+, can take so long on some
 * lines that the editor locks up, and a running pattern can't be stopped. So patterns are
 * checked when the chip file is loaded, and a chip file with a risky one is not used.
 * Returns a reason, or null if the pattern looks safe.
 */
function riskyPattern(re) {
  if (typeof re !== 'string') return 'is not text';
  if (re.length > 300) return 'is longer than 300 characters';
  if (/\\[1-9]|\\k</.test(re)) return 'refers back to an earlier part of itself (\\1 and so on)';
  // Walk the pattern, noting for each bracketed group whether it holds a repeat (* + {n,}) or a choice (|).
  // A group like that which is itself repeated without limit is what can run for ever.
  const stack = [{ inner: false }];
  let lastGroup = null;
  for (let i = 0; i < re.length; i++) {
    const c = re[i];
    if (c === '\\') { i++; lastGroup = null; continue; }
    if (c === '[') {                                    // a set of characters: skip to its end
      i++;
      if (re[i] === '^') i++;
      if (re[i] === ']') i++;
      while (i < re.length && re[i] !== ']') { if (re[i] === '\\') i++; i++; }
      lastGroup = null;
      continue;
    }
    if (c === '(') { stack.push({ inner: false }); lastGroup = null; continue; }
    if (c === ')') {
      const g = stack.length > 1 ? stack.pop() : { inner: false };
      lastGroup = g;
      if (g.inner) stack[stack.length - 1].inner = true;
      continue;
    }
    if (c === '|') { stack[stack.length - 1].choice = true; lastGroup = null; continue; }
    const unbounded = c === '*' || c === '+' || (c === '{' && /^\{\d*,\}/.test(re.slice(i)));
    const bounded = c === '?' || (c === '{' && !unbounded);
    if (unbounded || bounded) {
      if (unbounded && lastGroup && (lastGroup.inner || lastGroup.choice)) return 'repeats a group that already repeats or offers a choice, such as (a+)+ or (a|ab)*';
      if (unbounded || (c === '{' && !/^\{\d+\}/.test(re.slice(i)))) stack[stack.length - 1].inner = true;
      if (c === '{') { while (i < re.length && re[i] !== '}') i++; }
      if (re[i + 1] === '?') i++;
      lastGroup = null;
      continue;
    }
    lastGroup = null;
  }
  return null;
}

/** Compile a pattern from a chip file, refusing risky ones. `where` says which pattern, for the message. */
function safeRegExp(re, where) {
  const why = riskyPattern(re);
  if (why) throw new Error(`the pattern in ${where} ${why}, which could freeze the editor`);
  try { return new RegExp(re, 'i'); }
  catch (e) { throw new Error(`the pattern in ${where} is not valid: ${e.message}`); }
}

/** A snippet as plain code: ${1:NAME} becomes NAME, $1 and $0 (where the cursor goes) disappear, \\$ becomes $. */
function snippetPreview(text) {
  return text
    .replace(/\$\{\d+:([^}]*)\}/g, '$1')
    .replace(/\$\{\d+\}|(^|[^\\])\$\d+/g, (m, before) => before || '')
    .replace(/\\\$/g, '$');
}

/** Turn the raw JSON into a dialect object. Throws a readable Error if it is unusable. */
function prepare(raw, source) {
  if (!raw || typeof raw !== 'object') throw new Error('not a JSON object');
  if (!raw.id || typeof raw.id !== 'string') throw new Error('missing "id"');
  const D = {
    id: raw.id,
    name: raw.name || raw.id,
    short: raw.short || raw.name || raw.id,
    about: raw.about || '',
    source: source || '',
    fileExtensions: (raw.fileExtensions || []).map(e => e.toLowerCase()),
    syntax: Object.assign({}, SYNTAX_DEFAULTS, raw.syntax || {}),
    instructions: upperKeys(raw.instructions),
    directives: upperKeys(raw.directives),
    knownSymbols: upperKeys(raw.symbols),
    conditions: upperKeys(raw.conditions),
    addresses: new Map(),
    regions: [],
    operandForms: [],
    sizing: raw.sizing || null,
    build: raw.build || null,
    sprites: raw.sprites || null,
    ports: new Map(),
    checks: raw.checks || {},
    registers: { names: new Set(), notes: new Map(), about: '', pattern: null, workspaceInstruction: null }
  };
  // longest prefix first, so "0x" is tried before a bare digit rule
  D.syntax.hexPrefixes = D.syntax.hexPrefixes.slice().sort((a, b) => b.length - a.length);

  const reg = raw.registers || {};
  for (const n of reg.names || []) D.registers.names.add(n.toUpperCase());
  for (const k of Object.keys(reg.notes || {})) if (!k.startsWith('_')) D.registers.notes.set(k.toUpperCase(), reg.notes[k]);
  D.registers.about = reg.about || '';
  D.registers.list = (reg.names || []).slice();
  D.registers.workspaceInstruction = reg.workspaceInstruction ? reg.workspaceInstruction.toUpperCase() : null;
  D.registers.wide = new Set((reg.wide || []).map(n => n.toUpperCase()));   // 16-bit registers (Z80 pairs)
  D.registers.noRanges = !!reg.noRanges;
  // the halves of a pair (Z80: B and C make BC), so changing BC counts as changing B and C
  D.registers.parts = new Map();
  for (const k of Object.keys(reg.parts || {})) D.registers.parts.set(k.toUpperCase(), (reg.parts[k] || []).map(x => x.toUpperCase()));
  D.registers.overlap = (a, b) => {
    a = a.toUpperCase(); b = b.toUpperCase();
    if (a === b) return true;
    const pa = D.registers.parts.get(a) || [], pb = D.registers.parts.get(b) || [];
    return pa.includes(b) || pb.includes(a);
  };                                      // list as "B, C, D", never "B-D"
  if (reg.pattern) D.registers.pattern = safeRegExp(reg.pattern, 'registers.pattern');

  for (const k of Object.keys(raw.addresses || {})) if (!k.startsWith('_')) D.addresses.set(parseInt(k, 16), raw.addresses[k]);
  // more addresses, explained the same way but left out of the cheat sheet (points inside ROM routines)
  D.notInSheet = new Set();
  for (const k of Object.keys(raw.moreAddresses || {})) {
    if (k.startsWith('_')) continue;
    const v = parseInt(k, 16);
    if (!D.addresses.has(v)) { D.addresses.set(v, raw.moreAddresses[k]); D.notInSheet.add(v); }
  }
  D.portSymbols = upperKeys(raw.portSymbols);
  // when a number may be an address: from which value, and whether plain decimal numbers count too
  const g = raw.addressGuess || {};
  D.addressGuess = { min: g.min ? parseInt(g.min, 16) : 0x2000, decimal: !!g.decimal };
  if (D.sizing) D.sizing.load = parseInt(D.sizing.loadAddress || '0', 16);
  for (const k of Object.keys(raw.ports || {})) if (!k.startsWith('_')) D.ports.set(parseInt(k, 16), raw.ports[k]);
  // hardware reached with IN and OUT (Z80): number -> { name, text, write, read }
  D.ioPorts = new Map();
  for (const k of Object.keys(raw.ioPorts || {})) if (!k.startsWith('_')) D.ioPorts.set(parseInt(k, 16), raw.ioPorts[k]);
  /** The port a number reaches: an exact match first, then by its low byte (the Spectrum's ULA answers to any port ending $FE). */
  D.ioPort = (v) => {
    if (v === null || v === undefined) return null;
    const exact = D.ioPorts.get(v);
    if (exact) return exact;
    const low = D.ioPorts.get(v & 0xFF);
    return low && low.anyHigh ? low : null;
  };
  for (const r of raw.regions || []) D.regions.push({ from: parseInt(r.from, 16), to: parseInt(r.to, 16), text: r.text });
  for (const f of raw.operandForms || []) {
    if (f.re === '@REGISTER') D.operandForms.push(Object.assign({}, f, { anyRegister: true }));
    else D.operandForms.push(Object.assign({}, f, { rx: safeRegExp(f.re, `operandForms (${f.re})`) }));
  }
  if (D.sizing && Array.isArray(D.sizing.forms)) D.sizing.formList = D.sizing.forms.map((f, i) => Object.assign({}, f, { rx: safeRegExp(f.re, `sizing.forms[${i}]`) }));
  else if (D.sizing) delete D.sizing.forms;
  if (D.sizing && Array.isArray(D.sizing.extra)) D.sizing.extraList = D.sizing.extra.map((f, i) => Object.assign({}, f, { rx: safeRegExp(f.re, `sizing.extra[${i}]`) }));
  if (D.checks.returnOperand) D.checks.returnRx = safeRegExp(D.checks.returnOperand, 'checks.returnOperand');
  for (const [name, ins] of D.instructions) {
    for (const sp of ins.special || []) if (sp && sp.re) sp.rx = safeRegExp(sp.re, `instructions.${ins.key}.special`);
    for (const da of ins.dataAfter || []) if (da && da.end) da.endRx = safeRegExp(da.end, `instructions.${ins.key}.dataAfter`);
    if (ins.setsUnless) ins.setsUnlessRx = safeRegExp(ins.setsUnless, `instructions.${ins.key}.setsUnless`);
  }
  // ready-made starter code (the chip file's "snippets" section): trigger word -> lines to put in
  D.snippets = [];
  for (const k of Object.keys(raw.snippets || {})) {
    if (k.startsWith('_')) continue;
    const s = raw.snippets[k] || {};
    const lines = Array.isArray(s.body) ? s.body : typeof s.body === 'string' ? s.body.split(/\r?\n/) : null;
    if (!lines || lines.some(l => typeof l !== 'string')) throw new Error(`snippets.${k} needs a "body": a list of lines`);
    if (!/^[a-z][a-z0-9]*$/.test(k)) throw new Error(`snippets.${k}: the name must be lower-case letters and digits only (it is what you type)`);
    const text = lines.join('\n');
    D.snippets.push({ key: k, name: s.name || k, about: s.about || '', text, preview: snippetPreview(text) });
  }

  // how long each instruction takes (the chip file's "timing" section and each instruction's "cycles")
  D.timing = prepareTiming(raw, D, safeRegExp);

  // the key a name is filed under: capitals for most assemblers; as written for BeebAsm, where
  // st4 and ST4 are different names
  D.key = syn_caseSensitive(raw) ? (n) => String(n) : (n) => String(n).toUpperCase();
  D.isRegister = (name) => {
    const u = name.toUpperCase();
    return D.registers.names.has(u) || (D.registers.pattern ? D.registers.pattern.test(u) : false);
  };
  D.instr = (m) => D.instructions.get(m.toUpperCase()) || null;
  D.directive = (m) => D.directives.get(m.toUpperCase()) || null;
  D.isMnemonic = (m) => D.instructions.has(m.toUpperCase()) || D.directives.has(m.toUpperCase());
  /** [min, max] operand counts for a mnemonic, or null if unknown. */
  D.operandRange = (m) => {
    const i = D.instr(m);
    if (i) {
      if (Array.isArray(i.ops)) return [i.ops.length, i.ops.length];
      if (i.ops && typeof i.ops === 'object') {
        const counts = Object.keys(i.ops).map(Number);
        return [Math.min(...counts), Math.max(...counts)];
      }
      return null;
    }
    const d = D.directive(m);
    if (d && Array.isArray(d.ops)) return d.ops;
    return null;
  };
  D.region = (v) => D.regions.find(r => v >= r.from && v <= r.to) || null;
  return D;
}

function loadFile(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return prepare(raw, file);
}

/** Load every *.json dialect in a folder. Returns { dialects: [], errors: [] }. */
function loadFolder(folder) {
  const out = { dialects: [], errors: [] };
  let names = [];
  try { names = fs.readdirSync(folder); } catch (e) { return out; }
  for (const n of names.sort()) {
    if (!n.toLowerCase().endsWith('.json')) continue;
    const file = path.join(folder, n);
    try { out.dialects.push(loadFile(file)); }
    catch (e) { out.errors.push(`${file}: ${e.message}`); }
  }
  return out;
}

/**
 * Several chips can claim the same file ending (.asm is used by 6502 and Z80 assemblers alike).
 * Pick the one that knows most of the instructions (and, less so, directives) in the text; on a tie,
 * the first in the list.
 */
function guessDialect(text, list) {
  if (!list || !list.length) return null;
  if (list.length === 1 || !text) return list[0];
  const lines = String(text).split(/\r?\n/).slice(0, 600);
  let best = list[0], bestScore = -1;
  for (const D of list) {
    const st = {};
    let score = 0;
    for (const l of lines) {
      const whole = parseLine(l, D, st);
      for (const pl of whole.parts || [whole]) {
        if (!pl.mnem) continue;
        if (D.instructions.has(pl.mnem.upper)) score += 2;
        else if (D.directives.has(pl.mnem.upper)) score += 1;     // a file of DEFB lines is still Z80
        else if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(pl.mnem.text)) score -= 1;   // not even a name (a macro call would be): written for another assembler
      }
    }
    if (score > bestScore) { best = D; bestScore = score; }
  }
  return best;
}

module.exports = { riskyPattern, prepare, snippetPreview, loadFile, loadFolder, guessDialect };
