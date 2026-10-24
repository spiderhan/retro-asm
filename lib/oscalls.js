'use strict';
// Plain-English meanings for numbers handed to the BBC's operating system and hardware.
//
//   LDA #&13 : JSR OSBYTE      -> "OSBYTE &13: wait for the next vertical sync ..."
//   LDA #22  : JSR OSWRCH      -> "VDU 22: change to a new screen MODE ..."
//   LDA #1   : JSR OSWRCH      -> "... the MODE number: MODE 1"
//   LDA #&D8 : STA &FE20       -> "Video ULA control &D8: ..."
//
// The meanings live in the chip file ("osCalls", "osTables", "hardwareValues"), so another chip
// can use the same thing. Nothing in here knows about VS Code.

const { statements } = require('./parser');
const DEC = require('./decoders');

const LOADS = { A: 'LDA', X: 'LDX', Y: 'LDY' };
const STORES = { STA: 'A', STX: 'X', STY: 'Y' };
const hex2 = (v) => '&' + (v & 0xFF).toString(16).toUpperCase().padStart(2, '0');

/** Every statement from line `from` to `to`, in order: [{ ln, pl }]. */
function flatten(model, from, to) {
  const out = [];
  for (let ln = Math.max(0, from); ln <= Math.min(to, model.lines.length - 1); ln++) {
    for (const pl of statements(model.lines[ln])) out.push({ ln, pl });
  }
  return out;
}

/** The statement list around a line, and where `pl` sits in it. */
function around(project, file, ln, pl) {
  const model = project.get(file);
  const list = flatten(model, ln - 40, ln + 40);
  const idx = list.findIndex(e => e.pl === pl);
  return { model, D: model.D, list, idx };
}

const isSkipped = (project, file, e) => { const i = project.lineInfo(file, e.ln, e.pl.part); return !!(i && i.skipped); };

/** The OS call a JSR or JMP goes to ({ name, table, note }), or null. */
function callOf(project, file, D, pl) {
  if (!D.osCalls || !D.osCalls.size || !pl.mnem || pl.operands.length !== 1) return null;
  const m = pl.mnem.upper;
  if (m !== 'JSR' && m !== 'JMP') return null;
  const v = project.eval(file, pl.operands[0].text.trim());
  return v === null ? null : (D.osCalls.get(v & 0xFFFF) || null);
}

