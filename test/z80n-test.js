'use strict';
// The Spectrum Next (Z80N) chip file, and chip files that build on another one ("extends").
//   node test/z80n-test.js
// Set SJASMPLUS to the path of sjasmplus to also check the sizes against it and build the starter code.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');
const { loadFile, loadFolder, mergeRaw, guessDialect, snippetPreview } = require('../lib/dialect');
const { Project } = require('../lib/project');
const F = require('../lib/features');
const X = require('../lib/explain');

let fails = 0;
const ok = (name, cond, extra) => { if (!cond) { fails++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } else console.log('ok  ', name); };
const DIR = path.join(__dirname, '../dialects');
const N = loadFile(path.join(DIR, 'z80n.json'));
const Z = loadFile(path.join(DIR, 'z80.json'));

// --- building on another chip file
ok('z80n builds on z80', N.basedOn === 'z80' && N.id === 'z80n');
ok('z80n knows every Z80 instruction', [...Z.instructions.keys()].every(k => N.instructions.has(k)));
ok('z80n adds the Next instructions', ['NEXTREG', 'MUL', 'LDIRX', 'PIXELAD', 'SWAPNIB', 'TEST', 'OUTINB'].every(k => N.instructions.has(k)));
ok('plain z80 does not know them', !Z.instr('NEXTREG') && !Z.instr('MUL'));
ok('the Spectrum addresses come along', N.addresses.size === Z.addresses.size && N.addresses.size > 100);
ok('the Spectrum ports come along, with the Next ones', N.ioPort(0xFE) && N.ioPort(0x7FFD) && N.ioPort(0x243B) && /sprite/.test(N.ioPort(0x1357).name));
ok('merge: names merge, lists are replaced, null takes out',
  JSON.stringify(mergeRaw({ a: { x: 1, y: 2 }, l: [1, 2], g: 5 }, { a: { y: 3 }, l: [9], g: null })) === JSON.stringify({ a: { x: 1, y: 3 }, l: [9] }));
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'z80n-'));
  fs.writeFileSync(path.join(tmp, 'mine.json'), JSON.stringify({ id: 'mine', extends: 'z80', short: 'Mine', instructions: { HALT: { summary: 'My words.' } } }));
  fs.writeFileSync(path.join(tmp, 'lost.json'), JSON.stringify({ id: 'lost', extends: 'nothere' }));
  fs.writeFileSync(path.join(tmp, 'bad.json'), JSON.stringify({ id: 'bad', extends: '../z80' }));
  const r = loadFolder(tmp, { baseFolders: [DIR] });
  const mine = r.dialects.find(d => d.id === 'mine');
  ok('your own chip file can build on a built-in one', mine && mine.instr('LD') && mine.instr('HALT').summary === 'My words.' && mine.instr('HALT').explain);
  ok('a missing base is explained', r.errors.some(e => /lost\.json.*no nothere\.json/.test(e)), r.errors);
  ok('a base name that climbs out of the folder is refused', r.errors.some(e => /bad\.json.*id of another chip file/.test(e)), r.errors);
}

