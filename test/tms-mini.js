'use strict';
// A very small stand-in for the TMS9900, just enough to run the few instructions that the game
// blocks write, so a test can check what a block does with real numbers. Not an emulator:
// it knows words only, no byte moves, no memory map. Variables are looked up by name.

const s16 = (n) => ((n & 0xFFFF) << 16) >> 16;
const u16 = (n) => n & 0xFFFF;

function parseValue(t, symbols) {
  t = t.trim();
  if (/^>[0-9A-Fa-f]+$/.test(t)) return parseInt(t.slice(1), 16);
  if (/^->[0-9A-Fa-f]+$/.test(t)) return -parseInt(t.slice(2), 16);
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  if (t in symbols) return symbols[t];
  return 0x1234;       // a label used as a constant (the address of a table): any number will do
}

/** Run the lines of assembly. `mem` is { NAME: number }. Returns the memory and the registers. */
function run(lines, mem, symbols = {}, hooks = {}) {
  const R = new Array(16).fill(0);
  const prog = [], labels = {};
  for (const raw of lines) {
    if (!raw.trim() || /^\s*\*/.test(raw)) continue;
    const m = /^(\S+)?\s*(?:(\S+)\s*([^;]*))?/.exec(raw.replace(/;.*$/, ''));
    if (m[1]) labels[m[1]] = prog.length;
    if (m[2]) prog.push({ op: m[2].toUpperCase(), args: (m[3] || '').trim().split(',').map(x => x.trim()).filter(x => x !== ''), raw });
  }
  let cmp = { s: [0, 0], u: [0, 0] };
  const flagsOf = (v) => { cmp = { s: [s16(v), 0], u: [u16(v), 0] }; };
  const compare = (a, b) => { cmp = { s: [s16(a), s16(b)], u: [u16(a), u16(b)] }; };
  const get = (o) => {
    if (/^R\d+$/.test(o)) return R[+o.slice(1)];
    if (o[0] === '@') { const n = o.slice(1); return n in mem ? mem[n] : 0; }
    throw new Error('operand not understood: ' + o);
  };
  const put = (o, v) => {
    v = s16(v);
    if (/^R\d+$/.test(o)) R[+o.slice(1)] = v;
    else if (o[0] === '@') mem[o.slice(1)] = v;
    else throw new Error('cannot write to: ' + o);
  };
  const imm = (o) => parseValue(o, symbols);
  const target = (l) => { if (!(l in labels)) throw new Error('no label ' + l); return labels[l]; };
  let pc = 0, steps = 0;
  while (pc < prog.length) {
    if (++steps > 20000) throw new Error('ran for too long (a loop that never ends?)');
    const { op, args: a } = prog[pc++];
    switch (op) {
      case 'MOV': put(a[1], get(a[0])); flagsOf(get(a[0])); break;
      case 'LI': put(a[0], imm(a[1])); flagsOf(imm(a[1])); break;
      case 'AI': put(a[0], get(a[0]) + imm(a[1])); flagsOf(get(a[0])); break;
      case 'A': put(a[1], get(a[1]) + get(a[0])); flagsOf(get(a[1])); break;
      case 'S': put(a[1], get(a[1]) - get(a[0])); flagsOf(get(a[1])); break;
      case 'INC': put(a[0], get(a[0]) + 1); flagsOf(get(a[0])); break;
      case 'DEC': put(a[0], get(a[0]) - 1); flagsOf(get(a[0])); break;
      case 'NEG': put(a[0], -get(a[0])); flagsOf(get(a[0])); break;
      case 'ABS': put(a[0], Math.abs(get(a[0]))); flagsOf(get(a[0])); break;
      case 'CLR': put(a[0], 0); break;
      case 'INV': put(a[0], ~get(a[0])); flagsOf(get(a[0])); break;
      case 'SRA': put(a[0], get(a[0]) >> imm(a[1])); flagsOf(get(a[0])); break;
      case 'SRL': put(a[0], u16(get(a[0])) >>> imm(a[1])); flagsOf(get(a[0])); break;
      case 'ANDI': put(a[0], get(a[0]) & imm(a[1])); flagsOf(get(a[0])); break;
      case 'BL': { const n = a[0].replace(/^@/, ''); if (!hooks[n]) throw new Error('the test stand-in has no stand-in for the routine ' + n); hooks[n](R, mem, s16); break; }
      case 'SLA': put(a[0], get(a[0]) << imm(a[1])); flagsOf(get(a[0])); break;
      case 'C': compare(get(a[0]), get(a[1])); break;
      case 'CI': compare(get(a[0]), imm(a[1])); break;
      case 'JMP': pc = target(a[0]); break;
      case 'B': pc = target(a[0].replace(/^@/, '')); break;
      case 'JEQ': if (cmp.s[0] === cmp.s[1]) pc = target(a[0]); break;
      case 'JNE': if (cmp.s[0] !== cmp.s[1]) pc = target(a[0]); break;
      case 'JLT': if (cmp.s[0] < cmp.s[1]) pc = target(a[0]); break;
      case 'JGT': if (cmp.s[0] > cmp.s[1]) pc = target(a[0]); break;
      case 'JH': if (cmp.u[0] > cmp.u[1]) pc = target(a[0]); break;
      case 'JL': if (cmp.u[0] < cmp.u[1]) pc = target(a[0]); break;
      case 'NOP': break;
      default: throw new Error('the test stand-in does not know ' + op + ' (line: ' + prog[pc - 1].raw.trim() + ')');
    }
  }
  return { mem, R };
}

module.exports = { run };
