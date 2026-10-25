'use strict';
// Runs the added VSBW / VMBW / VSBR / VMBR / VWTR routines on a tiny pretend TMS9900 and VDP, and
// checks them against what the Editor/Assembler documents for each:
//   VSBW  R0 = VDP address, left byte of R1 = the byte to write
//   VMBW  R0 = VDP address, R1 = where the bytes are in CPU memory, R2 = how many
//   VSBR  R0 = VDP address; the byte comes back in the left byte of R1
//   VMBR  R0 = VDP address, R1 = where to put the bytes, R2 = how many
//   VWTR  left byte of R0 = VDP register number, right byte = the value
// Only the instructions those routines use are understood by the pretend chip.
const assert = require('assert');
const U = require('../lib/utils99');

class Machine {
  constructor() { this.mem = new Uint8Array(65536); this.vram = new Uint8Array(16384); this.vreg = new Array(8).fill(0); this.latch = null; this.addr = 0; this.buf = 0; this.write = true; this.pc = 0; this.wp = 0; this.st = 0; }
  rw(a) { a &= 0xFFFE; return (this.mem[a] << 8) | this.mem[a + 1]; }
  ww(a, v) { a &= 0xFFFE; this.mem[a] = (v >> 8) & 255; this.mem[a + 1] = v & 255; }
  reg(n) { return this.rw(this.wp + 2 * n); }
  setReg(n, v) { this.ww(this.wp + 2 * n, v); }
  // the VDP
  portWrite(a, b) {
    if (a === 0x8C00) { this.vram[this.addr & 0x3FFF] = b; this.addr = (this.addr + 1) & 0x3FFF; this.latch = null; return; }
    if (a === 0x8C02) {
      if (this.latch === null) { this.latch = b; return; }
      const lo = this.latch; this.latch = null;
      if ((b & 0xC0) === 0x80) this.vreg[b & 7] = lo;
      else { this.addr = ((b & 0x3F) << 8) | lo; this.write = (b & 0x40) !== 0; if (!this.write) { this.buf = this.vram[this.addr]; this.addr = (this.addr + 1) & 0x3FFF; } }
    }
  }
  portRead(a) {
    if (a === 0x8800) { const v = this.buf; this.buf = this.vram[this.addr & 0x3FFF]; this.addr = (this.addr + 1) & 0x3FFF; return v; }
    return 0;
  }
  // an operand: returns { get(byte?), set(v, byte?) } and moves registers for *R+
  operand(mode, n, byte) {
    const step = byte ? 1 : 2;
    let a;
    if (mode === 0) return { reg: n };
    if (mode === 1) a = this.reg(n);
    else if (mode === 2) { if (n === 0) { a = this.rw(this.pc); this.pc += 2; } else { a = (this.reg(n) + this.rw(this.pc)) & 0xFFFF; this.pc += 2; } }
    else { a = this.reg(n); this.setReg(n, a + step); }
    return { addr: a & 0xFFFF };
  }
  load(o, byte) {
    if (o.reg !== undefined) return byte ? this.reg(o.reg) & 0xFF00 : this.reg(o.reg);
    if (byte) { if (o.addr === 0x8800) return this.portRead(0x8800) << 8; return this.mem[o.addr] << 8; }
    return this.rw(o.addr);
  }
  store(o, v, byte) {
    if (o.reg !== undefined) { if (byte) this.setReg(o.reg, (this.reg(o.reg) & 0x00FF) | (v & 0xFF00)); else this.setReg(o.reg, v); return; }
    if (byte) { if (o.addr === 0x8C00 || o.addr === 0x8C02) this.portWrite(o.addr, v >> 8); else this.mem[o.addr] = v >> 8; return; }
    this.ww(o.addr, v);
  }
  // run one BLWP-style call: vector at `vec`, with the caller's registers at callerWp
  call(vec) {
    const callerWp = this.wp;
    this.wp = this.rw(vec); this.pc = this.rw(vec + 2);
    this.setReg(13, callerWp); this.setReg(14, 0xBEEF); this.setReg(15, 0);
    for (let n = 0; n < 100000; n++) {
      if (this.pc === 0x000E) { this.mem[0x8375] = 0x41; this.mem[0x837C] |= 0x20; this.pc = this.reg(11); continue; }   // the console's own keyboard routine, pretended: key 'A', bit >20 set, then RT
      const op = this.rw(this.pc); this.pc += 2;
      const top = op >> 12;
      if (op === 0x0380) { this.rtwpFrom = this.wp; this.wp = callerWp; return; }                                    // RTWP
      if (top === 0xC || top === 0xD) {                                                        // MOV / MOVB
        const byte = top === 0xD;
        const s = this.operand((op >> 4) & 3, op & 15, byte);
        const d = this.operand((op >> 10) & 3, (op >> 6) & 15, byte);
        this.store(d, this.load(s, byte), byte);
      } else if ((op & 0xFFE0) === 0x0260) { const r = op & 15; const imm = this.rw(this.pc); this.pc += 2; this.setReg(r, this.reg(r) | imm); }   // ORI
      else if (op === 0x02E0) { this.wp = this.rw(this.pc); this.pc += 2; }                                                                                  // LWPI
      else if ((op & 0xFFC0) === 0x0680) { const o = this.operand((op >> 4) & 3, op & 15, false); this.setReg(11, this.pc); this.pc = o.addr; }                       // BL
      else if ((op & 0xFFF0) === 0x06C0) { const r = op & 15, v = this.reg(r); this.setReg(r, ((v & 255) << 8) | (v >> 8)); }                       // SWPB
      else if ((op & 0xFFF0) === 0x0600) { const r = op & 15; this.setReg(r, (this.reg(r) - 1) & 0xFFFF); this.eq = this.reg(r) === 0; }                // DEC
      else if ((op & 0xFF00) === 0x1300) { if (this.eq) this.pc += 2 * ((op << 24) >> 24); }                                                             // JEQ
      else if ((op & 0xFF00) === 0x1600) { if (!this.eq) this.pc += 2 * ((op << 24) >> 24); }                                                            // JNE
      else throw new Error('the pretend chip does not know instruction ' + op.toString(16));
      if ((top === 0xC || top === 0xD)) { /* flags only matter after MOV for JEQ in these routines */ this.eq = this.lastEq(op); }
    }
    throw new Error('the routine did not finish');
  }
  lastEq(op) { // MOV R2 then JEQ: equal means the value moved was zero
    const d = (op >> 6) & 15, dm = (op >> 10) & 3;
    if (dm === 0) return this.reg(d) === 0;
    return false;
  }
}

