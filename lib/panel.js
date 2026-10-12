'use strict';
// What the side panel shows. Everything here is worked out from the code and the chip files:
// nothing is sent anywhere, and no AI is used. extension.js turns these plain objects into
// VS Code's tree items and web pages (see panel-html.js).

const path = require('path');
const { scan, opKinds, isAddressSlot, statements } = require('./parser');
const F = require('./features');
const X = require('./explain');
const A = require('./analysis');

const plain = (s) => String(s || '').replace(/\*\*|`/g, '').replace(/\s+/g, ' ').trim();
const firstSentence = (s) => { const t = plain(s); const m = /^(.+?[.!?])(\s|$)/.exec(t); return m ? m[1] : t; };
const codeOf = (model, ln) => {
  const pl = model.lines[ln];
  const raw = model.rawLines[ln] || '';
  return raw.slice(0, pl && pl.comment ? pl.comment.start : undefined).trim().replace(/\s+/g, ' ');
};

/** "**PRINT-A** (ROM routine): Prints ..." -> { title: 'PRINT-A', text: '(ROM routine): Prints ...' } */
function splitNote(note) {
  const m = /^\*\*([^*]+)\*\*\s*(.*)$/s.exec(note || '');
  const out = m ? { title: m[1].trim(), text: m[2].replace(/^[:—-]\s*/, '') } : { title: '', text: note || '' };
  const tag = /^\(([^)]{1,40})\)\s*:\s*/.exec(out.text);    // "(ROM routine): Plays ..."
  if (tag) { out.tag = tag[1]; out.text = out.text.slice(tag[0].length); }
  return out;
}

// ---------------------------------------------------------------------------
// This line (follows the cursor)
// ---------------------------------------------------------------------------
function thisLine(project, file, line, ch) {
  const model = project.get(file);
  if (!model || line < 0 || line >= model.lines.length) return null;
  const D = model.D;
  const whole = model.lines[line];
  // "LDA #1:STA &70": the statement the cursor is in (the first if the column isn't known)
  const pl = whole.parts ? (whole.parts.find(p => ch !== undefined && ch >= p.from && ch <= p.to) || whole.parts[ch !== undefined && ch > whole.parts[whole.parts.length - 1].to ? whole.parts.length - 1 : 0]) : whole;
  const ctx = F.makeCtx(project, file);
  const out = { file, fileName: path.basename(file), line, chip: D.name, code: codeOf(model, line), comment: whole.comment ? whole.comment.text : '', kind: 'blank' };
  const ins = pl.mnem ? D.instr(pl.mnem.upper) : null;
  const dir = pl.mnem ? D.directive(pl.mnem.upper) : null;
  const data = A.dataAfterLines(project, file).get(line);

  if (pl.mnem || pl.label) out.sentence = F.lineSentence(project, file, line, ctx);
  if (data) out.kind = 'data';
  else if (ins) {
    out.kind = 'instruction';
    Object.assign(out, { mnem: pl.mnem.upper, name: ins.name || '', group: ins.group || '', summary: ins.summary || '', more: ins.more || '', flags: ins.flags || '', syntax: ins.syntax || '' });
    const lr = A.lineRegs(pl, D, (t) => project.eval(file, t));
    out.reads = A.regList(lr.r, D);
    out.changes = A.regList(lr.w, D);
  } else if (dir) {
    out.kind = 'directive';
    Object.assign(out, { mnem: pl.mnem.upper, summary: dir.summary || '', syntax: dir.syntax || '' });
  } else if (pl.mnem) {
    out.kind = project.macros(file).has(pl.mnem.upper.replace(/^[.:+]/, '')) ? 'macro' : 'unknown';
    out.mnem = pl.mnem.text;
  } else if (pl.label) out.kind = 'label';
  else if (whole.comment) out.kind = 'comment';

  if (pl.label) {
    const uses = project.findRefs(file, pl.label.upper || model.qualify(pl.label.name, line));
    out.label = { name: pl.label.name, uses: uses.length };
  }

  // where it sits in memory
  if (D.sizing && (pl.mnem || pl.label)) {
    const info = project.lineInfo(file, line, pl.part);
    if (info && !info.dummy && !(dir && dir.kind === 'equ')) {
      out.address = X.hex(info.addr, D, 4);
      out.size = info.size;
      out.approx = !!info.approx;
    }
  }

  // the routine it is in
  const node = F.buildOutline(project, file).find(n => n.kind === 'routine' && line >= n.line && line <= n.endLine);
  if (node) {
    const r = { name: node.name, line: node.line, file };
    const sz = A.routineSize(project, file, node);
    if (sz) { r.address = X.hex(sz.addr, D, 4); r.size = sz.size; }
    try {
      const use = A.routineUse(project, file, node);
      r.changes = A.regList(use.writes, D);
    } catch (e) { /* optional */ }
    const c = A.callers(project, file, node.name);
    r.calledFrom = c.calls.length;
    r.usedFrom = c.refs.length;
    out.routine = r;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hardware used: the chip's known addresses (screen, sound, ROM routines ...) and ports
// ---------------------------------------------------------------------------
function hardwareUse(project, file) {
  const model = project.get(file);
  if (!model) return null;
  const D = model.D;
  const unit = project.unit(file);
  const size = safe(() => A.programSize(project, file));
  const mine = (v) => size && v >= size.start && v < size.end;
  const found = new Map();   // key -> item
  const add = (key, base, use) => {
    let it = found.get(key);
    if (!it) found.set(key, it = Object.assign({ uses: [] }, base));
    if (!it.uses.some(u => u.file === use.file && u.line === use.line)) it.uses.push(use);
  };

  for (const f of unit) {
    const m = project.get(f);
    const data = A.dataAfterLines(project, f);
    for (let ln = 0; ln < m.lines.length; ln++) for (const pl of statements(m.lines[ln])) {
      if (!pl.mnem || data.has(ln)) continue;
      const ins = D.instr(pl.mnem.upper);
      if (!ins) continue;                      // only instructions: a table of numbers isn't "using" hardware
      const use = { file: f, line: ln, code: codeOf(m, ln) };
      const kinds = opKinds(ins, pl.operands.length) || [];

      // Z80 ports: OUT ($FE),A and IN A,(C)
      const port = A.portLine(pl, D);
      if (port && D.ioPorts && D.ioPorts.size) {
        const v = A.portNumber(project, f, ln, pl.operands[port.port].text);
        const p = D.ioPort(v);
        if (p) {
          const key = 'port:' + p.name;
          add(key, { group: 'Ports (IN and OUT)', order: 0x10000, value: v & 0xFF, hex: X.hex(v & 0xFF, D, 2), title: plain(p.name), note: firstSentence(p.text || '') }, use);
        }
        continue;
      }

      for (let oi = 0; oi < pl.operands.length; oi++) {
        const op = pl.operands[oi];
        if (op.text.trim().startsWith('#')) continue;      // 6502 "#5": a number, not an address
        const slot = isAddressSlot(ins, pl, oi, D) || kinds[oi] === 't';
        for (const t of scan(op.text, op.start, D)) {
          let v = null, named = null;
          const prefixed = !!D.syntax.addressPrefix && m.rawLines[ln][t.start - 1] === D.syntax.addressPrefix;
          if (t.type === 'num') v = t.value;
          else if (t.type === 'ident') {
            const defs = project.findDefs(f, m.qualify(t.text, ln));
            if (!defs.length || defs[0].kind !== 'equ') continue;    // a label in the program itself
            v = project.value(f, m.qualify(t.text, ln));
            named = t.text;
          } else continue;
          if (v === null || v === undefined || v < 0 || v > 0xFFFF) continue;
          const note = D.addresses.get(v);
          const addressish = slot || prefixed;
          if (note && (addressish || v >= D.addressGuess.min)) {
            const s = splitNote(note);
            const region = D.region(v);
            add('a:' + v, { group: region ? region.text : 'Other', order: region ? region.from : 0xFFFF, value: v, hex: X.hex(v, D, 4), title: s.title || named || X.hex(v, D, 4), tag: s.tag || '', known: true, names: new Set(), note: firstSentence(s.text) }, use);
            if (named) found.get('a:' + v).names.add(named);
          } else if (addressish && !mine(v) && v >= 0x100) {
            const region = D.region(v);
            if (!region) continue;
            add('a:' + v, { group: region.text, order: region.from, value: v, hex: X.hex(v, D, 4), title: named || X.hex(v, D, 4), known: false, names: new Set(), note: '' }, use);
            if (named) found.get('a:' + v).names.add(named);
          }
        }
      }
    }
  }

  // group them, in address order
  const groups = new Map();
  for (const it of [...found.values()].sort((a, b) => a.order - b.order || a.value - b.value)) {
    if (it.names && it.names.size && !it.names.has(it.title)) it.alsoCalled = [...it.names].filter(n => n.toUpperCase() !== it.title.toUpperCase()).join(', ');
    delete it.names;
    if (!groups.has(it.group)) groups.set(it.group, { name: it.group, items: [] });
    groups.get(it.group).items.push(it);
  }
  return { chip: D.name, groups: [...groups.values()] };
}

function safe(f) { try { return f(); } catch (e) { return null; } }

// ---------------------------------------------------------------------------
// Memory map
// ---------------------------------------------------------------------------
function memoryMap(project, file, hardware) {
  const model = project.get(file);
  if (!model) return null;
  const D = model.D;
  const out = { chip: D.name, short: D.short, sizing: !!D.sizing, regions: [], files: [], program: null };
  const size = D.sizing ? safe(() => A.programSize(project, file)) : null;
  if (size && size.used > 0) {
    out.program = {
      start: size.start, end: size.end, used: size.used, room: size.room, free: size.room ? size.room - size.used : null,
      startHex: X.hex(size.start, D, 4), endHex: X.hex(size.end - 1, D, 4), regionText: size.regionText, approx: !!size.approx,
      loadNote: size.reloc && D.sizing && D.sizing.loadNote ? D.sizing.loadNote : ''
    };
  }
  const hwCount = new Map();
  for (const g of (hardware && hardware.groups) || []) for (const it of g.items) {
    const r = D.region(it.value);
    if (r && it.known && g.name !== 'Ports (IN and OUT)') hwCount.set(r.from, (hwCount.get(r.from) || 0) + 1);
  }
  for (const r of D.regions) {
    const reg = { from: r.from, to: r.to, fromHex: X.hex(r.from, D, 4), toHex: X.hex(r.to, D, 4), text: r.text, bytes: r.to - r.from + 1, uses: hwCount.get(r.from) || 0, program: null };
    if (out.program) {
      const a = Math.max(r.from, out.program.start), b = Math.min(r.to + 1, out.program.end);
      if (b > a) reg.program = { start: a, end: b, bytes: b - a };
    }
    out.regions.push(reg);
  }
  // where each file sits
  if (D.sizing) {
    for (const f of project.unit(file)) {
      const m = project.get(f);
      let lo = null, hi = null, approx = false, bytes = 0;
      for (let ln = 0; ln < m.lines.length; ln++) {
        const info = project.lineInfo(f, ln);
        if (!info || info.dummy || !info.size) continue;
        const pl = m.lines[ln];
        const dir = statements(pl).map(p => (p.mnem ? D.directive(p.mnem.upper) : null)).find(d => d && d.kind === 'include') || (pl.mnem ? D.directive(pl.mnem.upper) : null);
        if (dir && dir.kind === 'include' && !dir.binary) continue;     // the COPY line: counted in its own file
        if (info.approx) approx = true;
        bytes += info.size;
        lo = lo === null ? info.addr : Math.min(lo, info.addr);
        hi = hi === null ? info.after : Math.max(hi, info.after);
      }
      if (lo !== null) out.files.push({ file: f, name: path.basename(f), start: lo, startHex: X.hex(lo, D, 4), endHex: X.hex(hi - 1, D, 4), bytes, approx });
    }
    out.files.sort((a, b) => a.start - b.start);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Project at a glance
// ---------------------------------------------------------------------------
function projectSummary(project, file) {
  const model = project.get(file);
  if (!model) return null;
  const D = model.D;
  const root = project.rootOf(file);
  const unit = project.unit(file);
  const out = { chip: D.name, short: D.short, root, rootName: path.basename(root), files: [], warnings: 0, notes: 0, unused: [], routines: [], size: null };
  for (const f of unit) {
    const m = project.get(f);
    out.files.push({ file: f, name: path.basename(f), lines: m.lines.length, main: f === root });
    for (const c of safe(() => F.check(project, f)) || []) { if (c.severity === 'info') out.notes++; else out.warnings++; }
  }
  const size = D.sizing ? safe(() => A.programSize(project, file)) : null;
  if (size && size.used > 0) out.size = { used: size.used, room: size.room, startHex: X.hex(size.start, D, 4), endHex: X.hex(size.end - 1, D, 4), approx: !!size.approx };

  // names nothing uses
  const seen = new Set();
  for (const d of project.allDefs(file)) {
    if (!['code', 'label', 'data', 'equ'].includes(d.kind) || seen.has(d.upper)) continue;
    seen.add(d.upper);
    if (project.findRefs(file, d.upper).length) continue;
    out.unused.push({ name: d.name, kind: d.kind, file: d.file, line: d.line });
  }
  out.unused.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  // the biggest routines
  for (const f of unit) for (const n of F.buildOutline(project, f)) {
    if (n.kind !== 'routine') continue;
    const sz = A.routineSize(project, f, n);
    out.routines.push({ name: n.name, file: f, line: n.line, bytes: sz ? sz.size : null, lines: n.endLine - n.line + 1 });
  }
  out.routineCount = out.routines.length;
  out.routines.sort((a, b) => (b.bytes || 0) - (a.bytes || 0) || b.lines - a.lines);
  out.routines = out.routines.slice(0, 8);
  return out;
}

module.exports = { thisLine, hardwareUse, memoryMap, projectSummary, splitNote, firstSentence };
