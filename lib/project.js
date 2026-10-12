'use strict';

/** A value the assembler itself knows by name (KickAssembler's BLACK = 0 and so on), or null. */
function builtInValue(D, upper) {
  const k = D.knownSymbols.get(String(upper).toUpperCase());
  return k && typeof k.value === 'number' ? k.value : null;
}
// Keeps one parsed Model per source file and answers questions that span files:
// "where is this label defined?", "where is it used?", "what number does it stand for?".
// Files are tied together by include lines (COPY, INCLUDE, #import), so two separate
// programs in one folder don't get mixed up.

const path = require('path');
const fs = require('fs');
const { Model, evalExpr } = require('./parser');
const { buildLayout } = require('./layout');

class Project {
  constructor() {
    this.models = new Map();   // file path -> Model
    this.gen = 0;
    this._unitCache = new Map();
    this._refIndex = new Map();
    this._layouts = new Map();
    this.loadAddress = () => null;   // replaced by the extension: (file) -> number or null (use the chip's own)
    this.fileSize = () => null;      // replaced by the extension: (path) -> bytes, for binary includes
    this.notes = () => ({});    // replaced by the extension: (file) -> notes object
  }

  set(file, text, D) {
    const old = this.models.get(file);
    if (old && old.text === text && old.D === D) return old;
    const m = new Model(text, D, file);
    this.models.set(file, m);
    this._touch();
    return m;
  }
  remove(file) { if (this.models.delete(file)) this._touch(); }
  get(file) { return this.models.get(file) || null; }
  _touch() { this.gen++; this._unitCache.clear(); this._refIndex.clear(); this._layouts.clear(); }

  /** Every use of every name in the program `file` belongs to: UPPER name -> [uses]. */
  refIndex(file) {
    const unit = this.unit(file);
    const key = unit[0] || file;
    let idx = this._refIndex.get(file);
    if (idx) return idx;
    idx = this._refIndex.get('unit:' + key);
    if (!idx) {
      idx = new Map();
      for (const f of unit) for (const r of this.models.get(f).refs) {
        let list = idx.get(r.upper);
        if (!list) idx.set(r.upper, list = []);
        list.push(r);
      }
      this._refIndex.set('unit:' + key, idx);
    }
    this._refIndex.set(file, idx);
    return idx;
  }

  /** Turn the name on a COPY line into a full path (forgiving about upper/lower case). */
  resolveInclude(fromFile, name) {
    name = String(name).replace(/\\/g, '/');      // "src\\music.asm" written on Windows still works elsewhere
    const near = path.resolve(path.dirname(fromFile), name);
    // BeebAsm reads INCLUDE names from the folder it was started in, often the project's top
    // folder ("1-source-files/main.asm"), so try the folders above too
    const tries = [near];
    if (!path.isAbsolute(name)) for (let d = path.dirname(path.dirname(fromFile)), k = 0; k < 4 && d !== path.dirname(d); d = path.dirname(d), k++) tries.push(path.resolve(d, name));
    for (const full of tries) {
      if (this.models.has(full)) return full;
      const want = full.toLowerCase();
      for (const k of this.models.keys()) if (k.toLowerCase() === want) return k;
    }
    if (tries.length > 1) for (const full of tries) { try { if (fs.statSync(full).isFile()) return full; } catch (e) { /* not there */ } }
    return near;
  }

  /** Every file that is assembled together with `file` (through COPY lines, in either direction). */
  unit(file) {
    const hit = this._unitCache.get(file);
    if (hit) return hit;
    const children = new Map(), parents = new Map();
    for (const [f, m] of this.models) {
      for (const inc of m.includes) {
        if (inc.binary) continue;
        const t = this.resolveInclude(f, inc.name);
        if (!children.has(f)) children.set(f, []);
        children.get(f).push(t);
        if (!parents.has(t)) parents.set(t, []);
        parents.get(t).push(f);
      }
    }
    const up = new Set([file]);
    const q = [file];
    while (q.length) for (const p of parents.get(q.pop()) || []) if (!up.has(p)) { up.add(p); q.push(p); }
    const all = new Set(up);
    const q2 = [...up];
    while (q2.length) for (const c of children.get(q2.pop()) || []) if (!all.has(c)) { all.add(c); q2.push(c); }
    const list = [...all].filter(f => this.models.has(f)).sort();
    if (!list.includes(file) && this.models.has(file)) list.unshift(file);
    this._unitCache.set(file, list);
    return list;
  }

