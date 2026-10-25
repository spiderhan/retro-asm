'use strict';
// The "who called me" guess, with made-up code and a pretend memory.
const assert = require('assert');
const L = require('../lib/listing');
const { callStack } = require('../lib/callstack');

const LST = [
'     **** ****     > demo.a99',
'0001                      AORG >A000',
'0002 A000 0200  20 START  LI   R0,1',
'     A002 0001     ',
'0003 A004 06A0  34        BL   @ONE',
'     A006 A00E     ',
'0004 A008 0420  42        BLWP @VEC',
'     A00A A016     ',
'0005 A00C 10FF  14 LOOP   JMP  LOOP',
'0006 A00E 05C1  10 ONE    INC  R1',
'0007 A010 045B  12        RT',
'0008 A012 05C2  10 TWO    INC  R2',
'0009 A014 0380  14        RTWP',
'0010 A016 8320     VEC    DATA >8320,TWO',
'     A018 A012     ',
'0011                      END  START',
'',
'    loop................ >a00c :     ',
'    one................. >a00e :     ',
'    start............... >a000 :     ',
'    two................. >a012 :     ',
'    vec................. >a016 :     '].join('\n');
const parsed = L.parseListing(LST, '/x/demo.a99');

const word = (m) => async (a) => m[a] || 0;
const names = (fr) => fr.map(f => f.how + ':' + f.pc.toString(16).toUpperCase());

(async () => {
  // inside ONE, called by BL from START
  let fr = await callStack(parsed, { PC: 0xA00E, WP: 0x8300, R11: 0xA008 }, word({}));
  assert.deepStrictEqual(names(fr), ['here:A00E', 'bl:A004'], 'BL caller found from R11');
  assert.strictEqual(fr[0].ret, 0xA008, 'step out would run to the way back');

  // inside TWO, called by BLWP @VEC from START (new workspace >8320 holds the old WP, PC, ST in R13-R15)
  fr = await callStack(parsed, { PC: 0xA012, WP: 0x8320, R11: 0 }, word({ [0x8320 + 26]: 0x8300, [0x8320 + 28]: 0xA00C, [0x8320 + 30]: 0x2000, [0x8300 + 22]: 0xA008 }));
  assert.deepStrictEqual(names(fr), ['here:A012', 'blwp:A008'], 'BLWP caller found from R13/R14');
  assert.strictEqual(fr[0].ret, 0xA00C, 'step out of a BLWP routine runs to the saved PC');
  assert.strictEqual(fr[1].ws, 0x8300, 'the caller had the old workspace');

  // an old R11 left over in the main program does not make up a caller (it points after a BL, but we are not inside that routine)
  fr = await callStack(parsed, { PC: 0xA00C, WP: 0x8300, R11: 0xA008 }, word({}));
  assert.deepStrictEqual(names(fr), ['here:A00C'], 'stale R11 ignored');

  // R11 pointing after something that is not a call
  fr = await callStack(parsed, { PC: 0xA00E, WP: 0x8300, R11: 0xA004 }, word({}));
  assert.deepStrictEqual(names(fr), ['here:A00E'], 'R11 must come right after a BL');

  // junk in R13/R14 does not make a caller
  fr = await callStack(parsed, { PC: 0xA00E, WP: 0x8300, R11: 0 }, word({ [0x8300 + 26]: 0x1235, [0x8300 + 28]: 0xA00C }));
  assert.deepStrictEqual(names(fr), ['here:A00E'], 'odd workspace address ignored');

  // a loop of made-up frames cannot run forever
  fr = await callStack(parsed, { PC: 0xA012, WP: 0x8320, R11: 0 }, word({ [0x8320 + 26]: 0x8320, [0x8320 + 28]: 0xA00C }));
  assert.strictEqual(fr.length, 1, 'a workspace that calls itself is ignored');

  console.log('callstack-test: all good');
})().catch(e => { console.log('FAIL', e.message); process.exit(1); });
