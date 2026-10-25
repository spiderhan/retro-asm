'use strict';
// Stand-ins for the Editor/Assembler utilities (VSBW, VMBW, VSBR, VMBR, VWTR and KSCAN). A program that says
// `REF VSBW,VMBW` expects the loader to fill these in; with the program put straight into MAME
// nothing does, so a call would jump to address 0 and restart the TI. The debugger adds these
// small routines after your program and points the calls at them.
// (Written for this extension, position independent; see the listing in the CHANGELOG notes for 0.20.3.)

const CODE = 'C01D0260400006C0D8008C0206C0D8008C02D82D00028C000380C01D0260400006C0D8008C0206C0D8008C02C06D0002C0AD00041304D8318C00060216FC0380C01D06C0D8008C0206C0D8008C02DB60880000020380C01D06C0D8008C0206C0D8008C02C06D0002C0AD00041304DC608800060216FC0380C01D06C0D8008C0206C002608000D8008C020380';
const OFFSET = { VSBW: 0, VMBW: 26, VSBR: 64, VMBR: 86, VWTR: 120 };
const NAMES = Object.keys(OFFSET);
const WS_BYTES = 32;

// KSCAN is not written out here: the TI's own console ROM has the keyboard routine (at >000E). It has
// to be called with the console's workspace (>83E0) and its R11 kept safe, so a small wrapper does that:
//   LWPI >83E0 / MOV R11,@SAVE / BL @>000E / MOV @SAVE,R11 / LWPI (our workspace) / RTWP
// Afterwards the key is in >8375 (>FF = none) and bit >20 of >837C says a key was pressed, as with the real thing.
const KS_LEN = 24;                                     // 22 bytes of code and a 2-byte save place
const ksHex = (ws, save) => ['02E0', '83E0', 'C80B', wordHex(save), '06A0', '000E', 'C2E0', wordHex(save), '02E0', wordHex(ws), '0380', '0000'].join('');

const { roomAfter } = require('./listing');
const wordHex = (n) => (n & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');

/** Names this module can supply. */
const supplied = () => NAMES.concat(['KSCAN']);

/**
 * Add the routines for the REF names the program uses, and point the program's calls at them.
 * Changes `parsed` (bytes and segments). Returns { added: [names], missing: [names], error }.
 */
function supply(parsed, segmentsOf) {
  const wanted = supplied().filter(n => parsed.refs.has(n));
  const missing = [...parsed.refs].filter(n => !supplied().includes(n));
  if (!wanted.length) return { added: [], missing, error: '' };
  const codeLen = CODE.length / 2;
  const ks = wanted.includes('KSCAN');
  const size = WS_BYTES + codeLen + (ks ? KS_LEN : 0) + 4 * wanted.length;
  const base = roomAfter(parsed, size);                  // an even address just after the program
  if (base === null) return { added: [], missing, error: 'There is no room after your program for the standard routines (VSBW, VMBW...) it calls. Move it lower.' };
  const bytes = parsed.bytes;
  for (let i = 0; i < WS_BYTES; i++) bytes.set(base + i, 0);
  const code = base + WS_BYTES;
  for (let i = 0; i < codeLen; i++) bytes.set(code + i, parseInt(CODE.substr(i * 2, 2), 16));
  const ksAt = code + codeLen;
  if (ks) { const h = ksHex(base, ksAt + 22); for (let i = 0; i < KS_LEN; i++) bytes.set(ksAt + i, parseInt(h.substr(i * 2, 2), 16)); }
  const vec = {};
  wanted.forEach((n, k) => {
    const v = code + codeLen + (ks ? KS_LEN : 0) + 4 * k;
    const words = [base, n === 'KSCAN' ? ksAt : code + OFFSET[n]];             // new workspace, first instruction
    words.forEach((w, j) => { bytes.set(v + 2 * j, w >> 8); bytes.set(v + 2 * j + 1, w & 255); });
    vec[n] = v;
  });
  // point each call at its routine
  for (const l of parsed.lines) {
    const t = l.source[0] === ' ' || l.source[0] === '\t' ? /^\s*(\S+)\s+(\S+)/.exec(l.source) : /^\S+\s+(\S+)\s+(\S+)/.exec(l.source);
    if (!t) continue;
    const isData = /^DATA$/i.test(t[1]);
    const ops = t[2].split(',').map(o => wanted.find(n => new RegExp('(^|[^A-Za-z0-9_$])' + n + '($|[^A-Za-z0-9_$])', 'i').test(o)) || null);
    if (!ops.some(Boolean)) continue;
    const put = (w, name) => { const v = vec[name]; bytes.set(w.addr, v >> 8); bytes.set(w.addr + 1, v & 255); };
    if (isData) {
      // one word per operand
      ops.forEach((name, k) => { if (name && l.words[k] && l.words[k].hex === '0000') put(l.words[k], name); });
      continue;
    }
    // an instruction: the empty (0000) address words after the first word, in order
    const named = ops.filter(Boolean);
    const zeros = l.words.slice(1).filter(w => w.hex === '0000');
    if (zeros.length === named.length) zeros.forEach((w, k) => put(w, named[k]));
  }
  parsed.segments = segmentsOf(bytes);
  return { added: wanted, missing, error: '' };
}


// A few instructions run before your program, so the screen looks the way it does when the
// Editor/Assembler starts a program: white text on a light blue screen (VDP register 7 = >F5, and
// every entry of the colour table at >0380 = >F5). Without it your program inherits the colours
// of MAME's start screen (black on cyan). Written for this extension; ends with B @(your start).
const STARTUP = '0200F587D8008C0206C0D8008C0202008043D8008C0206C0D8008C020201F50002020020D8018C00060216FC04C004C104C20460';
const STARTUP_JUMP_AT = 52;   // where the 2-byte start address of your program goes (after the final B @)

/** Add the start-up code after everything else. Returns its address, or null if there is no room. */
function startup(parsed, segmentsOf, userEntry) {
  const n = STARTUP.length / 2 + 2;
  const base = roomAfter(parsed, n);
  if (base === null) return null;
  for (let i = 0; i < n - 2; i++) parsed.bytes.set(base + i, parseInt(STARTUP.substr(i * 2, 2), 16));
  parsed.bytes.set(base + STARTUP_JUMP_AT, userEntry >> 8);
  parsed.bytes.set(base + STARTUP_JUMP_AT + 1, userEntry & 255);
  parsed.segments = segmentsOf(parsed.bytes);
  return base;
}

module.exports = { startup, supply, supplied, NAMES, wordHex, CODE, OFFSET };
