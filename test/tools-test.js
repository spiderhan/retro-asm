// Tests for finding the assemblers and emulators, and for building and starting with them.
// Run: node test/tools-test.js (ext-test.js runs it too). Every tool here is a made-up stand-in file
// in a temporary folder, and the code is made up. Set SJASMPLUS to the path of a real sjasmplus to
// also build a made-up Spectrum program with it.
const path = require('path'), fs = require('fs'), os = require('os');
const { loadFile } = require('../lib/dialect'); const B = require('../lib/build'); const T = require('../lib/tools');
let fails = 0; const ok = (name, cond, extra) => { if (!cond) { fails++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } else console.log('ok  ', name); };
const chip = (id) => loadFile(path.join(__dirname, '../dialects', id + '.json'));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'retroasm-tools-'));
const touch = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text || ''); fs.chmodSync(file, 0o755); return file; };
// a made-up computer: nothing installed, an empty home, an empty PATH, no usual install folders
const world = () => { const root = tmp(); const home = path.join(root, 'home'); const work = path.join(root, 'work'); fs.mkdirSync(home); fs.mkdirSync(work);
  const bin = path.join(root, 'bin'); fs.mkdirSync(bin);
  return { root, home, work, bin, settings: { home, env: { PATH: bin }, standardDirs: [], toolsFolder: path.join(home, 'tools') } }; };

// ---- looking ----
{
  const w = world(); const spec = { id: 'xas99', find: ['xas99.py', 'xdt99/xas99.py'] };
  ok('nothing installed: not found', T.locate(spec, { dir: w.work, platform: 'linux', env: w.settings.env, home: w.home, toolsFolder: w.settings.toolsFolder, standardDirs: [] }) === null);
  const f = touch(path.join(w.settings.toolsFolder, 'xdt99-3.6.5-Windows', 'xas99.py'));
  const got = T.locate(spec, { dir: w.work, platform: 'linux', env: w.settings.env, home: w.home, toolsFolder: w.settings.toolsFolder, standardDirs: [] });
  ok('found inside the tools folder, in a folder with a version in its name', got && got.file === f && got.from === 'your tools folder' && !got.fromProject, got);
  const chosen = touch(path.join(w.root, 'elsewhere', 'xas99.py'));
  const got2 = T.locate(spec, { dir: w.work, platform: 'linux', toolPaths: { xas99: chosen }, env: w.settings.env, home: w.home, toolsFolder: w.settings.toolsFolder, standardDirs: [] });
  ok('a file chosen in the settings comes first', got2 && got2.file === chosen, got2);
  const near = touch(path.join(w.work, 'xdt99', 'xas99.py'));
  const got3 = T.locate(spec, { dir: w.work, platform: 'linux', env: w.settings.env, home: w.home, toolsFolder: w.settings.toolsFolder, standardDirs: [] });
  ok('next to the source counts as coming from the project (so you are asked first)', got3 && got3.file === near && got3.fromProject, got3);
  const w2 = world(); const onp = touch(path.join(w2.bin, 'sjasmplus'));
  const got4 = T.locate({ id: 'sjasmplus', find: ['sjasmplus.exe', 'sjasmplus'] }, { dir: w2.work, platform: 'linux', env: w2.settings.env, home: w2.home, toolsFolder: w2.settings.toolsFolder, standardDirs: [] });
  ok('found on the PATH (and a .exe name is skipped on Linux)', got4 && got4.file === onp && got4.from === 'your PATH', got4);
  const w3 = world(); const usual = touch(path.join(w3.root, 'apps', 'Fuse', 'fuse.exe'));
  const got5 = T.locate({ id: 'fuse', find: ['fuse.exe'] }, { dir: w3.work, platform: 'win32', env: w3.settings.env, home: w3.home, toolsFolder: w3.settings.toolsFolder, standardDirs: [[path.join(w3.root, 'apps'), 2]] });
  ok('found in a usual install folder', got5 && got5.file === usual && got5.from === 'a usual install folder', got5);
  ok('Windows-only names are not looked for on Linux', T.locate({ id: 'x', find: ['classic99.exe'] }, { dir: w.work, platform: 'linux', env: w.settings.env, home: w.home, standardDirs: [] }) === null);
}