// --- sizes: checked against sjasmplus 1.24.0 (--zxnext)
const forms = [
  ['swapnib', 2], ['mirror a', 2], ['mirror', 2], ['test $0F', 3], ['bsla de,b', 2], ['bsra de,b', 2], ['bsrl de,b', 2], ['bsrf de,b', 2], ['brlc de,b', 2],
  ['mul d,e', 2], ['mul', 2], ['add hl,a', 2], ['add de,a', 2], ['add bc,a', 2], ['add hl,$1234', 4], ['add de,320', 4], ['add bc,lbl', 4],
  ['push $1234', 4], ['push lbl', 4], ['outinb', 2], ['nextreg $07,3', 4], ['nextreg $07,a', 3], ['nextreg 21,A', 3], ['pixeldn', 2], ['pixelad', 2], ['setae', 2],
  ['jp (c)', 2], ['ldix', 2], ['ldws', 2], ['lddx', 2], ['ldirx', 2], ['ldpirx', 2], ['lddrx', 2],
  // the plain Z80 ways of writing them are unchanged
  ['push hl', 1], ['push ix', 2], ['add hl,de', 1], ['add ix,bc', 2], ['add a,5', 2], ['add a,b', 1], ['jp (hl)', 1], ['jp (ix)', 2], ['jp lbl', 3], ['ld hl,5', 3]
];
const src = '  ORG $8000\n' + forms.map(f => '  ' + f[0]).join('\n') + '\nlbl equ 777\n';
const PJ = new Project();
PJ.set('/x/next.asm', src, N);
const L = PJ.layout('/x/next.asm').files.get('/x/next.asm');
const bad = forms.filter((f, i) => L.size[i + 1] !== f[1] || L.approx[i + 1]).map(f => [f[0], f[1], L.size[forms.indexOf(f) + 1]]);
ok(`sizes of ${forms.length} ways of writing Next instructions`, bad.length === 0, bad);
if (process.env.SJASMPLUS) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'z80n-sj-'));
  fs.writeFileSync(path.join(tmp, 't.asm'), src);
  execFileSync(process.env.SJASMPLUS, ['--zxnext', '--lst=t.lst', 't.asm'], { cwd: tmp, stdio: 'pipe' });
  const lst = fs.readFileSync(path.join(tmp, 't.lst'), 'utf8').split(/\r?\n/);
  const real = [];
  for (const l of lst) { const m = /^\s*(\d+)\s+[0-9A-F]{4}((?:\s[0-9A-F]{2})*)\s{2,}\S/.exec(l); if (m) real[+m[1] - 1] = m[2].trim() ? m[2].trim().split(/\s+/).length : 0; }
  const off = forms.filter((f, i) => real[i + 1] !== L.size[i + 1]).map(f => [f[0], real[forms.indexOf(f) + 1], L.size[forms.indexOf(f) + 1]]);
  ok('sizes match real sjasmplus', off.length === 0, off);
} else console.log('skip  sizes against real sjasmplus (set SJASMPLUS to run it)');

// --- times (T-states), from the Spectrum Next wiki's Z80N table
const ctx = F.makeCtx(PJ, '/x/next.asm');
const m = PJ.get('/x/next.asm');
const timeOf = (text) => { const ln = forms.findIndex(f => f[0] === text) + 1; const pl = m.lines[ln]; return X.timeFor(N.instr(pl.mnem.upper), pl, ctx, ln); };
const same = (a, b) => JSON.stringify([...new Set(a)].sort((x, y) => x - y)) === JSON.stringify(b);
for (const [t, c] of [['swapnib', [8]], ['test $0F', [11]], ['mul d,e', [8]], ['add hl,a', [8]], ['add de,320', [16]], ['push $1234', [23]], ['push hl', [11]], ['push ix', [15]],
  ['outinb', [16]], ['nextreg $07,3', [20]], ['nextreg $07,a', [17]], ['jp (c)', [13]], ['ldws', [14]], ['ldix', [16]], ['ldirx', [16, 21]], ['add hl,de', [11]], ['jp (hl)', [4]]]) {
  const r = timeOf(t);
  ok(`time: ${t} = ${c.join('/')}`, r && same(r.values, c), r);
}
ok('time: LDIRX says per byte', /21 cycles for each byte, 16 for the last one/.test(timeOf('ldirx').text));

// --- words
const say = (line) => { const P2 = new Project(); P2.set('/x/s.asm', '  ORG $8000\n' + line + '\n', N); return X.explainLine(P2.get('/x/s.asm').lines[1], F.makeCtx(P2, '/x/s.asm'), 1); };
ok('NEXTREG $07,3 says 28 MHz', /Set Next register \$07 \(CPU speed\) to 3\..*28 MHz/.test(say('  nextreg $07,3')), say('  nextreg $07,3'));
ok('NEXTREG $52,10 says which memory', /Slot 2 \(\$4000-\$5FFF\) now shows 8K page 10.*normal screen/.test(say('  nextreg $52,10')), say('  nextreg $52,10'));
ok('NEXTREG $15,1 says sprites shown', /sprites shown/.test(say('  nextreg $15,1')), say('  nextreg $15,1'));
ok('NEXTREG $07,A names the register', /Set Next register \$07 \(CPU speed\) to A/.test(say('  nextreg $07,a')), say('  nextreg $07,a'));
ok('ADD DE,A is explained', /Add A to DE/.test(say('  add de,a')), say('  add de,a'));
ok('PUSH number is explained', /Put \$1234.*on top of the stack/.test(say('  push $1234')), say('  push $1234'));
ok('JP (C) is explained', /port BC/.test(say('  jp (c)')), say('  jp (c)'));
ok('ADD HL,DE still reads as before', /Add DE to HL/.test(say('  add hl,de')), say('  add hl,de'));

