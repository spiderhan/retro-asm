'use strict';
// Works out where every line of a program ends up in memory, and how many bytes it takes.
// It follows the same rules as the assembler for each chip: on the TMS9900, instructions and
// word data start on even addresses and BYTE and TEXT don't; on the 6502 a zero-page address
// makes a shorter instruction; on the Z80, IX and IY cost an extra byte. An include line
// (COPY, INCLUDE, #import) pulls the other file in at that point.
// Only dialects with a "sizing" section can be laid out.

const { evalExpr, scan, opKinds, statements } = require('./parser');

function textLength(opText, D) {
  const toks = scan(opText, 0, D);
  if (toks.length === 1 && toks[0].type === 'str') return (toks[0].body || '').replace(/''/g, "'").length;
  if (toks.length === 1 && toks[0].type === 'num' && toks[0].radix === 16) return Math.ceil(toks[0].digits / 2);
  if (toks.length === 2 && toks[0].text === '-' && toks[1].type === 'str') return (toks[1].body || '').replace(/''/g, "'").length;
  return null;
}

/**
 * Lay out the program that starts at `root`.
 * Returns { files: Map(file -> {addr[], after[], size[], reloc[], approx[], dummy[]}),
 *           symbols: Map(UPPER -> {off, reloc, approx, file, line}), relocEnd, absolute, approx, ok }
 * Addresses are offsets for relocatable code (add the load address) and real addresses after AORG.
 */
/**
 * How many bytes an instruction takes, for chips where that depends on how the operand is
 * written (the 6502: "#5" is 2 bytes, "$D020" is 3, "$FB" is 2 because it is in the first 256).
 * The chip file lists the ways of writing an operand ("forms"), first match wins.
 */
function instructionBytes(ins, pl, D, ev) {
  const joined = pl.operands.map(o => o.text.trim()).join(',').replace(/\s+/g, '');
  const mnem = pl.mnem.upper;
  // a rule can be kept to some instructions ("only") or skip some ("not")
  const applies = (f) => (!f.only || f.only.includes(mnem)) && (!f.not || !f.not.includes(mnem));
  let size = ins.bytes || null;
  if (size === null) {
    for (const f of D.sizing.formList) {
      if (!applies(f)) continue;
      const m = f.rx.exec(joined);
      if (!m) continue;
      const zp = f.zeroPage;
      size = f.bytes;
      if (zp && !ins.noZeroPage && (!zp.only || zp.only.includes(mnem))) {
        const v = ev(m[zp.value || 1]);
        if (v !== null && v >= 0 && v <= 0xFF) size = zp.bytes;
      }
      break;
    }
  }
  if (size === null) return null;
  // bytes added on top, whatever the form (the Z80's IX and IY need an extra byte in front)
  for (const x of D.sizing.extraList || []) if (applies(x) && x.rx.test(joined)) size += x.add;
  return size;
}

/**
 * Bytes taken by one data, text or gap line ("EQUB 1,2,3", "SKIP 4"), or null if unknown.
 * Instructions are sized by the caller.
 */
