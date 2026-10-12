'use strict';
// How long an instruction takes, in clock cycles. All the numbers live in the chip files: each
// instruction's "cycles" and the chip's "timing" section (README, "Adding a chip of your own").
// Nothing in here knows about VS Code, so it can be tested with plain Node.

const { opKinds } = require('./parser');

/** The operands as one string with no spaces ("($FB),Y"), as the sizing rules see them. */
function joinedOps(pl) {
  return pl.operands.map(o => o.text.trim()).join(',').replace(/\s+/g, '');
}

/**
 * Which way of writing the operand this is ("absx", "zp" ...), from the chip's timing modes.
 * A mode with a "zeroPage" partner switches to it when the address fits in one byte: the
 * instruction's size says so when it is known (2 bytes, not 3), otherwise the value does.
 */
function modeOf(table, pl, T, ev, size) {
  const joined = joinedOps(pl);
  for (const m of T.modeList) {
    const hit = m.rx.exec(joined);
    if (!hit) continue;
    if (m.zeroPage && table[m.zeroPage] !== undefined) {
      let zp;
      if (size === 2 || size === 3) zp = size === 2;
      else {
        const v = ev(hit[m.value || 1]);
        zp = v !== null && v >= 0 && v <= 0xFF;
      }
      if (zp || table[m.name] === undefined) return { name: m.zeroPage, mode: m };
    }
    return { name: m.name, mode: m };
  }
  return null;
}

/**
 * One instruction's entry ("cycles" or "cyclesAlt") worked down to a single value for this line:
 * a number, "4+" (one more if a page is crossed), [not taken, taken], or text.
 */
function pick(entry, pl, T, ev, size) {
  if (entry === undefined || entry === null) return null;
  if (typeof entry === 'number' || typeof entry === 'string') return { v: entry };
  if (Array.isArray(entry)) {
    if (!entry.length || typeof entry[0] !== 'object') return { v: entry };        // [7, 12]
    const joined = joinedOps(pl);                                                   // rules: first match wins
    for (const r of entry) if (r.rx && r.rx.test(joined)) return { v: r.c, note: r.note };
    return null;
  }
  if (typeof entry === 'object' && T.modeList) {
    const m = modeOf(entry, pl, T, ev, size);
    if (!m || entry[m.name] === undefined) return null;
    return { v: entry[m.name], plus: m.mode.plus };
  }
  return null;
}

const num = (v) => typeof v === 'number' ? v : parseInt(v, 10);
const plusOne = (v) => typeof v === 'string' && /^\d+\+$/.test(v);

/** Add a fixed number of cycles to a value (the TMS9900's operand costs). */
function addTo(v, n) {
  if (!n) return v;
  if (typeof v === 'number') return v + n;
  if (plusOne(v)) return (num(v) + n) + '+';
  if (Array.isArray(v)) return v.map(x => addTo(x, n));
  return v;
}

/** All the plain numbers a value stands for (used by the checks). */
function valuesOf(v) {
  if (typeof v === 'number') return [v];
  if (plusOne(v)) return [num(v), num(v) + 1];
  if (Array.isArray(v)) return v.flatMap(valuesOf);
  return [];
}

function say(v, T, ins, plus) {
  if (typeof v === 'number') return `${v} cycle${v === 1 ? '' : 's'}`;
  if (plusOne(v)) {
    const n = num(v);
    return plus ? `${n} cycles, or ${n + 1} if ${plus}` : `${n} cycles (1 more if the address crosses into the next page)`;
  }
  if (Array.isArray(v)) {
    const tpl = ins.cyclesPair || T.pair || '{1} or {2} cycles';
    return tpl.replace(/\{([1-9])\}/g, (all, k) => v[k - 1] !== undefined ? v[k - 1] : all);
  }
  return String(v);
}

/**
 * Cycles for the TMS9900's operands: the "operandCost" rules add clock cycles and memory uses
 * for each general operand (*R1+, @LABEL(R2) ...). Word instructions add more for *R1+.
 */
function operandCost(ins, pl, T, sizeName) {
  let c = 0, m = 0;
  if (!T.costList || !Array.isArray(ins.ops)) return { c, m };
  ins.ops.forEach((kind, i) => {
    if (kind !== 'g' || !pl.operands[i]) return;
    const t = pl.operands[i].text.trim();
    const r = T.costList.find(x => x.rx.test(t));
    if (!r) return;
    c += (sizeName === 'byte' && r.cByte !== undefined) ? r.cByte : r.c;
    m += r.m || 0;
  });
  return { c, m };
}

/** TMS9900 shifts, LDCR and STCR: the time depends on the count. Returns { v, m } or null. */
function byCount(ins, pl, ev) {
  const bc = ins.cyclesByCount;
  const op = pl.operands[bc.op - 1];
  let n = op ? ev(op.text.trim()) : null;
  if (n === null || n < 0 || n > 16) return { v: bc.unknown, m: 0, unknown: true };
  if (n === 0) {
    if (bc.zero) return { v: bc.zero, m: bc.zeroAccess || 0, unknown: true };
    n = 16;
  }
  if (bc.steps) {
    const s = bc.steps.find(([upTo]) => n <= upTo);
    return { v: s ? s[1] : bc.unknown, m: 0 };
  }
  return { v: bc.base + bc.each * n, m: 0 };
}

