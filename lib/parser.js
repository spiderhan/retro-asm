'use strict';
// Reads assembly source one line at a time and works out, for each line:
// the label, the instruction, the operands and the comment.
// Then builds a list of every label defined and every place a label is used.
// Nothing in here knows about VS Code.

const isSpace = (c) => c === ' ' || c === '\t';
const HEX = /[0-9A-Fa-f]/;
const ID_START = /[A-Za-z_]/;
const ID_BODY = /[A-Za-z0-9_]/;

/**
 * Does a quote mark start a piece of text here? On the Z80, ' also ends the register name AF',
 * so with "primeAfterName" a ' straight after a letter or digit doesn't count.
 */
function opensQuote(text, i, syn) {
  const c = text[i];
  if (!syn.stringQuotes.includes(c)) return false;
  return !(c === "'" && syn.primeAfterName && i > 0 && /[A-Za-z0-9_]/.test(text[i - 1]));
}

/** Split an operand field on commas that are not inside quotes or brackets. */
function splitOperands(code, from, to, syn) {
  const out = [];
  let depth = 0, q = null, start = from;
  const push = (a, b) => {
    while (a < b && isSpace(code[a])) a++;
    while (b > a && isSpace(code[b - 1])) b--;
    out.push({ text: code.slice(a, b), start: a, end: b });
  };
  for (let i = from; i < to; i++) {
    const c = code[i];
    if (q) { if (c === q) q = null; continue; }
    if (opensQuote(code, i, syn)) { q = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === ',' && depth === 0) { push(start, i); start = i + 1; }
  }
  if (start < to || out.length) push(start, to);
  return out.filter((o, i, a) => o.text.length || a.length > 1);
}

const startsAny = (text, i, marks) => marks.some(m => m && text.startsWith(m, i));

/**
 * Parse one line of source. `st` carries what one line leaves for the next (being inside a
 * block comment); give the same object to every line of a file, in order. It can be left out.
 */
function parseLine(text, D, st) {
  const syn = D.syntax;
  const res = { label: null, mnem: null, operands: [], comment: null };
  st = st || {};
  const block = syn.blockComment && syn.blockComment.length === 2 ? syn.blockComment : null;
  let skipTo = 0;
  if (block && st.inBlock) {
    const e = text.indexOf(block[1]);
    if (e < 0) { if (text.length) res.comment = { start: 0, text }; return res; }
    st.inBlock = false;
    res.comment = { start: 0, text: text.slice(0, e + block[1].length) };
    skipTo = e + block[1].length;
    text = ' '.repeat(skipTo) + text.slice(skipTo);
  }
  if (!text.length) return res;
  if (!skipTo && syn.col0Comment.includes(text[0])) { res.comment = { start: 0, text }; return res; }

  // 1. where does the comment start?
  let cs = text.length, q = null;
  for (let i = skipTo; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === q) q = null; continue; }
    if (opensQuote(text, i, syn)) { q = c; continue; }
    if (block && text.startsWith(block[0], i)) {
      const e = text.indexOf(block[1], i + block[0].length);
      if (e < 0) { st.inBlock = true; cs = i; break; }
      // a /* short note */ in the middle of a line: blank it out and carry on
      const stop = e + block[1].length;
      text = text.slice(0, i) + ' '.repeat(stop - i) + text.slice(stop);
      i = stop - 1;
      continue;
    }
    if (startsAny(text, i, syn.lineComment)) { cs = i; break; }
    if (syn.spaceStarComment && c === '*' && i > 0 && isSpace(text[i - 1]) &&
        (i + 1 >= text.length || isSpace(text[i + 1]))) { cs = i; break; }
  }
  if (syn.braceBlocks) {
    // { and } only group lines together (scopes, .for and .if blocks): treat them as spaces
    let qq = null, t = '';
    for (let i = 0; i < cs; i++) {
      const c = text[i];
      if (qq) { if (c === qq) qq = null; t += c; continue; }
      if (syn.stringQuotes.includes(c)) { qq = c; t += c; continue; }
      if (c === '{') res.open = (res.open || 0) + 1;
      if (c === '}') res.close = (res.close || 0) + 1;
      t += (c === '{' || c === '}') ? ' ' : c;
    }
    text = t + text.slice(cs);
  }
  let end = cs;
  while (end > 0 && isSpace(text[end - 1])) end--;
  const code = text.slice(0, end);
  if (cs < text.length) { if (res.comment && skipTo) res.comment = null; if (!res.comment) res.comment = { start: cs, text: text.slice(cs) }; }
  if (!code.trim().length) return res;

  // BeebAsm (and BBC BASIC): several statements on one line, split by ":" ("LDA #1:STA &70")
  const spans = syn.colonStatements ? colonSpans(code, syn) : null;
  if (!spans || spans.length < 2) {
    if (!spans || !spans.length) return parseStatement(code, text, D, res);
    // one statement, but maybe with a ":" before or after it (".loop:" is fine in BeebAsm)
    const sp = spans[0];
    const seg = (' '.repeat(sp.from) + code.slice(sp.from, sp.to)).replace(/\s+$/, '');
    const r = seg.length === code.length ? parseStatement(code, text, D, res) : parseStatement(seg, seg, D, res);
    r.from = sp.from; r.to = sp.to;
    return r;
  }
  res.parts = [];
  for (const sp of spans) {
    // blank out everything but this statement, so every position stays where it is on the line
    const seg = (' '.repeat(sp.from) + code.slice(sp.from, sp.to)).replace(/\s+$/, '');
    const part = sp === spans[0] ? res : { label: null, mnem: null, operands: [], comment: null };
    parseStatement(seg, seg, D, part);
    part.from = sp.from; part.to = sp.to; part.part = res.parts.length;
    res.parts.push(part);
  }
  return res;
}