// ---- Spectrum: sjasmplus and Fuse ----
{
  const z = chip('z80'); const w = world(); const src = path.join(w.work, 'game.z80');
  const none = B.plan(src, w.settings, 'linux', z);
  ok('Spectrum with no sjasmplus: says so, and offers the setup', /sjasmplus/.test(none.error || '') && /Set up tools/.test(none.error) && none.setup === true, none);
  const tool = touch(path.join(w.settings.toolsFolder, 'sjasmplus-1.24.0.win', 'sjasmplus'));
  const pl = B.plan(src, w.settings, 'linux', z);
  ok('sjasmplus in the tools folder is run on the source file', pl.command === `"${tool}" "game.z80"` && pl.cwd === w.work && !pl.fromProject, pl);
  const noFuse = B.findRunner(src, w.settings, 'linux', z);
  ok('no Fuse: the message says so', noFuse && noFuse.missingTool && /Fuse/.test(noFuse.message), noFuse);
  const fuse = touch(path.join(w.settings.toolsFolder, 'fuse', 'fuse'));
  const noSna = B.findRunner(src, w.settings, 'linux', z);
  ok('Fuse is not started when the build made no snapshot', noSna && noSna.missingOutput && noSna.missingOutput.endsWith('game.sna'), noSna);
  fs.writeFileSync(path.join(w.work, 'game.sna'), '');
  const rn = B.findRunner(src, w.settings, 'linux', z);
  ok('Fuse is started with the snapshot', rn && rn.file === fuse && rn.args.length === 1 && rn.args[0] === path.join(w.work, 'game.sna'), rn);
  ok('your own run command still wins', B.findRunner(src, Object.assign({}, w.settings, { runCommand: '"C:\\x\\f.exe" a' }), 'linux', z).exe === 'f.exe');
  ok('your own build command still wins', B.plan(src, Object.assign({}, w.settings, { command: 'echo hi' }), 'linux', z).command === 'echo hi');
}

// ---- C64: KickAssembler (needs Java) and VICE ----
{
  const c = chip('6502'); const w = world(); const src = path.join(w.work, 'game.asm');
  const noJar = B.plan(src, w.settings, 'linux', c);
  ok('C64 with no KickAssembler: says so, and offers the setup', /KickAssembler/.test(noJar.error || '') && noJar.setup === true, noJar);
  const jar = touch(path.join(w.settings.toolsFolder, 'KickAss.jar'));
  const noJava = B.plan(src, w.settings, 'linux', c);
  ok('KickAssembler without Java: it is Java that is missing', /Java/.test(noJava.error || '') && noJava.setup === true, noJava);
  const java = touch(path.join(w.bin, 'java'));
  const pl = B.plan(src, w.settings, 'linux', c);
  ok('KickAssembler is run with Java on the source file', pl.command === `"${java}" -jar "${jar}" "game.asm"`, pl);
  const home = path.join(w.root, 'jdk'); const j2 = touch(path.join(home, 'bin', 'java'));
  const pl2 = B.plan(src, Object.assign({}, w.settings, { env: { PATH: '', JAVA_HOME: home } }), 'linux', c);
  ok('JAVA_HOME is used too', pl2.command && pl2.command.startsWith(`"${j2}"`), pl2);
  const vice = touch(path.join(w.settings.toolsFolder, 'vice', 'bin', 'x64sc'));
  fs.writeFileSync(path.join(w.work, 'game.prg'), '');
  const rn = B.findRunner(src, w.settings, 'linux', c);
  ok('VICE is started with -autostart and the program', rn && rn.file === vice && rn.args[0] === '-autostart' && rn.args[1] === path.join(w.work, 'game.prg'), rn);
}

// ---- TI-99/4A: xas99 (needs Python) and Classic99 ----
{
  const t = chip('tms9900'); const w = world(); const src = path.join(w.work, 'game.a99');
  const none = B.plan(src, w.settings, 'linux', t);
  ok('TI with no xas99: says so, and offers the setup', /xas99/.test(none.error || '') && none.setup === true, none);
  const xas = touch(path.join(w.settings.toolsFolder, 'xdt99-3.6.5', 'xas99.py'));
  const py = touch(path.join(w.bin, 'python3'));
  const pl = B.plan(src, w.settings, 'linux', t);
  ok('xas99 in the tools folder is run with the Python that was found', pl.how === 'xas99' && pl.command.startsWith(`"${py}" "${xas}" -R "game.a99"`) && !pl.fromProject, pl);
  ok('Classic99 is Windows only: no run tool on Linux, so your own command is asked for', B.findRunner(src, w.settings, 'linux', t) === null);
  const c99 = touch(path.join(w.settings.toolsFolder, 'Classic99', 'classic99.exe'));
  const rn = B.findRunner(src, w.settings, 'win32', t);
  ok('Classic99 in the tools folder is started (Windows)', rn && rn.file === c99 && rn.args.length === 0, rn);
}

