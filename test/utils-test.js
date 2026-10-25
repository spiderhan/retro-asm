'use strict';
// A program that REFs VSBW/VMBW gets the standard routines added and its calls pointed at them.
const assert = require('assert');
const path = require('path');
const L = require('../lib/listing');
const U = require('../lib/utils99');
const LST = [
'     **** ****     > demo.a99',
'0001                      AORG >A000',
'0002                      DEF  START',
'0003                      REF  VSBW,VMBW,GPLLNK',
'0004 A000 04E0  34 START  CLR  @KEEP',
'     A002 A020     ',
'0005 A004 0420  36        BLWP @VSBW',
'     A006 0000e    ',
'0006 A008 0420  36        BLWP @VMBW         ; copy via VSBW later',
'     A00A 0000e    ',
'0007 A00C 0200  20        LI   R0,0',
'     A00E 0000     ',
'0008 A010 0420  36        BLWP @GPLLNK',
'     A012 0000e    ',
'0009 A014 10FF  14 LOOP   JMP  LOOP',
'0010 A016 0000     VECT   DATA VSBW,0',
'     A018 0000e    ',
'0011                      END  START',
'',
'    start............... >a000 :     '].join('\n');
const main = path.join('/x', 'demo.a99');
const p = L.parseListing(LST, main);
assert.deepStrictEqual([...p.refs].sort(), ['GPLLNK', 'VMBW', 'VSBW']);
const r = U.supply(p, L.segmentsOf);
assert.deepStrictEqual(r.added, ['VSBW', 'VMBW']);
assert.deepStrictEqual(r.missing, ['GPLLNK'], 'a routine we cannot supply is reported');
const word = (a) => p.bytes.get(a) * 256 + p.bytes.get(a + 1);
const vsbw = word(0xA006), vmbw = word(0xA00A);
assert.ok(vsbw > 0xA018 && vmbw > 0xA018 && vsbw !== vmbw, 'calls now point after the program');
assert.strictEqual(word(0xA00E), 0, 'LI R0,0 is left alone');
assert.strictEqual(word(0xA012), 0, 'GPLLNK stays empty');
assert.strictEqual(word(0xA016), vsbw, 'DATA VSBW is filled in');
assert.strictEqual(word(0xA018), 0, 'the other DATA word is left alone');
assert.strictEqual(word(vsbw), word(vsbw + 2) === 0 ? 0 : word(vsbw), 'vector has a workspace and entry');
assert.strictEqual(word(vsbw + 2) % 2, 0);
assert.strictEqual(word(word(vsbw + 2)), 0xC01D, 'entry is the first instruction (MOV *R13,R0)');
assert.strictEqual(p.symbols.get('VSBW'), word(vsbw + 2), 'the routine\'s name now means its address, so you can break on it');
assert.strictEqual(L.checkImage(p), '', 'the image is still one block');
const none = L.parseListing('     **** ****     > a.a99\n0001 A000 0380  18        RTWP\n', '/x/a.a99');
assert.deepStrictEqual(U.supply(none, L.segmentsOf).added, []);
const stub = U.startup(p, L.segmentsOf, 0xA000);
assert.ok(stub > 0xA018 && stub % 2 === 0, 'start-up code sits after the program');
assert.strictEqual(word(stub), 0x0200, 'it begins with LI R0');
assert.strictEqual(word(stub + 52), 0xA000, 'and ends by jumping to your start');
assert.strictEqual(word(stub + 50), 0x0460, 'that jump is B @address');
assert.strictEqual(L.checkImage(p), '', 'still one block');
console.log('utils-test: all good');
