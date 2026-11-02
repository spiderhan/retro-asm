'use strict';
// Game Blocks (prototype): small building blocks that write ordinary assembly.
// A project is a plain JSON file: things (sprites), a list of blocks to run once at the start,
// and a list of blocks to run every frame. Each block is one small file in lib/blocks/<machine>/.
// A block says what it does in plain English and writes a few lines of assembly. Adding a block
// means adding a file, not changing this one. Nothing in here knows about VS Code.

const fs = require('fs');
const path = require('path');
const E = require('./blocks-edit');

const BLOCK_DIR = path.join(__dirname, 'blocks');
const KIT_DIR = path.join(__dirname, '..', 'kits');

/** Every block file for a machine, keyed by its id. */
function loadBlocks(machine) {
  const dir = path.join(BLOCK_DIR, machine);
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.js')).sort()) {
    const b = require(path.join(dir, f));
    if (f.startsWith('_')) {   // shared routines, and the machine's colours
      out._helpers = Object.assign(out._helpers || {}, b.helpers || {});
      if (b.palette) out._palette = b.palette;
      continue;
    }
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
 * Returns { asm, problems: [plain-English strings], map: which block each line came from, paths: where in the project that block sits }.
 * map says which block each line of assembly came from (a first step towards editing either side).
 */
function generate(project0, blocks, options) {
  options = options || {};
  const project = require('./blocks-upgrade').upgrade(project0).project;   // an older file keeps working
  const dataLines = E.dataOf(project, options.dataLines);                   // the pictures and sounds (in the file, or in its pictures file)
  const problems = [];
  const things = project.things || {};
  const names = Object.keys(things);
  const vars = {};                 // number variables: NAME -> start value
  const helpers = new Set();       // shared routines the blocks asked for
  const data = [];                 // lines for the data part at the end
  const usedLabels = new Set();
  const tileNeeds = {}, tileBase = {};   // tile name -> groups of 8 characters needed / the first group it gets
  let n = 0;

  const ctx = {
    things,
    spriteNumber: (t) => names.indexOf(t),
    label(base) { let l; do { l = base + (++n); } while (usedLabels.has(l)); usedLabels.add(l); return l; },
    need(h) { helpers.add(h); },
    dataLines,
    /** A tile: its picture, how many 8x8 pieces across and down, and which screen characters it uses. */
    tile(name) {
      const def = (project.tiles || {})[name];
      if (!def) { problems.push(`There is no tile called "${name}". The tiles are: ${Object.keys(project.tiles || {}).join(', ') || '(none)'}.`); return null; }
      const pic = E.pictures(dataLines).find(x => x.label === def.art);
      const shape = E.tileShape(pic);
      if (shape.error) { problems.push(`The tile "${name}": ${shape.error}.`); return null; }
      const need = tileNeeds[name] || 1;
      return Object.assign({ name, art: def.art, left: name.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_LEFT', groups: need, group: tileBase[name] }, shape);
    },
    /** Blocks that draw tiles say in advance how many different colours (groups of characters) they need. */
    wantTileGroups(name, n) { tileNeeds[name] = Math.max(tileNeeds[name] || 1, n); },
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
    paths: [],            // for every line: where its block sits in the project, like 'every_frame/3/do/1'
    curPath: null, curPathArr: [],
    cur: null,
    op(mnem, operands, comment) { ctx.push(fmt('', mnem, operands, comment)); },
    at(label, mnem, operands, comment) { ctx.push(fmt(label, mnem, operands, comment)); },
    note(text) { ctx.push('* ' + text); },
    push(line) { ctx.lines.push(line); ctx.map.push(ctx.cur); ctx.paths.push(ctx.curPath); },
    /** Write the blocks inside a block (the "do these" list of an if). */
    children(list, when) { runList(list || [], when, ctx.curPathArr.concat(['do'])); }
  };

  function runList(list, when, base) {
    list.forEach((b, bi) => {
      const def = blocks[b.block];
      if (!def) { problems.push(`There is no block called "${b.block}".`); return; }
      if (def.when && def.when !== 'any' && when && def.when !== when) {
        problems.push(`"${def.name}" can only go in the ${def.when === 'start' ? 'start' : 'every-frame'} list.`);
        return;
      }
      // a block with a setting left empty would write broken code: say so in plain words instead
      let incomplete = false;
      for (const [pn, pd] of Object.entries(def.params || {})) {
        const v = b[pn];
        if (v === undefined && pd.default !== undefined) continue;   // left out on purpose: the default is used
        if (pd.type === 'number' || pd.type === 'colour') {
          if (v === undefined || v === '' || !Number.isFinite(Number(v))) { problems.push(`"${def.name}" needs a number for "${pn}".`); incomplete = true; }
        } else if (pd.type === 'choice') {
          if (!E.shown(def, b, pn)) continue;
          const cur = v === undefined ? pd.default : v;
          if (!pd.options.some(o => o[0] === cur)) { problems.push(`"${def.name}" has a choice for "${pn}" that is not one of: ${pd.options.map(o => o[0]).join(', ')}.`); incomplete = true; }
        } else if (pd.type === 'tile') {
          if (!v) { problems.push(`"${def.name}" needs a tile chosen for "${pn}".`); incomplete = true; }
          else if (!(project.tiles || {})[v]) { problems.push(`There is no tile called "${v}". The tiles are: ${Object.keys(project.tiles || {}).join(', ') || '(none)'}.`); incomplete = true; }
        } else if (pd.type === 'thing') {
          if (!v) { problems.push(`"${def.name}" needs a thing chosen for "${pn}".`); incomplete = true; }
        } else if (pd.type === 'label') {
          if (!v) { problems.push(`"${def.name}" needs a ${pn === 'sound' ? 'sound' : pn} chosen.`); incomplete = true; }
          else if (pn === 'sound' && !E.soundLabels(dataLines).includes(v)) { problems.push(`There is no sound called "${v}". The sounds are: ${E.soundLabels(dataLines).join(', ') || '(none: add an @sound block to the data)'}.`); incomplete = true; }
        }
      }
      if (incomplete) return;
      const prev = ctx.cur, prevPath = ctx.curPath, prevArr = ctx.curPathArr;
      ctx.cur = def.id;
      ctx.curPathArr = (base || []).concat([bi]);
      ctx.curPath = ctx.curPathArr.join('/');
      ctx.note(`[${def.name}]`);
      def.generate(ctx, b, when);
      ctx.cur = prev; ctx.curPath = prevPath; ctx.curPathArr = prevArr;
    });
  }

  // before writing anything: every block that draws or looks for tiles says how many colours it needs,
  // so each tile gets its own screen characters and the blocks agree where they are
  const planList = (list) => (list || []).forEach((b) => {
    const def = blocks[b.block];
    if (def && def.plan) def.plan(ctx, b);
    if (def) for (const [pn, pd] of Object.entries(def.params || {})) if (pd.type === 'blocks') planList(b[pn]);
  });
  planList(project.start); planList(project.every_frame);
  let nextGroup = 12;           // characters 96 up (groups of 8): the first 96 are letters and numbers
  for (const t of Object.keys(tileNeeds)) { tileBase[t] = nextGroup; nextGroup += tileNeeds[t]; }
  if (nextGroup > 32) problems.push(`The tiles need ${nextGroup - 12} groups of screen characters and only 20 are free. Use fewer rows with different colours, or fewer kinds of tile.`);

  // start list and frame list are written into separate buffers
  ctx.lines = []; ctx.map = []; ctx.paths = [];
  runList(project.start || [], 'start', ['start']);
  const startLines = ctx.lines, startMap = ctx.map, startPaths = ctx.paths;
  ctx.lines = []; ctx.map = []; ctx.paths = [];
  runList(project.every_frame || [], 'frame', ['every_frame']);
  const frameLines = ctx.lines, frameMap = ctx.map, framePaths = ctx.paths;

  // ---- put the file together ----
  const out = [], map = [], paths = [];
  const add = (l, b, pth) => { out.push(l); map.push(b || null); paths.push(pth || null); };
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
  startLines.forEach((l, i) => add(l, startMap[i], startPaths[i]));
  add('');
  add('* ---- once every frame (60 times a second) ----');
  add(fmt('MAIN', 'MOVB', '@VDPST,R0', 'Wait for the next frame'));
  add(fmt('', 'JLT', 'GO'));
  add(fmt('', 'JMP', 'MAIN'));
  add(fmt('GO', '', ''));
  // the console's own key scan is never run, so FCTN + = (QUIT) is looked for here: it goes back to the title screen
  add('* [Quit: holding FCTN and = together goes back to the title screen]');
  add(fmt('', 'LI', 'R12,>0024', 'Look at keyboard column 0'));
  add(fmt('', 'CLR', 'R1'));
  add(fmt('', 'LDCR', 'R1,3'));
  add(fmt('', 'LI', 'R12,>0006'));
  add(fmt('', 'STCR', 'R1,8', 'Read the 8 switches (0 means pressed)'));
  add(fmt('', 'ANDI', 'R1,>1100', 'FCTN and = both pressed?'));
  add(fmt('', 'JNE', 'NOQUIT'));
  add(fmt('', 'BLWP', '@>0000', 'Start the console over: the title screen'));
  add(fmt('NOQUIT', '', ''));
  frameLines.forEach((l, i) => add(l, frameMap[i], framePaths[i]));
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
  if (project.dataFile) {
    add('');
    add('* The pictures and sounds are in their own file, so the picture editor and sound player can change them.');
    add(fmt('', 'COPY', `"${project.dataFile}"`));
  } else data.concat(project.data || []).forEach(l => add(l));
  add(fmt('', 'END', 'START'));
  return { asm: out.join('\n') + '\n', problems, map, paths };
}

module.exports = { loadBlocks, listKits, generate, fmt };