// ---- the report ----
{
  const w = world(); const ctx = B.toolContext(w.settings, w.work, 'linux');
  const roles = (id) => B.reportTools(chip(id), ctx).map(r => r.role + ':' + r.name);
  ok('report: Spectrum', roles('z80').join() === 'assembler:sjasmplus,emulator:Fuse', roles('z80'));
  ok('report: C64 lists Java too', roles('6502').join() === 'assembler:KickAssembler,runtime:Java,emulator:VICE', roles('6502'));
  ok('report: TI lists Python too', roles('tms9900').join() === 'assembler:xas99,runtime:Python,emulator:Classic99,debugger:MAME', roles('tms9900'));
  ok('report: BBC', roles('bbc').join() === 'assembler:BeebAsm,emulator:BeebEm', roles('bbc'));
  ok('report: nothing is found in an empty world', B.reportTools(chip('z80'), ctx).every(r => !r.found));
  touch(path.join(w.settings.toolsFolder, 'sjasmplus'));
  ok('report: it sees a tool once it is there', B.reportTools(chip('z80'), ctx)[0].found);
  for (const id of ['tms9900', 'z80', '6502', 'bbc']) {
    const rep = B.reportTools(chip(id), ctx);
    ok(`${id}: every tool says where to get it`, rep.length >= 2 && rep.every(r => /^https:\/\//.test(r.url) && r.get.length > 20), rep.map(r => [r.name, r.url]));
  }
}

// ---- reading what the assemblers say ----
{
  // exactly what sjasmplus 1.24.0 printed for a made-up file with three mistakes
  const sj = 'SjASMPlus Z80 Cross-Assembler v1.24.0 (https://github.com/z00m128/sjasmplus)\nPass 1 complete (0 errors)\nPass 2 complete (0 errors)\ngame.z80(6): error: Label not found: nowhere\ngame.z80(6): error: [JR] Target out of range (-32774)\ngame.z80(7): error: Illegal instruction:   ld a,\nPass 3 complete\nErrors: 3, warnings: 0, compiled: 10 lines, work time: 0.001 seconds\n';
  const w = world(); touch(path.join(w.work, 'game.z80'));   // the plain "file(line): message" shape is only taken when the file exists
  const out = B.parseOutput(sj, w.work);
  ok('sjasmplus 1.24.0 output (real) is read', out.length === 3 && out[0].line === 5 && out[2].line === 6 && /Label not found/.test(out[0].message), out);
  const kk = B.parseOutput("Error: Unknown symbol 'foo'\nat line 12, column 9 in game.asm\n", '/w');
  ok('KickAssembler "at line, column in file" messages are read (shape not yet checked against the real one)', kk.length === 1 && kk[0].line === 11 && /Unknown symbol/.test(kk[0].message), kk);
}

// ---- the real sjasmplus, if there is one (set SJASMPLUS) ----
if (process.env.SJASMPLUS && fs.existsSync(process.env.SJASMPLUS)) {
  const z = chip('z80'); const w = world(); const src = path.join(w.work, 'game.z80');
  fs.writeFileSync(src, '  DEVICE ZXSPECTRUM48\n  ORG $8000\nstart:\n  ld a,2\n  out ($FE),a\n  ret\n  SAVESNA "game.sna",start\n');
  const tool = touch(path.join(w.settings.toolsFolder, 'sjasmplus')); fs.copyFileSync(process.env.SJASMPLUS, tool); fs.chmodSync(tool, 0o755);
  (async () => {
    const pl = B.plan(src, w.settings, 'linux', z);
    const good = await B.run(pl);
    ok('real sjasmplus: a clean file builds and makes the snapshot', good.code === 0 && good.problems.length === 0 && fs.existsSync(path.join(w.work, 'game.sna')), [good.code, good.text]);
    const rn = B.findRunner(src, w.settings, 'linux', z); ok('real sjasmplus: so the emulator step has its snapshot', rn && rn.missingTool, rn);
    fs.writeFileSync(src, fs.readFileSync(src, 'utf8').replace('  ret', '  jr nowhere\n  ld a,\n  ret'));
    const bad = await B.run(pl);
    ok('real sjasmplus: mistakes come back on the right lines', bad.code !== 0 && bad.problems.length === 3 && bad.problems[0].line === 5, bad.problems);
    console.log(fails ? `${fails} FAILED` : 'all passed'); process.exit(fails ? 1 : 0);
  })();
} else { console.log(fails ? `${fails} FAILED` : 'all passed'); process.exit(fails ? 1 : 0); }
