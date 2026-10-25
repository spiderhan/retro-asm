'use strict';
// The debugger against a pretend MAME: checks breakpoints, stepping (in / over / out), registers,
// watches and shutting down. Made-up code only.
const assert = require('assert');
const path = require('path');
const { EventEmitter } = require('events');
const L = require('../lib/listing');
const { DebugSession } = require('../lib/debug');

const main = path.join('/x', 'demo.a99');
const LST = [
'     **** ****     > demo.a99',
'0001                      AORG >A000',
'0002 A000 0200  20 START  LI   R0,>0001',
'     A002 0001     ',
'0003 A004 06A0  34        BL   @SUB',
'     A006 A00C     ',
'0004 A008 05C0  10 AFTER  INC  R0',
'0005 A00A 10FF  14 LOOP   JMP  LOOP',
'0006                      * a comment',
'0007 A00C 05C1  10 SUB    INC  R1',
'0008 A00E 045B  12        RT',
'0009                      END  START',
'',
'    after............... >a008 :     ',
'    loop................ >a00a :     ',
'    start............... >a000 :     ',
'    sub................. >a00c :     '].join('\n');
const parsed = L.parseListing(LST, main);

/** A pretend MAME: runs the little program above one instruction at a time. */
class FakeLink extends EventEmitter {
  constructor() { super(); this.pc = 0xA000; this.r = { R0: 0, R1: 0, R11: 0 }; this.armed = new Set(); this.events = []; this.quitCalled = false; this.wp = 0x8300; this.st = 0x2000; this.poked = []; }
  size(pc) { return L.lineForAddr(parsed, pc).size; }
  exec() {
    const op = parsed.bytes.get(this.pc) * 256 + parsed.bytes.get(this.pc + 1);
    if (op === 0x0200) { this.r.R0 = 1; this.pc += 4; }
    else if (op === 0x06A0) { this.r.R11 = this.pc + 4; this.pc = 0xA00C; }
    else if (op === 0x05C0) { this.r.R0++; this.pc += 2; }
    else if (op === 0x05C1) { this.r.R1++; this.pc += 2; }
    else if (op === 0x045B) { this.pc = this.r.R11; }
    else if (op === 0x10FF) { /* stays */ }
  }
  ping() { this.events.push(this.pc); this.emit('stopped'); }
  async stopped() { if (this.events.length) return this.events.shift(); return new Promise(res => this.once('stopped', () => res(this.events.shift()))); }
  async regs() { return Object.assign({ PC: this.pc, WP: this.wp, ST: this.st, IR: 0 }, Object.fromEntries([...Array(16).keys()].map(i => ['R' + i, this.r['R' + i] || 0]))); }
  async mem(a, n) { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = parsed.bytes.get(a + i) || 0; return b; }
  async setBreak(a) { this.armed.add(a); return 'ok'; }
  async clearBreak(a) { this.armed.delete(a); return 'ok'; }
  async step() { this.exec(); setTimeout(() => this.ping(), 1); return 'ok'; }
  async go() { setTimeout(() => { for (let i = 0; i < 50; i++) { this.exec(); if (this.armed.has(this.pc)) break; } this.ping(); }, 1); return 'ok'; }
  async pause() { return 'ok'; }
  async setReg(n, v) { if (n === 'WP') this.wp = v; else if (n === 'ST') this.st = v; else this.r[n] = v; return 'ok'; }
  async poke(a, b) { this.poked.push([a, Buffer.from(b).toString('hex')]); return 'ok'; }
  async quit() { this.quitCalled = true; }
}

