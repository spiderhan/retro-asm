// Tests for Game Blocks: node test/blocks-test.js (ext-test.js runs it too).
const path = require('path'), fs = require('fs');
const { loadFile } = require('../lib/dialect');
const { Project } = require('../lib/project');
const F = require('../lib/features');
const GB = require('../lib/blocks');
let fails = 0;
const ok = (name, cond, extra) => { if (!cond) { fails++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } else console.log('ok  ', name); };
const D = loadFile(path.join(__dirname, '../dialects/tms9900.json'));
const blocks = GB.loadBlocks('ti99');
const kit = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, '../kits', id + '.blocks.json'), 'utf8'));
const check = (asm) => { const P = new Project(); P.set('/x/game.a99', asm, D); return F.check(P, '/x/game.a99'); };

// ---- the blocks themselves ----
const ids = Object.keys(blocks).filter(k => !k.startsWith('_'));
ok('there are blocks for the TI-99/4A', ids.length >= 10, ids);
ok('every block explains itself in plain English', ids.every(k => blocks[k].name && blocks[k].about && blocks[k].about.length > 20), ids.filter(k => !blocks[k].about));
ok('every block says when it can be used', ids.every(k => ['start', 'frame', 'any'].includes(blocks[k].when)));

// ---- the kits ----
const kits = GB.listKits();
ok('the bat-and-ball kit is listed', kits.some(k => k.id === 'bat-and-ball' && k.machine === 'ti99'), kits);
for (const k of kits) {
  const r = GB.generate(JSON.parse(fs.readFileSync(k.file, 'utf8')), GB.loadBlocks(k.machine));
  ok(`${k.id}: no problems making the game`, r.problems.length === 0, r.problems);
  const w = check(r.asm);
  ok(`${k.id}: the extension's own checks give 0 warnings`, w.length === 0, w.slice(0, 5).map(x => `${x.line + 1}: ${x.message}`));
  const labels = r.asm.split('\n').map(l => /^([A-Za-z_][A-Za-z0-9_]*)\b/.exec(l)).filter(Boolean).map(m => m[1]).filter(l => !/^(DEF|END)$/.test(l));
  const dup = labels.filter((l, i) => labels.indexOf(l) !== i);
  ok(`${k.id}: no label is used twice`, dup.length === 0, dup);
  ok(`${k.id}: every line says which block wrote it (or is shared)`, r.map.length === r.asm.split('\n').length - 1);
  ok(`${k.id}: has a fixed address so MAME's loader can place it`, /^\s+AORG\s+>A000/m.test(r.asm));
  ok(`${k.id}: clears the screen, so the console's title screen doesn't show through`, /^CLRSCR\s/m.test(r.asm) && /^CLRCOL\s/m.test(r.asm));
  ok(`${k.id}: ends with END START`, /END\s+START\s*$/.test(r.asm));
}

// ---- the bricks ----
{
  const r = GB.generate(kit('bricks'), blocks);
  ok('the bricks kit is listed', kits.some(k => k.id === 'bricks'), kits.map(k => k.id));
  ok('bricks: the routines for tiles are there', /^VTILES\s/m.test(r.asm) && /^VSBR\s/m.test(r.asm) && /^VSBW\s/m.test(r.asm) && /^VFILL\s/m.test(r.asm));
  ok('bricks: the count of bricks is kept', /^BRICK_LEFT\s+DATA\s+0/m.test(r.asm));
  const old = GB.generate(kit('bat-and-ball'), blocks);
  ok('bat and ball without bricks has no tile routines', !/^VTILES\s/m.test(old.asm) && !/_LEFT\s+DATA/m.test(old.asm));
  const colours = [...r.asm.matchAll(/LI\s+R1,>([0-9A-F])000[ \t]*(?:;.*)?\n\s+BL\s+@VSBW/g)].map(m => m[1]);
  ok('bricks: every row has its own colour', colours.length >= 6 && new Set(colours.slice(0, 6)).size === 6, colours);
  ok('bricks: each row starts a different way (whole bricks, then shifted half a brick)', /Row 1 of tiles\n/.test(r.asm) && /shifted half a tile/.test(r.asm));
  ok('bricks: 6 rows = 3 x 15 + 3 x 16 bricks', /LI\s+R1,93\s/.test(r.asm));
  const one = kit('bricks'); one.start[1].colour = 9; one.every_frame.find(b => b.block === 'if-no-tiles').do[0].colour = 9;
  const oc = [...GB.generate(one, blocks).asm.matchAll(/LI\s+R1,>([0-9A-F])000[ \t]*(?:;.*)?\n\s+BL\s+@VSBW/g)].map(m => m[1]);
  ok('bricks: one chosen colour is used for every row', oc.length >= 1 && new Set(oc).size === 1 && oc[0] === '9', oc);
  const bad = kit('bricks'); bad.start[1].rows = 0;
  ok('0 rows is explained', GB.generate(bad, blocks).problems.some(x => /1 to 12 rows/.test(x)));
  const low = kit('bricks'); low.start[1].top = 20;
  ok('a wall off the bottom is explained', GB.generate(low, blocks).problems.some(x => /bottom of the screen/.test(x)));
  const nowall = kit('bricks'); nowall.start.splice(1, 1);
  ok('hitting tiles with no wall still makes valid code', GB.generate(nowall, blocks).problems.length === 0 && check(GB.generate(nowall, blocks).asm).length === 0);
}