  /** The key a name is filed under in this file's chip (capitals, unless the assembler minds case). */
  key(file, name) {
    const m = this.models.get(file);
    return m ? m.D.key(name) : String(name).toUpperCase();
  }

  findDefs(file, name) {
    const u = this.key(file, name);
    const out = [];
    for (const f of this.unit(file)) for (const d of this.models.get(f).defs.get(u) || []) out.push(d);
    // a real definition beats a REF line
    const real = out.filter(d => d.kind !== 'extern');
    return real.length ? real : out;
  }

  findDefsAnywhere(name) {
    const out = [];
    for (const m of this.models.values()) for (const d of m.defs.get(m.D.key(name)) || []) out.push(d);
    return out;
  }

  findRefs(file, name) {
    return this.refIndex(file).get(this.key(file, name)) || [];
  }

  allDefs(file) {
    const out = [];
    for (const f of this.unit(file)) for (const d of this.models.get(f).defList) out.push(d);
    return out;
  }

  macros(file) {
    const out = new Set();
    for (const f of this.unit(file)) for (const m of this.models.get(f).macros) out.add(m);
    return out;
  }

  /** The file a program starts from: the one that COPYs the others in. */
  rootOf(file) {
    const unit = this.unit(file);
    const included = new Set();
    for (const f of unit) for (const inc of this.models.get(f).includes) if (!inc.binary) included.add(this.resolveInclude(f, inc.name));
    const roots = unit.filter(f => !included.has(f));
    if (roots.includes(file) || !roots.length) return file;
    return roots[0];
  }

  /** Where everything sits in memory (see layout.js). Cached until a file changes. */
  layout(file) {
    const root = this.rootOf(file);
    let L = this._layouts.get(root);
    if (!L) {
      if (this._building) return null;
      this._building = true;
      try { L = buildLayout(this, root, this.fileSize); } finally { this._building = false; }
      const m = this.models.get(root);
      const own = this.loadAddress(root);
      L.base = own !== null && own !== undefined ? own : (m && m.D.sizing ? m.D.sizing.load : 0);
      this._layouts.set(root, L);
    }
    return L;
  }

  /**
   * Address and size of one line: { addr, size, after, reloc, approx, dummy } or null.
   * With `part`, just that statement of a line that holds several ("LDA #1:STA &70").
   */
  lineInfo(file, line, part) {
    const L = this.layout(file);
    const rec = L && L.ok ? L.files.get(file) : null;
    if (!rec || rec.addr[line] === null || rec.addr[line] === undefined) return null;
    const add = rec.reloc[line] ? L.base : 0;
    const pa = part !== undefined && rec.partAddr ? rec.partAddr.get(line) : null;
    if (pa && pa[part]) { const p = pa[part]; return { addr: p.addr + add, after: p.addr + p.size + add, size: p.size, reloc: rec.reloc[line], approx: p.approx, dummy: rec.dummy[line], skipped: !!(rec.skipped && rec.skipped[line]) }; }
    return { addr: rec.addr[line] + add, after: rec.after[line] + add, size: rec.size[line], reloc: rec.reloc[line], approx: rec.approx[line], dummy: rec.dummy[line], skipped: !!(rec.skipped && rec.skipped[line]) };
  }

  /** Address of a label: { addr, reloc, approx } or null. `base` overrides the load address. */
  labelAddress(file, name, base) {
    const L = this.layout(file);
    const s = L && L.ok ? L.symbols.get(this.key(file, name)) : null;
    if (!s) return null;
    return { addr: s.off + (s.reloc ? (base === undefined ? L.base : base) : 0), reloc: s.reloc, approx: s.approx, equ: !!s.equ };
  }

