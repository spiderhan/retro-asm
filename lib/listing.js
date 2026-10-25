'use strict';
/**
 * Reads the listing xas99 writes (xas99.py -R -L x.lst -S ...) and turns it into what a debugger needs:
 *  - the program's bytes, by address
 *  - which source line sits at which address (and back again)
 *  - where the program starts
 * No VS Code, no files: give it the listing text.
 */
const path = require('path');

const HEX4 = /^[0-9A-F]{4}$/i;

/** Runs of neighbouring bytes, as [{start, end}]. */
function segmentsOf(bytes) {
  const addrs = [...bytes.keys()].sort((a, b) => a - b);
  const segments = [];
  for (const a of addrs) {
    const s = segments[segments.length - 1];
    if (s && a === s.end + 1) s.end = a; else segments.push({ start: a, end: a });
  }
  return segments;
}

/**
 * @param {string} text   the listing
 * @param {string} mainFile  full path of the main source file (copied files are looked for beside it)
 * @returns {{bytes: Map<number,number>, lines: {file,line,addr,size}[], symbols: Map<string,number>, entry: number|null, segments: {start,end}[]}}
 */
function parseListing(text, mainFile) {
  const dir = path.dirname(mainFile);
  const stack = [mainFile];
  const bytes = new Map();
  const lines = [];
  const symbols = new Map();
  let last = null;                       // the source line the next continuation row belongs to
  let endLabel = null;
  const refs = new Set();
  const bss = [];                        // BSS / BES lines: room set aside but with no bytes in the listing

  const put = (addr, hex) => {
    for (let i = 0; i + 1 < hex.length + 1 && i < hex.length; i += 2) bytes.set((addr + i / 2) & 0xFFFF, parseInt(hex.substr(i, 2), 16));
  };

  for (const raw of text.split(/\r?\n/)) {
    let m = /^\s+\*{4} \*{4}\s+> (.+)$/.exec(raw);
    if (m) { const f = path.join(dir, m[1].trim()); if (f !== stack[stack.length - 1]) stack.push(f); continue; }
    m = /^\s+< (.+)$/.exec(raw);
    if (m) { if (stack.length > 1) stack.pop(); continue; }

    // symbol table: "    start............... >a000 :"
    m = /^\s*([^\s.][^\s]*?)\.{2,}\s*>([0-9A-Fa-f]{4})\b/.exec(raw);
    if (m) { symbols.set(m[1].toUpperCase(), parseInt(m[2], 16)); continue; }

    // continuation row: "     A002 1234"
    m = /^ {5}([0-9A-F]{4}) +([0-9A-F]{2,4})[a-z']?\s*$/i.exec(raw);   // xas99 puts a letter after an address it leaves to the loader (0000e)
    if (m && last) {
      put(parseInt(m[1], 16), m[2]);
      last.words.push({ addr: parseInt(m[1], 16), hex: m[2].toUpperCase() });
      if (last.addr >= 0) last.size = Math.max(last.size, parseInt(m[1], 16) + m[2].length / 2 - last.addr);
      continue;
    }

    // a source row: "0002 A000 0200  20 START  LI ..."
    // (read by column: for a byte at an odd address xas99 prints the byte further to the right,
    // under the second half of the data column, so the data cannot be found by counting spaces)
    m = /^(\d{4}) /.exec(raw);
    if (!m) continue;
    const lineNo = parseInt(m[1], 10) - 1;
    const addr = HEX4.test(raw.substr(5, 4)) ? parseInt(raw.substr(5, 4), 16) : -1;
    const data = raw.substr(10, 4).trim();
    const cycles = raw.substr(15, 3).trim();
    const source = raw.substr(19);
    if (addr >= 0 && /^[0-9A-F]+$/i.test(data) && data.length % 2 === 0) put(addr, data);
    const rm = /^\S*\s+REF\s+(\S+)/i.exec(source);
    if (rm) for (const n of rm[1].split(',')) if (n) refs.add(n.toUpperCase());
    const bm = addr >= 0 && !data ? /^\S*\s+(BSS|BES)\s+(\S+)/i.exec(source) : null;
    if (bm) bss.push({ addr, expr: bm[2], bes: /^BES$/i.test(bm[1]) });
    const em = /^\S*\s+END\s+(\S+)/i.exec(source);
    if (em) endLabel = em[1].toUpperCase();
    last = { file: stack[stack.length - 1], line: lineNo, addr, size: addr >= 0 ? data.length / 2 : 0, code: /^\d+$/.test(cycles), source, words: addr >= 0 && /^[0-9A-F]+$/i.test(data) ? [{ addr, hex: data.toUpperCase() }] : [] };
    if (addr >= 0) lines.push(last);
  }

  const segments = segmentsOf(bytes);
  let entry = null;
  if (endLabel && symbols.has(endLabel)) entry = symbols.get(endLabel);
  else if (/^[0-9A-F]{4}$/.test(endLabel || '')) entry = null;
  if (entry === null) { const first = lines.find(l => l.code); if (first) entry = first.addr; }
  // room set aside with BSS (often the program's own workspace at the very end) has no bytes, but nothing else may be put on top of it
  const reserved = [];
  for (const b of bss) {
    const n = evalSize(b.expr, symbols);
    const size = n === null ? 0x100 : n;        // an expression that can't be worked out: keep well clear
    if (size > 0) reserved.push({ start: b.addr, end: b.addr + size - 1 });
  }
  return { bytes, lines, symbols, entry, segments, refs, reserved };
}

/** A size such as 32, >20, WSLEN or 2*16+>10; null if it can't be worked out. */
function evalSize(text, symbols) {
  let t = String(text).replace(/>([0-9A-F]+)/gi, (m, h) => String(parseInt(h, 16)));
  t = t.replace(/[A-Z_$#@][A-Z0-9_$#@]*/gi, (m) => symbols.has(m.toUpperCase()) ? String(symbols.get(m.toUpperCase())) : m);
  if (!/^[0-9+\-*\/() ]+$/.test(t)) return null;
  try { const v = Function('return (' + t + ')')(); return Number.isFinite(v) && v >= 0 && v < 0x10000 ? Math.floor(v) : null; } catch (e) { return null; }
}

/** Same file? (Windows ignores capital letters and slash direction.) */
function same(a, b) {
  const n = (p) => { const x = path.normalize(p); return process.platform === 'win32' ? x.toLowerCase() : x; };
  return n(a) === n(b);
}

/**
 * Can this program be loaded and run by the debugger? Returns '' when it can, or one plain sentence.
 * The TI's extra 32K memory is at >2000->3FFF and >A000->FFFF, so that is where code must sit.
 * (Code may be in several separate pieces, as long as each is wholly inside one of those two places.)
 */
function checkImage(parsed) {
  if (!parsed.segments.length) return 'The assembler made no program bytes, so there is nothing to run.';
  const inside = (s) => (s.start >= 0x2000 && s.end <= 0x3FFF) || (s.start >= 0xA000 && s.end <= 0xFFFF);
  for (const s of parsed.segments) {
    if (!inside(s)) {
      const range = '>' + s.start.toString(16).toUpperCase() + '->' + s.end.toString(16).toUpperCase();
      return s.start < 0x2000
        ? 'This program has no fixed address (no AORG line), so the debugger can\'t tell where to put it. Add a line such as "AORG >A000" before the code.'
        : `The program sits at ${range}, which isn't wholly inside the TI's extra memory (>2000->3FFF or >A000->FFFF). Move it with AORG.`;
    }
  }
  return '';
}

/** Where there is room to put extra code after the program: gives the first free even address, or null. */
function roomAfter(parsed, size) {
  let lastEnd = parsed.segments.length ? parsed.segments[parsed.segments.length - 1].end : -1;
  for (const r of parsed.reserved || []) if (r.end > lastEnd && (lastEnd < 0 || r.start <= lastEnd + 0x1000)) lastEnd = r.end;     // BSS space at the end counts as used
  const base = (lastEnd + 2) & ~1;
  const limit = lastEnd < 0x4000 ? 0x4000 : 0x10000;
  return base + size <= limit ? base : null;
}

/** Lines you can stop on: lines that make an instruction. */
function breakableLines(parsed) { return parsed.lines.filter(l => l.code); }

/** The address a breakpoint on this line stops at, or null (a blank line, a comment, data...). */
function addrForLine(parsed, file, line) {
  const l = parsed.lines.find(x => x.code && same(x.file, file) && x.line === line);
  return l ? l.addr : null;
}

/** Same, but if the line has no code, move down to the next line that does (what other debuggers do). */
function nearestLine(parsed, file, line) {
  let best = null;
  for (const l of parsed.lines) if (l.code && same(l.file, file) && l.line >= line && (!best || l.line < best.line)) best = l;
  return best;
}

/** The source line for an address (the instruction it is inside), or null. */
function lineForAddr(parsed, addr) {
  for (const l of parsed.lines) if (l.code && addr >= l.addr && addr < l.addr + Math.max(2, l.size)) return l;
  return null;
}

/** The program as separate pieces: [{ addr, bytes }], one for each run of neighbouring bytes. */
function blocksOf(parsed) {
  return parsed.segments.map(sg => {
    const bytes = Buffer.alloc(sg.end - sg.start + 1);
    for (let a = sg.start; a <= sg.end; a++) bytes[a - sg.start] = parsed.bytes.get(a);
    return { addr: sg.start, bytes };
  });
}

/** The program as one block: {load, hex} for [start..end], gaps filled with zeros. */
function imageOf(parsed) {
  if (!parsed.segments.length) return null;
  const start = parsed.segments[0].start;
  const end = parsed.segments[parsed.segments.length - 1].end;
  let hex = '';
  for (let a = start; a <= end; a++) hex += (parsed.bytes.has(a) ? parsed.bytes.get(a) : 0).toString(16).padStart(2, '0');
  return { load: start, end, hex: hex.toUpperCase() };
}

module.exports = { blocksOf, roomAfter, parseListing, segmentsOf, same, checkImage, breakableLines, addrForLine, nearestLine, lineForAddr, imageOf };
