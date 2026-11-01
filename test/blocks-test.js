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
  ok(`${k.id}: ends with END START`, /END\s+START\s*$/.test(r.asm));
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

console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