// --- tooltips
{
  const P3 = new Project();
  P3.set('/x/h.asm', '  ORG $8000\n  nextreg $07,3\n  nextreg $99,1\n', N);
  const h = F.hoverAt(P3, '/x/h.asm', 1, 12);
  ok('tooltip on the register number says what it is', h && h.parts.some(x => /Next register \$07 \(7\): CPU speed/.test(x)) && h.parts.some(x => /28 MHz/.test(x)), h && h.parts);
  const v = F.hoverAt(P3, '/x/h.asm', 1, 14);
  ok('tooltip on the value says what it does', v && v.parts.some(x => /28 MHz/.test(x)), v && v.parts);
  const u = F.hoverAt(P3, '/x/h.asm', 2, 12);
  ok('a register with no notes says so', u && u.parts.some(x => /no notes on Next register \$99/.test(x)), u && u.parts);
  const i = F.hoverAt(P3, '/x/h.asm', 1, 4);
  ok('tooltip on NEXTREG explains it', i && i.parts.some(x => /Next register/.test(x)), i && i.parts);
}

// --- no false warnings on Next code
{
  const P4 = new Project();
  const code = '  DEVICE ZXSPECTRUMNEXT\n  ORG $8000\nstart:\n  nextreg $07,3\n  ld de,$0A0B\n  mul d,e\n  add hl,a\n  add de,320\n  push $1234\n  pop bc\n  ld bc,$123B\n  jp (c)\n  ldirx\n  test $80\n  jr z,start\n  ret\n';
  P4.set('/x/w.asm', code, N);
  const w = F.check(P4, '/x/w.asm');
  ok('Next code gives no warnings', w.length === 0, w.map(x => [x.line + 1, x.message]));
}

// --- NEXTREG in a file read as plain Z80 says which chip has it
{
  const P5 = new Project();
  P5.chips = [Z, N];
  P5.set('/x/p.z80', '  ORG 32768\n  nextreg 7,3\n  frob\n  ret\n', Z);
  const w = F.check(P5, '/x/p.z80');
  ok('NEXTREG in plain Z80 points to the Spectrum Next', w.some(x => x.line === 1 && /is a Spectrum Next instruction, but this file is read as Z80/.test(x.message)), w.map(x => x.message));
  ok('a made-up word still says check the spelling', w.some(x => x.line === 2 && /Check the spelling/.test(x.message)), w.map(x => x.message));
}

// --- which chip a file is read as
const plain = '  ORG 32768\nstart: ld a,2\n  out ($fe),a\n  ret\n';
ok('plain Z80 stays Z80', guessDialect(plain, [Z, N]).id === 'z80');
ok('Next instructions pick the Next', guessDialect(plain + '  nextreg $07,3\n', [Z, N]).id === 'z80n');
ok('DEVICE ZXSPECTRUMNEXT picks the Next', guessDialect('  DEVICE ZXSPECTRUMNEXT\n' + plain, [Z, N]).id === 'z80n');
ok('a comment about the Next does not', guessDialect('; DEVICE ZXSPECTRUMNEXT later\n' + plain, [Z, N]).id === 'z80');
ok('timing note: contended memory only at 3.5 MHz', /At 3\.5 MHz/.test(JSON.stringify(N.timing)));

// --- the starter code builds with real sjasmplus
if (process.env.SJASMPLUS) {
  const prog = N.snippets.find(s => s.key === 'program');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'z80n-prog-'));
  const middle = ['        nextreg $57,20', '        ld de,$0A0B', '        mul d,e', '        push $1234', '        pop hl', '        ldirx'].join('\n');
  const body = snippetPreview(prog.text.replace(/^\s*\$0$/m, () => middle.replace(/\$/g, '\\$')));
  fs.writeFileSync(path.join(tmp, 'p.asm'), body);
  const run = spawnSync(process.env.SJASMPLUS, ['--zxnext', 'p.asm'], { cwd: tmp, encoding: 'utf8' });
  const out = String(run.stdout || '') + String(run.stderr || '');
  ok('the starter code builds with sjasmplus and makes a .nex file', /Errors: 0, warnings: 0/.test(out) && fs.existsSync(path.join(tmp, 'program.nex')), out);
} else console.log('skip  starter code with real sjasmplus (set SJASMPLUS to run it)');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
