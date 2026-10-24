// Tests for BBC BASIC listings: only the [ ] parts are read, as BBC assembly.
// Run: node test/basic-test.js (ext-test.js runs it too). All the sample code here is made up.
const path = require('path'), fs = require('fs'), os = require('os'), Module = require('module');
const { loadFile } = require('../lib/dialect'); const { Project } = require('../lib/project'); const F = require('../lib/features');
const BA = require('../lib/basicasm');
let fails = 0; const ok = (name, cond, extra) => { if (!cond) { fails++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } else console.log('ok  ', name); };
const demo = fs.readFileSync(path.join(__dirname, 'fixtures/basicdemo.bas'), 'utf8');

// ---- cutting out the assembly ----
{
  const m = BA.mask(demo), a = demo.split('\n'), b = m.text.split('\n');
  ok('the cut-down text has the same lines and widths', a.length === b.length && a.every((l, i) => l.length === b[i].length));
  ok('assembly is found', m.any === true);
  ok('a plain number given a name in BASIC is kept for the assembly', b[3].includes('oswrch = &FFEE') && b[3].includes('osbyte = &FFF4') && !/LET/.test(b[3]), b[3]);
  ok('other BASIC assignments are not kept', b[5].trim() === '' && !/%/.test(b.join('')), [b[5]]);
  ok('BASIC lines are blanked', b[1].trim() === '' && b[2].trim() === '' && b[4].trim() === '' && b[17].trim() === '' && b[18].trim() === '', b);
  ok('line numbers and [ ] are blanked', b[6].trim() === '' && b[16].trim() === '', [b[6], b[16]]);
  ok('the OPT setting is blanked', !/OPT/i.test(b[6]));
  ok('instructions stay where they were', b[8].indexOf('LDA #65') === a[8].indexOf('LDA #65') && b[8].includes('JSR oswrch'), b[8]);
  ok('labels and comments stay', b[7].trim() === '.start' && /\\ print an A/.test(b[8]), [b[7], b[8]]);
  ok('a ] inside a string does not end the block', b[15].includes('EQUS "Hi [there]"') && b[15].includes('EQUB 0'), b[15]);
  ok('a [ in a BASIC string is not assembly', b[18].trim() === '' && b[19].trim() === '');
  ok('DATA lines are not assembly', b[20].trim() === '');
  ok('REM lines are not assembly', b[0].trim() === '');
  const one = BA.mask('10 P%=&2000:[OPT 2:LDA #1:STA &70:]:NEXT\n').text;
  ok('a block opened and closed on one line', one.includes('LDA #1:STA &70:') && !/NEXT|OPT|P%/.test(one), one);
  ok('text with no [ ] has no assembly', BA.mask('10 PRINT "HI"\n20 END\n').any === false);
  ok('a Windows line ending is kept', BA.mask('10 [\r\n20 NOP\r\n30 ]\r\n').text.split('\n')[1] === '   NOP\r');
  const unnumbered = BA.mask('[\n  LDA #1\n]\n').text;
  ok('a listing without line numbers works too', unnumbered.split('\n')[1] === '  LDA #1');
}

// ---- tooltips on the cut-down text ----
{
  const P = new Project();
  P.set('/x/t.bas', BA.mask(demo).text, loadFile(path.join(__dirname, '../dialects/bbc.json')));
  P.get('/x/t.bas').noAddresses = true;
  const rows = demo.split('\n'); const rowOf = (n) => rows.findIndex(r => r.trim().startsWith(n + ' '));
  const at = (n, needle) => { const ln = rowOf(n) + 1, raw = rows[ln - 1]; const h = F.hoverAt(P, '/x/t.bas', ln - 1, raw.indexOf(needle) + 1); return h ? JSON.stringify(h.parts) : ''; };
  ok('an instruction is explained', /Jump to subroutine/.test(at(90, 'JSR')), at(90, 'JSR'));
  ok('the OS call number is explained', /OSWRCH/.test(at(90, '#65')) && /'A'/.test(at(90, '#65')), at(90, '#65'));
  ok('an OSBYTE number is explained', /vertical sync|screen refresh/i.test(at(100, '#19')), at(100, '#19'));
  ok('a label shows what it is, but no address', /place in the code/.test(at(120, '.loop') || at(120, 'loop')) && !/Address:/.test(at(130, 'msg')), [at(120, 'loop'), at(130, 'msg')]);
  ok('an instruction shows its size but no address', /Size:/.test(at(130, 'LDA')) && !/Address:/.test(at(130, 'LDA')), at(130, 'LDA'));
  ok('tokens for colouring are produced only for the assembly', F.semanticTokens(P, '/x/t.bas').every(t => t.line >= rowOf(40) && t.line <= rowOf(160)), F.semanticTokens(P, '/x/t.bas').map(t => t.line + 1));
}

// ---- through the VS Code pieces (the stand-in for VS Code) ----
(async () => {
  const mock = require('./mock-vscode'); const orig = Module._load;
  Module._load = function (req, ...r) { return req === 'vscode' ? mock : orig.call(this, req, ...r); };
  const ext = require('../extension.js'); const { providers: P, makeDoc } = mock.__;
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'retroasm-bas-'));
  mock.workspace.workspaceFolders = [{ uri: mock.Uri.file(ws) }];
  const file = path.join(ws, 'demo.bas');
  fs.writeFileSync(file, demo);
  const doc = makeDoc(file, 'bbcbasic');
  const state = new Map(); const ctx = { extensionPath: path.join(__dirname, '..'), subscriptions: [], workspaceState: { get: (k) => state.get(k), update: async (k, v) => { state.set(k, v); } } };
  ext.activate(ctx);
  await new Promise(r => setTimeout(r, 400));
  const row = demo.split('\n').findIndex(r => r.trim().startsWith('90 ')), line = demo.split('\n')[row];
  const h = await P.Hover.provideHover(doc, new mock.Position(row, line.indexOf('JSR') + 1));
  ok('a tooltip appears inside [ ] of a .bas file', h && /Jump to subroutine/.test(JSON.stringify(h.contents)), h && h.contents);
  const h2 = await P.Hover.provideHover(doc, new mock.Position(1, 10));
  ok('no tooltip on a plain BASIC line', !h2, h2 && h2.contents);
  const diag = (mock.__.collections.find(c => c.name === 'retroasm').get(doc.uri) || []);
  ok('no warnings are made for a .bas file', diag.length === 0, diag.map(d => d.message));
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
