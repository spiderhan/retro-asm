'use strict';
// Game Blocks (prototype): small building blocks that write ordinary assembly.
// A project is a plain JSON file: things (sprites), a list of blocks to run once at the start,
// and a list of blocks to run every frame. Each block is one small file in lib/blocks/<machine>/.
// A block says what it does in plain English and writes a few lines of assembly. Adding a block
// means adding a file, not changing this one. Nothing in here knows about VS Code.

const fs = require('fs');
const path = require('path');

const BLOCK_DIR = path.join(__dirname, 'blocks');
const KIT_DIR = path.join(__dirname, '..', 'kits');

/** Every block file for a machine, keyed by its id. */
function loadBlocks(machine) {
  const dir = path.join(BLOCK_DIR, machine);
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.js')).sort()) {
    const b = require(path.join(dir, f));
    if (f.startsWith('_')) { out._helpers = Object.assign(out._helpers || {}, b.helpers || {}); continue; }   // shared routines
    if (b && b.id) out[b.id] = b;
  }
  return out;
}

/** The ready-made starting points that ship inside the extension. */
function listKits() {
  if (!fs.existsSync(KIT_DIR)) return [];
  return fs.readdirSync(KIT_DIR).filter(f => f.endsWith('.blocks.json')).sort().map(f => {
    const j = JSON.parse(fs.readFileSync(path.join(KIT_DIR, f), 'utf8'));
    return { id: f.replace(/\.blocks\.json$/, ''), file: path.join(KIT_DIR, f), title: j.title, about: j.about, machine: j.machine };
  });
}

function padTo(s, n) { return s.length >= n ? s + ' ' : s + ' '.repeat(n - s.length); }

/** Lay one line out in the usual columns: label, instruction, operands, comment. */
function fmt(label, mnem, operands, comment) {
  let s = padTo(label || '', 8);
  if (mnem) s += padTo(mnem, 6) + (operands || '');
  if (comment) s = padTo(s, 32) + '; ' + comment;
  return s.replace(/\s+$/, '');
}

/**
 * Turn a project into assembly.
 * Returns { asm, problems: [plain-English strings], map: [{ line, block }] }.
 * map says which block each line of assembly came from (a first step towards editing either side).
 */
