'use strict';
// Turns what the parser found into plain-English text for the tooltips.
// Everything returns Markdown strings. Nothing in here knows about VS Code.

const path = require('path');
const { scan, opKinds, byCount } = require('./parser');
const T = require('./timing');

/** Make text safe to drop into Markdown (so *R11 doesn't turn into italics). */
function esc(s) {
  return String(s).replace(/[\\`*_\[\]<>~|#]/g, '\\$&');
}

function hex(v, D, digits) {
  const bits = D.syntax.wordBits || 16;
  const mask = Math.pow(2, bits) - 1;
  let u = v < 0 ? (v & mask) >>> 0 : v;
  let s = u.toString(16).toUpperCase();
  const want = digits || (u > 0xFF ? 4 : 2);
  while (s.length < want) s = '0' + s;
  return D.syntax.hexDisplay + s;
}

/** The short name a chip file gives an address ("**CLS** ..." gives CLS), or null. */
function addressName(v, D) {
  const note = v === null || v === undefined ? null : D.addresses.get(v);
  const m = note && /^\*\*([^*]{1,30})\*\*/.exec(note);
  return m ? m[1] : null;
}

/** "768 (>0300)", "5", "-256 (>FF00)" */
function decHex(v, D) {
  if (v === null || v === undefined) return '?';
  if (v >= 0 && v < 10) return String(v);
  return `${v} (${hex(v, D)})`;
}

function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

function unitName(size, D) { return size === 'byte' ? D.syntax.byteName : size === 'word' ? D.syntax.wordName : 'value'; }

function regText(reg, ctx, line) {
  const note = ctx.regNote(reg, line);
  return note ? `${esc(reg.toUpperCase())} (${esc(note)})` : esc(reg.toUpperCase());
}

/** What a single BYTE/DATA label holds, e.g. B_ONE BYTE 1 -> 1. */
function heldValue(def, ctx) {
  const m = ctx.modelOf(def);
  if (!m) return null;
  const pl = m.statementOf ? m.statementOf(def) : m.lines[def.line];
  if (!pl || !pl.mnem || pl.operands.length !== 1) return null;
  const dir = m.D.directive(pl.mnem.upper);
  if (!dir || dir.kind !== 'data') return null;
  return ctx.eval(pl.operands[0].text);
}

/**
 * Describe a value or address written in an operand.
 * mode: 'imm' (a number being used), 'addr' (the name of a memory place), 'target' (somewhere to jump).
 */
function describeExpr(text, ctx, mode) {
  const D = ctx.D;
  const toks = scan(text, 0, D);
  if (toks.length === 1) {
    const t = toks[0];
    if (t.type === 'ident') {
      const defs = ctx.findDefs(t.text);
      const def = defs[0];
      if (!def) {
        const k = D.knownSymbols.get(t.upper);           // KickAssembler's BLACK and so on
        return k && typeof k.value === 'number' ? `${esc(t.text)} (${k.value})` : esc(t.text);
      }
      if (def.kind === 'equ') {
        const v = ctx.value(t.text);
        if (v === null) return esc(t.text);
        // show it the way it was written: hex if the EQU line used hex, otherwise decimal
        const asHex = mode === 'addr' || (v > 9 && scan(def.expr || '', 0, D).some(k => k.type === 'num' && k.radix === 16));
        const known = mode !== 'imm' ? addressName(v, D) : null;
        return `${esc(t.text)} (${asHex ? esc(hex(v, D, v > 0xFF || v < 0 ? 4 : 2)) : v}${known && known.toUpperCase() !== t.upper ? ', ' + esc(known) : ''})`;
      }
      if (mode === 'imm') return `the address of ${esc(t.text)}`;
      if (mode === 'addr' && def.kind === 'data') {
        const h = heldValue(def, ctx);
        if (h !== null) return `${esc(t.text)} (written as ${esc(decHex(h, D))})`;
      }
      return esc(t.text);
    }
    if (t.type === 'num' && t.value !== null) {
      const known = mode !== 'imm' ? addressName(t.value, D) : null;
      if (known) return t.radix === 10 ? `${t.value} (${esc(hex(t.value, D, 4))}, ${esc(known)})` : `${esc(hex(t.value, D, 4))} (${esc(known)})`;
      if (mode === 'addr') return esc(hex(t.value, D, t.radix === 16 && t.digits <= 2 && t.value <= 0xFF ? 2 : 4));   // $FB stays $FB
      if (t.radix === 10) return esc(decHex(t.value, D));
      return `${esc(t.text)} (${t.value})`;
    }
    if (t.type === 'str' && t.value !== null) return `${esc(t.text)} (${t.value})`;
    return esc(text);
  }
  const v = ctx.eval(text);
  if (v === null) return esc(text);
  if (mode === 'addr') return `${esc(text)} (${esc(hex(v, D))})`;
  return `${esc(text)} (= ${v}${v > 9 || v < 0 ? ', ' + esc(hex(v, D)) : ''})`;
}

function fillForm(form, m, size, ctx, line) {
  const D = ctx.D;
  let tpl = (size === 'byte' && form.byteText) ? form.byteText : form.text;
  return tpl.replace(/\{(unit|step|r\d|e\d|v\d|off\d|\d)\}/g, (all, key) => {
    if (key === 'unit') return unitName(size, D);
    if (key === 'step') return size === 'byte' ? '1' : size === 'word' ? '2' : '1 or 2';
    const n = parseInt(key.replace(/\D/g, ''), 10);
    const cap = m[n] === undefined ? '' : m[n];
    if (key[0] === 'r') return regText(cap, ctx, line);
    if (key[0] === 'e') return describeExpr(cap, ctx, 'addr');
    if (key[0] === 'v') return describeExpr(cap, ctx, 'imm');
    if (key.startsWith('off')) {
      const v = ctx.eval(cap);
      if (v === null) return esc(cap) + ' past';
      if (v === 0) return 'at';
      return v > 0 ? `${v} past` : `${-v} before`;
    }
    return esc(cap.toUpperCase());
  });
}

function matchForm(text, D) {
  const t = text.trim();
  for (const f of D.operandForms) {
    if (f.anyRegister) { if (D.isRegister(t)) return { form: f, m: [t, t] }; continue; }
    const m = f.rx.exec(t);
    if (m) return { form: f, m };
  }
  return null;
}

function describeOperand(op, kind, size, ctx, line) {
  const D = ctx.D;
  const text = op.text;
  switch (kind) {
    case 'g': {
      const hit = matchForm(text, D);
      if (hit) return fillForm(hit.form, hit.m, size, ctx, line);
      return describeExpr(text, ctx, 'imm');
    }
    case 'r': return D.isRegister(text) ? regText(text, ctx, line) : esc(text);
    case 'p': {
      // a hardware port, written in brackets: (254), ($FE), (C)
      const inner = text.trim().replace(/^\((.*)\)$/s, '$1').trim();
      if (D.isRegister(inner)) return 'the port whose number is in BC';     // (C): B is the top half
      const v = ctx.eval(inner);
      const p = v === null ? null : D.ioPort(v);
      return `port ${describeExpr(inner, ctx, 'imm')}${p && p.name ? ` (${esc(p.name)})` : ''}`;
    }
    case 'i': return describeExpr(text, ctx, 'imm');
    case 't': return describeExpr(text, ctx, 'target');
    case 'n': {
      const v = ctx.eval(text);
      if (v === 0) return 'the number of bits held in R0';
      if (v !== null) return plural(v, 'bit');
      return esc(text) + ' bits';
    }
    case 'nb': {
      const v = ctx.eval(text);
      if (v === 0) return '16 bits';
      if (v !== null) return plural(v, 'bit');
      return esc(text) + ' bits';
    }
    case 'cc': {
      const c = D.conditions.get(text.toUpperCase());
      return c ? c.text : esc(text);
    }
    default: return esc(text);
  }
}

/** Where a B / BL / BLWP style operand sends the program. */
function describeTarget(op, ctx, line) {
  const D = ctx.D;
  const t = op.text.trim();
  const pre = D.syntax.addressPrefix;
  if (pre && t.startsWith(pre) && !/\(/.test(t)) return describeExpr(t.slice(pre.length), ctx, 'target');
  const hit = matchForm(t, D);
  if (hit && hit.form.text.includes('points at')) return 'the address held in ' + regText(hit.m[1], ctx, line);
  if (D.isRegister(t)) return 'the address held in ' + regText(t, ctx, line);
  return describeExpr(t, ctx, 'target');
}

/**
 * On the 6502, "$D020,X" is one address written in two parts. For explaining, put the parts
 * back together so the chip file can describe the whole thing at once.
 */
function joinedLine(pl, D) {
  const ops = pl.operands;
  if (!D.syntax.joinIndexed || ops.length !== 2 || !D.isRegister(ops[1].text.trim())) return pl;
  return Object.assign({}, pl, { operands: [{ text: ops[0].text + ',' + ops[1].text.trim(), start: ops[0].start, end: ops[1].end }] });
}

/** One sentence saying what this particular line does, or null. */
function explainLine(pl, ctx, line) {
  const D = ctx.D;
  if (!pl.mnem) return null;
  const ins = D.instr(pl.mnem.upper);
  if (!ins || !ins.explain) return null;
  pl = joinedLine(pl, D);
  const count = pl.operands.length;
  const kinds = opKinds(ins, count);
  if (!kinds || kinds.length !== count) return null;

  for (const s of ins.special || []) {
    let hit = false;
    if (s.same) hit = count === 2 && pl.operands[0].text.toUpperCase() === pl.operands[1].text.toUpperCase();
    else if (s.re) hit = (s.rx || new RegExp(s.re, 'i')).test(pl.operands.map(o => o.text).join(','));
    if (!hit) continue;
    return s.text.replace(/\{(\d)\}/g, (a, n) => {
      const op = pl.operands[n - 1];
      return op ? describeOperand(op, kinds[n - 1], sizeFor(ins, pl, ctx), ctx, line) : a;
    });
  }

  if ((ins.cond && count === 1) || condOperand(ins, pl, D)) {
    const smart = explainJump(ins, pl, ctx, line);
    if (smart) return smart;
  }

  let tpl = typeof ins.explain === 'string' ? ins.explain : ins.explain[String(count)];
  if (!tpl) return null;
  const size = sizeFor(ins, pl, ctx);

  let pow = null;
  if (tpl.includes('{pow2}')) {
    const v = pl.operands[1] ? ctx.eval(pl.operands[1].text) : null;
    if (v !== null && v >= 1 && v <= 15) pow = Math.pow(2, v);
    else if (ins.explainNoPow) tpl = ins.explainNoPow;
  }
  return tpl.replace(/\{(\d)t\}|\{next(\d)\}|\{pow2\}|\{(\d)\}/g, (all, tgt, nxt, plain) => {
    if (all === '{pow2}') return pow === null ? '?' : String(pow);
    if (tgt) { const op = pl.operands[tgt - 1]; return op ? describeTarget(op, ctx, line) : all; }
    if (nxt) {
      const op = pl.operands[nxt - 1];
      const m = op && /^R(\d+)$/i.exec(op.text.trim());
      return m ? regText('R' + ((parseInt(m[1], 10) + 1) % 16), ctx, line) : 'the next register';
    }
    const op = pl.operands[plain - 1];
    return op ? describeOperand(op, kinds[plain - 1], size, ctx, line) : all;
  });
}

/** For chips that write the test as the first operand (Z80: JR NZ,loop): that condition, or null. */
function condOperand(ins, pl, D) {
  if (ins.cond) return null;
  const kinds = opKinds(ins, pl.operands.length);
  if (!kinds || kinds[0] !== 'cc' || !pl.operands[0]) return null;
  return D.conditions.get(pl.operands[0].text.trim().toUpperCase()) || null;
}

const COMPARE_WORDS = {
  eq: 'is equal to', ne: 'is not equal to',
  gt: 'is greater than', lt: 'is less than',
  h: 'is greater than', he: 'is greater than or equal to', l: 'is less than', le: 'is less than or equal to'
};
const SIGNED_NOTE = { gt: ' (as signed numbers)', lt: ' (as signed numbers)', h: ' (as unsigned numbers)', he: ' (as unsigned numbers)', l: ' (as unsigned numbers)', le: ' (as unsigned numbers)' };
const RESULT_WORDS = { eq: 'is 0', ne: 'is not 0', gt: 'is above 0', lt: 'is below 0 (negative)', mi: 'has its top bit on (negative)', pl: 'has its top bit off (0 to 127)' };

/**
 * A jump such as JNE only makes sense next to the line before it.
 * If that line is right above (no label in between), say exactly what is being asked.
 */
function explainJump(ins, pl, ctx, line) {
  const D = ctx.D;
  const model = ctx.model;
  if (pl.label) return null;
  // which test: the instruction's own (JNE, BNE), or the condition written first (JR NZ,...).
  // The Z80's C means "smaller" straight after CP, but "a 1 fell out" after a shift.
  const cc = condOperand(ins, pl, D);
  const codes = ins.cond ? { cmp: ins.cond, res: ins.cond } : cc ? { cmp: cc.cmp, res: cc.res } : null;
  if (!codes) return null;
  const kinds = opKinds(ins, pl.operands.length) || [];
  const tIndex = kinds.lastIndexOf('t');
  let k = line - 1, prev = null;
  // the statements before this one: earlier on the same line ("CMP #2:BCS exit"), then the lines above
  for (const b of model.statementsBefore(line, pl.part, 11)) {
    const p = b.pl;
    k = b.line;
    if (p.mnem) {
      const pi = D.instr(p.mnem.upper);
      // another conditional jump just above: it doesn't change the flags, so keep looking
      if (pi && (pi.cond || (condOperand(pi, p, D) && !pi.call)) && !p.label) continue;
      prev = p;
      break;
    }
    if (p.label) return null;   // a label on its own: code could arrive here from elsewhere
  }
  return prevResult(prev && joinedLine(prev, D));

  function prevResult(p) {
    if (!p || !p.mnem) return null;
    const pi = D.instr(p.mnem.upper);
    if (!pi || !(pi.sets || pi.resultReg)) return null;
    // INC BC changes no flags at all, unlike INC B
    if (pi.setsUnlessRx && pi.setsUnlessRx.test(p.operands.map(o => o.text.trim()).join(','))) return null;
    // a jump straight after another jump: look further up is not safe, so give up
    const kinds = opKinds(pi, p.operands.length);
    if (!kinds || kinds.length !== p.operands.length) return null;
    const size = sizeFor(pi, p, ctx);
    const quiet = (i) => describeOperand(p.operands[i], kinds[i], size, ctx, k).replace(/\s\([^()]*then moves on by[^()]*\)/, '');
    const tgt = ins.cond ? pl.operands[0] : tIndex >= 0 ? pl.operands[tIndex] : null;
    const to = tgt ? describeOperand(tgt, 't', undefined, ctx, line) : '';
    const lead = ins.returns ? 'Return' : ins.call ? `Call ${to}` : `Jump to ${to}`;
    const c = pi.sets === 'compare' ? codes.cmp : codes.res;
    if (!c) return null;
    const rr = byCount(pi.resultReg, p.operands.length);
    const resultText = rr === '{1}' ? quiet(0) : rr ? regText(rr, ctx, k) : null;
    // chips that compare against a register named by the instruction (6502: CMP compares with A)
    if (pi.sets === 'compare' && pi.compareReg && COMPARE_WORDS[c] && p.operands.length === 1) return `${lead} if ${regText(pi.compareReg, ctx, k)} ${COMPARE_WORDS[c]} ${quiet(0)}${pi.signed === false ? '' : SIGNED_NOTE[c] || ''}.`;
    if (resultText && RESULT_WORDS[c]) return `${lead} if ${resultText} ${RESULT_WORDS[c]}.`;
    if (pi.sets === 'compare' && COMPARE_WORDS[c] && p.operands.length >= 2) return `${lead} if ${quiet(0)} ${COMPARE_WORDS[c]} ${quiet(1)}${SIGNED_NOTE[c] || ''}.`;
    if (pi.sets && pi.sets.startsWith('result:') && RESULT_WORDS[c]) return `${lead} if ${quiet(parseInt(pi.sets.slice(7), 10) - 1)} ${RESULT_WORDS[c]}.`;
    if (pi.sets && (pi.sets.startsWith('shift:') || pi.sets.startsWith('carry:'))) {
      // shift:1 is the first operand; shift:A (RLCA and friends) names the register
      const which = pi.sets.slice(6);
      const r = /^\d+$/.test(which) ? quiet(parseInt(which, 10) - 1) : regText(which, ctx, k);
      if (c === 'oc') return `${lead} if the last bit shifted out of ${r} was 1.`;
      if (c === 'nc') return `${lead} if the last bit shifted out of ${r} was 0.`;
      if (RESULT_WORDS[c] && pi.sets.startsWith('shift:')) return `${lead} if ${r} ${RESULT_WORDS[c]}.`;
      return null;
    }
    if (pi.sets === 'testbit' && (c === 'eq' || c === 'ne')) return `${lead} if bit ${quiet(0)} of ${quiet(1)} was ${c === 'eq' ? 0 : 1}.`;
    if (pi.sets === 'ones' && (c === 'eq' || c === 'ne')) return `${lead} if ${c === 'eq' ? 'all' : 'not all'} of those bits were on.`;
    if (pi.sets === 'zeros' && (c === 'eq' || c === 'ne')) return `${lead} if ${c === 'eq' ? 'all' : 'not all'} of those bits were off.`;
    if (pi.sets === 'bit' && (c === 'eq' || c === 'ne')) return `${lead} if that hardware line was ${c === 'eq' ? 1 : 0}.`;
    return null;
  }
}

function sizeFor(ins, pl, ctx) {
  if (ins.sizeFromOps) return pl.operands.some(o => ctx.D.registers.wide.has(o.text.trim().toUpperCase())) ? 'word' : 'byte';
  if (ins.sizeByCount) {
    const op = pl.operands[ins.sizeByCount - 1];
    const v = op ? ctx.eval(op.text) : null;
    if (v !== null) return (v >= 1 && v <= 8) ? 'byte' : 'word';
    return undefined;
  }
  return ins.size;
}

/** How long this line's instruction takes (lib/timing.js), or null. */
function timeFor(ins, pl, ctx, line) {
  const info = ctx.lineInfo && line !== undefined ? ctx.lineInfo(line, pl.part) : null;
  const known = info && !info.approx && !info.skipped;
  return T.cyclesFor(ins, pl, ctx.D, {
    ev: (t) => ctx.eval(t),
    size: known ? info.size : undefined,
    addr: known && !info.reloc ? info.addr : undefined,
    sizeName: sizeFor(ins, pl, ctx)
  });
}

// ---------------------------------------------------------------------------
// Tooltips
// ---------------------------------------------------------------------------
function hoverInstruction(pl, ctx, line) {
  const D = ctx.D;
  const ins = D.instr(pl.mnem.upper);
  if (!ins) return null;
  const out = [];
  out.push(`**${esc(ins.key)}** — ${ins.name}`);
  if (ins.syntax) out.push('```\n' + ins.syntax + '\n```');
  out.push(ins.summary);
  if (ins.more) out.push(ins.more);
  const ex = explainLine(pl, ctx, line);
  if (ex) out.push(`**This line:** ${ex}`);
  if (ins.flags) out.push(`*Flags:* ${ins.flags}`);
  const time = timeFor(ins, pl, ctx, line);
  if (time) out.push(`*Time:* ${esc(time.text)}`);
  return out;
}

function hoverDirective(pl, ctx, line) {
  const D = ctx.D;
  const dir = D.directive(pl.mnem.upper);
  if (!dir) return null;
  const out = [];
  out.push(`**${esc(dir.key)}** — ${dir.name} *(an instruction to the assembler, not to the chip)*`);
  if (dir.syntax) out.push('```\n' + dir.syntax + '\n```');
  out.push(dir.summary);
  if (dir.kind === 'equ' && dir.nameFirst && pl.operands.length) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/s.exec(pl.operands.map(o => o.text).join(','));
    const v = m ? ctx.eval(m[2]) : null;
    if (v !== null) out.push(`**This line:** ${esc(m[1])} now stands for ${esc(decHex(v, D))}.`);
  } else if (dir.kind === 'equ' && pl.label && pl.operands.length) {
    const v = ctx.eval(pl.operands.map(o => o.text).join(','));
    if (v !== null) out.push(`**This line:** ${esc(pl.label.name)} now stands for ${esc(decHex(v, D))}.`);
  } else if (dir.kind === 'data' && dir.unit && pl.operands.length) {
    const n = pl.operands.length;
    const what = dir.unit === 1 ? plural(n, 'byte') : dir.unit === 2 ? `${plural(n, 'word')} (${n * 2} bytes)` : `${n * dir.unit} bytes`;
    out.push(`**This line:** puts ${what} into the program.`);
  } else if ((dir.kind === 'if' || dir.kind === 'elif') && pl.operands.length) {
    const v = ctx.eval(pl.operands.map(o => o.text).join(','));
    if (v !== null) out.push(`**This line:** the test is ${v ? 'true' : 'false'} (${v}), so the lines after it are ${v ? 'put in' : 'left out'}.`);
  } else if (dir.kind === 'space' && pl.operands.length) {
    const v = ctx.eval(pl.operands[0].text);
    if (v !== null) out.push(`**This line:** leaves a gap of ${plural(v, 'byte')}.`);
  }
  return out;
}

function kindPhrase(def) {
  switch (def.kind) {
    case 'equ': return 'a name for a number';
    case 'code': return 'a place in the code';
    case 'data': return 'a place holding data';
    case 'extern': return 'defined outside this program';
    case 'macro': return 'a macro (a named group of lines)';
    case 'param': return 'a name used while assembling (a value given to a macro, a loop counter or a .var)';
    default: return 'a label';
  }
}

function hoverSymbol(name, ctx, opts) {
  const D = ctx.D;
  opts = opts || {};
  const defs = ctx.findDefs(name);
  const out = [];
  const known = D.knownSymbols.get(name.toUpperCase());
  const userNote = ctx.symbolNote(name);

  if (!defs.length) {
    if (!known && !userNote) return opts.quiet ? null : [`**${esc(name)}** — no label with this name was found in this program.`];
    out.push(`**${esc(name)}**`);
    if (userNote) out.push(`*Your note:* ${esc(userNote)}`);
    if (known) out.push(known.text);
    return out;
  }

  const shown = defs.slice(0, 3);
  for (const def of shown) {
    const m = ctx.modelOf(def);
    const where = def.file === ctx.file ? `line ${def.line + 1}` : `line ${def.line + 1} of ${esc(path.basename(def.file))}`;
    let head = `**${esc(def.name)}** — ${kindPhrase(def)}`;
    if (def.kind === 'equ') {
      const v = ctx.value(def.name);
      if (v !== null) head = `**${esc(def.name)}** = ${esc(hex(v, D, v > 0xFF || v < 0 ? 4 : 2))} (${v} in decimal)`;
    }
    out.push(head);
    if (m) {
      let src = m.rawLines[def.line].trim();
      const pl = m.lines[def.line];
      if (!pl.mnem) {
        // a label on a line of its own: show the first real line after it too
        for (let k = def.line + 1; k < m.lines.length && k < def.line + 6; k++) {
          if (m.lines[k].mnem) { src += '\n' + m.rawLines[k].trim(); break; }
        }
      }
      out.push('```\n' + src + '\n```');
      const doc = def.kind === 'equ' ? [] : m.docAbove(def.line);
      if (doc.length) out.push('```text\n' + doc.join('\n') + '\n```');
    }
    if (def.kind === 'equ') {
      const v = ctx.value(def.name);
      if (v !== null) {
        const note = ctx.addressNote(v) || (v >= D.addressGuess.min || ctx.usedAsAddress(def.upper || def.name) ? D.addresses.get(v) : null);
        if (note) out.push(note);
        else if (ctx.usedAsAddress(def.upper || def.name)) {
          const r = D.region(v);
          if (r) out.push(`As a memory address, ${esc(hex(v, D, 4))} is in ${r.text}.`);
        }
      }
    }
    if (def.kind === 'data') {
      const h = heldValue(def, ctx);
      if (h !== null) out.push(`Written as ${esc(decHex(h, D))} in the source.`);
    }
    if (known && def === shown[0]) {
      // a helper the program defines itself (an EQU, or its own copy of the routine) is still that helper
      if (def.kind === 'extern') out.push(known.text);
      else out.push('*The standard meaning of this name:*\n\n' + known.text);
    }
    const uses = ctx.countRefs(def.upper || def.name);
    out.push(`Defined on ${where}. ${uses === 0 ? 'Not used anywhere yet.' : 'Used ' + (uses === 1 ? 'once' : uses + ' times') + '.'}`);
  }
  if (defs.length > shown.length) out.push(`… and ${defs.length - shown.length} more with the same name.`);
  if (defs.length > 1) out.push(`⚠ This name is defined ${defs.length} times.`);
  if (userNote) out.push(`*Your note:* ${esc(userNote)}`);
  return out;
}

function groupBits(v, bits) {
  let s = (v >>> 0).toString(2);
  while (s.length < bits) s = '0' + s;
  return s.replace(/(.{4})(?=.)/g, '$1 ');
}

function hoverNumber(tok, ctx, opts) {
  const D = ctx.D;
  opts = opts || {};
  const v = tok.value;
  if (v === null || v === undefined) return null;
  const out = [];
  const wide = v > 0xFF;
  const rows = [];
  rows.push(`| Decimal | ${v} |`);
  rows.push(`| Hex | ${esc(hex(v, D, wide ? 4 : 2))} |`);
  rows.push(`| Binary | ${groupBits(v, wide ? 16 : 8)} |`);
  if (wide && v <= 0xFFFF) {
    const hi = v >> 8, lo = v & 0xFF;
    rows.push(`| ${cap(D.syntax.highByteName)} | ${esc(hex(hi, D, 2))} (${hi}) |`);
    rows.push(`| ${cap(D.syntax.lowByteName)} | ${esc(hex(lo, D, 2))} (${lo}) |`);
    if (v >= 0x8000) rows.push(`| As a signed number | ${v - 0x10000} |`);
  } else if (v >= 32 && v <= 126) {
    rows.push(`| As a letter | \`${String.fromCharCode(v) === '`' ? "' ` '" : String.fromCharCode(v)}\` |`);
  }
  out.push(`**${esc(tok.text)}**\n\n| | |\n|---|---|\n` + rows.join('\n'));
  const user = ctx.addressNote(v);
  if (user) out.push(`*Your note:* ${esc(user)}`);
  if (opts.asAddress) {
    const note = D.addresses.get(v);
    if (note) out.push(note);
    else { const r = D.region(v); if (r) out.push(`As a memory address, this is in ${r.text}.`); }
  } else if (((tok.radix === 16 && tok.digits === 4) || (D.addressGuess.decimal && tok.radix === 10 && v > 0xFF)) && v >= D.addressGuess.min && D.addresses.has(v)) {
    out.push(`If this is a memory address: ${D.addresses.get(v)}`);
  }
  return out;
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function hoverRegister(tok, ctx, line) {
  const D = ctx.D;
  const u = tok.text.toUpperCase();
  const out = [];
  const mine = ctx.regNote(u, line);
  out.push(mine ? `**${esc(u)}** — ${esc(mine)}` : `**${esc(u)}** — register`);
  const special = D.registers.notes.get(u);
  if (special) out.push(special);
  if (D.registers.workspaceInstruction) {
    const ws = ctx.workspace();
    const idx = D.registers.list.findIndex(n => n.toUpperCase() === u);
    if (ws !== null && idx >= 0) {
      const a = ws + idx * 2;
      out.push(`Lives in memory at ${esc(hex(a, D, 4))} (${D.syntax.highByteName}) and ${esc(hex(a + 1, D, 4))} (${D.syntax.lowByteName}).`);
    }
  }
  if (D.registers.about) out.push(D.registers.about);
  if (!mine) out.push(`*Tip: add a comment line like* \`${(D.syntax.lineComment && D.syntax.lineComment[0]) || ';'} @reg ${u} = what it holds\` *and it will show here.*`);
  return out;
}

/** Extra help about the shape of a whole operand (*R1+, @LABEL(R1) ...). */
function hoverOperandForm(op, ctx, onPunctuation) {
  const hit = matchForm(op.text, ctx.D);
  if (!hit || !hit.form.help) return null;
  if (hit.form.quiet && !onPunctuation) return null;
  return [`\`${op.text.replace(/`/g, '')}\` — **${hit.form.name}.** ${hit.form.help}`];
}

