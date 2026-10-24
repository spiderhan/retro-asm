'use strict';
// "Registers" side panel: what each register (and named memory location) holds at the line
// the cursor is on, worked out by reading the routine from its top down to that line.
// It is a best guess from reading the code, not from running it: nothing is run, and a
// register that a jump could have changed is marked "unsure". No AI, nothing sent anywhere.

const { statements, opKinds, byCount } = require('./parser');
const A = require('./analysis');
const F = require('./features');
const X = require('./explain');
const P = require('./panel');

const plain = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const codeOf = (model, ln, st) => {
  const raw = model.rawLines[ln] || '';
  const whole = model.lines[ln];
  const from = st && st.mnem ? st.mnem.start : 0;
  return raw.slice(from, whole && whole.comment ? whole.comment.start : undefined).trim().replace(/\s+/g, ' ');
};

/** What kind of thing an operand is: a register, a number, a place in memory, or memory found through a register. */
function classify(text, D, project, file, ln) {
  const t = text.trim();
  const rv = D.registerView;
  if (!t) return { kind: 'none', text: t };
  if (D.isRegister(t)) return { kind: 'reg', reg: t.toUpperCase(), text: t };
  if (rv.immediatePrefix && t.startsWith(rv.immediatePrefix)) return number(t.slice(rv.immediatePrefix.length), t);
  const ap = D.syntax.addressPrefix;
  if (ap && t.startsWith(ap)) {
    const rest = t.slice(ap.length).replace(/\(\s*[A-Za-z0-9]+\s*\)\s*$/, '').trim();
    return { kind: 'mem', name: rest, text: t };
  }
  if (t.startsWith('*')) return { kind: 'via', text: t };
  if (t.startsWith('(')) {
    const inner = t.replace(/^\(\s*|\s*\)[^)]*$/g, '');
    return D.isRegister(inner.split(/[+\-]/)[0].trim()) ? { kind: 'via', text: t } : { kind: 'mem', name: inner, text: t };
  }
  if (rv.bareIs === 'memory') return { kind: 'mem', name: t, text: t };
  return number(t, t);

  function number(expr, shown) {
    const v = project.eval(file, expr);
    const ident = /^[A-Za-z_][A-Za-z0-9_]*$/.test(expr.trim());
    let isLabel = false;
    if (ident) {
      const m = project.get(file);
      const defs = project.findDefs(file, m.qualify(expr.trim(), ln));
      isLabel = defs.length > 0 && defs[0].kind !== 'equ';
    }
    return { kind: 'num', value: v, expr: expr.trim(), isLabel, text: shown };
  }
}

/** A memory place as the programmer would say it: your own name, or the chip file's name for a known address. */
function placeName(name, D, project, file) {
  if (/^[>$%0-9]/.test(name)) {
    const v = project.eval(file, name);
    const note = v === null || v === undefined ? null : D.addresses.get(v);
    if (note) {
      const sp = P.splitNote(note);
      let label = plain(sp.title || P.firstSentence(sp.text)).replace(/[.:]$/, '');
      if (label.length > 45) label = label.slice(0, 44).trim() + '\u2026';
      return `${name} (${label})`;
    }
  }
  return name;
}

function hexFor(D, reg, v) {
  const wide = D.registerView.bits >= 16 || D.registers.wide.has(reg);
  return X.hex(v, D, wide ? 4 : 2);
}

/** "R1 = >0100" style text for a number. */
function numberText(c, D, reg) {
  if (c.isLabel) return `the address of ${c.expr}`;
  if (c.value === null || c.value === undefined) return c.expr;
  const h = hexFor(D, reg, c.value);
  return /^[A-Za-z_]/.test(c.expr) ? `${c.expr} (${h})` : h;
}

/** What a source operand gives, as a state entry (without line info). */
function sourceOf(c, state, D, reg) {
  if (c.kind === 'num') return { kind: 'value', text: numberText(c, D, reg), value: c.value, label: c.isLabel ? c.expr : null };
  if (c.kind === 'reg') {
    const s = state[c.reg];
    if (s && (s.kind === 'value' || s.kind === 'copy')) return { kind: 'copy', text: s.text, value: s.value, from: c.reg };
    return { kind: 'copy', text: `a copy of ${c.reg}`, from: c.reg };
  }
  if (c.kind === 'mem') return { kind: 'copy', text: `what is stored at ${c.name}` };
  if (c.kind === 'via') return { kind: 'copy', text: `what ${c.text.replace(/^\*|\+$/g, '')} points to` };
  return { kind: 'copy', text: 'something from memory' };
}

