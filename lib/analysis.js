'use strict';
// Looks at whole routines rather than single lines: which registers a routine touches,
// who calls it, how big it is, whether it loses its way back, what a block of data
// looks like as a picture, and whether a number is on its way to a hardware chip.

const path = require('path');
const { scan, opKinds, isCommentOnly, byCount, statements } = require('./parser');
const { decode } = require('./decoders');

// ---------------------------------------------------------------------------
// Registers
// ---------------------------------------------------------------------------
function implicitFor(ins, count) {
  const imp = ins.implicit;
  if (!imp) return {};
  if (imp.r || imp.w) return imp;
  return byCount(imp, count) || {};
}

/** Registers one line reads and writes: { r: Set, w: Set, call: name|null }. */
function lineRegs(pl, D, evalFn) {
  const out = { r: new Set(), w: new Set(), implicitW: new Set(), call: null, go: null, returns: false };
  if (!pl.mnem) return out;
  const ins = D.instr(pl.mnem.upper);
  if (!ins) return out;
  const kinds = opKinds(ins, pl.operands.length) || [];
  const rw = byCount(ins.rw, pl.operands.length) || [];
  for (let i = 0; i < pl.operands.length; i++) {
    const text = pl.operands[i].text.trim();
    if (kinds[i] === 'cc' && D.conditions.has(text.toUpperCase())) continue;   // the Z80's "C" in JR C,label is a test, not register C
    const role = rw[i] || 'r';
    if (D.isRegister(text)) {
      const u = text.toUpperCase();
      const sameBoth = pl.operands.length === 2 && rw[0] === 'r' && rw[1] === 'w' && pl.operands[0].text.trim().toUpperCase() === pl.operands[1].text.trim().toUpperCase();
      if (role.includes('r')) out.r.add(u);
      if (role.includes('w') && !sameBoth) out.w.add(u);
      if (ins.nextReg && i === 1) {
        const idx = D.registers.list.findIndex(n => n.toUpperCase() === u);
        const next = D.registers.list[idx + 1];
        if (next) { out.w.add(next.toUpperCase()); if (ins.nextReg.includes('r')) out.r.add(next.toUpperCase()); }
      }
      continue;
    }
    // a register used to find memory (*R1, *R1+, @TABLE(R1)): it is read, and changed if it moves on
    for (const t of scan(text, 0, D)) {
      if (t.type !== 'reg') continue;
      out.r.add(t.text.toUpperCase());
      if (/\+\s*$/.test(text)) out.w.add(t.text.toUpperCase());
    }
  }
  const imp = implicitFor(ins, pl.operands.length);
  for (const r of imp.r || []) out.r.add(r.toUpperCase());
  for (const r of imp.w || []) { out.w.add(r.toUpperCase()); out.implicitW.add(r.toUpperCase()); }
  if (ins.zeroCountReads && pl.operands[1] && evalFn && evalFn(pl.operands[1].text) === 0) out.r.add(ins.zeroCountReads);

  const first = pl.operands[0] ? pl.operands[0].text.trim() : '';
  const pre = D.syntax.addressPrefix || '';
  const nameOf = (t) => { const m = /^[A-Za-z_][A-Za-z0-9_]*%?$/.exec(pre && t.startsWith(pre) ? t.slice(pre.length) : t); return m ? m[0] : null; };
  const target = kinds.lastIndexOf('t') >= 0 && pl.operands[kinds.lastIndexOf('t')] ? pl.operands[kinds.lastIndexOf('t')].text.trim() : first;
  if (ins.call) out.call = nameOf(target);
  else if (ins.far || (ins.local && kinds[kinds.length - 1] === 't')) out.go = nameOf(pl.operands[pl.operands.length - 1] ? pl.operands[pl.operands.length - 1].text.trim() : '');
  const ret = D.checks.returnRx || (D.checks.returnOperand ? new RegExp(D.checks.returnOperand, 'i') : null);
  if (ins.returns || (ins.far && ret && ret.test(first))) { out.returns = true; out.go = null; }
  return out;
}

/**
 * Lines that look like instructions but are really data, because the instruction above says so
 * (Z80 Spectrum: the bytes after RST $28 are a list of sums for the ROM calculator).
 * Returns Map(line -> { from: line of the RST, rule, last: true on the line that ends the data }).
 */
