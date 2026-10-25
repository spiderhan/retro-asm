'use strict';
// A best-guess "who called me" list for the debugger. The TMS9900 has no call stack as such, but
// the two ways of calling leave clues:
//   BL  (and BL *R)   puts the way back in R11 of the running workspace            -> "via R11"
//   BLWP / XOP        switches workspace and saves the old WP, PC and ST in the new R13, R14, R15 -> exact
// So: look at R11 and at R13/R14, and keep a clue only when the instruction just before the
// "way back" address really is a call (the listing says what is at each address).
// A routine that saves R11 on a stack of its own, or calls with BL a second time, hides the older
// callers: they cannot be seen from the chip alone. Nothing here talks to MAME: the caller gives
// it the registers and a way to read memory.

const BL = (op) => (op & 0xFFC0) === 0x0680;
const BLWP = (op) => (op & 0xFFC0) === 0x0400;
const XOP = (op) => (op & 0xF800) === 0x2C00;

/** The call instruction that ends exactly at `ret`, or null. kind: 'BL' | 'BLWP'. */
function callBefore(parsed, ret, kind) {
  if (!ret || (ret & 1)) return null;
  const line = parsed.lines.find(l => l.code && l.size >= 2 && l.addr + l.size === ret);
  if (!line) return null;
  const op = (parsed.bytes.get(line.addr) << 8) | parsed.bytes.get(line.addr + 1);
  const ok = kind === 'BL' ? BL(op) : (BLWP(op) || XOP(op));
  if (!ok) return null;
  let target = null;
  if (op === 0x06A0 && line.size === 4) target = (parsed.bytes.get(line.addr + 2) << 8) | parsed.bytes.get(line.addr + 3);   // BL @LABEL
  return { line, op, target };
}

const isWorkspace = (a) => a !== 0 && !(a & 1) && ((a >= 0x2000 && a <= 0x3FFE) || (a >= 0x8000 && a <= 0x83E0) || (a >= 0xA000 && a <= 0xFFE0));

/**
 * @param parsed  from lib/listing.js
 * @param regs    { PC, WP, R11, ... } of the stopped program
 * @param readWord  async (addr) => 16-bit number
 * @returns [{ pc, ws, how, ret? }]  frame 0 is where it is stopped now; each next one is a caller.
 *   pc  = for frame 0 the current PC; for a caller the address of its call instruction
 *   ws  = the workspace that frame was using
 *   how = 'here' | 'bl' (a guess from R11) | 'blwp' (exact)
 *   ret = where the frame below it returns to (used by Step Out)
 */
async function callStack(parsed, regs, readWord, max) {
  const out = [{ pc: regs.PC, ws: regs.WP, how: 'here' }];
  let pc = regs.PC, ws = regs.WP;
  const limit = max || 24;
  while (out.length < limit) {
    const r11 = ws === regs.WP ? regs.R11 : await readWord(ws + 22);
    const bl = callBefore(parsed, r11, 'BL');
    if (bl && (bl.target === null || pc >= bl.target)) {
      out[out.length - 1].ret = r11;
      out.push({ pc: bl.line.addr, ws, how: 'bl' });
      pc = bl.line.addr;
    }
    const r13 = await readWord(ws + 26), r14 = await readWord(ws + 28);
    const bw = callBefore(parsed, r14, 'BLWP');
    if (bw && isWorkspace(r13) && r13 !== ws && !out.some(f => f.pc === bw.line.addr && f.ws === r13)) {
      out[out.length - 1].ret = r14;
      out.push({ pc: bw.line.addr, ws: r13, how: 'blwp' });
      pc = bw.line.addr; ws = r13;
      continue;
    }
    break;
  }
  return out;
}

module.exports = { callStack, callBefore };
