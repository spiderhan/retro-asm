// Checks the GPL chip file (dialects/gpl.json) against a made-up GPL program.
// Run: node test/gpl-test.js
const path = require('path'), fs = require('fs'), assert = require('assert');
const { loadFile } = require('../lib/dialect');
const { Project } = require('../lib/project');
const F = require('../lib/features');
const X = require('../lib/explain');

const D = loadFile(path.join(__dirname, '../dialects/gpl.json'));
const file = path.join(__dirname, 'fixtures', 'gpl-demo.gpl');
const P = new Project();
P.set(file, fs.readFileSync(file, 'utf8'), D);
const M = P.get(file);
let failed = 0;
const ok = (name, cond, extra) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond || !extra ? '' : '  ' + JSON.stringify(extra))); if (!cond) failed++; };

const hoverText = (needle, sub) => {
  const ln = M.rawLines.findIndex(l => l.includes(needle));
  const ch = M.rawLines[ln].indexOf(sub);
  const h = F.hoverAt(P, file, ln, ch + 1);
  return h ? h.parts.join('\n') : '';
};

ok('the chip file loads and claims .gpl', D.id === 'gpl' && D.fileExtensions.includes('.gpl'));
ok('a correct made-up program gives no warnings', F.check(P, file).length === 0, F.check(P, file).map(c => c.message));
ok('V@ and G@ are not read as labels', !F.check(P, file).some(c => /called [GV] /.test(c.message)));
ok('ST explained', /Put .*3.* into the byte at LIVES/.test(X.explainLine ? (F.explainLines(P, file, 0, M.rawLines.length).match(/ST >03,@LIVES[^\n]*/) || [''])[0] : ''));
ok('MOVE from GROM to video memory is explained', /GROM at SHAPE.*video memory at/.test(F.explainLines(P, file, 0, M.rawLines.length)));
ok('# is a video chip setting', /Video chip setting/.test(hoverText('MOVE >0002,@SCORE,#7', '#7')));
ok('V@ with an offset is explained', /Video memory, with an offset/.test(hoverText('ST   >00,V@>0400(@TICKS)', 'V@>0400(@TICKS)')));
ok('a pointer (*) is explained', /address kept in memory/.test(hoverText('CZ   *TICKS', '*TICKS')));
ok('a scratchpad address has its name', /The key SCAN found/.test(hoverText('CEQ  >FF,@>8375', '@>8375')));
ok('HTEXT with one text is accepted', !F.check(P, file).some(c => /HTEXT takes/.test(c.message)));
ok('I/O and ROW+ (names with symbols) are recognised', /Input or output/.test(hoverText('I/O  >00,SOUND', 'I/O')) && /Move down/.test(hoverText('ROW+ >02', 'ROW+')));

// ---- building with xga99 ----
{
  const os = require('os');
  const B = require('../lib/build');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'retroasm-gpl-'));
  const touch = (f) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ''); fs.chmodSync(f, 0o755); return f; };
  const home = path.join(tmp, 'home'), work = path.join(tmp, 'work'), bin = path.join(tmp, 'bin');
  [home, work, bin].forEach(d => fs.mkdirSync(d));
  const settings = { home, env: { PATH: bin }, standardDirs: [], toolsFolder: path.join(home, 'tools') };
  const src = path.join(work, 'demo.gpl');
  fs.writeFileSync(src, '        END\n');
  const none = B.plan(src, settings, 'linux', D);
  ok('GPL with no xga99: says so, and offers the setup', /xga99/.test(none.error || '') && none.setup === true, none);
  const tool = touch(path.join(settings.toolsFolder, 'xdt99-3.6.5', 'xga99.py'));
  const noPy = B.plan(src, settings, 'linux', D);
  ok('GPL with xga99 but no Python: says Python is missing', /Python/.test(noPy.error || ''), noPy);
  const py = touch(path.join(bin, 'python3'));
  const pl = B.plan(src, settings, 'linux', D);
  ok('xga99 is run with Python on the source file', pl.command === `"${py}" "${tool}" "demo.gpl" --color off` && pl.cwd === work, pl);
  ok('your own build command still wins for GPL', B.plan(src, Object.assign({}, settings, { command: 'echo hi' }), 'linux', D).command === 'echo hi');
  ok('GPL has no emulator step', !B.findRunner(src, settings, 'linux', D));
  // exactly what xga99 3.6.5 printed for a made-up file with one mistake
  const out = ': xga99, version 3.6.5\n> demo.gpl <0> 0032 - BEEP    I/O  >00,G@SOUND\n***** Error: Invalid GROM address outside MOVE\n1 Error found.\n';
  const probs = B.parseOutput(out, work);
  ok('an xga99 error is tied to its line', probs.length === 1 && probs[0].line === 31 && probs[0].severity === 'error' && /Invalid GROM address/.test(probs[0].message) && path.basename(probs[0].file) === 'demo.gpl', probs);
  // with a real xga99 (set XGA99 to the path of xga99.py): the made-up program builds, and a bad line is reported
  if (process.env.XGA99) {
    const cp = require('child_process');
    const run = (file) => cp.spawnSync(process.env.PYTHON || 'python3', [process.env.XGA99, path.basename(file), '--color', 'off'], { cwd: path.dirname(file), encoding: 'utf8' });
    const good = path.join(work, 'gpl-demo.gpl');
    fs.copyFileSync(file, good);
    const r = run(good);
    ok('REAL xga99 builds the made-up program with no errors', r.status === 0 && fs.existsSync(path.join(work, 'gpl-demo.gbc')), (r.stdout + r.stderr).slice(0, 300));
    const bad = path.join(work, 'bad.gpl');
    fs.writeFileSync(bad, '        GROM 6\n        AORG >0000\n        MOVE >0002,@>8300,V@>0400\n        I/O  >00,G@>6000\n');
    const rb = run(bad);
    const found = B.parseOutput(rb.stdout + rb.stderr, work);
    ok('REAL xga99 error is read, on the right line', rb.status !== 0 && found.length === 1 && found[0].line === 3, found);
  } else console.log('skip real xga99 (set XGA99 to the path of xga99.py to include it)');
}

console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exit(failed ? 1 : 0);