/** A one-page cheat sheet for a dialect, as Markdown. */
function referenceSheet(D) {
  const out = [`# ${D.name}`, ''];
  if (D.about) out.push(D.about, '');
  const groups = new Map();
  for (const ins of D.instructions.values()) {
    const g = ins.group || 'Instructions';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(ins);
  }
  for (const [g, list] of groups) {
    out.push(`## ${g}`, '', '| Instruction | Written as | What it does |', '|---|---|---|');
    for (const ins of list) out.push(`| **${ins.key}** — ${ins.name} | \`${ins.syntax || ins.key}\` | ${ins.summary.replace(/\|/g, '\\|')} |`);
    out.push('');
  }
  if (D.timing && D.timing.about) out.push('## How long instructions take', '', D.timing.about + ' Hover an instruction to see its number of cycles.', '');
  if (D.operandForms.some(f => f.help)) {
    out.push('## Ways of writing an operand', '', '| Shape | Called | What it means |', '|---|---|---|');
    for (const f of D.operandForms) if (f.help || f.name) out.push(`| \`${f.example || f.re}\` | ${f.name || ''} | ${(f.help || '').replace(/\|/g, '\\|')} |`);
    out.push('');
  }
  if (D.directives.size) {
    out.push('## Instructions to the assembler', '', '| Directive | Written as | What it does |', '|---|---|---|');
    for (const d of D.directives.values()) out.push(`| **${d.key}** — ${d.name} | \`${d.syntax || d.key}\` | ${d.summary.replace(/\|/g, '\\|')} |`);
    out.push('');
  }
  if (D.addresses.size) {
    out.push('## Memory addresses worth knowing', '', '| Address | What is there |', '|---|---|');
    for (const [a, t] of [...D.addresses].filter(x => !D.notInSheet || !D.notInSheet.has(x[0])).sort((x, y) => x[0] - y[0])) out.push(`| \`${hex(a, D, 4)}\` | ${t.replace(/\|/g, '\\|')} |`);
    out.push('');
  }
  if (D.regions.length) {
    out.push('## Memory map', '', '| From | To | What is there |', '|---|---|---|');
    for (const r of D.regions) out.push(`| \`${hex(r.from, D, 4)}\` | \`${hex(r.to, D, 4)}\` | ${r.text} |`);
    out.push('');
  }
  if (D.ioPorts && D.ioPorts.size) {
    out.push('## Hardware ports (IN and OUT)', '', '| Port | What is there |', '|---|---|');
    for (const [a, p] of [...D.ioPorts].sort((x, y) => x[0] - y[0])) out.push(`| \`${hex(a, D, a > 0xFF ? 4 : 2)}\` | ${String(p.text || p.name || '').replace(/^\*\*[^*]*\*\*\s*(is\s+)?/, '').replace(/\|/g, '\\|')} |`);
    out.push('');
  }
  return out.join('\n');
}

module.exports = { esc, hex, addressName, decHex, describeOperand, explainLine, timeFor, hoverInstruction, hoverDirective, hoverSymbol, hoverNumber, hoverRegister, hoverOperandForm, referenceSheet, matchForm };
