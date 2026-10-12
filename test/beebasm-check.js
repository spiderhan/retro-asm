// Compare our addresses with real BeebAsm: node test/beebasm-check.js file.6502 [path to beebasm]
// Runs "beebasm -v" (or reads a saved listing given as a .txt file) and checks every label's address.
const path = require('path'), fs = require('fs'), cp = require('child_process'), os = require('os');
const { loadFile } = require('../lib/dialect'); const { Project } = require('../lib/project'); const { statements } = require('../lib/parser');
const src = path.resolve(process.argv[2]);
const D = loadFile(path.join(__dirname, '../dialects/bbc.json'));
const P = new Project();
P.fileSize = (p) => { try { return fs.statSync(p).size; } catch (e) { return null; } };
const dir = path.dirname(src);
for (const f of fs.readdirSync(dir).filter(f => /\.(6502|asm|s)$/i.test(f))) P.set(path.join(dir, f), fs.readFileSync(path.join(dir, f), 'utf8'), D);
// files pulled in from other folders (BeebAsm reads INCLUDE names from the folder it runs in)
for (let pass = 0; pass < 3; pass++) for (const m of [...P.models.values()]) for (const inc of m.includes) {
  const t = P.resolveInclude(m.file, inc.name);
  if (!inc.binary && !P.get(t) && fs.existsSync(t)) P.set(t, fs.readFileSync(t, 'utf8'), D);
}
let listing;
const tool = process.argv[3] || process.env.BEEBASM || 'beebasm';
if (tool.endsWith('.txt')) listing = fs.readFileSync(tool, 'utf8');
else {
  const tmp = path.join(os.tmpdir(), 'retroasm-check.ssd');
  const r = cp.spawnSync(tool, ['-i', path.basename(src), '-do', tmp, '-v'], { cwd: dir, encoding: 'utf8' });
  if (r.error || r.status !== 0) { console.log('beebasm failed:', r.error ? r.error.message : r.stdout + r.stderr); process.exit(2); }
  listing = r.stdout;
}
// theirs: ".name" then the next line that starts with an address
const theirs = [];
const lines = listing.split(/\r?\n/);
for (let i = 0; i < lines.length; i++) {
  const m = /^\.(\S+)\s*$/.exec(lines[i]);
  if (!m) continue;
  for (let k = i + 1; k < lines.length; k++) {
    const a = /^\s+([0-9A-F]{4})(\s|$)/.exec(lines[k]);
    if (a) { theirs.push({ name: m[1], addr: parseInt(a[1], 16) }); break; }
    if (/^\.\S+\s*$/.test(lines[k])) break;
  }
}
// ours: every label in the order it is assembled (following INCLUDE lines), outside macros
const ours = [];
const L = P.layout(src);
(function walk(file, depth) {
  const m = P.get(file);
  let inMacro = false;
  m.lines.forEach((pl, ln) => {
    for (const st of statements(pl)) {
      const dr = st.mnem ? D.directive(st.mnem.upper) : null;
      if (dr && dr.kind === 'macro') inMacro = true;
      if (dr && dr.kind === 'endmacro') { inMacro = false; continue; }
      if (inMacro) continue;
      if (st.label && !(dr && dr.kind === 'equ')) {
        const s = L.symbols.get(st.label.upper);
        ours.push({ name: st.label.name, addr: s ? s.off : null, file, line: ln });
      }
      if (dr && dr.kind === 'include' && !dr.binary && depth < 8) walk(P.resolveInclude(file, st.operands[0].text.replace(/"/g, '')), depth + 1);
    }
  });
})(src, 0);
let bad = 0, checked = 0;
const byName = theirs.slice();
for (const o of ours) {
  const k = byName.findIndex(t => t.name.toUpperCase() === o.name.toUpperCase());
  if (k < 0) continue;                       // a label BeebAsm didn't list (zero page with SKIP shows no bytes)
  const t = byName.splice(k, 1)[0];
  checked++;
  if (t.addr !== o.addr) { bad++; if (bad <= 10) console.log('MISMATCH', o.name, 'line', o.line + 1, 'beebasm', t.addr.toString(16), 'ours', o.addr === null ? 'none' : o.addr.toString(16)); }
}
console.log(path.basename(src), 'labels checked:', checked, 'mismatches:', bad, 'rough:', L.approx);
process.exit(bad || !checked ? 1 : 0);