  /**
   * Work out a sum that may contain labels. Returns { value, isAddress }:
   * isAddress is true when the answer moves with the program (LABEL+2), false for a plain
   * number (LABEL_END-LABEL). Returns null if it can't be worked out.
   */
  evalFull(file, text, here) {
    const m = this.models.get(file);
    if (!m) return null;
    const run = (base) => {
      const guard = new Set();
      const res = (n) => {
        const u = this.key(file, n);
        const a = this.labelAddress(file, n, base);
        if (a && !a.approx) return a.addr;
        if (guard.has(u)) return null;
        const def = this.findDefs(file, n).find(d => d.kind === 'equ');
        if (!def || def.expr === null) return builtInValue(m.D, u);
        guard.add(u);
        const dm = this.models.get(def.file);
        const v = evalExpr(def.expr, dm ? dm.D : m.D, res);
        guard.delete(u);
        return v;
      };
      return evalExpr(text, m.D, res, here === undefined ? undefined : here.reloc ? here.off + base : here.off);
    };
    const L = this.layout(file);
    const base = L ? L.base : 0;
    const a = run(base);
    if (a === null) return null;
    const b = run(base + 0x100);
    return { value: a, isAddress: a !== b };
  }

  /** The number a name stands for, or null. Follows EQU chains (SCORE+1 and so on). */
  value(file, name, seen) {
    seen = seen || new Set();
    const u = this.key(file, name);
    if (seen.has(u)) return null;
    seen.add(u);
    const def = this.findDefs(file, name).find(d => d.kind === 'equ');
    if (!def || def.expr === null) { const fm = this.models.get(file); return fm ? builtInValue(fm.D, u) : null; }
    const m = this.models.get(def.file);
    return evalExpr(def.expr, m ? m.D : this.models.get(file).D, (n) => this.value(file, n, seen));
  }

  eval(file, text) {
    const m = this.models.get(file);
    if (!m) return null;
    const quick = evalExpr(text, m.D, (n) => this.value(file, n));
    if (quick !== null) return quick;
    if (!m.D.sizing || this._building) return null;
    // a sum with labels in it: only a plain number counts here (PAT_END-PAT, not PAT+2)
    const full = this.evalFull(file, text);
    return full && !full.isAddress ? full.value : null;
  }

  /** Your own note for a register: nearest ";@reg" line above, else anywhere in the file, else the notes file. */
  regNote(file, reg, line) {
    const m = this.models.get(file);
    const u = reg.toUpperCase();
    if (m) {
      let best = null;
      for (const n of m.regNotes) if (n.reg === u && n.line <= line) best = n;
      if (!best) best = m.regNotes.find(n => n.reg === u) || null;
      if (best) return best.text || null;
    }
    const notes = this.notes(file) || {};
    const perFile = (notes.files || {})[path.basename(file)] || {};
    const pick = (o) => { if (!o) return null; for (const k of Object.keys(o)) if (!k.startsWith('_') && k.toUpperCase() === u) return o[k]; return null; };
    return pick(perFile.registers) || pick(notes.registers) || null;
  }

  symbolNote(file, name) {
    const notes = this.notes(file) || {};
    const perFile = (notes.files || {})[path.basename(file)] || {};
    const u = name.toUpperCase();
    const pick = (o) => { if (!o) return null; for (const k of Object.keys(o)) if (!k.startsWith('_') && k.toUpperCase() === u) return o[k]; return null; };
    return pick(perFile.symbols) || pick(notes.symbols) || null;
  }

  addressNote(file, value) {
    const notes = this.notes(file) || {};
    const perFile = (notes.files || {})[path.basename(file)] || {};
    const pick = (o) => {
      if (!o) return null;
      for (const k of Object.keys(o)) {
        if (k.startsWith('_')) continue;
        const v = parseInt(String(k).replace(/^(0x|[>$#])/i, ''), 16);
        if (v === value) return o[k];
      }
      return null;
    };
    return pick(perFile.addresses) || pick(notes.addresses) || null;
  }
}

module.exports = { Project };