// ---- mistakes are explained, not crashed on ----
{
  const p = kit('bat-and-ball');
  p.every_frame.push({ block: 'move-by-speed', thing: 'rocket' });
  const r = GB.generate(p, blocks);
  ok('a thing that does not exist is named, with the ones that do', r.problems.some(x => /no thing called "rocket"/.test(x) && /bat, ball/.test(x)), r.problems);
}
{
  const p = kit('bat-and-ball');
  p.start.push({ block: 'move-by-speed', thing: 'ball' });
  const r = GB.generate(p, blocks);
  ok('a block in the wrong list is explained', r.problems.some(x => /Keep moving at its speed.*every-frame/.test(x)), r.problems);
}
{
  const p = kit('bat-and-ball');
  p.every_frame.push({ block: 'dance' });
  ok('an unknown block is named', GB.generate(p, blocks).problems.some(x => /no block called "dance"/.test(x)));
}
{
  const p = kit('bat-and-ball');
  delete p.things.ball.art;
  ok('a thing with no drawing is explained', GB.generate(p, blocks).problems.some(x => /"ball" has no drawing/.test(x)));
}

// ---- the idea holds up: different blocks give a different game, no code changed ----
{
  const p = kit('bat-and-ball');
  p.every_frame = p.every_frame.filter(b => b.block !== 'show-score' && b.block !== 'if-below');
  p.every_frame.forEach(b => { if (b.do) b.do = b.do.filter(x => x.block !== 'play-sound'); });
  const r = GB.generate(p, blocks);
  ok('without the sound block there is no sound code', !/SNDTICK/.test(r.asm) && r.problems.length === 0);
  ok('without the score block there is no digit code', !/SHOWNUM/.test(r.asm));
  const w = check(r.asm);
  ok('the smaller game also gives 0 warnings', w.length === 0, w.slice(0, 3));
}
{
  // a second sprite is just another entry: no new code
  const p = kit('bat-and-ball');
  p.things.mate = { art: 'BALL_PIC', x: 40, y: 40, w: 8, h: 8, color: 6 };
  p.every_frame.push({ block: 'move-by-speed', thing: 'mate' });
  const r = GB.generate(p, blocks);
  ok('a third thing is drawn and moved with no new code', /MATE_X/.test(r.asm) && /@MATE_Y,R1/.test(r.asm) && r.problems.length === 0);
}

// ---- the editing rules behind the blocks panel ----
{
  const E = require('../lib/blocks-edit');
  const names = (l) => l.map(b => b.block).join(',');
  const cat = E.catalogue(blocks);
  ok('the panel gets every block with its settings', cat.length === ids.length && cat.every(c => c.id && c.name && c.params && c.category));
  const p = kit('bricks');
  const n0 = p.every_frame.length;
  ok('a new block starts with sensible settings', (() => { const b = E.newBlock(blocks['set-speed'], p); return b.block === 'set-speed' && b.thing === 'bat' && typeof b.across === 'number'; })());
  ok('a block with a list starts with an empty list', Array.isArray(E.newBlock(blocks['when-things-hit'], p).do));
  ok('a start-only block cannot go in the every-frame list', !E.canDrop(blocks['screen-colour'], ['every_frame']) && E.canDrop(blocks['screen-colour'], ['start']));
  ok('a start-only block cannot go inside a block in the every-frame list', !E.canDrop(blocks['screen-colour'], ['every_frame', 3, 'do']));
  ok('a block that works anywhere goes anywhere', E.canDrop(blocks['place'], ['start']) && E.canDrop(blocks['place'], ['every_frame', 3, 'do']));
  E.insertBlock(p, ['every_frame'], 1, E.newBlock(blocks['play-sound'], p));
  ok('inserting puts the block in the gap', p.every_frame[1].block === 'play-sound' && p.every_frame.length === n0 + 1);
  E.removeBlock(p, ['every_frame'], 1);
  ok('removing takes it out again', p.every_frame.length === n0 && p.every_frame[1].block !== 'play-sound');
  const before = names(p.every_frame);
  ok('moving a block down one place', E.moveBlock(p, ['every_frame'], 0, ['every_frame'], 2, blocks) && names(p.every_frame).split(',').slice(0, 2).join() === before.split(',').slice(1, 2).concat(before.split(',')[0]).join());
  E.moveBlock(p, ['every_frame'], 1, ['every_frame'], 0, blocks);
  ok('moving it back gives the same list', names(p.every_frame) === before);
  const p2 = kit('bricks'); const ti2 = p2.every_frame.findIndex(b => b.block === 'when-things-hit');
  E.moveBlock(p2, ['every_frame'], 0, ['every_frame', ti2, 'do'], 0, blocks);
  ok('the block is inside now, and the outer list is one shorter', p2.every_frame.length === n0 - 1 && p2.every_frame[ti2 - 1].do[0].block === 'move-with-joystick', p2.every_frame.map(b => b.block));
  ok('a block can come back out of an "if"', E.moveBlock(p2, ['every_frame', ti2 - 1, 'do'], 0, ['every_frame'], 0, blocks) && p2.every_frame.length === n0);
  ok('a block can not be dropped into itself', E.moveBlock(p2, ['every_frame'], ti2, ['every_frame', ti2, 'do'], 0, blocks) === false && p2.every_frame.length === n0);
  ok('an every-frame-only block can not go to the start list', E.moveBlock(p2, ['every_frame'], 0, ['start'], 0, blocks) === false && p2.every_frame.length === n0);
  ok('a number is kept inside its limits', (() => { E.setParam(p2, ['start'], 1, 'rows', 99, blocks['tile-fill']); return p2.start[1].rows === 12; })());
  ok('a number that is not a number gets the default', (() => { E.setParam(p2, ['start'], 1, 'rows', 'abc', blocks['tile-fill']); return p2.start[1].rows === 4; })());
  ok('a thing\'s position is kept on the screen', (() => { E.setThing(p2, 'bat', 'x', 999); E.setThing(p2, 'bat', 'y', -5); return p2.things.bat.x === 255 && p2.things.bat.y === 0 && E.setThing(p2, 'bat', 'nonsense', 1) === false; })());
  for (const k of kits) {
    const q = JSON.parse(fs.readFileSync(k.file, 'utf8')); const orig = JSON.stringify(q);
    E.moveBlock(q, ['every_frame'], 0, ['every_frame'], 2, blocks); E.moveBlock(q, ['every_frame'], 1, ['every_frame'], 0, blocks);
    ok(`${k.id}: any order of blocks the panel makes still makes a game`, GB.generate(q, blocks).problems.length === 0 && JSON.stringify(q) === orig);
  }
}

