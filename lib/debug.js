'use strict';
// The debugger: answers VS Code's debug buttons (continue, step, breakpoints, registers...) by
// talking to a TI-99/4A running in MAME. Nothing in here knows about VS Code itself or starts
// programs: everything it needs from outside is handed in (see `deps` below), so it can be
// tested with a pretend MAME.
//
// deps:
//   prepare(args)  -> Promise<{ parsed, image, program, mameArgsInfo }>   assemble, read the listing
//   launchMame(info) -> Promise<{ link, kill() }>                       start MAME, connect to it
// where `parsed` comes from lib/listing.js.

const path = require('path');
const { EventEmitter } = require('events');
const Listing = require('./listing');
const Cond = require('./condition');
const { callStack } = require('./callstack');

const THREAD = 1;
const REF_REGS = 1, REF_FLAGS = 2, REF_WORKSPACE = 3, REF_FRAME = 100;   // REF_FRAME + n = the workspace of call-stack frame n

const hex4 = (n) => '>' + (n & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');

/** The status register's bits, left to right, as the TMS9900 documents them. */
const FLAGS = [['L>', 15], ['A>', 14], ['EQ', 13], ['C', 12], ['OV', 11], ['OP', 10], ['X', 9]];

class DebugSession extends EventEmitter {
  constructor(deps) {
    super();
    this.deps = deps;
    this.parsed = null;
    this.link = null;
    this.proc = null;
    this.userBreaks = new Map();   // source file -> [addresses]
    this.conds = new Map();        // address -> { test, hits, count, text } for breakpoints with a condition
    this.armed = new Set();        // addresses the bridge has a breakpoint at
    this.running = false;
    this.stopOnEntry = true;
    this.ended = false;
    this.nextSeq = 1;
  }

  // ---- talking to VS Code ------------------------------------------------
  send(msg) { msg.seq = this.nextSeq++; this.emit('message', msg); }
  event(name, body) { this.send({ type: 'event', event: name, body: body || {} }); }
  reply(req, body) { this.send({ type: 'response', request_seq: req.seq, success: true, command: req.command, body: body || {} }); }
  fail(req, message) { this.send({ type: 'response', request_seq: req.seq, success: false, command: req.command, message, body: { error: { id: 1, format: message } } }); }

  async handleMessage(req) {
    if (!req || req.type !== 'request') return;
    const fn = this['do_' + req.command];
    if (!fn) { this.fail(req, 'Retro ASM cannot do "' + req.command + '".'); return; }
    try { await fn.call(this, req, req.arguments || {}); }
    catch (e) { this.fail(req, e && e.message ? e.message : String(e)); }
  }

  // ---- setting up --------------------------------------------------------
  do_initialize(req) {
    this.reply(req, {
      supportsConfigurationDoneRequest: true,
      supportsReadMemoryRequest: true,
      supportsEvaluateForHovers: true,
      supportsFunctionBreakpoints: true,
      supportsConditionalBreakpoints: true,
      supportsHitConditionalBreakpoints: true,
      supportsTerminateRequest: true,
      supportsSetVariable: true,
      supportsSetExpression: true,
      supportsSteppingGranularity: false
    });
  }

  async do_launch(req, args) {
    this.stopOnEntry = args.stopOnEntry !== false;
    const info = await this.deps.prepare(args);
    this.parsed = info.parsed;
    for (const n of info.notes || []) this.event('output', { category: 'console', output: n + '\n' });
    const started = await this.deps.launchMame(info);
    this.link = started.link;
    this.proc = started;
    this.link.on('closed', () => this.finish());
    this.link.on('error-line', (m) => this.event('output', { category: 'important', output: 'MAME: ' + m + '\n' }));
    await this.link.stopped(90);          // the program is loaded and waiting at its first instruction
    if (info.runUntil !== undefined) {
      // a few start-up instructions come first (they set the screen colours): run them, and stop at your start
      await this.link.setBreak(info.runUntil);
      await this.link.go();
      await this.link.stopped(30);
      await this.link.clearBreak(info.runUntil);
    }
    this.reply(req);
    this.event('initialized');
  }

  async do_setBreakpoints(req, args) {
    const file = path.normalize(args.source && args.source.path ? args.source.path : '');
    const wanted = args.breakpoints || (args.lines || []).map(l => ({ line: l }));
    const result = [];
    const addrs = [];
    for (const old of this.userBreaks.get(file) || []) this.conds.delete(old);
    for (const b of wanted) {
      const a = this.parsed ? Listing.addrForLine(this.parsed, file, b.line - 1) : null;
      if (a === null) { result.push({ verified: false, line: b.line, message: 'There is no instruction on this line, so the program can\'t stop here.' }); continue; }
      let test = null, hits = null;
      try {
        if (b.condition && b.condition.trim()) test = Cond.parseCondition(b.condition, this.parsed.symbols);
        if (b.hitCondition && b.hitCondition.trim()) hits = Cond.parseHits(b.hitCondition);
      } catch (e) {
        result.push({ verified: false, line: b.line, message: 'Can\'t use this condition: ' + e.message + '. Examples: R2 = 5, R0 >= >0100, @SCORE > 9, R1 & 1.' });
        continue;
      }
      addrs.push(a);
      if (test || hits) this.conds.set(a, { test, hits, count: 0 });
      result.push({ verified: true, line: b.line });
    }
    this.userBreaks.set(file, addrs);
    await this.syncBreaks();
    this.reply(req, { breakpoints: result });
  }

  /** The "break at a name or address" box: a label, a supplied routine (VSBW, KSCAN...), or an address such as >000E. */
  async do_setFunctionBreakpoints(req, args) {
    const KEY = '\0names';
    for (const old of this.userBreaks.get(KEY) || []) this.conds.delete(old);
    const addrs = [], result = [];
    for (const b of args.breakpoints || []) {
      const text = String(b.name || '').trim();
      let a = null;
      const n = Cond.number(text.replace(/^@/, ''));
      if (n !== null) a = n;
      else if (this.parsed && this.parsed.symbols.has(text.toUpperCase())) a = this.parsed.symbols.get(text.toUpperCase());
      if (a === null) { result.push({ verified: false, message: `"${text}" is not a label, a routine such as VSBW or KSCAN, or an address (try >A000).` }); continue; }
      if (a & 1) { result.push({ verified: false, message: `${hex4(a)} is an odd address; instructions start on even addresses.` }); continue; }
      let test = null, hits = null;
      try {
        if (b.condition && b.condition.trim()) test = Cond.parseCondition(b.condition, this.parsed.symbols);
        if (b.hitCondition && b.hitCondition.trim()) hits = Cond.parseHits(b.hitCondition);
      } catch (e) { result.push({ verified: false, message: 'Can\'t use this condition: ' + e.message + '.' }); continue; }
      addrs.push(a);
      if (test || hits) this.conds.set(a, { test, hits, count: 0 });
      result.push({ verified: true, message: `Stops at ${hex4(a)}` });
    }
    this.userBreaks.set(KEY, addrs);
    await this.syncBreaks();
    this.reply(req, { breakpoints: result });
  }

  do_setExceptionBreakpoints(req) { this.reply(req); }

  async syncBreaks(temp) {
    if (!this.link) return;
    const want = new Set();
    for (const list of this.userBreaks.values()) for (const a of list) want.add(a);
    if (temp !== undefined && temp !== null) want.add(temp);
    for (const a of [...this.armed]) if (!want.has(a)) { await this.link.clearBreak(a); this.armed.delete(a); }
    for (const a of want) if (!this.armed.has(a)) { await this.link.setBreak(a); this.armed.add(a); }
  }

  /** At a breakpoint of yours: does its condition (and hit count) say stop? */
  async shouldStop(addr) {
    const c = this.conds.get(addr);
    if (!c) return true;
    if (c.test) {
      const regs = await this.link.regs();
      let ok;
      try { ok = await c.test.test({ regs, word: async (a) => (await this.link.mem(a & 0xFFFE, 2)).readUInt16BE(0) }); }
      catch (e) { this.event('output', { category: 'important', output: 'Retro ASM: could not check the condition at ' + hex4(addr) + ': ' + e.message + '\n' }); return true; }
      if (!ok) return false;
    }
    c.count++;
    return c.hits ? c.hits(c.count) : true;
  }

  isUserBreak(addr) {
    for (const list of this.userBreaks.values()) if (list.includes(addr)) return true;
    return false;
  }

  async do_configurationDone(req) {
    this.reply(req);
    if (this.stopOnEntry) this.event('stopped', { reason: 'entry', threadId: THREAD, allThreadsStopped: true });
    else this.resume('breakpoint', async () => { await this.syncBreaks(); return this.goOn(); }, undefined, true);
  }

  do_threads(req) { this.reply(req, { threads: [{ id: THREAD, name: 'TI-99/4A' }] }); }

  // ---- running -----------------------------------------------------------
  /** Do `start` (which lets the program run), then tell VS Code when it stops. */
  async resume(reason, start, target, skippable) {
    this.running = true;
    try {
      const reached = await start();
      let pc = reached !== undefined ? reached : await this.link.stopped(60 * 60 * 24);
      // a breakpoint with a condition that is not true (or a hit count not reached yet): carry on
      // quietly. Not when you are stepping: a step always stops where it lands.
      while (skippable && pc !== target && this.isUserBreak(pc) && !this.pauseWanted && !(await this.shouldStop(pc))) {
        const again = await start();
        pc = again !== undefined ? again : await this.link.stopped(60 * 60 * 24);
      }
      this.running = false;
      const why = this.pauseWanted ? 'pause' : (target !== undefined && pc !== target && this.isUserBreak(pc) ? 'breakpoint' : reason);
      this.event('output', { category: 'console', output: `Stopped at ${hex4(pc)} (${why})\n` });
      this.event('stopped', { reason: this.pauseWanted ? 'pause' : (target !== undefined && pc !== target && this.isUserBreak(pc) ? 'breakpoint' : reason), threadId: THREAD, allThreadsStopped: true });
      this.pauseWanted = false;
    } catch (e) {
      this.running = false;
      if (!this.ended) this.event('output', { category: 'important', output: 'Retro ASM: ' + e.message + '\n' });
      if (!this.ended) this.event('stopped', { reason: 'pause', threadId: THREAD, allThreadsStopped: true });
    }
  }

  async do_continue(req) { this.reply(req, { allThreadsContinued: true }); this.resume('breakpoint', async () => { await this.syncBreaks(); return this.goOn(); }, undefined, true); }

  async do_pause(req) { this.reply(req); if (this.running) { this.pauseWanted = true; await this.link.pause(); } }

  async do_stepIn(req) { this.reply(req); this.resume('step', async () => { await this.syncBreaks(); await this.link.step(); }); }

  /**
   * Let the program run. If it is sitting on a breakpoint, step off it first: the TI's MAME can
   * report the same breakpoint again straight away, which looks like Continue doing nothing.
   * Gives the address if that one step already landed on another breakpoint.
   */
  async goOn() {
    const r = await this.link.regs();
    if (this.armed.has(r.PC)) {
      await this.link.step();
      const pc = await this.link.stopped(10);
      if (this.armed.has(pc)) return pc;
    }
    await this.link.go();
    return undefined;
  }

  /** Run until the program gets to `addr` (or to a breakpoint of yours first). */
  runTo(addr) {
    return async () => { await this.syncBreaks(addr); return this.goOn(); };
  }

  async do_next(req) {
    this.reply(req);
    const regs = await this.link.regs();
    const mem = await this.link.mem(regs.PC, 2);
    const op = mem.readUInt16BE(0);
    const call = (op & 0xFFC0) === 0x0680 || (op & 0xFFC0) === 0x0400 || (op & 0xF800) === 0x2C00;   // BL, BLWP, XOP
    const line = Listing.lineForAddr(this.parsed, regs.PC);
    if (call && line && line.size >= 2) {
      const after = line.addr + line.size;
      this.resume('step', this.runTo(after), after, true);
    } else this.resume('step', async () => { await this.syncBreaks(); await this.link.step(); });
  }

  async do_stepOut(req) {
    this.reply(req);
    const regs = await this.link.regs();
    let back = regs.R11;                                          // R11 holds the way back after BL
    try {
      const frames = await callStack(this.parsed, regs, async (a) => (await this.link.mem(a & 0xFFFE, 2)).readUInt16BE(0));
      if (frames[0].ret) back = frames[0].ret;                    // (after BLWP it is the saved PC in R14)
    } catch (e) { /* fall back to R11 */ }
    this.resume('step', this.runTo(back), back, true);
  }

  // ---- looking ----------------------------------------------------------
  async do_stackTrace(req, args) {
    const r = await this.link.regs();
    this.lastRegs = r;
    let frames;
    try { frames = await callStack(this.parsed, r, async (a) => (await this.link.mem(a & 0xFFFE, 2)).readUInt16BE(0)); }
    catch (e) { frames = [{ pc: r.PC, ws: r.WP, how: 'here' }]; }     // never let a guess about callers break the basics
    this.frames = frames;
    const out = frames.map((f, i) => {
      const line = Listing.lineForAddr(this.parsed, f.pc);
      const sym = this.nameFor(f.pc);
      const where = sym ? `${sym} (${hex4(f.pc)}${f.how === 'bl' ? ', via R11' : ''})` : hex4(f.pc);
      const frame = { id: i + 1, name: where, line: line ? line.line + 1 : 0, column: line ? 1 : 0 };
      if (line) frame.source = { name: path.basename(line.file), path: line.file };
      return frame;
    });
    const start = args.startFrame || 0, count = args.levels || 0;
    this.reply(req, { stackFrames: count ? out.slice(start, start + count) : out.slice(start), totalFrames: out.length });
  }

  /** The nearest label at or before an address, as `LABEL+n`. */
  nameFor(addr) {
    let best = null;
    for (const [n, a] of this.parsed.symbols) if (a <= addr && addr - a < 0x100 && (!best || a > best.a)) best = { n, a };
    return best ? (best.a === addr ? best.n : `${best.n}+${addr - best.a}`) : '';
  }

  do_scopes(req, args) {
    const n = (args.frameId || 1) - 1;
    if (n > 0) {
      // a caller: its own workspace, plus the registers where the program is stopped now (so WP, PC and ST never vanish)
      this.reply(req, { scopes: [
        { name: 'Registers (where it is stopped now)', variablesReference: REF_REGS, expensive: false },
        { name: 'Workspace of this caller (R0-R15)', variablesReference: REF_FRAME + n, expensive: false }
      ] });
      return;
    }
    this.reply(req, { scopes: [
      { name: 'Registers', variablesReference: REF_REGS, expensive: false },
      { name: 'Status flags', variablesReference: REF_FLAGS, expensive: false },
      { name: 'Workspace (R0-R15)', variablesReference: REF_WORKSPACE, expensive: false }
    ] });
  }

  async do_variables(req, args) {
    const r = this.lastRegs || await this.link.regs();
    const v = (name, value) => ({ name, value: hex4(value), variablesReference: 0 });
    let list = [];
    if (args.variablesReference >= REF_FRAME) {
      const f = (this.frames || [])[args.variablesReference - REF_FRAME];
      if (f) {
        const m = await this.link.mem(f.ws, 32);
        for (let i = 0; i < 16; i++) list.push(v('R' + i, m.readUInt16BE(i * 2)));
      }
      this.reply(req, { variables: list });
      return;
    }
    if (args.variablesReference === REF_REGS) list = [v('PC', r.PC), v('WP', r.WP), v('ST', r.ST)];
    else if (args.variablesReference === REF_FLAGS) list = FLAGS.map(([n, bit]) => ({ name: n, value: (r.ST >> bit) & 1 ? 'on' : 'off', variablesReference: 0 }));
    else if (args.variablesReference === REF_WORKSPACE) for (let i = 0; i < 16; i++) list.push(v('R' + i, r['R' + i]));
    this.reply(req, { variables: list });
  }

  /** What you can type in Watch or the Debug Console: a register, a label, or >ADDR. A label or address shows the word stored there. */
  async do_evaluate(req, args) {
    const text = String(args.expression || '').trim();
    const assign = args.context === 'repl' ? /^(?:(PC|WP|ST|R(?:[0-9]|1[0-5]))|@\s*(\S+?))\s*=\s*(\S.*)$/i.exec(text) : null;
    if (assign) { this.reply(req, { result: await this.assign(assign[1] || '@' + assign[2], assign[3]), variablesReference: 0 }); return; }
    const r = this.lastRegs || await this.link.regs();
    const up = text.toUpperCase();
    if (/^(PC|WP|ST|R([0-9]|1[0-5]))$/.test(up)) { this.reply(req, { result: hex4(r[up]), variablesReference: 0 }); return; }
    let addr = null;
    const at = up.replace(/^@/, '');
    if (/^[>]([0-9A-F]{1,4})$/.test(at)) addr = parseInt(at.slice(1), 16);
    else if (/^0X([0-9A-F]{1,4})$/.test(at)) addr = parseInt(at.slice(2), 16);
    else if (this.parsed.symbols.has(at)) addr = this.parsed.symbols.get(at);
    if (addr === null) { this.fail(req, 'Not a register, label or address: ' + text + ' (try R0, PC, a label, or >8300).'); return; }
    const m = await this.link.mem(addr & 0xFFFE, 2);
    this.reply(req, { result: `${hex4(m.readUInt16BE(0))}   (at ${hex4(addr & 0xFFFE)})`, variablesReference: 0 });
  }

  // ---- changing things while stopped ------------------------------------------
  /** A number, register or label as a 16-bit value: 5, >1F, 0x1F, R3, SCORE. */
  valueOf(text, regs) {
    const t = String(text).trim();
    const n = Cond.number(t);
    if (n !== null) return n;
    const u = t.toUpperCase();
    if (regs && regs[u] !== undefined && /^(PC|WP|ST|R\d+)$/.test(u)) return regs[u];
    if (this.parsed && this.parsed.symbols.has(u)) return this.parsed.symbols.get(u);
    throw new Error(`"${t}" is not a number (try 5, >1F or 0x1F), a register or a label.`);
  }

  /** Change a register (R0-R15, WP, ST) or, for a name starting with @, the word at an address. Gives the text to show afterwards. */
  async assign(target, valueText) {
    if (this.running) throw new Error('The program is running. Press Pause first, then change it.');
    const regs = this.lastRegs || await this.link.regs();
    const name = String(target).toUpperCase();
    const v = this.valueOf(valueText, regs);
    let shown;
    if (name[0] === '@') {
      const a = this.valueOf(name.slice(1), regs) & 0xFFFE;
      await this.link.poke(a, Buffer.from([(v >> 8) & 0xFF, v & 0xFF]));
      shown = `${hex4(v)}   (at ${hex4(a)})`;
    } else if (name === 'PC') {
      throw new Error('PC can\'t be changed here: the chip has already read its next instruction. To run from somewhere else, put a breakpoint there and press Continue.');
    } else if (/^(WP|ST|R([0-9]|1[0-5]))$/.test(name)) {
      await this.link.setReg(name, v);
      shown = hex4(v);
    } else throw new Error(`"${target}" is not something that can be changed (try R0-R15, WP, ST or @address).`);
    this.lastRegs = await this.link.regs();
    this.event('invalidated', { areas: ['variables'], threadId: THREAD });
    return shown;
  }

  async do_setVariable(req, args) {
    const name = String(args.name || '').toUpperCase();
    if (args.variablesReference === REF_FLAGS) {
      const f = FLAGS.find(([n]) => n === name);
      if (!f) throw new Error('Unknown flag ' + args.name);
      const t = String(args.value).trim().toLowerCase();
      const on = ['on', '1', 'true', 'yes'].includes(t), off = ['off', '0', 'false', 'no'].includes(t);
      if (!on && !off) throw new Error('A flag is on or off (or 1 or 0).');
      const r = this.lastRegs || await this.link.regs();
      const st = on ? (r.ST | (1 << f[1])) : (r.ST & ~(1 << f[1]));
      await this.assign('ST', String(st & 0xFFFF));
      this.reply(req, { value: on ? 'on' : 'off', variablesReference: 0 });
      return;
    }
    if (args.variablesReference >= REF_FRAME) {
      // a register in a caller's workspace: that workspace is somewhere in memory, so write the word there
      const f = (this.frames || [])[args.variablesReference - REF_FRAME];
      const m = /^R([0-9]|1[0-5])$/.exec(name);
      if (!f || !m) throw new Error('Only R0-R15 can be changed here.');
      const regs = this.lastRegs || await this.link.regs();
      const v = this.valueOf(args.value, regs);
      await this.link.poke(f.ws + 2 * parseInt(m[1], 10), Buffer.from([(v >> 8) & 0xFF, v & 0xFF]));
      this.lastRegs = await this.link.regs();
      this.event('invalidated', { areas: ['variables'], threadId: THREAD });
      this.reply(req, { value: hex4(v), variablesReference: 0 });
      return;
    }
    this.reply(req, { value: await this.assign(name, args.value), variablesReference: 0 });
  }

  async do_setExpression(req, args) {
    const e = String(args.expression || '').trim();
    const m = /^(?:(PC|WP|ST|R(?:[0-9]|1[0-5]))|@\s*(\S+))$/i.exec(e);
    if (!m) throw new Error('Only a register (R0-R15, WP, ST) or @address can be changed.');
    this.reply(req, { value: await this.assign(m[1] || '@' + m[2], args.value), variablesReference: 0 });
  }

  async do_readMemory(req, args) {
    const ref = String(args.memoryReference || '0').toUpperCase().replace(/^>|^0X/, '');
    const start = (parseInt(ref, 16) || 0) + (args.offset || 0);
    const count = Math.min(args.count || 16, 4096);
    const m = await this.link.mem(start & 0xFFFF, count);
    this.reply(req, { address: '0x' + start.toString(16), data: m.toString('base64') });
  }

  // ---- finishing ---------------------------------------------------------
  finish() {
    if (this.ended) return;
    this.ended = true;
    this.event('terminated');
  }

  async do_disconnect(req) { this.reply(req); await this.close(); }
  async do_terminate(req) { this.reply(req); await this.close(); }

  async close() {
    this.ended = true;
    try { if (this.link) await this.link.quit(); } catch (e) { /* closing anyway */ }
    try { if (this.proc && this.proc.kill) this.proc.kill(); } catch (e) { /* already gone */ }
    this.event('terminated');
  }
}

module.exports = { DebugSession, hex4 };