function setup() {
  const m = new Machine();
  const base = 0xB000, code = base + 32;
  const bytes = Buffer.from(U.CODE, 'hex');
  bytes.forEach((b, i) => { m.mem[code + i] = b; });
  const vecs = {};
  U.NAMES.forEach((n, k) => { const v = 0xB200 + 4 * k; m.ww(v, base); m.ww(v + 2, code + U.OFFSET[n]); vecs[n] = v; });
  m.wp = 0x8300; m.setReg(0, 0); m.setReg(1, 0); m.setReg(2, 0);
  return { m, vecs };
}

{ // VSBW
  const { m, vecs } = setup();
  m.setReg(0, 0x0044); m.setReg(1, 0x5400);
  m.call(vecs.VSBW);
  assert.strictEqual(m.vram[0x44], 0x54, 'VSBW writes the left byte of R1 at the address in R0');
  assert.strictEqual(m.wp, 0x8300, 'RTWP puts the caller\'s workspace back');
  assert.strictEqual(m.reg(0), 0x0044, 'the caller\'s R0 is not changed');
  m.setReg(0, 0x0045); m.setReg(1, 0x4A00); m.call(vecs.VSBW);
  assert.deepStrictEqual([m.vram[0x44], m.vram[0x45]], [0x54, 0x4A], 'two writes go to two places');
  m.setReg(0, 0x1FFF); m.setReg(1, 0x7700); m.call(vecs.VSBW);
  assert.strictEqual(m.vram[0x1FFF], 0x77, 'a high address works');
}
{ // VMBW
  const { m, vecs } = setup();
  [0x11, 0x22, 0x33, 0x44, 0x55].forEach((b, i) => { m.mem[0xA100 + i] = b; });
  m.setReg(0, 0x0300); m.setReg(1, 0xA100); m.setReg(2, 5);
  m.call(vecs.VMBW);
  assert.deepStrictEqual([...m.vram.slice(0x300, 0x305)], [0x11, 0x22, 0x33, 0x44, 0x55], 'VMBW copies R2 bytes from CPU memory to the VDP');
  assert.strictEqual(m.vram[0x305], 0, 'and not one more');
  m.setReg(2, 0); m.setReg(0, 0x0400); m.call(vecs.VMBW);
  assert.strictEqual(m.vram[0x400], 0, 'a count of zero copies nothing');
}
{ // VSBR
  const { m, vecs } = setup();
  m.vram[0x120] = 0x9C; m.vram[0x121] = 0x3E;
  m.setReg(0, 0x0120); m.setReg(1, 0x0000);
  m.call(vecs.VSBR);
  assert.strictEqual(m.reg(1) >> 8, 0x9C, 'VSBR puts the byte in the left byte of R1');
  m.setReg(0, 0x0121); m.call(vecs.VSBR);
  assert.strictEqual(m.reg(1) >> 8, 0x3E);
}
{ // VMBR
  const { m, vecs } = setup();
  [1, 2, 3, 4].forEach((b, i) => { m.vram[0x200 + i] = b; });
  m.setReg(0, 0x0200); m.setReg(1, 0xA200); m.setReg(2, 4);
  m.call(vecs.VMBR);
  assert.deepStrictEqual([...m.mem.slice(0xA200, 0xA204)], [1, 2, 3, 4], 'VMBR copies R2 bytes from the VDP to CPU memory');
  assert.strictEqual(m.mem[0xA204], 0, 'and not one more');
}
{ // VWTR
  const { m, vecs } = setup();
  m.setReg(0, 0x0506); m.call(vecs.VWTR);
  assert.strictEqual(m.vreg[5], 0x06, 'VWTR: register number in the left byte, the value in the right (>0506 = register 5 gets >06)');
  assert.strictEqual(m.vreg[6], 0, 'and no other register is touched');
  m.setReg(0, 0x0601); m.call(vecs.VWTR);
  assert.strictEqual(m.vreg[6], 0x01, '>0601 = register 6 gets >01');
  m.setReg(0, 0x01E0); m.call(vecs.VWTR);
  assert.strictEqual(m.vreg[1], 0xE0, '>01E0 = register 1 gets >E0 (the usual "screen on" value)');
  assert.strictEqual(m.reg(0), 0x01E0, 'the caller\'s R0 is not changed');
}
{ // KSCAN: a wrapper around the console's own routine
  const L = require('../lib/listing');
  const LST = ['     **** ****     > demo.a99', '0001                      AORG >A000', '0002                      REF  KSCAN',
    '0003 A000 0420  36 START  BLWP @KSCAN', '     A002 0000e    ', '0004 A004 10FF  14 LOOP   JMP  LOOP', '0005                      END  START', '', '    start............... >a000 :     '].join('\n');
  const p = L.parseListing(LST, '/x/demo.a99');
  const r = U.supply(p, L.segmentsOf);
  assert.deepStrictEqual(r.added, ['KSCAN'], 'KSCAN is supplied'); assert.deepStrictEqual(r.missing, []);
  const m = new Machine();
  for (const [a, b] of p.bytes) m.mem[a] = b;
  const vec = (p.bytes.get(0xA002) << 8) | p.bytes.get(0xA003);
  assert.ok(vec > 0xA005, 'the call points at a vector after the program');
  m.wp = 0x8300; m.setReg(3, 0x7777); m.setReg(11, 0x4242);
  m.ww(0x83F6, 0x1234);               // the console's own R11, which must survive
  m.mem[0x8375] = 0xFF;
  m.call(vec);
  assert.strictEqual(m.mem[0x8375], 0x41, 'the key code comes back in >8375');
  assert.strictEqual(m.mem[0x837C] & 0x20, 0x20, 'and bit >20 of >837C says a key was pressed');
  assert.strictEqual(m.rw(0x83F6), 0x1234, 'the console\'s R11 is put back');
  assert.strictEqual(m.wp, 0x8300, 'the caller\'s workspace is back');
  assert.strictEqual(m.rtwpFrom, m.rw(vec), 'RTWP ran in the wrapper\'s own workspace, so it returned to the right place');
  assert.strictEqual(m.reg(3), 0x7777); assert.strictEqual(m.reg(11), 0x4242, 'the caller\'s registers are untouched');
}
console.log('vdp-routines-test: all good');