/**
 * How long one instruction line takes: { text, values, access } or null when the chip file has
 * no timing for it. opts: { ev(text) -> number|null, size (bytes, if known), addr (of the line),
 * sizeName ('byte' / 'word') }.
 */
function cyclesFor(ins, pl, D, opts) {
  const T = D.timing;
  if (!T || !ins || ins.cycles === undefined) return null;
  opts = opts || {};
  const ev = opts.ev || (() => null);
  let got;
  let access = ins.access;
  let formula = false;
  if (ins.cyclesByCount) {
    const r = byCount(ins, pl, ev);
    got = { v: r.v };
    if (access !== undefined) access += r.m;
    formula = !!r.unknown;
  } else got = pick(ins.cycles, pl, T, ev, opts.size);
  if (!got || got.v === undefined || got.v === null) return null;

  let v = got.v;
  if (access !== undefined) {
    const oc = operandCost(ins, pl, T, opts.sizeName);
    if (!formula) v = addTo(v, oc.c);
    access += oc.m;
  }
  let text = say(v, T, ins, got.plus);
  if (formula && access !== undefined) {
    const oc = operandCost(ins, pl, T, opts.sizeName);
    if (oc.c) text += `, plus ${oc.c} for the way the first operand is written`;
  }

  const alt = ins.cyclesAlt ? pick(ins.cyclesAlt, pl, T, ev, opts.size) : null;
  if (alt && alt.v !== undefined && JSON.stringify(alt.v) !== JSON.stringify(v) && T.altLabel) {
    text += `. ${T.altLabel}: ${say(alt.v, T, ins, alt.plus || got.plus)}`;
  }
  const notes = [];
  if (got.note) notes.push(got.note);
  if (ins.cyclesNote) notes.push(ins.cyclesNote);
  // slower memory: the line itself, or an address it uses
  for (const s of T.slowList || []) {
    const inside = (a) => a !== null && a !== undefined && a >= s.from && a <= s.to;
    let hit = s.code && inside(opts.addr);
    if (!hit) {
      const kinds = opKinds(ins, pl.operands.length) || [];
      for (let i = 0; i < pl.operands.length; i++) {
        if (['t', 'i', 'p', 'cc', 'n', 'nb', 'c', 'x'].includes(kinds[i])) continue;   // jump targets, plain numbers, ports
        let t = pl.operands[i].text.trim();
        if (t.startsWith('#') || D.isRegister(t)) continue;
        t = t.replace(/^\(+|\)+$/g, '');
        if (!t || D.isRegister(t)) continue;
        if (inside(ev(t))) { hit = true; break; }
      }
    }
    if (hit) { notes.push(s.text); break; }
  }
  const tucked = notes.filter(n => /^[0-9a-z]/.test(n));
  for (const n of tucked) text += ` (${n.replace(/\.$/, '')})`;
  // TMS9900: every read or write of slow memory adds a few cycles
  if (access !== undefined && T.slowAccess) {
    const times = access === 1 ? 'once' : access === 2 ? 'twice' : `${access} times`;
    const tpl = T.accessText || 'plus up to {extra} more in slow memory (it uses memory {times}; each slow one adds {slow})';
    text += ', ' + tpl.replace('{extra}', T.slowAccess * access).replace('{times}', times).replace('{slow}', T.slowAccess);
  }
  const rest = notes.filter(n => !tucked.includes(n));
  if (rest.length) text += '. ' + rest.map(n => n.replace(/\.$/, '')).join('. ');
  return { text: text.replace(/\.?$/, '.'), values: valuesOf(v), access };
}

/** Called when a chip file is loaded: compiles the patterns in its "timing" section. */
function prepareTiming(raw, D, safeRegExp) {
  const t = raw.timing;
  if (!t) return null;
  const T = Object.assign({}, t);
  T.modeList = (t.modes || []).map((m, i) => Object.assign({}, m, { rx: safeRegExp(m.re, `timing.modes[${i}]`) }));
  T.costList = (t.operandCost || []).map((m, i) => Object.assign({}, m, { rx: safeRegExp(m.re, `timing.operandCost[${i}]`) }));
  T.slowList = (t.slow || []).map(s => Object.assign({}, s, { from: parseInt(s.from, 16), to: parseInt(s.to, 16) }));
  for (const [, ins] of D.instructions) {
    for (const key of ['cycles', 'cyclesAlt']) {
      const e = ins[key];
      if (Array.isArray(e) && e.length && typeof e[0] === 'object') {
        ins[key] = e.map((r, i) => Object.assign({}, r, { rx: safeRegExp(r.re, `instructions.${ins.key}.${key}[${i}]`) }));
      }
    }
  }
  return T;
}

module.exports = { cyclesFor, prepareTiming, valuesOf };