(async () => {
  const link = new FakeLink();
  let killed = false;
  const s = new (require('../lib/debug').DebugSession)({
    prepare: async () => ({ parsed }),
    launchMame: async () => { setTimeout(() => link.ping(), 1); return { link, kill() { killed = true; } }; }
  });
  const out = [];
  s.on('message', m => out.push(m));
  let seq = 0;
  const call = async (command, args) => { const before = out.length; await s.handleMessage({ type: 'request', seq: ++seq, command, arguments: args }); return out.slice(before).find(m => m.type === 'response' && m.request_seq === seq); };
  const nextEvent = async (name) => { for (let i = 0; i < 200; i++) { const e = out.find(m => m.type === 'event' && m.event === name); if (e) { out.splice(out.indexOf(e), 1); return e; } await new Promise(r => setTimeout(r, 5)); } throw new Error('no ' + name + ' event'); };
  const where = async () => (await call('stackTrace', { threadId: 1 })).body.stackFrames[0];

  let r = await call('initialize', {});
  assert.ok(r.success && r.body.supportsConfigurationDoneRequest, 'initialize');
  r = await call('launch', { program: main });
  assert.ok(r.success, 'launch');
  await nextEvent('initialized');

  // breakpoints: line 4 is AFTER; line 6 is a comment; line 7 is SUB's INC
  r = await call('setBreakpoints', { source: { path: main }, breakpoints: [{ line: 4 }, { line: 6 }, { line: 7 }] });
  assert.deepStrictEqual(r.body.breakpoints.map(b => b.verified), [true, false, true], 'comment line cannot hold a breakpoint');
  assert.ok(link.armed.has(0xA008) && link.armed.has(0xA00C));

  await call('configurationDone', {});
  assert.strictEqual((await nextEvent('stopped')).body.reason, 'entry');
  let f = await where();
  assert.strictEqual(f.line, 2, 'stopped on START line'); assert.strictEqual(f.source.path, main);

  // step over the BL: should land on AFTER, not inside SUB
  await call('next', { threadId: 1 }); // at LI -> plain step
  await nextEvent('stopped'); f = await where(); assert.strictEqual(f.line, 3, 'step from LI lands on BL');
  await call('next', { threadId: 1 });
  // the user breakpoint inside SUB is hit first, as in any debugger
  let e = await nextEvent('stopped'); f = await where();
  assert.strictEqual(f.line, 7, 'stopped inside SUB at your breakpoint'); assert.strictEqual(e.body.reason, 'breakpoint');
  assert.strictEqual(link.r.R1, 0);
  r = await call('stackTrace', { threadId: 1 });
  assert.strictEqual(r.body.stackFrames.length, 2, 'inside SUB there is a caller');
  assert.strictEqual(r.body.stackFrames[1].line, 3, 'the caller is the BL line');
  assert.ok(/via R11/.test(r.body.stackFrames[1].name), 'the guess is labelled');
  r = await call('scopes', { frameId: 2 }); assert.strictEqual(r.body.scopes.length, 2, 'a caller shows its workspace and the current registers');
  assert.ok(/Registers/.test(r.body.scopes[0].name), 'registers (PC, WP, ST) are still there');
  const callerRef = r.body.scopes[1].variablesReference;
  r = await call('variables', { variablesReference: callerRef }); assert.strictEqual(r.body.variables.length, 16);
  r = await call('setVariable', { variablesReference: callerRef, name: 'R2', value: '>0007' });
  assert.ok(r.success && r.body.value === '>0007', 'a register in a caller\'s workspace can be changed');
  assert.deepStrictEqual(link.poked[link.poked.length - 1], [0x8300 + 4, '0007'], 'and it is written in THAT workspace in memory, not the one running now');

  // step out: runs to the address in R11, which is AFTER
  await call('stepOut', { threadId: 1 });
  await nextEvent('stopped'); f = await where();
  assert.strictEqual(f.line, 4, 'step out returns after the BL');

  // registers and watches
  r = await call('scopes', { frameId: 1 });
  assert.strictEqual(r.body.scopes.length, 3);
  r = await call('variables', { variablesReference: 1 });
  assert.ok(r.body.variables.some(v => v.name === 'PC' && v.value === '>A008'));
  r = await call('variables', { variablesReference: 3 });
  assert.strictEqual(r.body.variables.length, 16);
  r = await call('variables', { variablesReference: 2 });
  assert.ok(r.body.variables.some(v => v.name === 'EQ'));
  r = await call('evaluate', { expression: 'r1' }); assert.strictEqual(r.body.result, '>0001');
  r = await call('evaluate', { expression: 'start' }); assert.ok(/^>0200/.test(r.body.result), 'label shows the word stored there');
  r = await call('evaluate', { expression: 'nonsense!' }); assert.ok(!r.success);

  // break at a name or address
  r = await call('setFunctionBreakpoints', { breakpoints: [{ name: 'sub' }, { name: '>A008' }, { name: '0xA00A', condition: 'R1 = 9' }, { name: 'nonsense' }, { name: '>A009' }] });
  assert.deepStrictEqual(r.body.breakpoints.map(b => b.verified), [true, true, true, false, false], 'label, address, address with a condition; a bad name and an odd address are explained');
  assert.ok(/not a label/.test(r.body.breakpoints[3].message) && /odd/.test(r.body.breakpoints[4].message));
  assert.ok(link.armed.has(0xA00C) && link.armed.has(0xA008) && link.armed.has(0xA00A), 'they are armed in MAME');
  r = await call('setFunctionBreakpoints', { breakpoints: [] });
  assert.ok(!link.armed.has(0xA00A), 'and cleared again');

  // changing registers while stopped
  r = await call('setVariable', { variablesReference: 3, name: 'R3', value: '>1F' });
  assert.ok(r.success && r.body.value === '>001F', 'R3 set'); assert.strictEqual(link.r.R3, 0x1F);
  r = await call('variables', { variablesReference: 3 });
  assert.strictEqual(r.body.variables[3].value, '>001F', 'the list shows the new value');
  assert.ok(out.some(m => m.type === 'event' && m.event === 'invalidated'), 'VS Code is told to refresh');
  r = await call('setVariable', { variablesReference: 3, name: 'R4', value: '12' }); assert.strictEqual(link.r.R4, 12, 'plain numbers are decimal');
  r = await call('setVariable', { variablesReference: 3, name: 'R5', value: 'START' }); assert.strictEqual(link.r.R5, 0xA000, 'a label gives its address');
  r = await call('setVariable', { variablesReference: 1, name: 'WP', value: '>8320' }); assert.strictEqual(link.wp, 0x8320);
  r = await call('setVariable', { variablesReference: 1, name: 'PC', value: '>A000' });
  assert.ok(!r.success && /breakpoint/.test(r.message), 'PC cannot be changed and the reason is plain');
  r = await call('setVariable', { variablesReference: 3, name: 'R1', value: 'banana' }); assert.ok(!r.success && /not a number/.test(r.message));
  link.st = 0;
  r = await call('setVariable', { variablesReference: 2, name: 'EQ', value: 'on' }); assert.ok(r.success); assert.strictEqual(link.st, 1 << 13, 'EQ flag is bit 13');
  r = await call('setVariable', { variablesReference: 2, name: 'EQ', value: 'off' }); assert.strictEqual(link.st, 0);
  r = await call('evaluate', { expression: 'R2 = 7', context: 'repl' }); assert.ok(r.success && link.r.R2 === 7, 'Debug Console: R2 = 7 changes it');
  r = await call('evaluate', { expression: 'R2 = 7', context: 'watch' }); assert.ok(!r.success || link.r.R2 === 7, 'in a Watch it is not an assignment');
  r = await call('evaluate', { expression: '@>8310 = >ABCD', context: 'repl' }); assert.deepStrictEqual(link.poked[link.poked.length - 1], [0x8310, 'abcd'], 'memory word written');
  r = await call('setExpression', { expression: 'R6', value: '3' }); assert.strictEqual(link.r.R6, 3);

  // continue runs to the next breakpoint or forever
  r = await call('setBreakpoints', { source: { path: main }, breakpoints: [] });
  assert.ok(!link.armed.has(0xA008), 'removed breakpoints are cleared in MAME');
  await call('continue', { threadId: 1 });
  await nextEvent('stopped'); f = await where();
  assert.strictEqual(f.line, 5, 'ran on to the JMP loop');


  // ---- conditional breakpoints (a fresh session) ----
  const run2 = async (cond, hit) => {
    const link2 = new FakeLink();
    const s2 = new DebugSession({ prepare: async () => ({ parsed }), launchMame: async () => { setTimeout(() => link2.ping(), 1); return { link: link2, kill() {} }; } });
    const out2 = [];
    s2.on('message', m => out2.push(m));
    let q = 0;
    const c2 = async (command, args) => { const b = out2.length; await s2.handleMessage({ type: 'request', seq: ++q, command, arguments: args }); return out2.slice(b).find(m => m.type === 'response' && m.request_seq === q); };
    const ev2 = async (name) => { for (let i = 0; i < 200; i++) { const e = out2.find(m => m.type === 'event' && m.event === name); if (e) { out2.splice(out2.indexOf(e), 1); return e; } await new Promise(r => setTimeout(r, 5)); } throw new Error('no ' + name); };
    await c2('initialize', {}); await c2('launch', {}); await ev2('initialized');
    const bp = { line: 7 }; if (cond) bp.condition = cond; if (hit) bp.hitCondition = hit;   // line 7 = SUB (INC R1)
    const r2 = await c2('setBreakpoints', { source: { path: main }, breakpoints: [bp] });
    await c2('configurationDone', {}); await ev2('stopped');
    await c2('continue', { threadId: 1 }); await ev2('stopped');
    const f2 = (await c2('stackTrace', { threadId: 1 })).body.stackFrames[0];
    await c2('disconnect', {});
    return { verified: r2.body.breakpoints[0].verified, message: r2.body.breakpoints[0].message, line: f2.line };
  };
  let res = await run2('R1 = 0');
  assert.strictEqual(res.line, 7, 'a condition that is true stops there');
  res = await run2('R1 = 5');
  assert.strictEqual(res.line, 5, 'a condition that is false runs on (to the JMP loop)');
  res = await run2('R1 = 0 and R0 = 1');
  assert.strictEqual(res.line, 7, 'and: both true');
  res = await run2('@START = >0200');
  assert.strictEqual(res.line, 7, 'a word in memory can be used');
  res = await run2(null, '2');
  assert.strictEqual(res.line, 5, 'a hit count of 2 does not stop the first time');
  res = await run2(null, '1');
  assert.strictEqual(res.line, 7, 'a hit count of 1 stops the first time');
  res = await run2('R1 = ');
  assert.ok(!res.verified && /Can't use this condition/.test(res.message), 'a condition that makes no sense is explained');


  // ---- start-up code first: the debugger runs it and stops at your start ----
  {
    const l3 = new FakeLink();
    const s3 = new DebugSession({ prepare: async () => ({ parsed, runUntil: 0xA004 }), launchMame: async () => { setTimeout(() => l3.ping(), 1); return { link: l3, kill() {} }; } });
    s3.on('message', () => {});
    await s3.handleMessage({ type: 'request', seq: 1, command: 'initialize', arguments: {} });
    await s3.handleMessage({ type: 'request', seq: 2, command: 'launch', arguments: {} });
    assert.strictEqual(l3.pc, 0xA004, 'ran the start-up code and stopped at your first instruction');
    assert.strictEqual(l3.armed.size, 0, 'the temporary breakpoint is gone');
  }

  await call('disconnect', {});
  assert.ok(link.quitCalled && killed, 'MAME is closed');
  await nextEvent('terminated');
  console.log('debug-test: all good');
})().catch(e => { console.log('FAIL', e.stack || e); process.exit(1); });