function dataAfterLines(project, file) {
  const model = project.get(file);
  if (!model) return new Map();
  if (model._dataAfter && model._dataAfterGen === project.gen) return model._dataAfter;
  const D = model.D;
  const map = new Map();
  for (let ln = 0; ln < model.lines.length; ln++) {
    const pl = model.lines[ln];
    const ins = pl.mnem ? D.instr(pl.mnem.upper) : null;
    if (!ins || !ins.dataAfter || !pl.operands[0]) continue;
    const v = project.eval(file, pl.operands[0].text);
    const rule = ins.dataAfter.find(r => r.value === v);
    if (!rule) continue;
    for (let k = ln + 1; k < model.lines.length && k <= ln + 60; k++) {
      const q = model.lines[k];
      if (q.label) break;                       // something jumps here: real code again
      if (!q.mnem) continue;
      const joined = q.mnem.upper + (q.operands.length ? ' ' + q.operands.map(o => o.text.trim()).join(',').replace(/\s+/g, '') : '');
      const last = !!(rule.endRx && rule.endRx.test(joined));
      map.set(k, { from: ln, rule, last });
      if (last) break;
    }
  }
  model._dataAfter = map;
  model._dataAfterGen = project.gen;
  return map;
}

/** What one routine (an outline item) does with registers, looking only at its own lines. */
function routineUse(project, file, node) {
  const model = project.get(file);
  const D = model.D;
  const use = { reads: new Set(), writes: new Set(), implicitOnly: new Set(), calls: new Set(), goes: new Set(), returns: false };
  const explicit = new Set();
  const inside = new Set([D.key(node.name), ...node.children.map(c => D.key(c.name))]);
  const data = dataAfterLines(project, file);
  for (let ln = node.line; ln <= node.endLine; ln++) {
    if (data.has(ln)) continue;                 // data, not instructions
    for (const st of statements(model.lines[ln])) {
      const lr = lineRegs(st, D, (t) => project.eval(file, t));
      for (const r of lr.r) use.reads.add(r);
      for (const r of lr.w) { use.writes.add(r); if (!lr.implicitW.has(r)) explicit.add(r); }
      if (lr.call) use.calls.add(D.key(lr.call));
      if (lr.go && !inside.has(D.key(model.qualify(lr.go, ln))) && !inside.has(D.key(lr.go))) use.goes.add(D.key(lr.go));
      if (lr.returns) use.returns = true;
    }
  }
  for (const r of use.writes) if (!explicit.has(r)) use.implicitOnly.add(r);
  return use;
}

/** Every routine in the program, by name: UPPER -> { file, node, use }. Cached per change. */
function routineMap(project, file, buildOutline) {
  const root = project.rootOf(file);
  project._routineMaps = project._routineMaps || new Map();
  const hit = project._routineMaps.get(root);
  if (hit && hit.gen === project.gen) return hit.map;
  const map = new Map();
  for (const f of project.unit(file)) {
    for (const node of buildOutline(project, f)) {
      if (node.kind !== 'routine') continue;
      const entry = { file: f, node, use: null, key: project.key(f, node.name) };
      const key = (n) => project.key(f, n);
      map.set(key(node.name), entry);
      for (const c of node.children) if (!map.has(key(c.name))) map.set(key(c.name), Object.assign({ inner: true }, entry));
    }
  }
  for (const e of new Set(map.values())) if (!e.use) e.use = routineUse(project, e.file, e.node);
  for (const e of map.values()) if (!e.use) e.use = map.get(project.key(e.file, e.node.name)).use;
  project._routineMaps.set(root, { gen: project.gen, map });
  return map;
}

/** Registers changed by the routines this one calls or carries on into (not counting its own lines). */
function writesThroughCalls(map, name) {
  const k0 = map.has(name) ? name : name.toUpperCase();
  const seen = new Set([k0]);
  const out = new Set();
  const start = map.get(k0);
  if (!start) return out;
  const queue = [...start.use.calls, ...start.use.goes];
  while (queue.length) {
    const n = queue.pop();
    const e = map.get(n);
    if (!e) continue;
    const key = e.key || e.node.name.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    for (const r of e.use.writes) out.add(r);
    queue.push(...e.use.calls, ...e.use.goes);
  }
  return out;
}

