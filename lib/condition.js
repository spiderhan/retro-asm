'use strict';
// Conditions for breakpoints ("stop here only when R2 = 5"), and "hit counts" ("only the 10th time").
// Nothing here talks to MAME: the debugger gives it the registers and a way to read a word.
//
// A condition is one or more comparisons joined by "and" / "&&" / "or" / "||":
//   R2 = 5      R0 >= >0100      @SCORE > 9      R1 & 1      PC <> LOOP      R3 = 5 and R0 < 32
// Each side is a register (R0-R15, PC, WP, ST), a number (12, >1F, 0x1F), a label (its address),
// or @something (the word stored at that address). Everything is compared as an unsigned 16-bit number.
// "&" means "any of these bits are set" (R1 & 1: the lowest bit of R1 is on).

const REG = /^(R(?:[0-9]|1[0-5])|PC|WP|ST)$/i;
const OPS = ['<>', '!=', '==', '<=', '>=', '=', '<', '>', '&'];

function number(tok) {
  if (/^>[0-9A-F]{1,4}$/i.test(tok)) return parseInt(tok.slice(1), 16);
  if (/^0x[0-9A-F]{1,4}$/i.test(tok)) return parseInt(tok.slice(2), 16);
  if (/^-?\d+$/.test(tok)) return parseInt(tok, 10) & 0xFFFF;
  return null;
}

function operand(text, symbols) {
  let t = text.trim();
  if (!t) throw new Error('something is missing next to the comparison');
  let memory = false;
  if (t[0] === '@') { memory = true; t = t.slice(1).trim(); }
  let get;
  const n = number(t);
  if (n !== null) get = () => n;
  else if (REG.test(t)) { const r = t.toUpperCase(); get = (regs) => regs[r]; }
  else if (symbols && symbols.has(t.toUpperCase())) { const a = symbols.get(t.toUpperCase()); get = () => a; }
  else throw new Error(`"${t}" is not a register, a number or a label`);
  return { get, memory };
}

function comparison(text, symbols) {
  // the longest operator that appears is found first (so >= is not read as >)
  let at = -1, op = '';
  for (let i = 0; i < text.length && at < 0; i++) {
    for (const o of OPS) {
      if (text.startsWith(o, i)) {
        // a ">" that starts a hex number (">1F") belongs to the number, not the comparison
        if (o === '>' && /^>[0-9A-F]/i.test(text.slice(i)) && (i === 0 || /[\s=<>!&@]/.test(text[i - 1]))) continue;
        at = i; op = o; break;
      }
    }
  }
  if (at < 0) {
    const one = operand(text, symbols);       // no operator: true when the value is not zero
    return { async test(ctx) { return (await value(one, ctx)) !== 0; } };
  }
  const left = operand(text.slice(0, at), symbols);
  const right = operand(text.slice(at + op.length), symbols);
  return {
    async test(ctx) {
      const a = await value(left, ctx), b = await value(right, ctx);
      switch (op) {
        case '=': case '==': return a === b;
        case '<>': case '!=': return a !== b;
        case '<': return a < b;
        case '<=': return a <= b;
        case '>': return a > b;
        case '>=': return a >= b;
        case '&': return (a & b) !== 0;
        default: return false;
      }
    }
  };
}

async function value(o, ctx) {
  const v = o.get(ctx.regs) & 0xFFFF;
  return o.memory ? (await ctx.word(v)) & 0xFFFF : v;
}

/** Returns { test(ctx) } where ctx = { regs, word(addr) }, or throws an Error saying what is wrong. */
function parseCondition(text, symbols) {
  const ors = String(text).split(/\s*(?:\|\||\bor\b)\s*/i).map(p => p.split(/\s*(?:&&|\band\b)\s*/i).map(c => comparison(c, symbols)));
  return {
    async test(ctx) {
      for (const ands of ors) {
        let all = true;
        for (const c of ands) if (!(await c.test(ctx))) { all = false; break; }
        if (all) return true;
      }
      return false;
    }
  };
}

/** "5" (only the 5th time), ">=5", ">5", "==5", "%5" (every 5th time). Returns a function of the count so far. */
function parseHits(text) {
  const m = /^\s*(>=|<=|==|=|>|<|%)?\s*(\d+)\s*$/.exec(String(text));
  if (!m) throw new Error('a hit count is a number, or >=5, ==5, >5, <5 or %5 (every 5th time)');
  const n = parseInt(m[2], 10);
  switch (m[1]) {
    case '>=': return (c) => c >= n;
    case '<=': return (c) => c <= n;
    case '>': return (c) => c > n;
    case '<': return (c) => c < n;
    case '%': return (c) => n > 0 && c % n === 0;
    default: return (c) => c === n;
  }
}

module.exports = { parseCondition, parseHits, number };