/** The address a plain `STA &FE20` stores to (no index), or null. */
function storeTarget(project, file, pl) {
  if (!pl.mnem || !STORES[pl.mnem.upper] || pl.operands.length !== 1) return null;
  const t = pl.operands[0].text.trim();
  if (t.startsWith('#') || /,|\(/.test(t)) return null;
  return project.eval(file, t);
}

/** `LDA #n`: the number n, or null. */
function immediateOf(project, file, pl, reg) {
  if (!pl.mnem || pl.mnem.upper !== LOADS[reg] || pl.operands.length !== 1) return null;
  const t = pl.operands[0].text.trim();
  return t.startsWith('#') ? project.eval(file, t.slice(1)) : null;
}

/**
 * What was in `reg` just before statement `idx`, if a `LDA #n` (or LDX, LDY) a few lines up says
 * so and nothing in between could have changed it. Returns { value, at } or null.
 */
function valueBefore(project, file, ctx, idx, reg) {
  const { D, list } = ctx;
  for (let k = idx - 1; k >= 0 && k >= idx - 40; k--) {
    const q = list[k].pl;
    if (isSkipped(project, file, list[k])) continue;
    if (q.mnem) {
      const ins = D.instr(q.mnem.upper);
      if (!ins) {
        const dir = D.directive(q.mnem.upper);
        if (dir && (dir.kind === 'equ' || dir.kind === 'other')) { if (q.label) return null; continue; }
        return null;                                    // data or something unknown: stop
      }
      const v = immediateOf(project, file, q, reg);
      if (v !== null) return { value: v & 0xFF, at: k };
      const A = require('./analysis');
      const lr = A.lineRegs(q, D, null);
      if (lr.w.has(reg) || lr.returns || q.mnem.upper === 'JSR' || q.mnem.upper === 'JMP' || q.mnem.upper === 'BRA') return null;
    }
    if (q.label) return null;                            // someone may jump here with something else in the register
  }
  return null;
}

/** For `LDA #n` at statement idx: the first thing after it that uses A (an OS call or a store to hardware). */
function consumerAfter(project, file, ctx, idx, reg) {
  const { D, list } = ctx;
  for (let k = idx + 1; k < list.length && k <= idx + 14; k++) {
    const q = list[k].pl;
    if (isSkipped(project, file, list[k])) continue;
    if (q.label && !q.mnem) return null;
    if (q.mnem) {
      const ins = D.instr(q.mnem.upper);
      if (!ins) return null;
      const call = callOf(project, file, D, q);
      if (call) return reg === 'A' ? { kind: 'call', call, at: k } : null;
      const a = storeTarget(project, file, q);
      if (a !== null && STORES[q.mnem.upper] === reg) {
        const hw = D.hwValues.get(a & 0xFFFF);
        return hw ? { kind: 'store', hw, addr: a & 0xFFFF, at: k } : null;
      }
      const A = require('./analysis');
      const lr = A.lineRegs(q, D, null);
      if (lr.w.has(reg) || lr.returns || q.mnem.upper === 'JSR' || q.mnem.upper === 'JMP' || q.mnem.upper === 'BRA') return null;
    }
    if (q.label) return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Words for each kind of call
// ---------------------------------------------------------------------------
const printable = (v) => v >= 32 && v < 127;

/** The VDU command a value starts, from the chip's table: { t, n } or null. */
function vduEntry(D, v) {
  const e = D.osTables && D.osTables.vdu ? D.osTables.vdu[String(v)] : null;
  return e || null;
}

/**
 * VDU codes can be followed by parameter bytes (22 is followed by the MODE number). Looks back
 * through the bytes sent to OSWRCH just before this one and works out which part this is.
 * Returns { code, param } where param is null when this byte starts a command.
 */
function vduRole(project, file, ctx, idx, value) {
  const { D, list } = ctx;
  const sent = [];
  let clean = false;
  for (let k = idx - 1; k >= 0 && k >= idx - 40; k--) {
    const q = list[k].pl;
    if (isSkipped(project, file, list[k])) continue;
    if (q.mnem) {
      const c = callOf(project, file, D, q);
      if (c && c.table === 'vdu') {
        const v = valueBefore(project, file, ctx, k, 'A');
        if (!v) { clean = false; break; }
        sent.unshift(v.value);
        if (q.label) { clean = true; break; }
        continue;
      }
      if (!D.instr(q.mnem.upper)) {
        const dir = D.directive(q.mnem.upper);
        if (dir && (dir.kind === 'equ' || dir.kind === 'other')) continue;
        clean = true; break;
      }
      const m = q.mnem.upper;
      if (/^(LD[AXY]|ST[AXY]|NOP)$/.test(m) || /^(CLC|SEC|CLD|SED|CLI|SEI)$/.test(m)) { if (q.label) { clean = true; break; } continue; }
      clean = true; break;                              // anything else: the run of bytes started after it
    } else if (q.label) { clean = true; break; }
  }
  const seq = sent.concat([value & 0xFF]);
  if (!clean && seq.length > 1) return { code: value & 0xFF, param: null };    // can't tell where the run started
  let pos = 0;
  const cur = seq.length - 1;
  while (pos <= cur) {
    const e = vduEntry(D, seq[pos]);
    const n = e ? e.n : 0;
    if (pos === cur) return { code: seq[pos], param: null };
    if (pos + n >= cur) return { code: seq[pos], param: cur - pos - 1, n, first: seq[pos + 1] };
    pos += n + 1;
  }
  return { code: value & 0xFF, param: null };
}

function paramText(code, k, v, n) {
  v &= 0xFF;
  if (code === 22) return `the MODE number: MODE ${v}${v === 7 ? ' (the teletext mode)' : ''}`;
  if (code === 31) return k === 0 ? `the column to move to: ${v}` : `the row to move to: ${v}`;
  if (code === 17) return v >= 128 ? `the background colour: ${v - 128}` : `the text colour: ${v}`;
  if (code === 18) return k === 0 ? `how to draw: ${['replace', 'OR', 'AND', 'EOR', 'invert'][v] || v}` : `the graphics colour: ${v}`;
  if (code === 19) return k === 0 ? `the logical colour: ${v}` : k === 1 ? `the actual colour: ${v}` : 'a spare byte (always 0)';
  if (code === 23 && k === 0) return `the number of the character to define: ${v}`;
  return `parameter ${k + 1} of ${n}: ${hex2(v)} (${v})`;
}

function describeCall(project, file, ctx, idx, call, value) {
  const { D } = ctx;
  const v = value & 0xFF;
  const tab = (D.osTables || {})[call.table] || {};
  if (call.table === 'vdu') {
    const role = vduRole(project, file, ctx, idx, v);
    if (role.param !== null && role.param !== undefined) {
      const e = vduEntry(D, role.code);
      return `${call.name}: sends ${hex2(v)} (${v}), part of VDU ${role.code} (${(e ? e.t : '').split('.')[0].toLowerCase()}): ${paramText(role.code, role.param, v, role.n)}.`;
    }
    const e = vduEntry(D, v);
    if (e) return `${call.name}: VDU ${v}. ${e.t}${call.note && v === 13 ? ' ' + call.note : ''}`;
    if (printable(v)) return `${call.name}: prints the character '${String.fromCharCode(v)}'.`;
    return null;
  }
  const key = v.toString(16).toUpperCase().padStart(2, '0');
  const text = tab[key];
  if (!text) return null;
  return `${call.name} ${hex2(v)}: ${text}${call.note && /OSWORD/.test(call.name) ? ' ' + call.note.replace(/^A says which OSWORD; /, '') : ''}`;
}

/** The register chosen by the last write to &FE00 (the 6845's register select), or null. */
function crtcSelected(project, file, ctx, idx) {
  const { D, list } = ctx;
  for (let k = idx - 1; k >= 0 && k >= idx - 14; k--) {
    const q = list[k].pl;
    if (q.mnem) {
      const a = storeTarget(project, file, q);
      if (a === 0xFE00) { const v = valueBefore(project, file, ctx, k, STORES[q.mnem.upper]); return v ? v.value & 31 : null; }
      if (!D.instr(q.mnem.upper)) return null;
      const m = q.mnem.upper;
      if (m === 'JSR' || m === 'JMP' || m === 'RTS' || m === 'BRA') return null;
    }
    if (q.label) return null;
  }
  return null;
}

function describeStore(project, file, ctx, idx, hw, addr, value) {
  if (hw === 'bbc6845value') return DEC.crtcValue(crtcSelected(project, file, ctx, idx), value);
  return DEC.decode(hw, value, value, false);
}

// ---------------------------------------------------------------------------
// What the hover shows
// ---------------------------------------------------------------------------
/**
 * Extra words for the operand under the cursor on statement `pl` (line `ln`), or null.
 *   JSR OSBYTE            -> what the A set above asks for
 *   LDA #&13 (then a call or a store a few lines on) -> what that number means there
 *   STA &FE20             -> what the value loaded above does to that hardware
 */
function hoverFor(project, file, ln, pl) {
  const model = project.get(file);
  if (!model) return null;
  const D = model.D;
  if (!(D.osCalls && D.osCalls.size) && !(D.hwValues && D.hwValues.size)) return null;
  if (!pl.mnem || pl.operands.length !== 1) return null;
  const ctx = around(project, file, ln, pl);
  if (ctx.idx < 0) return null;
  const m = pl.mnem.upper;

  const call = callOf(project, file, D, pl);
  if (call) {
    const v = valueBefore(project, file, ctx, ctx.idx, 'A');
    if (!v) return null;
    return describeCall(project, file, ctx, ctx.idx, call, v.value);
  }
  const target = storeTarget(project, file, pl);
  if (target !== null && D.hwValues && D.hwValues.get(target & 0xFFFF)) {
    const v = valueBefore(project, file, ctx, ctx.idx, STORES[m]);
    return v ? describeStore(project, file, ctx, ctx.idx, D.hwValues.get(target & 0xFFFF), target, v.value) : null;
  }
  for (const reg of ['A', 'X', 'Y']) {
    const v = immediateOf(project, file, pl, reg);
    if (v === null) continue;
    const use = consumerAfter(project, file, ctx, ctx.idx, reg);
    if (!use) return null;
    if (use.kind === 'call') return describeCall(project, file, ctx, use.at, use.call, v);
    return describeStore(project, file, ctx, use.at, use.hw, use.addr, v);
  }
  return null;
}

module.exports = { hoverFor, callOf, storeTarget, immediateOf, valueBefore, flatten, around, vduRole };