/** Lines of the comment above a routine that say what a register holds ("R1 = the letter to print"). */
function docsFor(model, node, D) {
  const out = { in: {}, out: {} };
  if (!node) return out;
  const rx = /^\s*(?:(in|input|on entry|entry|out|output|returns?|exit|on exit|uses|needs)\b\s*[:\-]?\s*)?([A-Za-z][A-Za-z0-9']{0,3})\s*(?:=|:|-|–|—|\bis\b|\bholds\b)\s*(.+?)\s*$/i;
  let mode = 'in';
  for (const l of model.docAbove(node.line)) {
    const lead = /^\s*(in|input|on entry|entry|out|output|returns?|exit|on exit)\b\s*[:\-]?\s*$/i.exec(l);
    if (lead) { mode = /^(out|output|return|exit|on exit)/i.test(lead[1]) ? 'out' : 'in'; continue; }
    const m = rx.exec(l);
    if (!m || !D.isRegister(m[2])) continue;
    const which = m[1] && /^(out|output|returns?|exit|on exit)/i.test(m[1]) ? 'out' : m[1] ? 'in' : mode;
    out[which][m[2].toUpperCase()] = plain(m[3]);
  }
  return out;
}

function conditional(ins, n) {
  if (ins.cond) return true;
  const k = opKinds(ins, n) || [];
  return k.includes('cc');
}

/** Registers a routine needs filled in before it is called: read before the routine itself sets them. */
function entryNeeds(project, file, map, key, seen) {
  project._regNeeds = project._regNeeds && project._regNeeds.gen === project.gen ? project._regNeeds : { gen: project.gen, map: new Map() };
  const memo = project._regNeeds.map;
  if (memo.has(key)) return memo.get(key);
  const entry = map.get(key);
  if (!entry) return new Set();
  seen = seen || new Set();
  if (seen.has(key)) return new Set();
  seen.add(key);
  const model = project.get(entry.file);
  const D = model.D;
  const link = D.checks.linkRegister ? D.checks.linkRegister.toUpperCase() : '';
  const data = A.dataAfterLines(project, entry.file);
  const written = new Set();
  const needs = new Set();
  const isSet = (r) => [...written].some(w => D.registers.overlap(w, r));
  for (let ln = entry.node.line; ln <= entry.node.endLine; ln++) {
    if (data.has(ln)) continue;
    for (const st of statements(model.lines[ln])) {
      const lr = A.lineRegs(st, D, (t) => project.eval(entry.file, t));
      for (const r of lr.r) if (r !== link && !isSet(r)) needs.add(r);
      if (lr.call) {
        const ck = project.key(entry.file, lr.call);
        const callee = map.get(ck);
        if (callee) {
          for (const r of entryNeeds(project, file, map, ck, seen)) if (r !== link && !isSet(r)) needs.add(r);
          for (const r of callee.use.writes) written.add(r);
          for (const r of A.writesThroughCalls(map, ck)) written.add(r);
        }
      }
      for (const r of lr.w) written.add(r);
    }
  }
  seen.delete(key);
  memo.set(key, needs);
  return needs;
}

/** Everything the panel shows for the cursor position. */
function registersAt(project, file, line) {
  const model = project.get(file);
  if (!model || line < 0 || line >= model.lines.length) return null;
  const D = model.D;
  if (!D.registers.list.length) return null;
  const link = D.checks.linkRegister ? D.checks.linkRegister.toUpperCase() : '';
  const map = A.routineMap(project, file, F.buildOutline);
  const node = F.buildOutline(project, file).find(n => n.kind === 'routine' && line >= n.line && line <= n.endLine) || null;
  const start = node ? node.line : 0;
  const docs = docsFor(model, node, D);
  const data = A.dataAfterLines(project, file);

  // labels that a jump lands on: the registers there can differ depending on how you got there
  const targets = new Map();      // label -> the lines that jump to it
  const addTarget = (k, ln) => { if (!targets.has(k)) targets.set(k, []); targets.get(k).push(ln); };
  if (node) for (let ln = node.line; ln <= node.endLine; ln++) {
    for (const st of statements(model.lines[ln])) {
      const lr = A.lineRegs(st, D, null);
      if (lr.go) addTarget(D.key(model.qualify(lr.go, ln)), ln);
    }
  }
  // registers changed on any line from a to b (including by the routines those lines call)
  const writesBetween = (a, b) => {
    const set = new Set();
    for (let ln = a; ln <= b; ln++) {
      if (data.has(ln)) continue;
      for (const st of statements(model.lines[ln])) {
        const lr = A.lineRegs(st, D, null);
        for (const r of lr.w) set.add(r);
        if (lr.call) {
          const c = map.get(project.key(file, lr.call));
          if (c) { for (const r of c.use.writes) set.add(r); for (const r of A.writesThroughCalls(map, project.key(file, lr.call))) set.add(r); }
        }
      }
    }
    return set;
  };

  const state = {};
  const memory = new Map();
  const unknownCalls = [];
  let dead = false, callAtCursor = null, cursorStmt = null;

  const put = (reg, entry, ln, code) => {
    if (reg === link) return;
    for (const other of Object.keys(state)) if (other !== reg && D.registers.overlap(reg, other)) state[other] = { kind: 'changed', text: `changed when ${reg} was set`, line: ln, code };
    state[reg] = Object.assign({ line: ln, code }, entry);
  };

  for (let ln = start; ln <= line; ln++) {
    const pl = model.lines[ln];
    const atCursor = ln === line;
    if (pl.label && ln > start) {
      const jumps = targets.get(D.key(model.qualify(pl.label.name, ln)));
      if (jumps) {
        if (dead) { for (const k of Object.keys(state)) delete state[k]; }
        else {
          // only registers changed on the way round (or skipped over) can differ
          const differ = new Set();
          for (const j of jumps) for (const r of (j > ln ? writesBetween(ln, j) : writesBetween(j + 1, ln - 1))) differ.add(r);
          for (const k of Object.keys(state)) {
            if (state[k].unsure || ![...differ].some(w => w === k || D.registers.overlap(w, k))) continue;
            state[k] = Object.assign({}, state[k], { unsure: pl.label.name });
          }
        }
        dead = false;
      }
    }
    if (data.has(ln)) continue;
    for (const st of statements(pl)) {
      if (!st.mnem) continue;
      const ins = D.instr(st.mnem.upper);
      if (!ins) continue;
      const code = codeOf(model, ln, st);
      const lr = A.lineRegs(st, D, (t) => project.eval(file, t));
      if (atCursor) {
        cursorStmt = { st, ins, lr, code };
        if (lr.call) callAtCursor = lr.call;
        break;                                  // the state is what it was before this line
      }
      const n = st.operands.length;
      const cls = st.operands.map(o => classify(o.text, D, project, file, ln));
      const handled = new Set();
      const copy = ins.copy, fixed = ins.fixed, store = ins.store;
      if (copy && (copy.toReg || (cls[copy.to] && cls[copy.from]))) {
        const src = cls[copy.from];
        const dest = copy.toReg ? { kind: 'reg', reg: copy.toReg } : cls[copy.to];
        if (dest && src) {
          if (dest.kind === 'reg') {
            const s = sourceOf(src, state, D, dest.reg);
            put(dest.reg, s, ln, code);
            handled.add(dest.reg);
          } else if (dest.kind === 'mem') {
            const known = src.kind === 'reg' && state[src.reg] && (state[src.reg].kind === 'value' || state[src.reg].kind === 'copy');
            const s = src.kind === 'reg' ? (known ? `${src.reg} (${state[src.reg].text})` : src.reg) : sourceOf(src, state, D, '').text;
            memory.set(D.key(dest.name), { name: placeName(dest.name, D, project, file), text: s, line: ln, code, unsure: null });
          }
        }
      } else if (fixed && cls[fixed.to]) {
        const dest = cls[fixed.to];
        if (dest.kind === 'reg') { put(dest.reg, { kind: 'value', value: fixed.value, text: hexFor(D, dest.reg, fixed.value) }, ln, code); handled.add(dest.reg); }
        else if (dest.kind === 'mem') memory.set(D.key(dest.name), { name: placeName(dest.name, D, project, file), text: hexFor(D, '', fixed.value), line: ln, code, unsure: null });
      } else if (store && cls[store.to] && cls[store.to].kind === 'mem') {
        const s = state[store.fromReg];
        memory.set(D.key(cls[store.to].name), { name: placeName(cls[store.to].name, D, project, file), text: s && s.kind !== 'changed' && s.kind !== 'call' ? `${store.fromReg} (${s.text})` : store.fromReg, line: ln, code, unsure: null });
      }
      // anything else this line changes
      for (const r of lr.w) {
        if (handled.has(r) || r === link) continue;
        put(r, { kind: 'changed', text: `changed by ${code}` }, ln, code);
      }
      // other instructions that write to a named place in memory (INC @COUNT ...)
      if (!copy && !fixed && !store) {
        const rw = byCount(ins.rw, n) || [];
        cls.forEach((c, i) => { if (c.kind === 'mem' && /w/.test(rw[i] || '') && c.name) memory.set(D.key(c.name), { name: placeName(c.name, D, project, file), text: `changed by ${code}`, line: ln, code, unsure: null }); });
      }
      if (lr.call) {
        const ck = project.key(file, lr.call);
        const callee = map.get(ck);
        if (callee) {
          const ch = new Set([...callee.use.writes, ...A.writesThroughCalls(map, ck)]);
          for (const r of ch) if (r !== link) put(r, { kind: 'call', text: `changed by ${lr.call}` }, ln, code);
        } else unknownCalls.push({ name: lr.call, line: ln });
      }
      if (lr.returns || (lr.go && !conditional(ins, n)) || (ins.far && !conditional(ins, n) && !lr.call)) dead = true;
    }
  }

  const rows = [];
  for (const r of D.registers.list) {
    const s = state[r.toUpperCase()];
    if (!s || r.toUpperCase() === link) continue;
    rows.push({ reg: r, kind: s.kind, text: s.text, line: s.line, code: s.code, unsure: s.unsure || '', doc: docs.out[r.toUpperCase()] || docs.in[r.toUpperCase()] || plain(project.regNote(file, r, line)) });
  }
  const needsList = node ? [...entryNeeds(project, file, map, project.key(file, node.name))].sort((a, b) => D.registers.list.findIndex(n => n.toUpperCase() === a) - D.registers.list.findIndex(n => n.toUpperCase() === b)) : [];
  const needs = needsList;
  for (const r of needs) {
    if (state[r] || rows.some(x => x.reg.toUpperCase() === r)) continue;
    rows.push({ reg: r, kind: 'entry', text: 'from whoever calls this routine', line: node.line, code: '', unsure: '', doc: docs.in[r] || plain(project.regNote(file, r, line)) });
  }
  rows.sort((a, b) => D.registers.list.findIndex(n => n.toUpperCase() === a.reg.toUpperCase()) - D.registers.list.findIndex(n => n.toUpperCase() === b.reg.toUpperCase()));
  const out = {
    file, line, chip: D.name, routine: node ? { name: node.name, line: node.line } : null,
    rows, memory: [...memory.values()], unknownCalls: unknownCalls.slice(0, 5),
    needs: needs.map(r => ({ reg: r, doc: docs.in[r] || plain(project.regNote(file, r, line)) })), call: null,
    returns: Object.keys(docs.out).map(r => ({ reg: r, doc: docs.out[r] }))
  };

  // the line under the cursor is a call: what the routine it calls wants and changes
  if (callAtCursor) {
    const ck = project.key(file, callAtCursor);
    const callee = map.get(ck);
    const call = { name: callAtCursor, found: !!callee, line, needs: [], changes: '' };
    if (callee) {
      const cdocs = docsFor(project.get(callee.file), callee.node, project.get(callee.file).D);
      for (const r of entryNeeds(project, file, map, ck)) {
        const now = state[r];
        call.needs.push({ reg: r, doc: cdocs.in[r] || plain(project.regNote(callee.file, r, callee.node.line)), now: now ? (now.kind === 'value' || now.kind === 'copy' ? now.text : now.kind === 'call' ? `unsure, ${now.text}` : now.text) : '', unsure: !!(now && now.unsure), missing: !now });
      }
      call.needs.sort((a, b) => D.registers.list.findIndex(n => n.toUpperCase() === a.reg) - D.registers.list.findIndex(n => n.toUpperCase() === b.reg));
      const ch = new Set([...callee.use.writes, ...A.writesThroughCalls(map, ck)]);
      ch.delete(link);
      call.changes = A.regList(ch, D);
      call.returns = Object.keys(cdocs.out).map(r => ({ reg: r, doc: cdocs.out[r] }));
    }
    out.call = call;
  }
  return out;
}

module.exports = { registersAt, entryNeeds, classify, docsFor };