// ---- colours and the link between a block and its lines of code ----
{
  const E = require('../lib/blocks-edit');
  const pal = blocks._palette;
  ok('the TI has 16 named colours, in order', pal && pal.length === 16 && pal.every((c, i) => c.n === i && c.name) && new Set(pal.map(c => c.name)).size === 16, pal && pal.map(c => c.name));
  ok('every colour except see-through has a real colour to draw', pal.filter(c => c.n > 0).every(c => /^#[0-9A-F]{6}$/.test(c.rgb)) && pal[0].rgb === null);
  const colourParams = ids.flatMap(k => Object.entries(blocks[k].params).filter(([, p]) => p.type === 'colour').map(([n]) => k + '.' + n));
  ok('the colour settings are colour pickers, not numbers', colourParams.includes('screen-colour.colour') && colourParams.includes('tile-fill.colour'), colourParams);
  const p = kit('bricks');
  ok('a colour is kept to the colours it may be', (() => { E.setParam(p, ['start'], 0, 'colour', 99, blocks['screen-colour']); const a = p.start[0].colour; E.setParam(p, ['start'], 0, 'colour', 0, blocks['screen-colour']); return a === 15 && p.start[0].colour === 1; })());
  ok('a new colour block starts with its default colour', E.newBlock(blocks['screen-colour'], p).colour === 1 && E.newBlock(blocks['tile-fill'], p).colour === 0);
  ok('the wall can say "a different colour for each row"', typeof blocks['tile-fill'].params.colour.zero === 'string');
  for (const k of kits) {
    const q = JSON.parse(fs.readFileSync(k.file, 'utf8')), r = GB.generate(q, blocks);
    ok(`${k.id}: every line has a place in the project, or none`, r.paths.length === r.asm.split('\n').length - 1);
    const dangling = r.paths.map((pt, i) => [pt, i]).filter(([pt]) => pt).filter(([pt, i]) => {
      let cur = q; for (const part of pt.split('/')) { cur = cur && cur[part]; }
      return !(cur && cur.block && blocks[cur.block].id === r.map[i]);
    });
    ok(`${k.id}: each line's place is the block that wrote it`, dangling.length === 0, dangling.slice(0, 3));
    ok(`${k.id}: blocks inside an "if" are told apart from the "if"`, r.paths.some(pt => /\/do\/\d+/.test(pt || '')));
  }
}

// ---- whatever the panel lets you build still makes a valid game ----
{
  const E = require('../lib/blocks-edit');
  const all = Object.keys(blocks).filter(k => !k.startsWith('_'));
  let seed = 7; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const listsOf = (p) => {
    const out = [['start'], ['every_frame']];
    const walk = (path) => (E.listAt(p, path) || []).forEach((b, i) => {
      const d = blocks[b.block];
      if (d) for (const [n, pp] of Object.entries(d.params)) if (pp.type === 'blocks') { out.push(path.concat([i, n])); walk(path.concat([i, n])); }
    });
    walk(['start']); walk(['every_frame']);
    return out;
  };
  let bad = [], made = 0;
  for (let t = 0; t < 400; t++) {
    const p = kit(t % 2 ? 'bricks' : 'bat-and-ball');
    for (let k = 0; k < 2 + rnd(30); k++) {
      const L = listsOf(p), l = L[rnd(L.length)], d = blocks[all[rnd(all.length)]];
      if (E.canDrop(d, l)) { const lst = E.listAt(p, l); E.insertBlock(p, l, rnd(lst.length + 1), E.newBlock(d, p)); }
      if (rnd(3) === 0) { const L2 = listsOf(p), a = L2[rnd(L2.length)], al = E.listAt(p, a); if (al && al.length) E.moveBlock(p, a, rnd(al.length), L2[rnd(L2.length)], rnd(3), blocks); }
    }
    const r = GB.generate(p, blocks);
    if (r.problems.length) { bad.push(r.problems[0]); continue; }
    made++;
    const w = check(r.asm);
    if (w.length) bad.push(w[0].message);
  }
  ok('400 random arrangements of blocks all make a game with 0 warnings', bad.length === 0 && made === 400, bad.slice(0, 3));
  const big = kit('bat-and-ball');
  const below = big.every_frame.find(b => b.block === 'if-below');
  for (let i = 0; i < 60; i++) below.do.push({ block: 'place', thing: 'ball', x: 1, y: 2 });
  const rb = GB.generate(big, blocks);
  ok('an "if" with a very long list inside still makes a valid game', rb.problems.length === 0 && check(rb.asm).length === 0, check(rb.asm).slice(0, 2).map(x => x.message));
}

// ---- a setting left empty is explained, not turned into broken code ----
{
  const E = require('../lib/blocks-edit');
  const p = kit('bricks');
  ok('a new "Play a sound" block already has a real sound chosen', E.newBlock(blocks['play-sound'], p).sound === 'BOING');
  ok('the sounds in a project are found', E.soundLabels(p).join() === 'BOING');
  const t1 = kit('bricks'); t1.start.push({ block: 'play-sound', sound: '' });
  const r1 = GB.generate(t1, blocks);
  ok('an empty sound is explained in plain words', r1.problems.some(x => /Play a sound.*needs a sound chosen/.test(x)) && !/LI\s+R1,\s*$/m.test(r1.asm), r1.problems);
  const t2 = kit('bricks'); t2.start.push({ block: 'play-sound', sound: 'NOPE' });
  ok('a sound that does not exist is explained, with the ones that do', GB.generate(t2, blocks).problems.some(x => /no sound called "NOPE".*BOING/.test(x)));
  const t3 = kit('bricks'); t3.start.push({ block: 'place', thing: 'bat', x: '', y: 3 });
  ok('an empty number is explained', GB.generate(t3, blocks).problems.some(x => /Put a thing here.*number for "x"/.test(x)));
  const t4 = kit('bricks'); t4.start.push({ block: 'place', thing: '', x: 1, y: 3 });
  ok('an empty thing is explained', GB.generate(t4, blocks).problems.some(x => /Put a thing here.*thing chosen/.test(x)));
  ok('a setting left out that has a default is fine', GB.generate(kit('bricks'), blocks).problems.length === 0);
  for (const k of kits) {
    const q = JSON.parse(fs.readFileSync(k.file, 'utf8'));
    for (const d of ids.map(i => blocks[i])) {
      if (!E.canDrop(d, ['every_frame'])) continue;
      q.every_frame.push(E.newBlock(d, q));
    }
    const r = GB.generate(q, blocks);
    ok(`${k.id}: one new block of every kind, straight from the list, makes a valid game`, r.problems.length === 0 && check(r.asm).length === 0, r.problems.concat(check(r.asm).slice(0, 2).map(x => x.message)));
  }
}

// ---- what "If a thing hits a tile" really does: run its code on a pretend screen ----
{
  const { run } = require('./tms-mini');
  const u16 = (n) => n & 0xFFFF;
  const tileProject = (art, extra) => {
    const p = kit('bat-and-ball');
    p.data = p.data.concat(['', extra || '']);
    p.tiles = { thing: { art } };
    p.every_frame = [{ block: 'tile-hit', thing: 'ball', tile: 'thing', bounce: 'up-down', do: [{ block: 'add-to-score', by: 1 }] }];
    return p;
  };
  const hitTest = (p, screen, mem) => {
    const r = GB.generate(p, blocks);
    const lines = r.asm.split('\n').filter((l, k) => r.paths[k] && r.paths[k].startsWith('every_frame/0'));
    const hooks = {
      VSBR: (R) => { R[1] = ((screen[u16(R[0])] === undefined ? 32 : screen[u16(R[0])]) << 8) << 16 >> 16; },
      VFILL: (R) => { for (let i = 0; i < u16(R[2]); i++) screen[u16(R[0]) + i] = (u16(R[1]) >> 8); }
    };
    const m = run(lines, Object.assign({ BALL_X: 40, BALL_Y: 20, BALL_VX: 2, BALL_VY: 2, SCORE: 0, THING_LEFT: 10 }, mem), {}, hooks).mem;
    return { m, problems: r.problems };
  };
  // a brick: 16x8 = two pieces across, shown as characters 96 and 97
  const brick = tileProject('B_PIC', '* @sprite 16x8 cells\nB_PIC BYTE >FF,>FF,>FF,>FF,>FF,>FF,>FF,>00\n       BYTE >FE,>FE,>FE,>FE,>FE,>FE,>FE,>00'.split('\n').join('\n'));
  brick.data = brick.data.slice(0, -2).concat(['* @sprite 16x8 cells', 'B_PIC BYTE >FF,>FF,>FF,>FF,>FF,>FF,>FF,>00', '       BYTE >FE,>FE,>FE,>FE,>FE,>FE,>FE,>00']);
  let screen = { 100: 96, 101: 97 };            // the ball is over column 5, row 3: screen position 101
  let t = hitTest(brick, screen, {});
  ok('tile hit: a 16x8 tile makes a valid game', t.problems.length === 0, t.problems);
  ok('tile hit: hitting the right half rubs out the whole brick', screen[100] === 32 && screen[101] === 32, screen);
  ok('tile hit: it counts one less, bounces, and scores', t.m.THING_LEFT === 9 && t.m.BALL_VY === -2 && t.m.BALL_VX === 2 && t.m.SCORE === 1, t.m);
  screen = { 100: 96, 101: 97 }; t = hitTest(brick, screen, { BALL_X: 33 });          // column 4: the left half
  ok('tile hit: hitting the left half rubs out the whole brick too', screen[100] === 32 && screen[101] === 32 && t.m.THING_LEFT === 9, screen);
  screen = { 100: 96, 101: 97 }; t = hitTest(brick, screen, { BALL_X: 120 });         // nothing there
  ok('tile hit: nothing under the ball: nothing happens', screen[100] === 96 && t.m.THING_LEFT === 10 && t.m.BALL_VY === 2 && t.m.SCORE === 0, t.m);
  screen = { 101: 65 }; t = hitTest(brick, screen, {});                                // a letter, not a tile
  ok('tile hit: some other character (a letter) is left alone', screen[101] === 65 && t.m.THING_LEFT === 10 && t.m.SCORE === 0, t.m);
  screen = { 101: 97 }; t = hitTest(brick, screen, { BALL_Y: 300 });                    // far off the bottom
  ok('tile hit: off the bottom of the screen is safe', t.m.THING_LEFT === 10 && t.m.SCORE === 0, t.m);
  const side = JSON.parse(JSON.stringify(brick)); side.every_frame[0].bounce = 'left-right';
  screen = { 100: 96, 101: 97 }; t = hitTest(side, screen, {});
  ok('tile hit: "bounce left or right" turns the sideways speed', t.m.BALL_VX === -2 && t.m.BALL_VY === 2, t.m);
  const back = JSON.parse(JSON.stringify(brick)); back.every_frame[0].bounce = 'back';
  screen = { 100: 96, 101: 97 }; t = hitTest(back, screen, {});
  ok('tile hit: "straight back" turns both', t.m.BALL_VX === -2 && t.m.BALL_VY === -2, t.m);
  const thru = JSON.parse(JSON.stringify(brick)); thru.every_frame[0].bounce = 'none';
  screen = { 100: 96, 101: 97 }; t = hitTest(thru, screen, {});
  ok('tile hit: "pass straight through" keeps going and still rubs out', t.m.BALL_VX === 2 && t.m.BALL_VY === 2 && screen[100] === 32, t.m);
  // the default: bounce the way it came in
  const auto = JSON.parse(JSON.stringify(brick)); auto.every_frame[0].bounce = 'auto';
  screen = { 100: 96, 101: 97 }; t = hitTest(auto, screen, {});                                   // came up from below, same column
  ok('bounce "the way it came in": from below it turns the up-and-down speed only', t.m.BALL_VY === -2 && t.m.BALL_VX === 2 && screen[101] === 32, t.m);
  screen = { 100: 96, 101: 97 }; t = hitTest(auto, screen, { BALL_X: 36, BALL_Y: 20, BALL_VY: 0 });   // moving along a row into the side of a brick
  ok('bounce "the way it came in": from the side it turns the sideways speed only', t.m.BALL_VX === -2 && t.m.BALL_VY === 0, t.m);
  screen = { 100: 96, 101: 97 }; t = hitTest(auto, screen, { BALL_X: 36, BALL_Y: 20 });          // new column and new row: a corner
  ok('bounce "the way it came in": at a corner it turns both', t.m.BALL_VX === -2 && t.m.BALL_VY === -2, t.m);
  ok('"bounce the way it came in" is what a new tile-hit block starts with', require('../lib/blocks-edit').newBlock(blocks['tile-hit'], kit('bricks')).bounce === 'auto');
  // an alien: 16x16 = 2 x 2 pieces, characters 96 97 / 98 99 in two screen rows
  const alien = tileProject('A_PIC');
  alien.data = alien.data.slice(0, -2).concat(['* @sprite 16x16 cells', 'A_PIC BYTE 1,2,3,4,5,6,7,8', '      BYTE 1,2,3,4,5,6,7,8', '      BYTE 1,2,3,4,5,6,7,8', '      BYTE 1,2,3,4,5,6,7,8']);
  screen = { 68: 96, 69: 97, 100: 98, 101: 99 };                                         // upper pieces on row 2, lower on row 3
  t = hitTest(alien, screen, {});
  ok('tile hit: hitting the bottom-right piece of a 16x16 tile rubs out all four pieces', t.problems.length === 0 && [68, 69, 100, 101].every(k => screen[k] === 32), [t.problems, screen]);
  screen = { 68: 96, 69: 97, 100: 98, 101: 99 }; t = hitTest(alien, screen, { BALL_X: 33, BALL_Y: 12 });   // column 4, row 2: the top-left piece
  ok('tile hit: hitting the top-left piece of a 16x16 tile rubs out all four pieces', [68, 69, 100, 101].every(k => screen[k] === 32) && t.m.THING_LEFT === 9, screen);
  // not marked "cells": a picture bigger than 8x8 is explained
  const plain = tileProject('A_PIC'); plain.data = plain.data.slice(0, -2).concat(['* @sprite 16x16', 'A_PIC BYTE 1,2,3,4,5,6,7,8']);
  ok('a big picture not marked "cells" is explained', GB.generate(plain, blocks).problems.some(x => /cells/.test(x)));
  const flat = tileProject('F_PIC'); flat.data = flat.data.slice(0, -2).concat(['* @sprite 16x8', 'F_PIC BYTE 1,2,3,4,5,6,7,8', '      BYTE 1,2,3,4,5,6,7,8']);
  ok('a 16x8 picture with no order marked is fine as a tile (it is already stored piece by piece)', GB.generate(flat, blocks).problems.length === 0, GB.generate(flat, blocks).problems);
  const rowsOrder = tileProject('F_PIC'); rowsOrder.data = rowsOrder.data.slice(0, -2).concat(['* @sprite 16x8 rows', 'F_PIC BYTE 1,2,3,4,5,6,7,8', '      BYTE 1,2,3,4,5,6,7,8']);
  ok('a 16x8 picture marked "rows" is explained, with the way to fix it', GB.generate(rowsOrder, blocks).problems.some(x => /cells/.test(x)) && require('../lib/blocks-edit').tileShape({ label: 'F', w: 16, h: 8, order: 'rows' }).fix === 'cells');
  const odd = tileProject('A_PIC'); odd.data = odd.data.slice(0, -2).concat(['* @sprite 12x8', 'A_PIC BYTE 1,2,3,4,5,6,7,8']);
  ok('a picture that is not a whole number of 8x8 pieces is explained', GB.generate(odd, blocks).problems.some(x => /whole number/.test(x)));
  const gone = tileProject('NOPE'); ok('a tile pointing at a picture that is not there is explained', GB.generate(gone, blocks).problems.some(x => /NOPE|not in the data/.test(x)), GB.generate(gone, blocks).problems);
  // the wall
  const wall = kit('bricks'); wall.start[1].left = 0;
  ok('a shifted wall that would run off the left is explained', GB.generate(wall, blocks).problems.some(x => /at least 1/.test(x)), GB.generate(wall, blocks).problems);
  const w2 = kit('bricks'); w2.start[1].across = 16;
  ok('a shifted wall that is too wide is explained', GB.generate(w2, blocks).problems.some(x => /does not fit|run off/.test(x)), GB.generate(w2, blocks).problems);
  const many = kit('bricks'); many.start[1].rows = 12; many.start[1].top = 0;
  ok('too many rows of different colours for the free characters is explained, not crashed on', (() => { const q = GB.generate(many, blocks); return q.problems.length === 0 || q.problems.some(x => /free|groups/.test(x)); })());
}

// ---- every row of the wall can be hit, not just the first ones ----
{
  const { run } = require('./tms-mini');
  const u16 = (n) => n & 0xFFFF;
  const p = kit('bricks'); const r = GB.generate(p, blocks);
  const pick = (pre) => r.asm.split('\n').filter((l, k) => r.paths[k] && (r.paths[k] === pre || r.paths[k].startsWith(pre + '/')));
  const screen = {};
  const hooks = {
    VTILES: (R) => { let pos = u16(R[0]); const n = u16(R[2]), cells = u16(R[3]), c = u16(R[1]) >> 8; for (let k = 0; k < n; k++) for (let i = 0; i < cells; i++) screen[pos++] = c + i; },
    VMBW: () => {}, VSBW: () => {},
    VFILL: (R) => { for (let i = 0; i < u16(R[2]); i++) screen[u16(R[0]) + i] = u16(R[1]) >> 8; },
    VSBR: (R) => { R[1] = (((screen[u16(R[0])] === undefined ? 32 : screen[u16(R[0])]) << 8) << 16) >> 16; }
  };
  run(pick('start/1'), {}, {}, hooks);
  const rows = new Set(Object.keys(screen).map(k => Math.floor(k / 32)));
  ok('the wall: six rows of tiles are drawn', rows.size === 6, [...rows]);
  const hit = pick('every_frame/' + p.every_frame.findIndex(b => b.block === 'tile-hit'));
  const pieces = Object.keys(screen).map(Number).filter(k => screen[k] >= 96);
  let missed = 0;
  for (const pos of pieces) {
    const col = pos % 32, row = (pos - col) / 32;
    run(hit, { BALL_X: col * 8, BALL_Y: row * 8, BALL_VX: 0, BALL_VY: -2, SCORE: 0, BRICK_LEFT: 93 }, {}, hooks);
    if (screen[pos] !== 32) missed++;
  }
  ok('the wall: a hit on any piece of any of the six rows rubs it out', pieces.length >= 90 && missed === 0, [pieces.length, missed]);
  ok('quitting: holding FCTN and = goes back to the title screen', /LDCR\s+R1,3[\s\S]*STCR\s+R1,8[\s\S]*ANDI\s+R1,>1100[\s\S]*JNE\s+NOQUIT[\s\S]*BLWP\s+@>0000[\s\S]*NOQUIT/.test(r.asm));
}

// ---- what "When one thing hits another" really does: run its code with real numbers ----
{
  const { run } = require('./tms-mini');
  const base = kit('bat-and-ball');
  const hit = (over, mem) => {
    const p = JSON.parse(JSON.stringify(base));
    const i = p.every_frame.findIndex(b => b.block === 'when-things-hit');
    Object.assign(p.every_frame[i], over);
    const r = GB.generate(p, blocks);
    const lines = r.asm.split('\n').filter((l, k) => r.paths[k] && (r.paths[k] === 'every_frame/' + i || r.paths[k].startsWith('every_frame/' + i + '/')));
    return run(lines, Object.assign({ BAT_X: 120, BAT_Y: 168, BALL_X: 124, BALL_Y: 164, BALL_VX: 2, BALL_VY: 2, BAT_VX: 0, BAT_VY: 0, SCORE: 5 }, mem)).mem;
  };
  let m = hit({}, {});
  ok('hitting the middle of the bat: goes straight up, and just above the bat', m.BALL_VY === -2 && m.BALL_VX === 0 && m.BALL_Y === 160, m);
  ok('hitting scores a point (the blocks inside run)', m.SCORE === 6, m.SCORE);
  m = hit({}, { BALL_X: 135 });
  ok('hitting the right edge of the bat sends it right', m.BALL_VX === 2 && m.BALL_VY === -2, m);
  m = hit({}, { BALL_X: 114 });
  ok('hitting the left edge of the bat sends it left', m.BALL_VX === -3 && m.BALL_VY === -2, m);
  m = hit({}, { BALL_X: 127 });
  ok('a little off the middle: a gentle angle', Math.abs(m.BALL_VX) <= 1, m.BALL_VX);
  m = hit({}, { BALL_Y: 100 });
  ok('not touching: nothing happens', m.BALL_VY === 2 && m.BALL_VX === 2 && m.SCORE === 5 && m.BALL_Y === 100, m);
  m = hit({}, { BALL_X: 200 });
  ok('beside the bat: nothing happens', m.BALL_VY === 2 && m.SCORE === 5, m);
  m = hit({}, { BALL_VY: -2 });
  ok('already going up: still goes up', m.BALL_VY === -2, m.BALL_VY);
  m = hit({ angle: 'keep' }, { BALL_VX: -2, BALL_VY: 3 });
  ok('keep the angle: same speeds, now going up', m.BALL_VX === -2 && m.BALL_VY === -3, m);
  m = hit({ angle: 'steep' }, { BALL_VX: -2, BALL_VY: 2 });
  ok('steep: mostly up, and it keeps going the way it was sideways', m.BALL_VX === -1 && m.BALL_VY === -3, m);
  m = hit({ angle: 'flat' }, { BALL_VX: 1, BALL_VY: 2 });
  ok('flat: mostly sideways', m.BALL_VX === 3 && m.BALL_VY === -1, m);
  m = hit({ angle: 'normal' }, { BALL_VX: 3, BALL_VY: 1 });
  ok('diagonal: equal speeds', m.BALL_VX === 2 && m.BALL_VY === -2, m);
  m = hit({ angle: 'normal' }, { BALL_VX: 0, BALL_VY: 1 });
  ok('standing still sideways: goes to the right', m.BALL_VX === 2, m);
  m = hit({ way: 'down', angle: 'keep' }, { BALL_Y: 166, BALL_VY: -2 });
  ok('bounce down: going down, just below the bat', m.BALL_VY === 2 && m.BALL_Y === 172, m);
  m = hit({ way: 'left', angle: 'keep' }, { BALL_X: 118, BALL_VX: 2, BALL_Y: 166 });
  ok('bounce left: going left, just left of the bat', m.BALL_VX === -2 && m.BALL_X === 112, m);
  m = hit({ way: 'right', angle: 'keep' }, { BALL_X: 134, BALL_VX: -2, BALL_Y: 166 });
  ok('bounce right: going right, just right of the bat', m.BALL_VX === 2 && m.BALL_X === 136, m);
  m = hit({ way: 'back', angle: 'keep' }, { BALL_VX: 2, BALL_VY: 3 });
  ok('straight back: both directions turn round', m.BALL_VX === -2 && m.BALL_VY === -3, m);
  m = hit({ then: 'destroy' }, {});
  ok('destroy: the ball is gone (parked off the screen, not moving)', m.BALL_Y === 200 && m.BALL_X === 0 && m.BALL_VX === 0 && m.BALL_VY === 0 && m.SCORE === 6, m);
  m = hit({ then: 'destroy-other' }, {});
  ok('destroy the other one: the bat is gone, the ball is untouched', m.BAT_Y === 200 && m.BALL_VY === 2 && m.BALL_Y === 164, m);
  m = hit({ then: 'stop' }, {});
  ok('stop: the ball stops where it is', m.BALL_VX === 0 && m.BALL_VY === 0 && m.BALL_Y === 164, m);
  m = hit({ then: 'nothing' }, {});
  ok('nothing: only the blocks inside run', m.BALL_VX === 2 && m.BALL_VY === 2 && m.SCORE === 6, m);
  ok('bouncing needs two different things, and says so', (() => { const p = JSON.parse(JSON.stringify(base)); const b = p.every_frame.find(x => x.block === 'when-things-hit'); b.other = 'ball'; return GB.generate(p, blocks).problems.some(x => /two different things/.test(x)); })());
  ok('a choice that does not exist is explained', (() => { const p = JSON.parse(JSON.stringify(base)); p.every_frame.find(x => x.block === 'when-things-hit').way = 'sideways'; return GB.generate(p, blocks).problems.some(x => /not one of: up, down, left, right, back/.test(x)); })());
  const E = require('../lib/blocks-edit');
  const def = blocks['when-things-hit'];
  ok('the bounce settings are hidden unless it bounces', E.shown(def, { then: 'bounce' }, 'way') && !E.shown(def, { then: 'destroy' }, 'way') && E.shown(def, {}, 'angle') && E.shown(def, { then: 'destroy' }, 'then'));
  ok('a new block starts as a bounce, with two different things', (() => { const b = E.newBlock(def, base); return b.then === 'bounce' && b.way === 'up' && b.angle === 'keep' && b.thing !== b.other; })());
  ok('a choice setting only takes one of its choices', (() => { const q = JSON.parse(JSON.stringify(base)); const i = q.every_frame.findIndex(b => b.block === 'when-things-hit'); E.setParam(q, ['every_frame'], i, 'way', 'nonsense', def); return q.every_frame[i].way === 'up'; })());
}

// ---- copying a picture ----
{
  const E = require('../lib/blocks-edit');
  const file = ['* header', '', '* @sprite 16x8 cells', 'BRICK_PIC BYTE >FF,>FF,>FF,>FF,>FF,>FF,>FF,>00', '       BYTE >FE,>FE,>FE,>FE,>FE,>FE,>FE,>00', '', '* @sprite 8x8', 'DOT BYTE 1,2,3,4,5,6,7,8', ''];
  const c = E.copyPictureLines(file, 'BRICK_PIC', 'WALL_PIC');
  ok('copy: the marker, the label line and the data lines come across, with the new name', c.lines && c.lines.length === 3 && c.lines[0] === '* @sprite 16x8 cells' && /^WALL_PIC BYTE >FF/.test(c.lines[1]) && /^\s+BYTE >FE/.test(c.lines[2]), c);
  ok('copy: a one-line picture copies on its own, not the one above it', E.copyPictureLines(file, 'DOT', 'DOT2').lines.length === 2);
  ok('copy: a name that is already used is refused', E.copyPictureLines(file, 'BRICK_PIC', 'DOT').error && E.copyPictureLines(file, 'BRICK_PIC', 'dot').error);
  ok('copy: a bad name or a missing picture is explained', E.copyPictureLines(file, 'BRICK_PIC', '1x').error && E.copyPictureLines(file, 'NOPE', 'X').error);
  const out = file.concat(c.lines);
  const dot = E.pictures(out); ok('copy: the copy is a picture of the same size', dot.some(x => x.label === 'WALL_PIC' && x.w === 16 && x.h === 8 && x.order === 'cells'), dot);
}

// ---- older blocks files keep working ----
{
  const U = require('../lib/blocks-upgrade');
  const old = {
    title: 'Old', machine: 'ti99', things: { ball: { art: 'BALL_PIC', x: 10, y: 10, w: 8, h: 8, color: 15 } },
    start: [{ block: 'brick-wall', rows: 3, top: 2, colour: 9 }],
    every_frame: [{ block: 'if-hits-brick', thing: 'ball', do: [{ block: 'add-to-score', by: 1 }] }, { block: 'if-no-bricks', do: [{ block: 'brick-wall', rows: 3, top: 2 }] }],
    data: ['* @sprite 16x16', 'BALL_PIC BYTE 0,0,0,0,0,0,0,0', '       BYTE 0,0,0,0,0,0,0,0', '       BYTE 0,0,0,0,0,0,0,0', '       BYTE 0,0,0,0,0,0,0,0']
  };
  const copy = JSON.stringify(old);
  const u = U.upgrade(old);
  ok('older file: the project handed in is not changed', JSON.stringify(old) === copy);
  ok('older file: brick blocks become tile blocks, nested ones too', u.changed && u.project.start[0].block === 'tile-fill' && u.project.every_frame[0].block === 'tile-hit' && u.project.every_frame[1].block === 'if-no-tiles' && u.project.every_frame[1].do[0].block === 'tile-fill', u.project);
  ok('older file: the old settings are kept (rows, top, colour, what is inside)', u.project.start[0].rows === 3 && u.project.start[0].top === 2 && u.project.start[0].colour === 9 && u.project.every_frame[0].do[0].block === 'add-to-score');
  ok('older file: a brick tile and the brick picture are added', u.project.tiles.brick.art === 'BRICK_PIC' && u.project.data.some(l => /^BRICK_PIC\s/.test(l)));
  const g = GB.generate(old, blocks);
  ok('older file: makes a game with no problems, without being converted first', g.problems.length === 0 && /^VTILES\s/m.test(g.asm), g.problems);
  ok('older file: upgrading twice changes nothing more', U.upgrade(u.project).changed === false && JSON.stringify(U.upgrade(u.project).project) === JSON.stringify(u.project));
  ok('a file with no brick blocks is left alone', U.upgrade(kit('bat-and-ball')).changed === false);
  const mv = U.moveDataToFile(kit('bricks'), 'x-pictures.a99');
  ok('moving the data: the project points to the file and holds no data', mv.project.dataFile === 'x-pictures.a99' && !mv.project.data && /BRICK_PIC/.test(mv.text) && /BOING/.test(mv.text));
  ok('moving the data: the game made from the pieces is the same', (() => { const a = GB.generate(kit('bricks'), blocks).asm.split('\n').filter(l => /BYTE|DATA/.test(l)); const b = GB.generate(mv.project, blocks, { dataLines: mv.text.split('\n') }); return b.problems.length === 0 && a.every(l => b.asm.includes(l) || mv.text.includes(l.trim())); })());
  ok('moving the data twice does nothing the second time', U.moveDataToFile(mv.project, 'y.a99') === null);
}

// ---- with xas99: the real assembler agrees, and the debugger's loader accepts the program ----
if (process.env.XAS99) {
  const cp = require('child_process'), os = require('os');
  for (const kid of ['bat-and-ball', 'bricks', 'bricks+long', 'bricks+file']) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blocks-'));
  const proj = kit(kid.replace(/\+(long|file)$/, ''));
  if (kid.endsWith('+long')) { const bw = proj.every_frame.find(b => b.block === 'if-below'); for (let i = 0; i < 90; i++) bw.do.push({ block: 'place', thing: 'ball', x: 1, y: 2 }); }   // a very long list inside an "if"
  let dataLines;
  if (kid.endsWith('+file')) {   // the pictures and sounds in a file of their own, included with COPY
    const moved = require('../lib/blocks-upgrade').moveDataToFile(proj, 'game-pictures.a99');
    fs.writeFileSync(path.join(dir, 'game-pictures.a99'), moved.text);
    Object.keys(proj).forEach(k => delete proj[k]); Object.assign(proj, moved.project); dataLines = moved.text.split('\n');
  }
  const r = GB.generate(proj, blocks, { dataLines });
  if (kid.endsWith('+file')) ok('bricks+file: includes the pictures file and holds no data of its own', /COPY\s+"game-pictures\.a99"/.test(r.asm) && !/BRICK_PIC\s+BYTE/.test(r.asm) && r.problems.length === 0, r.problems);
  fs.writeFileSync(path.join(dir, 'game.a99'), r.asm);
  const py = process.platform === 'win32' ? 'python' : 'python3';
  const x = cp.spawnSync(py, [process.env.XAS99, '-R', 'game.a99', '-L', 'game.lst', '-S', '-o', 'game.obj'], { cwd: dir, encoding: 'utf8' });
  const errors = ((x.stdout || '') + (x.stderr || '')).split('\n').filter(l => /\*{3,}\s*Error/i.test(l));
  ok(kid + ': ' + 'xas99 builds the made game with no errors', x.status === 0 && errors.length === 0 && fs.existsSync(path.join(dir, 'game.obj')), errors.concat((x.stderr || '').slice(0, 200)));
  if (fs.existsSync(path.join(dir, 'game.lst'))) {
    const L = require('../lib/listing');
    const parsed = L.parseListing(fs.readFileSync(path.join(dir, 'game.lst'), 'utf8'), path.join(dir, 'game.a99'));
    ok(kid + ': ' + 'the debugger\'s loader accepts it (every piece inside the extra memory, starting at >A000)', L.checkImage(parsed) === '' && parsed.segments[0].start === 0xA000, [L.checkImage(parsed), parsed.segments]);
    ok(kid + ': ' + 'it starts where START is', parsed.entry === parsed.symbols.get('START') && parsed.entry === 0xA000, parsed.entry);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  }
} else console.log('skip  xas99 checks (set XAS99 to the path of xas99.py to run them)');

console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