function generate(project, blocks) {
  const problems = [];
  const things = project.things || {};
  const names = Object.keys(things);
  const vars = {};                 // number variables: NAME -> start value
  const helpers = new Set();       // shared routines the blocks asked for
  const data = [];                 // lines for the data part at the end
  const usedLabels = new Set();
  let n = 0;

  const ctx = {
    things,
    spriteNumber: (t) => names.indexOf(t),
    label(base) { let l; do { l = base + (++n); } while (usedLabels.has(l)); usedLabels.add(l); return l; },
    need(h) { helpers.add(h); },
    problem(text) { problems.push(text); },
    variable(name, start) { if (!(name in vars)) vars[name] = start || 0; return name; },
    /** The four numbers every thing has: where it is and how fast it moves. */
    thing(t) {
      if (!things[t]) { problems.push(`There is no thing called "${t}". The things are: ${names.join(', ') || '(none)'}.`); return null; }
      const U = t.toUpperCase();
      const th = things[t];
      ctx.variable(U + '_X', th.x || 0); ctx.variable(U + '_Y', th.y || 0);
      ctx.variable(U + '_VX', 0); ctx.variable(U + '_VY', 0);
      return { x: U + '_X', y: U + '_Y', vx: U + '_VX', vy: U + '_VY', w: th.w || 8, h: th.h || 8, def: th };
    },
    lines: [],
    map: [],
    cur: null,
    op(mnem, operands, comment) { ctx.push(fmt('', mnem, operands, comment)); },
    at(label, mnem, operands, comment) { ctx.push(fmt(label, mnem, operands, comment)); },
    note(text) { ctx.push('* ' + text); },
    push(line) { ctx.lines.push(line); ctx.map.push(ctx.cur); },
    /** Write the blocks inside a block (the "do these" list of an if). */
    children(list, when) { runList(list || [], when); }
  };

  function runList(list, when) {
    list.forEach((b) => {
      const def = blocks[b.block];
      if (!def) { problems.push(`There is no block called "${b.block}".`); return; }
      if (def.when && def.when !== 'any' && when && def.when !== when) {
        problems.push(`"${def.name}" can only go in the ${def.when === 'start' ? 'start' : 'every-frame'} list.`);
        return;
      }
      const prev = ctx.cur;
      ctx.cur = def.id;
      ctx.note(`[${def.name}]`);
      def.generate(ctx, b, when);
      ctx.cur = prev;
    });
  }

  // start list and frame list are written into separate buffers
  ctx.lines = []; ctx.map = [];
  runList(project.start || [], 'start');
  const startLines = ctx.lines, startMap = ctx.map;
  ctx.lines = []; ctx.map = [];
  runList(project.every_frame || [], 'frame');
  const frameLines = ctx.lines, frameMap = ctx.map;

  // ---- put the file together ----
  const out = [], map = [];
  const add = (l, b) => { out.push(l); map.push(b || null); };
  add(`* ${project.title || 'Game'} (made by Retro ASM Game Blocks; you can edit this file freely).`);
  add('* Each [bracketed note] shows which block wrote the lines under it.');
  add('');
  add(fmt('', 'DEF', 'START'));
  add(fmt('', 'AORG', '>A000', 'Fixed place in the extra memory, so "Run in MAME" can load it'));
  add(fmt('VDPWD', 'EQU', '>8C00', 'Video chip: write a byte of data'));
  add(fmt('VDPWA', 'EQU', '>8C02', 'Video chip: set the address (or a register)'));
  add(fmt('VDPST', 'EQU', '>8802', 'Video chip: read its status'));
  add('');
  add(fmt('START', 'LWPI', 'WS'));
  add(fmt('', 'LIMI', '0'));
  add(fmt('', 'LI', 'R0,>01E2', 'Register 1: screen on, 16x16 sprites'));
  add(fmt('', 'BL', '@VWREG'));
  add(fmt('', 'LI', 'R0,>0506', 'Register 5: the sprite list is at >0300'));
  add(fmt('', 'BL', '@VWREG'));
  add(fmt('', 'LI', 'R0,>0602', 'Register 6: sprite drawings start at >1000 (the tile drawings use >0800 to >0FFF)'));
  add(fmt('', 'BL', '@VWREG'));
  // tidy the screen: the console's title screen is still there when the game starts
  add(fmt('', 'LI', 'R0,>030E', 'Register 3: the colour table is at >0380'));
  add(fmt('', 'BL', '@VWREG'));
  add(fmt('', 'CLR', 'R0', 'Clear the screen: 768 spaces from the top'));
  add(fmt('', 'MOVB', 'R0,@VDPWA'));
  add(fmt('', 'LI', 'R0,>4000'));
  add(fmt('', 'MOVB', 'R0,@VDPWA'));
  add(fmt('', 'LI', 'R1,>2000'));
  add(fmt('', 'LI', 'R2,768'));
  add(fmt('CLRSCR', 'MOVB', 'R1,@VDPWD'));
  add(fmt('', 'DEC', 'R2'));
  add(fmt('', 'JNE', 'CLRSCR'));
  add(fmt('', 'LI', 'R0,>4380', 'Colour table: white on see-through, so the screen colour shows'));
  add(fmt('', 'SWPB', 'R0'));
  add(fmt('', 'MOVB', 'R0,@VDPWA'));
  add(fmt('', 'SWPB', 'R0'));
  add(fmt('', 'MOVB', 'R0,@VDPWA'));
  add(fmt('', 'LI', 'R1,>F000'));
  add(fmt('', 'LI', 'R2,32'));
  add(fmt('CLRCOL', 'MOVB', 'R1,@VDPWD'));
  add(fmt('', 'DEC', 'R2'));
  add(fmt('', 'JNE', 'CLRCOL'));
  names.forEach((t, i) => {
    const th = things[t];
    if (!th.art) { problems.push(`"${t}" has no drawing (art). Give it the name of a @sprite block.`); return; }
    add(fmt('', 'LI', `R0,>${(0x1000 + i * 32).toString(16).toUpperCase().padStart(4, '0')}`, `Copy the drawing of ${t} to video memory`));
    add(fmt('', 'LI', `R1,${th.art}`));
    add(fmt('', 'LI', 'R2,32'));
    add(fmt('', 'BL', '@VMBW'));
  });
  startLines.forEach((l, i) => add(l, startMap[i]));
  add('');
  add('* ---- once every frame (60 times a second) ----');
  add(fmt('MAIN', 'MOVB', '@VDPST,R0', 'Wait for the next frame'));
  add(fmt('', 'JLT', 'GO'));
  add(fmt('', 'JMP', 'MAIN'));
  add(fmt('GO', '', ''));
  frameLines.forEach((l, i) => add(l, frameMap[i]));
  // send every thing to the screen
  add('* [Show everything on the screen]');
  add(fmt('', 'CLR', 'R0', 'Sprite list starts at >0300'));
  add(fmt('', 'MOVB', 'R0,@VDPWA'));
  add(fmt('', 'LI', 'R0,>4300'));
  add(fmt('', 'MOVB', 'R0,@VDPWA'));
  names.forEach((t, i) => {
    const th = ctx.thing(t); if (!th) return;
    add(fmt('', 'MOV', `@${th.y},R1`, t));
    add(fmt('', 'SWPB', 'R1'));
    add(fmt('', 'MOVB', 'R1,@VDPWD'));
    add(fmt('', 'MOV', `@${th.x},R1`));
    add(fmt('', 'SWPB', 'R1'));
    add(fmt('', 'MOVB', 'R1,@VDPWD'));
    add(fmt('', 'LI', `R1,>${((i * 4) * 256).toString(16).toUpperCase().padStart(4, '0')}`, 'Which drawing'));
    add(fmt('', 'MOVB', 'R1,@VDPWD'));
    add(fmt('', 'LI', `R1,>${(((th.def.color === undefined ? 15 : th.def.color) & 15) * 256).toString(16).toUpperCase().padStart(4, '0')}`, 'Colour'));
    add(fmt('', 'MOVB', 'R1,@VDPWD'));
  });
  add(fmt('', 'LI', 'R1,>D000', 'End of the sprite list'));
  add(fmt('', 'MOVB', 'R1,@VDPWD'));
  if (helpers.has('SOUND')) add(fmt('', 'BL', '@SNDTICK', 'Keep any sound going'));
  add(fmt('', 'B', '@MAIN'));
  add('');
  add('* ---- shared routines ----');
  [
    ['VWREG', ['* VWREG: set a video register. R0 holds the register number (left byte) and value (right byte).',
      fmt('VWREG', 'ORI', 'R0,>8000'), fmt('', 'SWPB', 'R0'), fmt('', 'MOVB', 'R0,@VDPWA'), fmt('', 'SWPB', 'R0'), fmt('', 'MOVB', 'R0,@VDPWA'), fmt('', 'B', '*R11')]],
    ['VMBW', ['* VMBW: copy R2 bytes from R1 to video memory address R0.',
      fmt('VMBW', 'ORI', 'R0,>4000'), fmt('', 'SWPB', 'R0'), fmt('', 'MOVB', 'R0,@VDPWA'), fmt('', 'SWPB', 'R0'), fmt('', 'MOVB', 'R0,@VDPWA'),
      fmt('VMBW1', 'MOVB', '*R1+,@VDPWD'), fmt('', 'DEC', 'R2'), fmt('', 'JNE', 'VMBW1'), fmt('', 'B', '*R11')]]
  ].forEach(([, ls]) => ls.forEach(l => add(l)));
  for (const h of helpers) {
    const hd = blocks._helpers && blocks._helpers[h];
    if (hd) { add(''); hd(ctx).forEach(l => add(l)); }
  }
  add('');
  add('* ---- numbers the game keeps (all start as shown) ----');
  add(fmt('WS', 'BSS', '32', 'Room for R0-R15'));
  Object.keys(vars).forEach(k => add(fmt(k, 'DATA', String(vars[k]))));
  data.concat(project.data || []).forEach(l => add(l));
  add(fmt('', 'END', 'START'));
  return { asm: out.join('\n') + '\n', problems, map };
}

module.exports = { loadBlocks, listKits, generate, fmt };