function directiveBytes(dir, pl, D, ev) {
  let size = 0;
  switch (dir.kind) {
    case 'data':
      // DEFB "text",0: the text counts its letters, anything else one unit
      if (dir.mixed) for (const op of pl.operands) size += (/^\s*["']/.test(op.text) ? textLength(op.text, D) : null) || (dir.unit || 1);
      else size = pl.operands.length * (dir.unit || 1);
      return size;
    case 'text': {
      for (const op of pl.operands) {
        let len = textLength(op.text, D);
        if (len === null && dir.mixed && !/^\s*["']/.test(op.text)) len = 1;     // DEFM "Hi",13: a number between the words is one byte
        if (len === null) return null;
        size += len;
      }
      if (dir.lengthByte) size += 1;
      return size;
    }
    case 'space': {
      const v = pl.operands[0] ? ev(pl.operands[0].text) : null;
      return v === null || v < 0 ? null : v;
    }
  }
  return 0;
}

/**
 * Lay out the program. Like a two-pass assembler: if a name was used before the line that sets it
 * and that decided an instruction's size (the 6502's zero page), go round again knowing it.
 */
function buildLayout(project, root, fileSize) {
  const first = layoutPass(project, root, fileSize, null);
  if (!first.ok || !first.forwardZp) return first;
  return layoutPass(project, root, fileSize, first.symbols);
}

function layoutPass(project, root, fileSize, prev) {
  const out = { files: new Map(), symbols: new Map(), relocEnd: 0, absMin: null, absMax: null, approx: false, ok: false, root };
  const rootModel = project.get(root);
  if (!rootModel || !rootModel.D.sizing) return out;
  out.ok = true;
  const st = { lc: 0, reloc: true, dummy: false, approx: false, savedReloc: 0, ended: false };
  const seen = new Set();
  const macroDefs = new Map();     // BeebAsm: macro name -> { model, from, to, params }, for working out a call's size

  const resolver = (file, guard) => (name) => {
    const u = project.key(file, name);
    const s = out.symbols.get(u);
    if (s) return s.off;
    if (prev) { const p = prev.get(u); if (p && !p.equ) return p.off; }
    if (guard.has(u)) return null;
    const def = project.findDefs(file, name).find(d => d.kind === 'equ');
    if (!def || def.expr === null) {
      // a name from a { } scope that is never assembled (inside IF 0): BeebAsm uses the one outside
      const outer = /^(.*)__B\d+$/.exec(u);
      if (outer && prev && !guard.has(u)) { guard.add(u); const v = resolver(file, guard)(outer[1]); guard.delete(u); return v; }
      const k = project.get(file) && project.get(file).D.knownSymbols.get(String(u).toUpperCase()); return k && typeof k.value === 'number' ? k.value : null;
    }
    guard.add(u);
    const m = project.get(def.file);
    const v = evalExpr(def.expr, m.D, resolver(file, guard));
    guard.delete(u);
    return v;
  };

  /** How many bytes a macro call puts in, with the values it is given standing in for its names; null if unknown. */
  function macroBytes(pl, D, ev, depth) {
    const mac = macroDefs.get(pl.mnem.upper);
    if (!mac || depth > 8) return null;
    const args = new Map();
    mac.params.forEach((p, i) => { if (pl.operands[i]) args.set(p, pl.operands[i].text); });
    const sub = (text) => {
      const t = text.replace(/(?<![A-Za-z0-9_&$%'"])[A-Za-z_][A-Za-z0-9_]*%?/g, (w) => (args.has(w.toUpperCase()) ? '(' + args.get(w.toUpperCase()) + ')' : w));
      return ev(t);
    };
    const list = [];
    for (let ln = mac.from; ln <= mac.to; ln++) for (const q of statements(mac.model.lines[ln])) if (q.mnem) list.push(q);
    const r = rangeBytes(list, 0, list.length, D, sub, depth);
    return r === null ? null : r;
  }

  /** `ev`, with one name (a FOR counter) standing for a number. */
  function withValue(ev, name, value) {
    const rx = new RegExp(`(?<![A-Za-z0-9_&$%'"])${name.replace(/[%$]/g, '\\$&')}(?![A-Za-z0-9_%])`, 'g');
    return (text) => ev(text.replace(rx, `(${value})`));
  }

  /** The values a FOR counter takes ("FOR n, 0, 7": 0 to 7), or null if they can't be worked out (or are too many). */
  function forValues(q, ev) {
    const [a, b, c] = [1, 2, 3].map(k => (q.operands[k] ? ev(q.operands[k].text) : k === 3 ? 1 : null));
    if (a === null || b === null || !c) return null;
    const out = [];
    for (let v = a; c > 0 ? v <= b + 1e-9 : v >= b - 1e-9; v += c) { out.push(v); if (out.length > 4096) return null; }
    return out;
  }

  /**
   * Bytes put in by statements list[from..to), following IF (when the test can be worked out, or
   * when every branch is the same size), FOR (when the count is known) and macro calls.
   * Null when it can't be worked out.
   */
  function rangeBytes(list, from, to, D, ev, depth) {
    let total = 0;
    for (let i = from; i < to; i++) {
      const q = list[i];
      const qi = D.instr(q.mnem.upper), qd = D.directive(q.mnem.upper);
      if (qd && qd.kind === 'if') {
        const blk = ifBlock(list, i, D);
        if (!blk) return null;
        const n = ifBytes(list, blk, D, ev, depth);
        if (n === null) return null;
        total += n;
        i = blk.end;
        continue;
      }
      if (qd && qd.kind === 'for') {
        const end = matching(list, i, D, 'for', 'next');
        if (end < 0) return null;
        const values = forValues(q, ev);
        if (values === null) return null;
        const name = (q.operands[0] ? q.operands[0].text.trim() : '');
        for (const v of values) {
          const body = rangeBytes(list, i + 1, end, D, /^[A-Za-z_][A-Za-z0-9_]*%?$/.test(name) ? withValue(ev, name, v) : ev, depth);
          if (body === null) return null;
          total += body;
        }
        i = end;
        continue;
      }
      let n = null;
      if (qi) n = D.sizing.forms ? instructionBytes(qi, q, D, ev) : null;
      else if (qd) n = qd.conditional || qd.alignTo || ['origin', 'for', 'next', 'if', 'elif', 'else', 'endif', 'include', 'macro', 'skipto', 'end'].includes(qd.kind) ? null : directiveBytes(qd, q, D, ev);
      else if (macroDefs.has(q.mnem.upper)) n = macroBytes(q, D, ev, depth + 1);
      if (n === null) return null;
      total += n;
    }
    return total;
  }

  /** The statement that closes the block opened at list[i] ("for" ... "next"), or -1. */
  function matching(list, i, D, open, close) {
    let depth = 0;
    for (let k = i; k < list.length; k++) {
      const d = D.directive(list[k].mnem.upper);
      if (!d) continue;
      if (d.kind === open) depth++;
      else if (d.kind === close && --depth === 0) return k;
    }
    return -1;
  }

  /** IF at list[i]: its branches [{ test, from, to }] and the ENDIF, or null if it doesn't end. */
  function ifBlock(list, i, D) {
    const branches = [{ test: list[i], from: i + 1, to: -1 }];
    let depth = 0;
    for (let k = i; k < list.length; k++) {
      const d = D.directive(list[k].mnem.upper);
      if (!d) continue;
      if (d.kind === 'if') { depth++; continue; }
      if (depth > 1) { if (d.kind === 'endif') depth--; continue; }
      if (d.kind === 'elif' || d.kind === 'else') {
        branches[branches.length - 1].to = k;
        branches.push({ test: d.kind === 'elif' ? list[k] : null, from: k + 1, to: -1 });
      } else if (d.kind === 'endif') {
        branches[branches.length - 1].to = k;
        if (branches[branches.length - 1].test) branches.push({ test: null, from: k, to: k });   // no ELSE: an empty one
        return { branches, end: k };
      }
    }
    return null;
  }

  /** Bytes from an IF block: the branch whose test is true, or the size every possible branch shares. */
  function ifBytes(list, blk, D, ev, depth) {
    const sizes = [];
    for (const b of blk.branches) {
      const v = b.test ? ev(b.test.operands.map(o => o.text).join(',')) : 1;
      if (v === 0) continue;                                  // this one is false: try the next
      const n = rangeBytes(list, b.from, b.to, D, ev, depth);
      if (n === null) return null;
      if (v !== null) { sizes.push(n); break; }               // true: this is the one
      sizes.push(n);                                          // can't tell: it might be this one
    }
    return sizes.length && sizes.every(x => x === sizes[0]) ? sizes[0] : null;
  }

  function visit(file, depth) {
    const model = project.get(file);
    if (!model || seen.has(file) || depth > 12) { st.approx = true; return; }
    seen.add(file);
    const D = model.D;
    const n = model.lines.length;
    const rec = { addr: new Array(n).fill(null), after: new Array(n).fill(null), size: new Array(n).fill(0), reloc: new Array(n).fill(true), approx: new Array(n).fill(false), dummy: new Array(n).fill(false), skipped: new Array(n).fill(false), partAddr: new Map() };
    out.files.set(file, rec);
    let curLn = 0;
    const bound = [];      // FOR counters being laid out: { rx, value }
    const ev = (text) => {
      for (const b of bound) text = text.replace(b.rx, `(${b.value})`);
      return evalExpr(model.qualifyText(text, curLn), D, resolver(file, new Set()), st.lc);
    };
    // a macro's body is a { ... } block (KickAssembler), or runs to ENDM / ENDMACRO
    const braceMacros = D.syntax.braceBlocks && D.syntax.braceMacros !== false;
    let inMacro = false, macroDepth = 0, macroOpened = false, macroRec = null;
    const conds = [];      // IF ... ELSE ... ENDIF: { active, done, outer }
    const loops = [];      // FOR ... NEXT: { from, count, skip }
    const active = () => conds.every(c => c.active);
    // an IF that can't be worked out still leaves the addresses right if every branch is the same size
    const sameSizeBranches = (ln0, pl0) => {
      const list = [];
      let depth = 0, started = false, done = false;
      for (let k = ln0; k < n && !done && list.length < 4000; k++) {
        for (const q of statements(model.lines[k])) {
          if (!started && q !== pl0) continue;
          started = true;
          if (!q.mnem) continue;
          list.push(q);
          const d = D.directive(q.mnem.upper);
          if (d && d.kind === 'if') depth++;
          else if (d && d.kind === 'endif' && --depth === 0) { done = true; break; }
        }
      }
      const blk = done ? ifBlock(list, 0, D) : null;
      if (!blk) return false;
      const sizes = blk.branches.map(b => rangeBytes(list, b.from, b.to, D, ev, 0));
      return sizes.every(x => x !== null && x === sizes[0]);
    };

    for (let ln = 0; ln < n; ln++) {
      const line = model.lines[ln];
      curLn = ln;
      if (st.ended) { rec.addr[ln] = st.lc; rec.after[ln] = st.lc; rec.reloc[ln] = st.reloc; rec.approx[ln] = st.approx; continue; }
      const parts = statements(line);
      let first = true;
      for (const pl of parts) {
      const ins = pl.mnem ? D.instr(pl.mnem.upper) : null;
      const dir = pl.mnem ? D.directive(pl.mnem.upper) : null;
      let size = 0;
      let labelAddr = null;
      const mark = (startAt, bytes) => {
        // note where this statement sits; a line's address is that of its first statement
        if (first) { rec.addr[ln] = startAt; rec.reloc[ln] = st.reloc; rec.dummy[ln] = st.dummy; first = false; }
        rec.size[ln] += bytes;
        rec.approx[ln] = st.approx;
        rec.after[ln] = st.lc;
        if (parts.length > 1) { if (!rec.partAddr.has(ln)) rec.partAddr.set(ln, []); rec.partAddr.get(ln)[pl.part] = { addr: startAt, size: bytes, approx: st.approx }; }
      };

      if (inMacro) {
        if (braceMacros) {
          // the body of a macro is the { ... } block after it
          if (line.open) macroOpened = true;
          macroDepth += (line.open || 0) - (line.close || 0);
          if (macroOpened && macroDepth <= 0) inMacro = false;
        } else if (pl.mnem && (pl.mnem.upper === '.ENDM' || (D.directive(pl.mnem.upper) || {}).kind === 'endmacro')) { inMacro = false; if (macroRec) macroRec.to = ln - 1; }
        const keep = st.approx; st.approx = true; mark(st.lc, 0); st.approx = keep;
        continue;
      }

      // IF / ELIF / ELSE / ENDIF: follow the branch that will really be assembled, when the test can be worked out
      if (dir && (dir.kind === 'if' || dir.kind === 'elif' || dir.kind === 'else' || dir.kind === 'endif')) {
        const test = () => {
          const v = pl.operands.length ? ev(pl.operands.map(o => o.text).join(',')) : null;
          if (v === null && !sameSizeBranches(ln, pl)) st.approx = true;
          return v === null ? true : v !== 0;
        };
        if (dir.kind === 'if') {
          const outer = active();
          const on = outer ? test() : false;
          conds.push({ active: on, done: on || !outer, outer });
        } else if (conds.length) {
          const c = conds[conds.length - 1];
          if (dir.kind === 'endif') conds.pop();
          else if (!c.outer) c.active = false;
          else if (dir.kind === 'else') { c.active = !c.done; c.done = true; }
          else if (c.done) c.active = false;
          else { c.active = test(); c.done = c.active; }
        }
        mark(st.lc, 0);
        continue;
      }
      if (!active()) {
        // not assembled: FOR and NEXT still have to be matched up
        if (dir && dir.kind === 'for') loops.push({ skip: true });
        else if (dir && dir.kind === 'next' && loops.length) loops.pop();
        rec.skipped[ln] = true;
        mark(st.lc, 0);
        continue;
      }
      if (dir && dir.kind === 'for') {
        // FOR n, 0, 7 ... NEXT: the lines in between go in 8 times
        const values = forValues(pl, ev);
        const name = pl.operands[0] ? pl.operands[0].text.trim() : '';
        const named = /^[A-Za-z_][A-Za-z0-9_]*%?$/.test(name);
        // the size of the whole loop, worked out a time at a time (an IF inside may depend on the counter)
        let total = null;
        if (values && named) {
          const list = [];
          let depth = 0, done = false;
          for (let k = ln; k < n && !done; k++) for (const q of statements(model.lines[k])) {
            if (k === ln && list.length === 0 && q !== pl) continue;
            if (!q.mnem) continue;
            list.push(q);
            const d = D.directive(q.mnem.upper);
            if (d && d.kind === 'for') depth++;
            else if (d && d.kind === 'next' && --depth === 0) { done = true; break; }
          }
          if (done) { total = rangeBytes(list, 0, list.length, D, ev, 0); }
        }
        if (!values || !values.length) st.approx = true;
        mark(st.lc, 0);
        loops.push({ from: st.lc, count: values ? values.length : null, reloc: st.reloc, total, approx: st.approx, bound: named && values && values.length });
        if (named && values && values.length) bound.push({ rx: new RegExp(`(?<![A-Za-z0-9_&$%'"])${name.replace(/[%$]/g, '\\$&')}(?![A-Za-z0-9_%])`, 'g'), value: values[0] });
        continue;
      }
      if (dir && dir.kind === 'next') {
        const loop = loops.pop();
        if (loop && loop.bound) bound.pop();
        if (loop && !loop.skip && loop.total !== null && loop.total !== undefined) { st.lc = loop.from + loop.total; st.approx = loop.approx; }
        else if (loop && !loop.skip && loop.count > 1) st.lc += (st.lc - loop.from) * (loop.count - 1);
        mark(st.lc, 0);
        continue;
      }

      const even = D.sizing.evenAlign !== false;
      if (even && (ins || (dir && dir.kind === 'data' && dir.unit >= 2))) {
        if (st.lc & 1) st.lc++;                      // these always start on an even address
      }
      if (dir && dir.align) { if (st.lc & 1) st.lc++; }
      if (dir && dir.alignTo) {                      // ".align $100": move on to the next multiple
        const v = pl.operands[0] ? ev(pl.operands[0].text) : null;
        if (v === null || v <= 0) st.approx = true; else if (st.lc % v) st.lc += v - (st.lc % v);
      }
      if (dir && dir.kind === 'skipto') {            // BeebAsm "SKIPTO &3000": leave a gap up to there
        const v = pl.operands[0] ? ev(pl.operands[0].text) : null;
        if (v === null) st.approx = true; else if (v > st.lc) { size = v - st.lc; }
      }
      const start = st.lc;

      if (ins && D.sizing.forms) {
        // a name not known yet (set further down) might turn out to be in the zero page
        size = instructionBytes(ins, pl, D, (t) => { const v = ev(t); if (v === null && !prev && /[A-Za-z_]/.test(t)) out.forwardZp = true; return v; });
        if (size === null) { size = 0; st.approx = true; }
      } else if (ins) {
        const kinds = opKinds(ins, pl.operands.length);
        size = D.sizing.base;
        if (kinds && kinds.length === pl.operands.length) {
          for (let i = 0; i < kinds.length; i++) {
            const t = pl.operands[i].text;
            if (kinds[i] === 'i') size += D.sizing.immediate;
            else if (kinds[i] === 'g' && D.syntax.addressPrefix && t.startsWith(D.syntax.addressPrefix)) size += D.sizing.address;
          }
        } else st.approx = true;
      } else if (dir) {
        switch (dir.kind) {
          case 'data': case 'text': case 'space': {
            const v = directiveBytes(dir, pl, D, ev);
            if (v === null) st.approx = true; else size = v;
            if (dir.kind === 'space' && dir.labelAtEnd) labelAddr = start + size;
            break;
          }
          case 'origin': {
            // "*=$0801" / ".pc = $0801", either may end with a name in quotes: "*=$0801 \"Basic\""
            const t = pl.operands[0] ? pl.operands[0].text.replace(/^\s*=/, '').replace(/\s*"[^"]*"\s*$/, '') : '';
            const v = dir.fixed ? parseInt(dir.fixed, 16) : t ? ev(t) : null;
            if (dir.mode === 'absolute' || dir.mode === 'dummy' || dir.mode === 'execute') {
              if (v === null) st.approx = true;
              else {
                if (st.reloc) st.savedReloc = st.lc;
                st.lc = v; st.reloc = false;
                if (dir.clearsRough) st.approx = false;     // BeebAsm's ORG &1900: a fresh start, whatever came before
              }
              st.dummy = dir.mode === 'dummy';
            } else if (dir.mode === 'relocatable') {
              st.lc = v === null ? st.savedReloc : v;
              st.reloc = true; st.dummy = false;
            } else st.approx = true;                  // banks and the like: can't follow
            break;
          }
          case 'include': {
            const inc = model.includes.find(i => i.line === ln);
            if (inc && !inc.binary) {
              const before = st.lc;
              mark(st.lc, 0);
              visit(project.resolveInclude(file, inc.name), depth + 1);
              st.ended = false;                      // END inside a copied file only ends that file
              rec.after[ln] = st.lc;
              rec.size[ln] += st.reloc ? Math.max(0, st.lc - before) : 0;
              continue;
            }
            const bytes = inc && fileSize ? fileSize(project.resolveInclude(file, inc.name)) : null;
            if (bytes === null || bytes === undefined) st.approx = true; else size = bytes;
            break;
          }
          case 'end': st.ended = true; break;
          case 'macro':
            inMacro = true;
            macroOpened = !!line.open; macroDepth = (line.open || 0) - (line.close || 0);
            if (braceMacros && macroOpened && macroDepth <= 0) inMacro = false;   // all on one line
            macroRec = null;
            if (!braceMacros && pl.operands[0]) {
              // "MACRO name, a, b": remember where the body is, to size each call
              const names = pl.operands.map(o => o.text).join(',').trim().toUpperCase().split(/[\s,]+/);
              macroRec = { model, from: ln + 1, to: n - 1, params: names.slice(1) };
              macroDefs.set(names[0], macroRec);
            }
            break;
          case 'equ': break;
          default:
            if (dir.conditional) st.approx = true;
        }
      } else if (pl.mnem) {
        // a macro call: its size, if the macro is known; otherwise something we can't follow
        const v = macroDefs.has(pl.mnem.upper) ? macroBytes(pl, D, ev, 0) : null;
        if (v === null) st.approx = true; else size = v;
      }

      const startNow = dir && dir.kind === 'origin' ? st.lc : start;

      if (pl.label && !pl.label.name.startsWith('!')) {
        const u = pl.label.upper || D.key(model.qualify(pl.label.name, ln));
        if (dir && dir.kind === 'equ') {
          // only names set to "this address" need remembering here ($ for xas99, * or P% for BeebAsm)
          const text = pl.operands.map(o => o.text).join(',');
          if (scan(text, 0, D).some(t => t.type === 'here' || (t.type === 'op' && t.text === '*' && D.syntax.hereSymbol === '*'))) { const v = ev(text); if (v !== null && !out.symbols.has(u)) out.symbols.set(u, { off: v, reloc: st.reloc, approx: st.approx, file, line: ln, equ: true }); }
        } else if (!out.symbols.has(u)) {
          out.symbols.set(u, { off: labelAddr === null ? startNow : labelAddr, reloc: st.reloc, approx: st.approx, file, line: ln });
        }
      }

      st.lc = startNow + size;
      mark(startNow, size);
      if (!st.dummy) {
        if (st.reloc) out.relocEnd = Math.max(out.relocEnd, st.lc);
        else if (size && !(dir && dir.reserves)) { out.absMin = out.absMin === null ? startNow : Math.min(out.absMin, startNow); out.absMax = out.absMax === null ? st.lc : Math.max(out.absMax, st.lc); }
      }
      }
      if (first) { rec.addr[ln] = st.lc; rec.after[ln] = st.lc; rec.reloc[ln] = st.reloc; rec.approx[ln] = st.approx; rec.dummy[ln] = st.dummy; }
    }
    seen.delete(file);
  }

  visit(root, 0);
  out.approx = st.approx;
  return out;
}

module.exports = { buildLayout, textLength, instructionBytes, directiveBytes };