/** "R0-R3, R6" */
function regList(set, D) {
  if (D.registers.parts && D.registers.parts.size) {
    // Z80: "B, C, BC" reads better as "BC", and H with L as "HL"
    set = new Set([...set].map(r => r.toUpperCase()));
    for (const [pair, halves] of D.registers.parts) {
      if (halves.length && halves.every(h => set.has(h))) set.add(pair);
      if (set.has(pair)) for (const h of halves) set.delete(h);
    }
  }
  const idx = [...set].map(r => D.registers.list.findIndex(n => n.toUpperCase() === r)).filter(i => i >= 0).sort((a, b) => a - b);
  if (D.registers.noRanges) return idx.map(i => D.registers.list[i]).join(', ');
  const parts = [];
  for (let i = 0; i < idx.length; i++) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1] === idx[j] + 1) j++;
    const a = D.registers.list[idx[i]], b = D.registers.list[idx[j]];
    parts.push(j - i >= 2 ? `${a}-${b}` : j > i ? `${a}, ${b}` : a);
    i = j;
  }
  return parts.join(', ');
}

/** Registers named anywhere in a block of comment lines, including ranges like R0-R3. */
function regsInText(lines, D) {
  const out = new Set();
  const list = D.registers.list.map(n => n.toUpperCase());
  const text = lines.join(' ');
  const rx = /\b(R\d{1,2})\s*(?:-|to|–)\s*(R\d{1,2})\b/gi;
  let m;
  while ((m = rx.exec(text))) {
    const a = list.indexOf(m[1].toUpperCase()), b = list.indexOf(m[2].toUpperCase());
    if (a >= 0 && b >= a) for (let i = a; i <= b; i++) out.add(list[i]);
  }
  for (const w of text.match(/\b[A-Za-z]{1,3}\d{0,2}'?\b/g) || []) if (list.includes(w.toUpperCase()) && /\d/.test(w)) out.add(w.toUpperCase());
  return out;
}

// ---------------------------------------------------------------------------
// Extra checks
// ---------------------------------------------------------------------------
function extraChecks(project, file, buildOutline) {
  const model = project.get(file);
  const D = model.D;
  const out = [];
  const link = D.checks.linkRegister ? D.checks.linkRegister.toUpperCase() : null;

  // 1. a space inside the operands (xas99 stops reading there)
  if (D.syntax.operandsEndAtSpace) {
    for (let ln = 0; ln < model.lines.length; ln++) {
      const pl = model.lines[ln];
      if (pl.spaceAt !== undefined) out.push({ line: ln, start: pl.spaceAt, end: pl.spaceAt + 1, severity: 'warning', message: 'There is a space in the middle of the operands. The assembler stops reading at the first space, so it will report a syntax error here. Remove the space after the comma.' });
    }
  }

  const nodes = buildOutline(project, file).filter(n => n.kind === 'routine');

  // 2. BL inside a routine that returns through the link register without saving it first
  if (link) {
    for (const node of nodes) {
      let saved = false;
      const lines = [];
      for (let ln = node.line; ln <= node.endLine; ln++) lines.push([ln, lineRegs(model.lines[ln], D, null), model.lines[ln]]);
      for (let i = 0; i < lines.length; i++) {
        const [ln, lr, pl] = lines[i];
        // "MOV R11,somewhere" (or any instruction that copies R11 out) counts as saving it
        if (!lr.returns && pl.operands.length >= 2 && pl.operands[0].text.trim().toUpperCase() === link && !lr.w.has(link)) saved = true;
        if (!lr.call || saved) continue;
        const later = lines.slice(i + 1).find(x => x[1].returns);
        if (!later) continue;
        // put back from somewhere before the return? then it was saved in a way we didn't spot
        const restored = lines.slice(i + 1, lines.indexOf(later)).some(x => x[1].w.has(link) && !x[1].implicitW.has(link));
        if (restored) continue;
        out.push({ line: ln, start: pl.mnem.start, end: pl.mnem.end, severity: 'warning', message: `${pl.mnem.upper} puts a new way back in ${link}, wiping the one ${node.name} needs for its own return on line ${later[0] + 1}. Save ${link} first (for example MOV ${link},@somewhere) and get it back before returning.` });
        break;
      }
    }
  }

  // 3. the comment above says what the routine uses, but the code changes something else too
  for (const node of nodes) {
    const doc = model.docAbove(node.line);
    // only a plain list counts ("Uses R0, R1, R2"), not a note such as "Uses R10 = count x 2"
    if (!doc.some(l => /(^|[.;:]\s+)\s*Uses\s+R\d+\s*(,|-|and\b|only\b|\.|\(|$)/i.test(l))) continue;
    const said = regsInText(doc, D);
    if (!said.size) continue;
    const use = routineUse(project, file, node);
    const missing = new Set([...use.writes].filter(r => !said.has(r) && !use.implicitOnly.has(r) && r !== link));
    if (!missing.size) continue;
    out.push({ line: node.line, start: node.start, end: node.end, severity: 'info', message: `The comment above lists the registers ${node.name} uses, but the code also changes ${regList(missing, D)}.` });
  }

  // 4. a test the instruction can't do (JR PE,label on the Z80)
  for (let ln = 0; ln < model.lines.length; ln++) {
    const pl = model.lines[ln];
    const ins = pl.mnem ? D.instr(pl.mnem.upper) : null;
    if (!ins || !ins.allowedConditions) continue;
    const kinds = opKinds(ins, pl.operands.length);
    if (!kinds) continue;
    kinds.forEach((k, i) => {
      if (k !== 'cc') return;
      const c = pl.operands[i].text.trim().toUpperCase();
      if (!D.conditions.has(c) || ins.allowedConditions.includes(c)) return;
      const far = [...D.instructions.values()].find(x => x.far);
      out.push({ line: ln, start: pl.operands[i].start, end: pl.operands[i].end, severity: 'warning', message: `${pl.mnem.upper} can only test ${ins.allowedConditions.join(', ').replace(/, ([^,]*)$/, ' or $1')}, not ${c}.${far ? ` Use ${far.key} ${c},... instead.` : ''}` });
    });
  }

  // 5. things that need addresses
  const L = project.layout(file);
  const rec = L && L.ok ? L.files.get(file) : null;
  if (rec && D.sizing) {
    for (let ln = 0; ln < model.lines.length; ln++) for (const pl of statements(model.lines[ln])) {
      if (rec.approx[ln] || (rec.skipped && rec.skipped[ln])) continue;
      const ins = pl.mnem ? D.instr(pl.mnem.upper) : null;
      // where this statement starts (a line can hold several: "DEX:BNE loop")
      const pa = pl.part !== undefined && rec.partAddr ? rec.partAddr.get(ln) : null;
      const at = pa && pa[pl.part] ? pa[pl.part].addr : rec.addr[ln];

      // 4a. a short jump that can't reach
      const kinds = ins ? opKinds(ins, pl.operands.length) : null;
      const ti = kinds ? kinds.lastIndexOf('t') : -1;
      if (ins && ins.local && (pl.operands.length === 1 || (ti >= 0 && ti === pl.operands.length - 1))) {
        const here = { off: at, reloc: rec.reloc[ln] };
        const top = pl.operands[pl.operands.length === 1 ? 0 : ti];
        const t = project.evalFull(file, model.qualifyText(top.text, ln), here);
        if (t) {
          const from = at + (rec.reloc[ln] ? L.base : 0) + (D.sizing.jumpFrom || D.sizing.base);
          const steps = (t.value - from) / D.sizing.jumpUnit;
          if (steps > D.sizing.jumpForward || steps < -D.sizing.jumpBack) {
            const far = D.directives.size && [...D.instructions.values()].find(i => i.far);
            const unit = D.sizing.jumpUnit === 1 ? 'bytes' : 'words';
            const pre = D.syntax.addressPrefix || '';
            const farText = far ? `${far.key} ${pre}${top.text}` : '';
            let advice = far ? (ins.cond ? ` Swap it for the opposite test, jumping over a "${farText}".` : ` Use ${farText} instead.`) : '';
            if (ins.farText) advice = ' ' + ins.farText.replace(/\{target\}/g, top.text);
            out.push({ line: ln, start: top.start, end: top.end, severity: 'warning', message: `${top.text} is too far away for ${pl.mnem.upper}: it is ${Math.abs(Math.round(steps))} ${unit} ${steps > 0 ? 'ahead' : 'back'}, and a short jump only reaches ${D.sizing.jumpForward} ahead or ${D.sizing.jumpBack} back.${advice}` });
          }
        }
      }

      // 4b. a label on its own line at an odd address, with code or word data after it
      if (D.sizing.evenAlign !== false && pl.label && !pl.mnem && (rec.addr[ln] & 1)) {
        for (let k = ln + 1; k < model.lines.length && k < ln + 30; k++) {
          const nx = model.lines[k];
          if (!nx.mnem) continue;
          const ni = D.instr(nx.mnem.upper), nd = D.directive(nx.mnem.upper);
          if (ni || (nd && nd.kind === 'data' && nd.unit >= 2)) {
            out.push({ line: ln, start: pl.label.start, end: pl.label.end, severity: 'warning', message: `${pl.label.name} lands on an odd address, but the ${ni ? 'code' : 'data'} after it starts one byte later (it must start on an even address). The label points one byte too early. Put EVEN on the line above it.` });
          }
          break;
        }
      }
    }

    // 4c. a whole-word instruction (or a call) aimed at a label on an odd address
    const pre = D.syntax.addressPrefix;
    for (const r of model.refs) {
      if (!r.asAddress || D.sizing.evenAlign === false) continue;
      const ins = D.instr(r.mnem);
      if (!ins || !(ins.size === 'word' || ins.call || ins.far)) continue;
      const pl = model.lines[r.line];
      const op = pl.operands.find(o => r.start >= o.start && r.end <= o.end);
      if (!op || op.text.toUpperCase() !== (pre + r.name).toUpperCase()) continue;
      const a = project.labelAddress(file, r.name);
      if (!a || a.approx || a.equ || !(a.addr & 1)) continue;
      const message = ins.call || ins.far
        ? `${r.name} is on an odd address. Code always starts on even addresses, so ${r.mnem} would land one byte before it. Put EVEN before ${r.name}.`
        : `${r.name} is on an odd address. ${r.mnem} works on whole words, which always start on even addresses, so it would use the byte before ${r.name}. Put EVEN before ${r.name}, or use the byte version of the instruction.`;
      out.push({ line: r.line, start: r.start, end: r.end, severity: 'warning', message });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sizes and callers
// ---------------------------------------------------------------------------
function routineSize(project, file, node) {
  const a = project.lineInfo(file, node.line);
  const b = project.lineInfo(file, node.endLine);
  if (!a || !b || a.approx || b.approx || a.reloc !== b.reloc) return null;
  return { addr: a.addr, size: b.after - a.addr, reloc: a.reloc };
}

/** Whole-program numbers for the status bar: { used, start, end, room, regionText } or null. */
function programSize(project, file) {
  const L = project.layout(file);
  if (!L || !L.ok) return null;
  const model = project.get(file);
  const D = model.D;
  let start, end;
  if (L.relocEnd > 0) { start = L.base; end = L.base + L.relocEnd; }
  else if (L.absMin !== null) { start = L.absMin; end = L.absMax; }
  else return null;
  const region = D.region(start);
  return { used: end - start, start, end, room: region ? region.to + 1 - start : null, regionText: region ? region.text : '', approx: L.approx, reloc: L.relocEnd > 0 };
}

function callers(project, file, name) {
  const D = project.get(file).D;
  const refs = project.findRefs(file, name).filter(r => !!D.instr(r.mnem));
  const calls = refs.filter(r => { const i = D.instr(r.mnem); return i.call || i.callOther; });
  return { refs, calls };
}

// ---------------------------------------------------------------------------
// Pictures
// ---------------------------------------------------------------------------
// A block is drawn as a picture when its label or the comments around it say it is one.
const PICTURE_LABEL = /(^|_)(PAT|PATS|SPR|SPRITE|SPRITES|FONT|GFX|TILE|TILES|ICON|SHAPE|BITMAP|CHARSET|GLYPH)(_|\d|$)|PAT\d*$/i;
const PICTURE_WORDS = /\b(pattern|drawing|picture|sprite|bitmap|pixel|shape|icon)s?\b|[X.]{8}/i;

/**
 * The run of BYTE / DATA lines a line belongs to, or null:
 * { label, labelLine, firstLine, endLine, bytes[], lineStart: Map(line -> byte index), hint,
 *   items: [{ line, start, end, text, unit, at, value, style }], littleEndian, editable, why }
 * items say where each number sits on its line, so an edited picture can be written back.
 */
function dataBlock(project, file, line) {
  const model = project.get(file);
  const D = model.D;
  const isData = (pl) => { const d = pl.mnem ? D.directive(pl.mnem.upper) : null; return !!(d && d.kind === 'data' && (d.unit === 1 || d.unit === 2)); };
  // walk up to the label that starts this block
  let top = line;
  for (let k = line; k >= 0 && k > line - 400; k--) {
    const pl = model.lines[k];
    if (pl.label) { top = k; break; }
    if (pl.mnem && !isData(pl)) return null;
    if (!pl.mnem && !pl.comment && k !== line) { top = k + 1; break; }
    top = k;
  }
  const first = model.lines[top];
  const little = !!D.syntax.littleEndian;
  const out = { label: first.label ? first.label.name : null, labelLine: top, firstLine: -1, endLine: top, bytes: [], lineStart: new Map(), hint: '', items: [], littleEndian: little, editable: true, why: '' };
  const SP = sprites();
  out.hint = model.docAbove(top).join(' ') + ' ' + model.trailingComment(top);
  for (let k = top; k < model.lines.length && out.bytes.length <= 4096; k++) {
    const pl = model.lines[k];
    if (k > top && pl.label) break;
    if (!pl.mnem) { if (!pl.comment && k > top) break; if (pl.comment) out.hint += ' ' + pl.comment.text; continue; }
    if (!isData(pl)) break;
    if (out.firstLine < 0) out.firstLine = k;
    out.endLine = k;
    if (pl.parts && pl.parts.length > 1 && out.editable) { out.editable = false; out.why = `line ${k + 1} has more than one statement on it`; }
    const unit = D.directive(pl.mnem.upper).unit;
    out.lineStart.set(k, out.bytes.length);
    for (const op of pl.operands) {
      const v = project.eval(file, op.text);
      if (v === null) return null;
      const value = unit === 2 ? v & 0xFFFF : v & 0xFF;
      const style = SP.numberStyle(op.text, D);
      const plain = style && (parseInt(op.text.trim().slice(style.prefix.length, op.text.trim().length - style.suffix.length), style.base) & (unit === 2 ? 0xFFFF : 0xFF)) === value;
      if (!plain && out.editable) { out.editable = false; out.why = `"${op.text}" on line ${k + 1} is worked out from a name or a sum, not written as a plain number`; }
      out.items.push({ line: k, start: op.start, end: op.end, text: op.text, unit, at: out.bytes.length, value, style: plain ? style : null });
      if (unit === 2) { if (little) out.bytes.push(value & 0xFF, value >> 8); else out.bytes.push(value >> 8, value & 0xFF); }
      else out.bytes.push(value);
    }
  }
  return out.bytes.length ? out : null;
}

// lib/sprites.js, loaded on first use (it is only needed for pictures)
let spritesLib = null;
const sprites = () => spritesLib || (spritesLib = require('./sprites'));

function drawRows(rows) {
  return rows.map(r => r.map(bit => (bit ? '██' : '··')).join('')).join('\n');
}
function char8(bytes, at) {
  const rows = [];
  for (let y = 0; y < 8; y++) { const b = bytes[at + y] || 0; const row = []; for (let x = 7; x >= 0; x--) row.push((b >> x) & 1); rows.push(row); }
  return rows;
}
/** A 16x16 sprite is 4 characters: top-left, bottom-left, top-right, bottom-right. */
function sprite16(bytes, at) {
  const tl = char8(bytes, at), bl = char8(bytes, at + 8), tr = char8(bytes, at + 16), br = char8(bytes, at + 24);
  const rows = [];
  for (let y = 0; y < 8; y++) rows.push(tl[y].concat(tr[y]));
  for (let y = 0; y < 8; y++) rows.push(bl[y].concat(br[y]));
  return rows;
}

/** Markdown showing the data around `line` as a picture, or null. mode: 'auto' | 'always' | 'never'. */
function pictureAt(project, file, line, mode) {
  if (mode === 'never') return null;
  const blk = dataBlock(project, file, line);
  if (!blk) return null;
  const at = blk.lineStart.has(line) ? blk.lineStart.get(line) : 0;
  // marked with @sprite: draw it the way the marker says
  const SP = sprites();
  const mark = SP.markerFor(project.get(file), blk.labelLine, blk.firstLine);
  if (mark) {
    const pic = SP.pictureOf(project, file, blk, mark.spec);
    if (pic.error) return [`**As a picture:** ${pic.error}`];
    const f = Math.min(Math.floor(at / pic.shape.stride), pic.frames.length - 1);
    const of = pic.frames.length > 1 ? ` — picture ${f + 1} of ${pic.frames.length}` : '';
    return [`**As a picture** (${pic.shape.name})${of}:\n\n\`\`\`text\n${SP.drawText(pic.frames[f], pic.shape)}\n\`\`\``];
  }
  if (blk.bytes.length < 8 || blk.bytes.length % 8) return null;
  if (mode !== 'always' && !PICTURE_LABEL.test(blk.label || '') && !PICTURE_WORDS.test(blk.hint)) return null;
  const parts = [];
  const chars = blk.bytes.length / 8;
  const c = Math.floor(at / 8);
  parts.push(`**As a picture** — character ${c + 1} of ${chars} in ${blk.label || 'this block'} (8 bytes each):\n\n\`\`\`text\n${drawRows(char8(blk.bytes, c * 8))}\n\`\`\``);
  if (blk.bytes.length % 32 === 0 && D16(project, file)) {
    const s = Math.floor(at / 32);
    parts.push(`As a 16x16 sprite — sprite ${s + 1} of ${blk.bytes.length / 32} (32 bytes each):\n\n\`\`\`text\n${drawRows(sprite16(blk.bytes, s * 32))}\n\`\`\``);
  }
  return parts;
}
/** The TI's way of storing a 16x16 sprite only makes sense to guess at on a chip that stores them that way. */
function D16(project, file) { const S = project.get(file).D.sprites; return !S || S.order === 'columns'; }

/** A quick first look, before working the block out: does its name or comment say picture? */
function pictureHint(label, text) { return PICTURE_LABEL.test(label || '') || PICTURE_WORDS.test(text || ''); }

/** Does a block look like a picture (by its name or comments)? Used to offer "Edit as a picture". */
function looksLikePicture(blk) {
  return !!blk && blk.bytes.length >= 8 && (PICTURE_LABEL.test(blk.label || '') || PICTURE_WORDS.test(blk.hint));
}

// ---------------------------------------------------------------------------
// Is this number on its way to a chip?
// ---------------------------------------------------------------------------
/**
 * After "LI Rn,value", look a few lines down for the value being sent to a known port.
 * Returns the decoded sentence or null.
 */
function decodeLoaded(project, file, line, reg, word) {
  const model = project.get(file);
  const D = model.D;
  if (!D.ports.size && !D.portSymbols.size) return null;
  const pre = D.syntax.addressPrefix;
  const R = reg.toUpperCase();
  let sends = 0, kind = null, swapped = false, firstByte = null;
  for (let k = line + 1; k < model.lines.length && k <= line + 8; k++) {
    const pl = model.lines[k];
    if (!pl.mnem) continue;
    const ins = D.instr(pl.mnem.upper);
    if (!ins) continue;
    const ops = pl.operands.map(o => o.text.trim());
    // a helper called with the value in this register (BLWP @VWTR)
    if (ins.callOther && ops[0] && ops[0].startsWith(pre)) {
      const sym = D.portSymbols.get(ops[0].slice(pre.length).toUpperCase());
      if (sym && R === 'R0') return decode(sym.text, word, word >> 8, true);
      break;
    }
    if (ops[0] && ops[0].toUpperCase() === R && ins.size === 'byte' && ops[1] && ops[1].startsWith(pre) && ins.rw && ins.rw[1] === 'w') {
      const v = project.eval(file, ops[1].slice(pre.length));
      const p = v === null ? null : D.ports.get(v);
      if (!p) break;
      kind = p;
      const sent = swapped ? word & 0xFF : word >> 8;
      if (sends === 0) firstByte = sent;
      sends++;
      if (sends === 2) return decode(kind, word, firstByte, true);
      continue;
    }
    if (ops.length === 1 && ops[0].toUpperCase() === R && pl.mnem.upper === 'SWPB') { swapped = !swapped; continue; }
    // anything else that changes the register ends the trail
    const lr = lineRegs(pl, D, null);
    if (lr.w.has(R) || lr.call || lr.returns || (ins.local && !ins.cond)) break;
  }
  return kind && firstByte !== null ? decode(kind, word, firstByte, false) : null;
}

/** Is the data block holding `line` sent byte by byte to a port? Returns the decoder name or null. */
function blockPort(project, file, blk) {
  if (!blk || !blk.label) return null;
  const model = project.get(file);
  const D = model.D;
  if (!D.ports.size) return null;
  const pre = D.syntax.addressPrefix;
  for (const r of project.findRefs(file, blk.label)) {
    const m = project.get(r.file);
    const pl = m.lines[r.line];
    if (!pl.mnem || pl.operands.length !== 2 || !D.isRegister(pl.operands[0].text.trim())) continue;
    const R = pl.operands[0].text.trim().toUpperCase();
    for (let k = r.line + 1; k < m.lines.length && k <= r.line + 8; k++) {
      const nx = m.lines[k];
      if (!nx.mnem || nx.operands.length !== 2) continue;
      const ins = D.instr(nx.mnem.upper);
      if (!ins || ins.size !== 'byte') continue;
      const src = nx.operands[0].text.trim().toUpperCase();
      const dst = nx.operands[1].text.trim();
      if ((src === '*' + R + '+' || src === '*' + R) && dst.startsWith(pre)) {
        const v = project.eval(r.file, dst.slice(pre.length));
        const p = v === null ? null : D.ports.get(v);
        if (p) return p;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Z80 ports: OUT (port),A and IN A,(port)
// ---------------------------------------------------------------------------
/** The port number an IN or OUT operand reaches: ($FE), (254), or (C) with BC loaded a few lines above. */
function portNumber(project, file, line, opText) {
  const model = project.get(file);
  const D = model.D;
  const inner = opText.trim().replace(/^\((.*)\)$/s, '$1').trim();
  if (!D.isRegister(inner)) return project.eval(file, inner);
  for (let k = line - 1; k >= 0 && k >= line - 10; k--) {
    const pl = model.lines[k];
    if (!pl.mnem) { if (pl.label) break; continue; }
    const lr = lineRegs(pl, D, null);
    if (pl.mnem.upper === 'LD' && pl.operands.length === 2 && pl.operands[0].text.trim().toUpperCase() === 'BC') return project.eval(file, pl.operands[1].text);
    if (lr.w.has('BC') || lr.w.has('B') || lr.w.has('C') || lr.call || lr.returns || lr.go) break;
  }
  return null;
}

/** Is this an IN or OUT line? Returns { port: operand index, reg: operand index } or null. */
function portLine(pl, D) {
  const ins = pl.mnem ? D.instr(pl.mnem.upper) : null;
  const kinds = ins ? opKinds(ins, pl.operands.length) : null;
  if (!kinds || kinds.length !== 2) return null;
  if (kinds[0] === 'p') return { port: 0, reg: 1, out: true };
  if (kinds[1] === 'p') return { port: 1, reg: 0, out: false };
  return null;
}

/**
 * After "LD A,2", look a few lines down for A being sent to a known port (OUT ($FE),A),
 * or used as the top half of the port number when reading (IN A,($FE) reads the keyboard).
 * Returns the decoded sentence or null.
 */
function decodePortValue(project, file, line, reg, value) {
  const model = project.get(file);
  const D = model.D;
  if (!D.ioPorts || !D.ioPorts.size) return null;
  const R = reg.toUpperCase();
  for (let k = line + 1; k < model.lines.length && k <= line + 8; k++) {
    const pl = model.lines[k];
    if (!pl.mnem) { if (pl.label) return null; continue; }
    const pp = portLine(pl, D);
    if (pp) {
      const opText = pl.operands[pp.port].text;
      const isC = D.isRegister(opText.trim().replace(/^\((.*)\)$/s, '$1').trim());
      const p = D.ioPort(portNumber(project, file, k, opText));
      if (p && pp.out && pl.operands[pp.reg].text.trim().toUpperCase() === R && p.write) return decode(p.write, value, value, false);
      if (p && !pp.out && !isC && R === 'A' && pl.operands[pp.reg].text.trim().toUpperCase() === 'A' && p.readHigh) return decode(p.readHigh, value, value, false);
    }
    const lr = lineRegs(pl, D, null);
    if (lr.w.has(R) || lr.call || lr.returns || lr.go) return null;
  }
  return null;
}

/** On an OUT line: what the register sent was set to just above, decoded. Or null. */
function decodePortSend(project, file, line) {
  const model = project.get(file);
  const D = model.D;
  const pl = model.lines[line];
  const pp = portLine(pl, D);
  if (!pp || !pp.out) return null;
  const R = pl.operands[pp.reg].text.trim().toUpperCase();
  if (!D.isRegister(R)) {
    // OUT (C),0 and the like: a number sent straight out
    const v = project.eval(file, pl.operands[pp.reg].text);
    const p = D.ioPort(portNumber(project, file, line, pl.operands[pp.port].text));
    return v !== null && p && p.write ? decode(p.write, v, v, false) : null;
  }
  for (let k = line - 1; k >= 0 && k >= line - 8; k--) {
    const q = model.lines[k];
    if (!q.mnem) { if (q.label) return null; continue; }
    if (q.mnem.upper === 'LD' && q.operands.length === 2 && q.operands[0].text.trim().toUpperCase() === R) {
      const v = project.eval(file, q.operands[1].text);
      return v === null ? null : decodePortValue(project, file, k, R, v);
    }
    const lr = lineRegs(q, D, null);
    if (lr.w.has(R) || lr.call || lr.returns || lr.go) return null;
  }
  return null;
}

module.exports = { dataAfterLines, portNumber, portLine, decodePortValue, decodePortSend, implicitFor, lineRegs, routineUse, routineMap, writesThroughCalls, regList, regsInText, extraChecks, routineSize, programSize, callers, dataBlock, pictureAt, looksLikePicture, pictureHint, decodeLoaded, blockPort, decode };