/** Where each ":"-separated statement starts and ends on a line (quotes and brackets kept whole). */
function colonSpans(code, syn) {
  const out = [];
  let q = null, depth = 0, start = 0;
  const push = (a, b) => { if (code.slice(a, b).trim().length) out.push({ from: a, to: b }); };
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (q) { if (c === q) q = null; continue; }
    if (opensQuote(code, i, syn)) { q = c; continue; }
    if (c === '(' || c === '[') depth++;
    else if ((c === ')' || c === ']') && depth > 0) depth--;
    else if (c === ':' && depth === 0) { push(start, i); start = i + 1; }
  }
  push(start, code.length);
  return out;
}

/** The label, instruction and operands of one statement. `code` has no comment and no trailing spaces. */
function parseStatement(code, text, D, res) {
  const syn = D.syntax;
  const setComment = (at) => { if (at < text.length && !res.comment) res.comment = { start: at, text: text.slice(at) }; };

  // "*=$0801" (or "* = $0801"): where the following code goes
  if (syn.starOrigin) {
    const m = /^(\s*)\*\s*=/.exec(code);
    if (m) {
      const a = m[1].length;
      res.mnem = { text: '*=', upper: '*=', start: a, end: m[0].length };
      const o = m[0].length;
      res.operands = splitOperands(code, o, code.length, syn);
      return res;
    }
  }

  // 2. label
  let i = 0;
  const n = code.length;
  if (syn.dotLabels) {
    // BeebAsm: ".loop", anywhere on the line. ".*name" is seen everywhere, ".^name" one scope out.
    let a = 0;
    while (a < n && isSpace(code[a])) a++;
    if (code[a] === '.') {
      let s = a + 1, mark = '';
      if (code[s] === '*' || code[s] === '^') { mark = code[s]; s++; }
      if (ID_START.test(code[s] || '')) {
        let b = s;
        while (b < n && ID_BODY.test(code[b])) b++;
        if (syn.nameSuffix && code[b] === syn.nameSuffix) b++;
        res.label = { name: code.slice(s, b), start: s, end: b, mark };
        i = b;
      }
    }
  } else if (!isSpace(code[0])) {
    let j = 0;
    while (j < n && !isSpace(code[j]) && code[j] !== ':') j++;
    const tok = code.slice(0, j);
    const colon = code[j] === ':';
    if (!colon && (syn.labelsNeedColon || (!syn.col0IsAlwaysLabel && D.isMnemonic(tok)))) {
      // a dialect that lets instructions start in column 0
    } else {
      res.label = { name: tok, start: 0, end: j };
      i = j + (colon ? 1 : 0);
    }
  } else if (syn.indentedLabels) {
    let a = 0;
    while (a < n && isSpace(code[a])) a++;
    let b = a;
    while (b < n && !isSpace(code[b]) && code[b] !== ':') b++;
    if (code[b] === ':' && b > a) { res.label = { name: code.slice(a, b), start: a, end: b }; i = b + 1; }
  }

  // "name = value": a name for a number (BeebAsm, BBC BASIC)
  if (syn.assignments && !res.label) {
    const m = /^(\s*)([A-Za-z_][A-Za-z0-9_]*%?)(\s*)(=\??)(?!=)/.exec(code.slice(i));
    if (m && !D.isMnemonic(m[2])) {
      const s = i + m[1].length;
      res.label = { name: m[2], start: s, end: s + m[2].length };
      const e = s + m[2].length + m[3].length;
      res.mnem = { text: m[4], upper: '=', start: e, end: e + m[4].length };
      res.operands = splitOperands(code, e + m[4].length, n, syn);
      return res;
    }
  }

  // 3. instruction (or directive)
  while (i < n && isSpace(code[i])) i++;
  if (i >= n) return res;
  let m = i;
  while (m < n && !isSpace(code[m])) m++;
  // a call written with brackets: BasicUpstart2(start), clearScreen(0)
  const paren = syn.parenCalls ? code.indexOf('(', i) : -1;
  if (paren > i && paren < m && /^[A-Za-z_:.]/.test(code[i])) {
    let depth = 0, close = -1;
    for (let k = paren; k < n; k++) { if (code[k] === '(') depth++; else if (code[k] === ')' && --depth === 0) { close = k; break; } }
    const name = code.slice(i, paren);
    res.mnem = { text: name, upper: name.toUpperCase(), start: i, end: paren, call: true };
    res.operands = splitOperands(code, paren + 1, close < 0 ? n : close, syn);
    return res;
  }
  if (syn.tightOperands && !D.isMnemonic(code.slice(i, m))) {
    // BeebAsm lets the operand follow straight on: "LDA#5", "STA(ptr),Y", "LDA&70"
    const head = code.slice(i, i + 3);
    if (D.instructions.has(head.toUpperCase()) && (/[#(&$%'"\[<>*\-]/.test(code[i + 3] || '') || /^[Aa]$/.test(code.slice(i + 3, m)))) m = i + 3;
  }
  res.mnem = { text: code.slice(i, m), upper: code.slice(i, m).toUpperCase(), start: i, end: m };

  // 4. operands
  let o = m;
  while (o < n && isSpace(code[o])) o++;
  if (o >= n) return res;
  const range = D.operandRange(res.mnem.upper);
  if (range && range[1] === 0) { setComment(o); res.comment = { start: o, text: text.slice(o) }; return res; }

  let opEnd = n;
  if (syn.operandsEndAtSpace) {
    // Classic layout: the operands stop at the first space; anything after is a comment.
    // (A space straight after a comma is forgiven, so "LI R0, 5" still works.)
    let qq = null, k = o;
    for (; k < n; k++) {
      const c = code[k];
      if (qq) { if (c === qq) qq = null; continue; }
      if (opensQuote(code, k, syn)) { qq = c; continue; }
      if (isSpace(c)) {
        let p = k - 1;
        if (code[p] === ',') { if (res.spaceAt === undefined) res.spaceAt = k; while (k + 1 < n && isSpace(code[k + 1])) k++; continue; }
        let nx = k;
        while (nx < n && isSpace(code[nx])) nx++;
        if (code[nx] === ',') { if (res.spaceAt === undefined) res.spaceAt = k; k = nx; continue; }
        break;
      }
    }
    opEnd = k;
    if (opEnd < n) res.comment = { start: opEnd + (text.slice(opEnd).length - text.slice(opEnd).trimStart().length), text: text.slice(opEnd).trimStart() };
  }
  res.operands = splitOperands(code, o, opEnd, syn);
  return res;
}

/** Every statement on a parsed line: usually just the line itself. */
function statements(pl) { return pl && pl.parts ? pl.parts : [pl]; }

/**
 * Break a piece of operand text into tokens.
 * Types: num, str, reg, ident, here (the "current address" sign), op.
 */
function scan(text, base, D) {
  const syn = D.syntax;
  const toks = [];
  let i = 0;
  const n = text.length;
  outer:
  while (i < n) {
    const c = text[i];
    if (isSpace(c)) { i++; continue; }
    // quoted text
    if (opensQuote(text, i, syn)) {
      let j = i + 1;
      while (j < n) {
        if (text[j] === c) { if (text[j + 1] === c) { j += 2; continue; } break; }
        j++;
      }
      const body = text.slice(i + 1, j);
      const closed = j < n;
      let value = null;
      if (closed && body.length === 1) value = body.charCodeAt(0);
      else if (closed && body.length === 2) value = (body.charCodeAt(0) << 8) | body.charCodeAt(1);
      toks.push({ type: 'str', text: text.slice(i, closed ? j + 1 : n), start: base + i, end: base + (closed ? j + 1 : n), value, body });
      i = closed ? j + 1 : n;
      continue;
    }
    // hex with a prefix
    for (const p of syn.hexPrefixes) {
      if (text.startsWith(p, i) && HEX.test(text[i + p.length] || '')) {
        let j = i + p.length;
        while (j < n && HEX.test(text[j])) j++;
        toks.push({ type: 'num', text: text.slice(i, j), start: base + i, end: base + j, value: parseInt(text.slice(i + p.length, j), 16), radix: 16, digits: j - i - p.length });
        i = j;
        continue outer;
      }
    }
    // binary with a prefix
    for (const p of syn.binPrefixes) {
      if (text.startsWith(p, i) && /[01]/.test(text[i + p.length] || '')) {
        let j = i + p.length;
        while (j < n && /[01]/.test(text[j])) j++;
        toks.push({ type: 'num', text: text.slice(i, j), start: base + i, end: base + j, value: parseInt(text.slice(i + p.length, j), 2), radix: 2, digits: j - i - p.length });
        i = j;
        continue outer;
      }
    }
    // BeebAsm's P% (this address), before it is read as P and then %
    if (syn.hereNames) {
      const h = syn.hereNames.find(w => text.slice(i, i + w.length).toUpperCase() === w.toUpperCase() && !ID_BODY.test(text[i + w.length] || ''));
      if (h && !ID_BODY.test(text[i - 1] || '')) { toks.push({ type: 'here', text: text.slice(i, i + h.length), start: base + i, end: base + i + h.length }); i += h.length; continue; }
    }
    // two-character operators: << >> <= >= <> == !=
    if (syn.basicMath && /^(<<|>>|<=|>=|<>|==|!=)/.test(text.slice(i, i + 2))) {
      toks.push({ type: 'op', text: text.slice(i, i + 2), start: base + i, end: base + i + 2 });
      i += 2;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < n && ID_BODY.test(text[j])) j++;
      // BeebAsm: numbers with a fraction or a power of ten (2.5, 1E-3)
      if (syn.decimals && /^[0-9]+$/.test(text.slice(i, j))) {
        const fm = /^[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?/.exec(text.slice(i));
        if (fm && fm[0].length > j - i && !ID_BODY.test(text[i + fm[0].length] || '')) {
          toks.push({ type: 'num', text: fm[0], start: base + i, end: base + i + fm[0].length, value: parseFloat(fm[0]), radix: 10, digits: fm[0].length });
          i += fm[0].length;
          continue;
        }
      }
      const body = text.slice(i, j);
      let value = null, radix = 10, digits = body.length;
      if (/^[0-9]+$/.test(body)) value = parseInt(body, 10);
      else if (syn.hexSuffix && /^[0-9][0-9A-Fa-f]*[hH]$/.test(body)) { value = parseInt(body.slice(0, -1), 16); radix = 16; digits = body.length - 1; }
      else if (syn.hexSuffix && /^[01]+[bB]$/.test(body)) { value = parseInt(body.slice(0, -1), 2); radix = 2; digits = body.length - 1; }
      toks.push({ type: 'num', text: body, start: base + i, end: base + j, value, radix, digits });
      i = j;
      continue;
    }
    // a memory-space mark written in front of an address (GPL: V@ for video memory, G@ for GROM): not a name
    if (syn.operandPrefixes && syn.operandPrefixes.length && !ID_BODY.test(text[i - 1] || '')) {
      const mark = syn.operandPrefixes.find(m => text.slice(i, i + m.length).toUpperCase() === m.toUpperCase());
      if (mark) { toks.push({ type: 'op', text: text.slice(i, i + mark.length), start: base + i, end: base + i + mark.length }); i += mark.length; continue; }
    }
    if (ID_START.test(c) || (c === '.' && ID_START.test(text[i + 1] || ''))) {
      let j = i + 1;
      while (j < n && (ID_BODY.test(text[j]) || (syn.dotInNames && text[j] === '.' && ID_START.test(text[j + 1] || '')))) j++;
      // registers such as AF' on the Z80
      if (text[j] === "'" && D.isRegister(text.slice(i, j + 1))) j++;
      // BeebAsm names can end with % like BBC BASIC's whole-number variables (LOAD%, CODE_B%)
      if (syn.nameSuffix && text[j] === syn.nameSuffix) j++;
      const word = text.slice(i, j);
      // BBC BASIC style operators written as words: AND, OR, EOR, DIV, MOD
      if (syn.basicMath && WORD_OPS.has(word.toUpperCase())) {
        toks.push({ type: 'op', text: word.toUpperCase(), start: base + i, end: base + j });
        i = j;
        continue;
      }
      const tok = { type: D.isRegister(word) ? 'reg' : 'ident', text: word, upper: word.toUpperCase(), start: base + i, end: base + j };
      // music.init, scope.label: the part after the dot belongs to the first name, not followed
      let k = j;
      if (syn.dottedNames) while (text[k] === '.' && ID_START.test(text[k + 1] || '')) { k++; while (k < n && ID_BODY.test(text[k])) k++; }
      if (k > j) tok.member = text.slice(j, k);
      // a function call such as sin(x) or LoadSid("tune.sid")
      let after = k;
      while (after < n && isSpace(text[after])) after++;
      if (syn.parenCalls && text[after] === '(' && tok.type === 'ident') tok.type = 'func';
      // a function the assembler knows: LO(label), HI(label), NOT(x) ...
      if (syn.functions && (text[after] === '(' || text[after] === '[') && syn.functions.includes(tok.upper)) tok.type = 'func';
      toks.push(tok);
      i = k;
      continue;
    }
    if (c === '$') { toks.push({ type: 'here', text: c, start: base + i, end: base + i + 1 }); i++; continue; }
    if (c === '!') {
      // xas99 local label (!, !name): recognised, but not followed
      let j = i + 1;
      while (j < n && ID_BODY.test(text[j])) j++;
      toks.push({ type: 'local', text: text.slice(i, j), start: base + i, end: base + j });
      i = j;
      continue;
    }
    toks.push({ type: 'op', text: c, start: base + i, end: base + i + 1 });
    i++;
  }
  return toks;
}

// ---------------------------------------------------------------------------
// Sums. xas99 works sums out strictly left to right (no "times before plus"),
// other assemblers use the usual order. The dialect says which.
// ---------------------------------------------------------------------------
const PREC = { '|': 1, '^': 2, '&': 3, '+': 4, '-': 4, '*': 5, '/': 5, '%': 5 };
// BeebAsm's order, which follows BBC BASIC: ^ is "to the power of", comparisons give -1 for true
const BASIC_PREC = { OR: 2, EOR: 2, AND: 3, '=': 4, '==': 4, '<>': 4, '!=': 4, '<=': 4, '>=': 4, '<': 4, '>': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6, DIV: 6, MOD: 6, '<<': 6, '>>': 6, '^': 7 };
const WORD_OPS = new Set(['AND', 'OR', 'EOR', 'DIV', 'MOD']);

function applyOp(a, op, b) {
  if (a === null || b === null) return null;
  const t = (x) => (x ? -1 : 0);
  switch (op) {
    case 'AND': return a & b;
    case 'OR': return a | b;
    case 'EOR': return a ^ b;
    case 'DIV': return b === 0 ? null : Math.trunc(a / b);
    case 'MOD': return b === 0 ? null : a % b;
    case '<<': return a << b;
    case '>>': return a >> b;
    case '=': case '==': return t(a === b);
    case '<>': case '!=': return t(a !== b);
    case '<': return t(a < b);
    case '>': return t(a > b);
    case '<=': return t(a <= b);
    case '>=': return t(a >= b);
    case 'POW': return Math.pow(a, b);
    case 'FDIV': return b === 0 ? null : a / b;
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return b === 0 ? null : Math.trunc(a / b);
    case '%': return b === 0 ? null : a % b;
    case '&': return a & b;
    case '|': return a | b;
    case '^': return a ^ b;
  }
  return null;
}

/**
 * Work out the value of a sum. `resolve(name)` gives the value of a label (or null).
 * Returns a number, or null if it can't be worked out.
 */
function evalExpr(text, D, resolve, here) {
  const toks = scan(text, 0, D);
  if (!toks.length) return null;
  let p = 0;
  let failed = false;
  const peek = () => toks[p];
  const ltr = !!D.syntax.leftToRightMath;
  const basic = !!D.syntax.basicMath;
  const prec = basic ? BASIC_PREC : PREC;

  function primary() {
    const t = toks[p++];
    if (!t) { failed = true; return null; }
    if (t.type === 'num') return t.value;
    if (t.type === 'str') return t.value;
    if (t.type === 'ident') return resolve ? resolve(t.text) : null;
    if (t.type === 'here') return here === undefined ? null : here;
    if (t.type === 'op' && t.text === '*' && D.syntax.hereSymbol === '*') return here === undefined ? null : here;
    if (t.type === 'op' && (t.text === '(' || (basic && t.text === '['))) {
      const close = t.text === '(' ? ')' : ']';
      const v = expr(0);
      if (peek() && peek().text === close) p++; else failed = true;
      return v;
    }
    if (t.type === 'func' && D.syntax.functions) {
      // LO(x), HI(x), NOT(x) and friends
      const open = toks[p];
      if (!open || (open.text !== '(' && open.text !== '[')) { failed = true; return null; }
      p++;
      const v = expr(0);
      const close = open.text === '(' ? ')' : ']';
      if (peek() && peek().text === close) p++; else failed = true;
      return callFunction(t.upper, v);
    }
    failed = true;
    return null;
  }
  function unary() {
    const t = peek();
    if (t && t.type === 'op' && (t.text === '-' || t.text === '+' || t.text === '~')) {
      p++;
      const v = unary();
      if (v === null) return null;
      return t.text === '-' ? -v : t.text === '~' ? ~v : v;
    }
    if (t && t.type === 'op' && D.syntax.lowHighBytes && (t.text === '<' || t.text === '>')) {
      p++;
      const v = unary();
      if (v === null) return null;
      return t.text === '<' ? v & 0xFF : (v >> 8) & 0xFF;
    }
    return primary();
  }
  function expr(minPrec) {
    let left = unary();
    for (;;) {
      const t = peek();
      if (!t || t.type !== 'op' || !(t.text in prec)) break;
      const level = ltr ? 1 : prec[t.text];
      if (level < minPrec) break;
      p++;
      const right = ltr ? unary() : expr(level + 1);
      left = applyOp(left, basic && t.text === '^' ? 'POW' : basic && t.text === '/' ? 'FDIV' : t.text, right);
    }
    return left;
  }
  const v = expr(0);
  if (failed || p < toks.length) return null;
  return v;
}

/** The value of a function the assembler knows (BeebAsm: LO, HI, NOT ...), or null. */
function callFunction(name, v) {
  if (v === null) return null;
  switch (name) {
    case 'LO': return v & 0xFF;
    case 'HI': return (v >> 8) & 0xFF;
    case 'NOT': return ~v;
    case 'ABS': return Math.abs(v);
    case 'SGN': return Math.sign(v);
    case 'INT': return Math.floor(v);
    case 'SIN': return Math.sin(v);
    case 'COS': return Math.cos(v);
    case 'TAN': return Math.tan(v);
    case 'ATN': return Math.atan(v);
    case 'SQR': return v < 0 ? null : Math.sqrt(v);
    case 'RAD': return v * Math.PI / 180;
    case 'DEG': return v * 180 / Math.PI;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Whole-file model
// ---------------------------------------------------------------------------
function isCommentOnly(pl) { return !pl.label && !pl.mnem && !!pl.comment; }
function isBlank(pl) { return !pl.label && !pl.mnem && !pl.comment; }

function stripCommentMarker(text, D) {
  let t = text;
  const marks = D.syntax.lineComment.concat(D.syntax.col0Comment, D.syntax.spaceStarComment ? ['*'] : []);
  const block = D.syntax.blockComment || [];
  if (block.length === 2) {
    t = t.replace(/^\s*/, '');
    if (t.startsWith(block[0])) t = t.slice(block[0].length).replace(/^\*+/, '');
    else if (t.startsWith('*') && !t.startsWith(block[1])) t = t.slice(1);      // the " * " down the side of a block
    if (t.trimEnd().endsWith(block[1])) t = t.trimEnd().slice(0, -block[1].length);
  }
  const mark = marks.filter(m => m && t.startsWith(m)).sort((a, b) => b.length - a.length)[0];
  if (mark) t = t.slice(mark.length);
  if (t.startsWith(' ')) t = t.slice(1);
  return t.replace(/\s+$/, '');
}

const RULE_LINE = /^[\s\-=*_#~+.]*$/;

let scopeCounter = 0;

class Model {
  constructor(text, D, file) {
    this.D = D;
    this.file = file || '';
    this.text = text;
    this.rawLines = text.split(/\r?\n/);
    const st = {};
    this.lines = this.rawLines.map(l => parseLine(l, D, st));
    this.defs = new Map();      // UPPER name -> [def]
    this.defList = [];
    this.refs = [];             // every use of a name
    this.includes = [];         // COPY "file" lines
    this.regNotes = [];         // ;@reg R4 = Harry X
    this.macros = new Set();
    this.workspace = null;      // text of the LWPI operand, if any
    this.unknown = [];          // lines whose instruction isn't known
    this.scopes = null;         // with "dotLocals": the ordinary label each line comes under
    if (D.syntax.dotLocals) {
      let scope = '';
      this.scopes = this.lines.map(pl => {
        if (pl.label && !pl.label.name.startsWith('.')) scope = pl.label.name.toUpperCase();
        return scope;
      });
    }
    // BeebAsm: { } (and FOR ... NEXT, MACRO ... ENDMACRO) make a scope, where names can be
    // reused. braceStacks[line] lists the scopes the line is inside, outermost first.
    this.braceStacks = null;
    if (D.syntax.braceScopes) {
      // scope numbers are unique across every file, so a .loop in one file's { } never meets another's
      let next = scopeCounter;
      const stack = [];
      this.braceStacks = this.lines.map(pl => {
        const here = stack.slice();
        for (let k = 0; k < (pl.close || 0); k++) stack.pop();
        for (const st of statements(pl)) {
          const dir = st.mnem ? D.directive(st.mnem.upper) : null;
          if (dir && dir.scope === 'close') stack.pop();
          if (dir && dir.scope === 'open') stack.push(++next);
        }
        for (let k = 0; k < (pl.open || 0); k++) stack.push(++next);
        return here;
      });
      scopeCounter = next;
    }
    this._build();
  }

  /**
   * The full name of a label used on `line`, in capitals. With "dotLocals" (sjasmplus),
   * .loop under the label MAIN is really MAIN.LOOP, so each routine can have its own .loop.
   */
  qualify(name, line) {
    name = String(name);
    if (this.braceStacks) {
      // the innermost { } scope around this line that defines the name, else the name itself
      const stack = this.braceStacks[Math.max(0, Math.min(line, this.braceStacks.length - 1))] || [];
      const u = this.D.key(name);
      for (let k = stack.length - 1; k >= 0; k--) if (this.defs.has(`${u}__B${stack[k]}`)) return `${u}__B${stack[k]}`;
      return name;
    }
    if (!this.scopes || !name.startsWith('.') || name.length < 2) return name;
    const sc = this.scopes[Math.max(0, Math.min(line, this.scopes.length - 1))];
    return sc ? sc + name.toUpperCase() : name;
  }

  /** The same, for every .name in a piece of operand text, so it can be worked out. */
  qualifyText(text, line) {
    if (this.braceStacks) {
      const stack = this.braceStacks[line] || [];
      if (!stack.length) return text;
      return text.replace(/(?<![A-Za-z0-9_&$%'"])[A-Za-z_][A-Za-z0-9_]*%?/g, (w) => this.qualify(w, line));
    }
    if (!this.scopes || !text.includes('.')) return text;
    return text.replace(/(^|[^A-Za-z0-9_.'"])(\.[A-Za-z_][A-Za-z0-9_]*)/g, (all, pre, name) => pre + this.qualify(name, line));
  }

  _addDef(def) {
    if (!this.defs.has(def.upper)) this.defs.set(def.upper, []);
    this.defs.get(def.upper).push(def);
    this.defList.push(def);
  }

  _build() {
    const D = this.D;
    const noteRx = /^(?:\/\/|[;*\\])\s*@reg\s+(\S+)\s*(?:=|:)?\s*(.*)$/i;
    for (let ln = 0; ln < this.lines.length; ln++) {
      const pl = this.lines[ln];
      if (pl.comment && !pl.mnem && !pl.label && !pl.parts) {
        const m = noteRx.exec(pl.comment.text.trim());
        if (m && D.isRegister(m[1])) this.regNotes.push({ reg: m[1].toUpperCase(), text: m[2].trim(), line: ln });
      }
      for (const st of statements(pl)) this._buildStatement(st, ln);
    }
    // BeebAsm { } scopes: a name used inside one means the one defined there, if there is one,
    // which is only known once every line has been read
    if (this.braceStacks) for (const r of this.refs) r.upper = D.key(this.qualify(r.name, r.line));
  }

  _buildStatement(pl, ln) {
    const D = this.D;
    const info = pl.mnem ? (D.instr(pl.mnem.upper) || D.directive(pl.mnem.upper)) : null;
    const dir = pl.mnem ? D.directive(pl.mnem.upper) : null;
    const ins = pl.mnem ? D.instr(pl.mnem.upper) : null;

    if (pl.label && !pl.label.name.startsWith('!')) {
      let kind = 'label', expr = null;
      if (dir && dir.kind === 'equ') { kind = 'equ'; expr = pl.operands.map(o => o.text).join(','); }
      else if (dir && (dir.kind === 'data' || dir.kind === 'text' || dir.kind === 'space')) kind = 'data';
      else if (dir && dir.kind === 'macro' && dir.nameFromLabel) kind = 'macro';     // name MACRO a,b
      else if (ins) kind = 'code';
      else if (!pl.mnem) kind = this._kindFromNext(ln, pl.part);
      else if (pl.mnem && !info) kind = 'code';
      const upper = this._defUpper(pl.label, ln);
      pl.label.upper = upper;
      this._addDef({ name: pl.label.name, upper, line: ln, start: pl.label.start, end: pl.label.end, kind, expr, file: this.file });
    }
    if (!pl.mnem) return;

    const labelledMacro = !!(dir && dir.kind === 'macro' && pl.label && dir.nameFromLabel);
    if (labelledMacro) {
      // "name MACRO a,b": the label is the macro's name, and the operands are its values
      this.macros.add(pl.label.name.toUpperCase());
      for (const op of pl.operands) {
        const nm = /^[A-Za-z_][A-Za-z0-9_]*/.exec(op.text);
        if (nm) this._addDef({ name: nm[0], upper: D.key(nm[0]), line: ln, start: op.start, end: op.start + nm[0].length, kind: 'param', expr: null, file: this.file });
      }
    } else if (dir && dir.kind === 'macro' && pl.operands[0]) this.macros.add(pl.operands[0].text.replace(/[\s(,].*$/s, '').toUpperCase());
    if (dir && dir.declares && !labelledMacro) this._declared(pl, ln, dir);
    if (dir && dir.nameFirst) { this._nameFirst(pl, ln, dir); return; }
    if (!info) this.unknown.push(ln);
    if (ins && D.registers.workspaceInstruction === pl.mnem.upper && pl.operands[0] && this.workspace === null) this.workspace = pl.operands[0].text;

    if (dir && dir.kind === 'include' && pl.operands[0]) {
      const t = pl.operands[0];
      const name = t.text.replace(/^["'<]|["'>]$/g, '');
      this.includes.push({ name, line: ln, start: t.start, end: t.end, binary: !!dir.binary });
      return;
    }
    if (dir && dir.kind === 'import') {
      for (const op of pl.operands) {
        if (ID_START.test(op.text[0] || '')) this._addDef({ name: op.text, upper: D.key(op.text), line: ln, start: op.start, end: op.end, kind: 'extern', expr: null, file: this.file });
      }
      return;
    }
    if (dir && dir.symbolOperands === false) return;

    // operands that are names being brought in, not used (the counter in "FOR n, 0, 7")
    const skip = dir && dir.declares === 'first' ? 1 : 0;
    for (let oi = skip; oi < pl.operands.length; oi++) {
      const op = pl.operands[oi];
      const toks = scan(op.text, op.start, D);
      for (let ti = 0; ti < toks.length; ti++) {
        const t = toks[ti];
        if (t.type !== 'ident') continue;
        if (D.knownSymbols.has(t.upper) && D.knownSymbols.get(t.upper).builtIn && !this.defs.has(D.key(t.text))) continue;
        if (D.conditions.has(t.upper) && this._isConditionSlot(ins, pl, oi)) continue;
        const prev = this.rawLines[ln][t.start - 1];
        this.refs.push({
          name: t.text, upper: D.key(this.qualify(t.text, ln)), line: ln, start: t.start, end: t.end,
          asAddress: (!!D.syntax.addressPrefix && prev === D.syntax.addressPrefix) || isAddressSlot(ins, pl, oi, D),
          mnem: pl.mnem.upper, file: this.file
        });
      }
    }
  }

  /** The full name a label is filed under: in a { } scope it gets the scope's number. */
  _defUpper(label, ln) {
    if (!this.braceStacks) return this.D.key(this.qualify(label.name, ln));
    const stack = this.braceStacks[ln] || [];
    const u = this.D.key(label.name);
    if (label.mark === '*' || !stack.length) return u;
    const id = label.mark === '^' ? stack[stack.length - 2] : stack[stack.length - 1];
    return id === undefined ? u : `${u}__B${id}`;
  }

  /** ".const NAME = value", ".label NAME = $D020", ".var NAME = 0": a name and its value. */
  _nameFirst(pl, ln, dir) {
    if (!pl.operands.length) return;
    const raw = this.rawLines[ln];
    const from = pl.operands[0].start, to = pl.operands[pl.operands.length - 1].end;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*(=)?\s*/.exec(raw.slice(from, to));
    if (!m) return;
    const expr = m[2] ? raw.slice(from + m[0].length, to) : null;
    this._addDef({ name: m[1], upper: this.D.key(m[1]), line: ln, start: from, end: from + m[1].length, kind: dir.defKind || 'equ', expr, file: this.file });
    if (expr === null) return;
    for (const t of scan(expr, from + m[0].length, this.D)) {
      if (t.type !== 'ident') continue;
      if (this.D.knownSymbols.has(t.upper) && this.D.knownSymbols.get(t.upper).builtIn) continue;
      this.refs.push({ name: t.text, upper: t.upper, line: ln, start: t.start, end: t.end, asAddress: false, mnem: pl.mnem.upper, file: this.file });
    }
  }

  /**
   * Names that a line brings in for the lines inside its block: the values passed to a macro
   * (".macro clear(colour) {"), or a loop counter (".for (var i=0; i<8; i++) {").
   * They are only noted so they aren't reported as missing.
   */
  _declared(pl, ln, dir) {
    if (!pl.operands.length) return;
    const raw = this.rawLines[ln];
    const from = pl.operands[0].start, to = pl.operands[pl.operands.length - 1].end;
    const text = raw.slice(from, to);
    const add = (name, at) => this._addDef({ name, upper: this.D.key(name), line: ln, start: from + at, end: from + at + name.length, kind: 'param', expr: null, file: this.file });
    if (dir.declares === 'first') {
      // "FOR n, 0, 7": the first operand is the name of the counter
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*%?)/.exec(pl.operands[0].text);
      if (m) this._addDef({ name: m[1], upper: this.D.key(m[1]), line: ln, start: pl.operands[0].start + m.index + m[0].length - m[1].length, end: pl.operands[0].start + m[0].length, kind: 'param', expr: null, file: this.file });
      return;
    }
    if (dir.declares === 'vars') {
      const rx = /\bvar\s+([A-Za-z_][A-Za-z0-9_]*)/g;
      let m;
      while ((m = rx.exec(text))) add(m[1], m.index + m[0].length - m[1].length);
      return;
    }
    // "name(a, b)" or "name a : b" (BeebAsm names can end with %: "MACRO FNE I%")
    const m = /^([A-Za-z_][A-Za-z0-9_]*%?)\s*(.*)$/s.exec(text);
    if (!m) return;
    if (dir.kind !== 'macro') this.macros.add(m[1].toUpperCase());
    else this._addDef({ name: m[1], upper: this.D.key(m[1]), line: ln, start: from, end: from + m[1].length, kind: 'macro', expr: null, file: this.file });
    const rest = m[2], restAt = text.length - rest.length;
    const rx = /[A-Za-z_][A-Za-z0-9_]*%?/g;
    let p;
    while ((p = rx.exec(rest))) add(p[0], restAt + p.index);
  }

  _isConditionSlot(ins, pl, oi) {
    if (!ins) return false;
    const kinds = opKinds(ins, pl.operands.length);
    return !!kinds && kinds[oi] === 'cc';
  }

  /** A label with nothing after it: code or data, going by the statement that follows. */
  _kindFromNext(ln, part) {
    const here = this.lines[ln];
    const rest = here && here.parts ? here.parts.slice((part || 0) + 1) : [];
    const list = rest.concat(...this.lines.slice(ln + 1, ln + 40).map(statements));
    for (const pl of list) {
      if (!pl.mnem) continue;
      const dir = this.D.directive(pl.mnem.upper);
      if (dir) {
        if (dir.kind === 'data' || dir.kind === 'text' || dir.kind === 'space') return 'data';
        if (dir.kind === 'equ') return 'label';
        continue;
      }
      return 'code';
    }
    return 'label';
  }

  /** The statement (of a line that may hold several) where a name is defined. */
  statementOf(def) {
    const pl = this.lines[def.line];
    if (!pl || !pl.parts) return pl;
    return pl.parts.find(p => p.label && p.label.start === def.start) || pl;
  }

  /**
   * The statements before one statement, nearest first: earlier ones on the same line, then the
   * lines above (at most `lines` of them). Each comes as { pl, line }.
   */
  statementsBefore(line, part, lines) {
    const out = [];
    const here = this.lines[line];
    if (here && here.parts) for (let k = (part || 0) - 1; k >= 0; k--) out.push({ pl: here.parts[k], line });
    for (let ln = line - 1; ln >= 0 && ln >= line - (lines || 12); ln--) {
      const list = statements(this.lines[ln]);
      for (let k = list.length - 1; k >= 0; k--) out.push({ pl: list[k], line: ln });
    }
    return out;
  }

  /** The comment block sitting directly above a line, with rule lines (-----) removed. */
  docAbove(line) {
    const out = [];
    let k = line - 1;
    // step over other labels stacked directly above (DRAW_LEVEL / DRAW_LIST / DL_JOB)
    while (k >= 0 && this.lines[k].label && !this.lines[k].mnem) k--;
    for (; k >= 0 && out.length < 80; k--) {
      const pl = this.lines[k];
      if (!isCommentOnly(pl)) break;
      out.unshift(stripCommentMarker(pl.comment.text, this.D));
    }
    while (out.length && RULE_LINE.test(out[0])) out.shift();
    while (out.length && RULE_LINE.test(out[out.length - 1])) out.pop();
    return out;
  }

  /** First line of the comment block above `line` (for folding), or `line` itself. */
  docStart(line) {
    let k = line - 1;
    while (k >= 0 && isCommentOnly(this.lines[k])) k--;
    return k + 1;
  }

  trailingComment(line) {
    const pl = this.lines[line];
    if (!pl || !pl.comment || isCommentOnly(pl)) return '';
    return stripCommentMarker(pl.comment.text, this.D);
  }

  /** What is under the cursor? */
  tokenAt(line, ch) {
    let pl = this.lines[line];
    if (!pl) return null;
    const raw = this.rawLines[line];
    if (pl.parts) pl = pl.parts.find(p => ch >= p.from && ch <= p.to) || (pl.comment && ch >= pl.comment.start ? pl : pl.parts[pl.parts.length - 1]);
    if (pl.label && ch >= pl.label.start && ch <= pl.label.end) return { where: 'label', text: pl.label.name, start: pl.label.start, end: pl.label.end, pl };
    if (pl.mnem && ch >= pl.mnem.start && ch <= pl.mnem.end) return { where: 'mnem', text: pl.mnem.text, start: pl.mnem.start, end: pl.mnem.end, pl };
    for (let oi = 0; oi < pl.operands.length; oi++) {
      const op = pl.operands[oi];
      if (ch < op.start || ch > op.end) continue;
      const toks = scan(op.text, op.start, this.D);
      let hit = toks.find(t => ch >= t.start && ch < t.end) || toks.find(t => ch === t.end && t.type !== 'op');
      return { where: 'operand', index: oi, operand: op, tok: hit || null, text: hit ? hit.text : op.text, start: hit ? hit.start : op.start, end: hit ? hit.end : op.end, pl };
    }
    const lineComment = this.lines[line].comment;
    if (lineComment && ch >= lineComment.start) {
      // a word inside a comment: handy for jumping to a routine that is only mentioned
      let a = ch, b = ch;
      while (a > 0 && ID_BODY.test(raw[a - 1])) a--;
      while (b < raw.length && ID_BODY.test(raw[b])) b++;
      if (b > a) return { where: 'comment', text: raw.slice(a, b), start: a, end: b, pl };
    }
    return null;
  }
}

/**
 * Is operand `oi` of this line a memory address because of where it is? Only for chips that ask
 * ("addressByShape"): a jump or call target, an operand the chip file marks ("addressOperand"),
 * or a number in brackets such as the Z80's LD A,(23560). (HL) and (IX+5) don't count: the
 * address there is in a register.
 */
function isAddressSlot(ins, pl, oi, D) {
  if (!ins || !D.syntax.addressByShape) return false;
  const kinds = opKinds(ins, pl.operands.length);
  if (!kinds) return false;
  if (kinds[oi] === 't') return true;
  if (Array.isArray(ins.addressOperand) && ins.addressOperand.includes(oi)) return true;
  if (kinds[oi] !== 'g') return false;
  const t = pl.operands[oi].text.trim();
  if (!/^\(.*\)$/.test(t)) return false;
  return !scan(t, 0, D).some(k => k.type === 'reg');
}

/**
 * A chip file can give a value for each operand count, like "ops" ({"1": ..., "2": ...}):
 * the Z80's "ADD B" changes A, while "ADD HL,DE" changes HL. Returns the one for `count`.
 */
function byCount(v, count) {
  if (v === undefined || v === null || Array.isArray(v) || typeof v !== 'object') return v;
  if (Object.keys(v).length && Object.keys(v).every(k => /^\d+$/.test(k))) return v[String(count)];
  return v;
}

/** The list of operand kinds for an instruction used with `count` operands. */
function opKinds(ins, count) {
  if (!ins || !ins.ops) return null;
  if (Array.isArray(ins.ops)) return ins.ops;
  return ins.ops[String(count)] || null;
}

module.exports = { statements, colonSpans, callFunction, parseLine, scan, evalExpr, Model, opKinds, isAddressSlot, byCount, opensQuote, splitOperands, stripCommentMarker, isCommentOnly, isBlank };
