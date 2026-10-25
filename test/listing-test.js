'use strict';
// Reads a made-up listing (shape of xas99 3.6.5 output) and checks the line <-> address map.
const assert = require('assert');
const path = require('path');
const L = require('../lib/listing');
const LST = [
'XAS99 CROSS-ASSEMBLER   VERSION 3.6.5',
'     **** ****     > demo.a99',
'0001                      AORG >A000',
'0002 A000 0200  20 START  LI   R0,>1234',
'     A002 1234     ',
'0003 A004 0201  20        LI   R1,>0005',
'     A006 0005     ',
'0004 A008 A001  18        A    R1,R0',
'0005 A00A C0A0  34        MOV  @VALUE,R2',
'     A00C A010     ',
'0006 A00E 10FF  14 LOOP   JMP  LOOP',
'0007 A010 BEEF     VALUE  DATA >BEEF,>CAFE',
'     A012 CAFE     ',
'0008 A014 41       FLAG   BYTE >41',
'0009                      COPY "more.a99"',
'     **** ****     > more.a99',
'0001 A016 0380  18 EXTRA  RTWP',
'     **** ****     < more.a99',
'0010                      END  START',
'',
'    extra............... >a016 :     ',
'    loop................ >a00e :     ',
'    start............... >a000 :     ',
'    value............... >a010 :     '].join('\n');
const main = path.join('/x', 'demo.a99');
const p = L.parseListing(LST, main);
assert.strictEqual(p.entry, 0xA000, 'entry is the END label');
assert.strictEqual(p.symbols.get('LOOP'), 0xA00E);
assert.strictEqual(p.bytes.get(0xA000), 0x02);
assert.strictEqual(p.bytes.get(0xA003), 0x34);
assert.strictEqual(p.bytes.get(0xA014), 0x41, 'one-byte data');
assert.strictEqual(L.addrForLine(p, main, 3), 0xA008, 'breakpoint on line 4 -> A008');
assert.strictEqual(L.addrForLine(p, main, 0), null, 'AORG line has no code');
assert.strictEqual(L.addrForLine(p, main, 6), null, 'data line is not breakable');
assert.strictEqual(L.nearestLine(p, main, 0).line, 1, 'a comment line moves down to the next instruction');
assert.strictEqual(L.nearestLine(p, main, 6), null);
assert.strictEqual(L.addrForLine(p, path.join('/x', 'more.a99'), 0), 0xA016, 'copied file line');
assert.strictEqual(L.lineForAddr(p, 0xA00C).line, 4, 'inside MOV');
assert.strictEqual(L.lineForAddr(p, 0xA016).file, path.join('/x', 'more.a99'));
const img = L.imageOf(p);
assert.strictEqual(img.load, 0xA000);
assert.strictEqual(img.hex.slice(0, 8), '02001234');
assert.strictEqual(img.end, 0xA017);
assert.strictEqual(L.checkImage(p), '', 'a program at >A000 is fine');
const low = L.parseListing('     **** ****     > a.a99\n0001 0000 0200  20        LI   R0,>1\n     0002 0001     \n', '/x/a.a99');
assert.ok(/AORG/.test(L.checkImage(low)), 'no AORG is explained');
const rom = L.parseListing('     **** ****     > a.a99\n0001 6000 0380  18        RTWP\n', '/x/a.a99');
assert.ok(/extra memory/.test(L.checkImage(rom)), 'cartridge space is refused');
const two = L.parseListing('     **** ****     > a.a99\n0001 2000 0380  18        RTWP\n0002 A000 0380  18        RTWP\n', '/x/a.a99');
assert.strictEqual(L.checkImage(two), '', 'code in two separate pieces (low and high memory) is fine');
const blocks = L.blocksOf(two);
assert.deepStrictEqual(blocks.map(b => [b.addr, b.bytes.toString('hex')]), [[0x2000, '0380'], [0xA000, '0380']], 'each piece is loaded at its own address');
assert.strictEqual(L.roomAfter(two, 100), 0xA002, 'extra code goes after the last piece');
const lowOnly = L.parseListing('     **** ****     > a.a99\n0001 3FF0 0380  18        RTWP\n', '/x/a.a99');
assert.strictEqual(L.roomAfter(lowOnly, 100), null, 'and not on past the end of low memory');
const straddle = L.parseListing('     **** ****     > a.a99\n0001 3FFE 0200  20        LI   R0,>1\n     4000 0001     \n', '/x/a.a99');
assert.ok(/extra memory/.test(L.checkImage(straddle)), 'a piece running off the end of low memory is refused');
// a byte at an odd address is printed further right (under the second half of the data column)
const odd = L.parseListing([
'     **** ****     > a.a99',
'0001 A000 0200  20 START  LI   R0,>1234',
'     A002 1234     ',
'0002 A004 AB       MSG    BYTE >AB',
'0003 A005   54             TEXT \'THE\'',
'     A006 4845     ',
'0004 A008 0380  18 DONE   RTWP'].join('\n'), '/x/a.a99');
assert.strictEqual(odd.bytes.get(0xA004), 0xAB);
assert.strictEqual(odd.bytes.get(0xA005), 0x54, 'the first byte of text at an odd address is kept');
assert.strictEqual(odd.bytes.get(0xA006), 0x48);
assert.strictEqual(odd.bytes.get(0xA007), 0x45);
assert.strictEqual(odd.bytes.get(0xA008), 0x03);
{ // room set aside with BSS at the end (a program's own workspace) is not free
  const t = ['     **** ****     > w.a99', '0001                      AORG >A000',
    '0002 A000 02E0  18 START  LWPI WS', '     A002 A00C     ', '0003 A004 10FF  14 LOOP   JMP  LOOP', '0004 A006 0001     DAT    DATA 1',
    '0005                      EVEN', '0006 A008          VARS   BSS  >4', '0007 A00C          WS     BSS  2*16', '0008                      END  START', '',
    '    dat................. >a006 :     ', '    start............... >a000 :     ', '    vars................ >a008 :     ', '    ws.................. >a00c :     '].join('\n');
  const q = L.parseListing(t, '/x/w.a99');
  assert.deepStrictEqual(q.reserved, [{ start: 0xA008, end: 0xA00B }, { start: 0xA00C, end: 0xA02B }], 'BSS sizes are worked out (decimal, hex, sums)');
  assert.strictEqual(L.roomAfter(q, 4), 0xA02C, 'extra code goes after the workspace, not on top of it');
  const q2 = L.parseListing(t.replace('2*16', 'MYSTERY'), '/x/w.a99');
  assert.ok(L.roomAfter(q2, 4) >= 0xA10C, 'a size that can not be worked out keeps well clear');
}
console.log('listing-test: all good');
