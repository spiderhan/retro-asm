'use strict';
// Warnings that only make sense on the BBC Micro (the rules live in the chip file, under "checks"):
//   - an instruction only the 65C02 has, used while the CPU is still the plain 6502 (no "CPU 1")
//   - code that runs past a GUARD address
//   - the program stores to zero page the operating system owns (&90-&FF) while also calling the OS
//   - code that sits in screen memory for the MODE the program switches to
// Nothing in here knows about VS Code.

const OS = require('./oscalls');

const hex = (v, n) => '&' + (v >>> 0).toString(16).toUpperCase().padStart(n || 2, '0');
const range = (pl) => ({ start: pl.mnem.start, end: pl.mnem.end });

function run(project, file) {
  const model = project.get(file);
  const D = model.D, C = D.checks || {};
  const out = [];
  if (!C.cpuExtras && !C.guard && !C.osZeroPage && !C.screenByMode) return out;
  const list = OS.flatten(model, 0, model.lines.length - 1);

  const info = (e) => project.lineInfo(file, e.ln, e.pl.part);
  const usesOS = C.osZeroPage && list.some(e => e.pl.mnem && D.instr(e.pl.mnem.upper) && OS.callOf(project, file, D, e.pl));

  let cpu = 0;
  const guards = [];                        // [{ addr, reported }]
  let mode = null, wantMode = false, modeReported = false;
  const zp = C.osZeroPage ? { from: parseInt(C.osZeroPage.from, 16), to: parseInt(C.osZeroPage.to, 16), w: new Set(C.osZeroPage.writers) } : null;
  const extras = C.cpuExtras ? new Set(C.cpuExtras.instructions) : null;

  for (let i = 0; i < list.length; i++) {
    const e = list[i], pl = e.pl;
    if (!pl.mnem) continue;
    const m = pl.mnem.upper;
    const li = info(e);
    if (li && li.skipped) continue;

    // directives that change what follows
    if (C.cpuExtras && m === C.cpuExtras.directive && pl.operands.length === 1) {
      const v = project.eval(file, pl.operands[0].text.trim());
      if (v !== null) cpu = v;
      continue;
    }
    if (C.guard && m === C.guard.set && pl.operands.length === 1) {
      const v = project.eval(file, pl.operands[0].text.trim());
      if (v !== null) guards.push({ addr: v, reported: false });
      continue;
    }
    if (C.guard && m === C.guard.clear && pl.operands.length === 2) {
      const a = project.eval(file, pl.operands[0].text.trim()), b = project.eval(file, pl.operands[1].text.trim());
      if (a !== null && b !== null) for (let g = guards.length - 1; g >= 0; g--) if (guards[g].addr >= a && guards[g].addr < b) guards.splice(g, 1);
      continue;
    }

    const ins = D.instr(m);
    if (!ins) continue;
    const op = pl.operands.map(o => o.text.trim()).join(',');
    const opU = op.toUpperCase();

    // 1. 65C02 only
    if (extras && cpu < C.cpuExtras.level) {
      let why = null;
      if (extras.has(m)) why = m + ' is a 65C02 instruction';
      else for (const f of C.cpuExtras.forms) if (f.only.includes(m) && new RegExp(f.re, 'i').test(opU)) { why = m + ' ' + f.what + ' is a 65C02 instruction'; break; }
      if (why) out.push({ line: e.ln, ...range(pl), severity: 'warning', message: why + ', but the CPU is still the plain 6502 here. Put CPU ' + C.cpuExtras.level + ' above this line (before the code that needs it), or BeebAsm will refuse it.' });
    }

    // 2. past a GUARD
    if (li && li.after !== undefined && !li.dummy) for (const g of guards) {
      if (!g.reported && li.after > g.addr) {
        g.reported = true;
        out.push({ line: e.ln, ...range(pl), severity: 'warning', message: 'This code runs past the GUARD at ' + hex(g.addr, 4) + ' (it ends at ' + hex(li.after - 1, 4) + '). BeebAsm will stop with an error here. Make the program smaller, or move the GUARD.' });
      }
    }

    // 3. zero page the OS owns
    if (zp && usesOS && zp.w.has(m) && op && !op.startsWith('#') && !/^\(/.test(op)) {
      const base = project.eval(file, op.replace(/,\s*[XY]\s*$/i, '').trim());
      if (base !== null && base >= zp.from && base <= zp.to) out.push({ line: e.ln, ...range(pl), severity: 'info', message: 'Zero page ' + hex(base) + ' belongs to the operating system (its filing system and screen code use ' + hex(zp.from) + '-' + hex(zp.to) + '), and this program also calls the OS. Writing here can upset it. &70-&8F is kept free for your own programs.' });
    }

    // 4. screen memory for the MODE (VDU 22,n)
    if (C.screenByMode && li && li.addr !== undefined) {
      const call = OS.callOf(project, file, D, pl);
      if (call && call.name && call.name.toUpperCase() === C.screenByMode.modeCall) {
        const ctx = OS.around(project, file, e.ln, pl);
        const v = ctx.idx >= 0 ? OS.valueBefore(project, file, ctx, ctx.idx, 'A') : null;
        if (v) {
          if (wantMode) { mode = v.value & 7; wantMode = false; modeReported = false; }
          else if (v.value === C.screenByMode.modeCode) wantMode = true;
        } else wantMode = false;
      }
      if (mode !== null && !modeReported && !li.dummy && li.size > 0) {
        const start = parseInt(C.screenByMode.modes[String(mode)], 16), top = parseInt(C.screenByMode.top, 16);
        if (li.addr >= start && li.addr < top) {
          modeReported = true;
          out.push({ line: e.ln, ...range(pl), severity: 'info', message: 'This code is at ' + hex(li.addr, 4) + ', which is screen memory in MODE ' + mode + ' (the screen starts at ' + hex(start, 4) + '). Drawing on the screen would overwrite the program.' });
        }
      }
    }
  }
  return out;
}

module.exports = { run };
