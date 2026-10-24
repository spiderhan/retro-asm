// Tests for two things: the "only one space before a comment" warning (and its quick fix),
// and the "14 cycles" notes beside instruction lines.
// Run: node test/spacing-test.js (ext-test.js runs it too). All the sample code here is made up.
const path = require('path'), fs = require('fs'), os = require('os'), Module = require('module');
const { loadFile } = require('../lib/dialect'); const { Project } = require('../lib/project'); const F = require('../lib/features');
let fails = 0; const ok = (name, cond, extra) => { if (!cond) { fails++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } else console.log('ok  ', name); };
const chip = (id) => loadFile(path.join(__dirname, '../dialects', id + '.json'));
const run = (id, text) => { const P = new Project(); P.set('/x/t', text, chip(id)); return P; };
const oneSpace = (P) => F.check(P, '/x/t').filter(c => c.fix === 'oneSpaceComment');

// ---- the warning (TI-99/4A) ----
{
  const text = [
    '       DEF  START',
    'START  LWPI >8300',
    '       LI   R0,>10 * star after one space',     // line 3  warn
    '       LI   R1,>10  * two spaces',               // 3  fine
    '       LI   R2,5\t* a tab',                       // 4  fine
    '       LI   R3,5 ; semicolon after one space',   // 5  fine: ; ends the operands
    '       LI   R4,5 note in plain words',           // line 7  warn
    '       MOV  R0,R1 * mov',                        // line 8  warn
    '       RT   * no operands, one space',           // 8  fine: nothing to swallow it
    '       BYTE >01 text',                           // line 10 warn (a directive)
    '       LI   R5,>10 + 2',                         // 10 fine: carries on the sum
    '* a whole-line comment',                         // 11 fine
    '       LI   R6,5',                               // 12 fine: no comment
    '       END'
  ].join('\n');
  const P = run('tms9900', text);
  const hits = oneSpace(P);
  const lines = hits.map(h => h.line + 1);
  ok('warns on one space before a * comment, plain words, and after a directive', JSON.stringify(lines) === JSON.stringify([3, 7, 8, 10]), lines);
  const h = hits[0], raw = text.split('\n')[2];
  ok('the underline starts on the single space and covers the first word', raw[h.start] === ' ' && raw.slice(h.start, h.end) === ' *', raw.slice(h.start, h.end));
  ok('the message says what to do', /two or more spaces, or a Tab/.test(h.message), h.message);
  // applying the fix (one more space at the start of the range) clears the warning
  const fixed = text.split('\n').map((l, i) => { const m = hits.find(x => x.line === i); return m ? l.slice(0, m.start) + ' ' + l.slice(m.start) : l; }).join('\n');
  ok('adding the space clears every warning', oneSpace(run('tms9900', fixed)).length === 0, oneSpace(run('tms9900', fixed)).map(x => x.line + 1));
}
// other chips don't get this warning (their assemblers read comments differently)
{
  const z = run('z80', '       org $8000\n       ld a,5 ; ok\n       ld b,6 note\n');
  ok('the Z80 chip is not told about it', oneSpace(z).length === 0);
  const m = run('6502', '       lda #5 ; ok\n       ldx #6 note\n');
  ok('the 6502 chip is not told about it', oneSpace(m).length === 0);
}

// ---- cycle counts beside the code ----
{
  const t = run('tms9900', '       DEF  START\nSTART  LWPI >8300\n       LI   R0,>10\n       MOV  R0,R1\n       NOP\n       RT\n       END\n');
  const hints = F.cycleHints(t, '/x/t', 0, 99);
  const by = Object.fromEntries(hints.map(h => [h.line, h]));
  ok('TI: an instruction line gets a note ending in "cycles"', by[2] && /^\d+\+? cycles$/.test(by[2].label), by[2]);
  ok('TI: a note is only added to instruction lines', !by[0] && !by[6], hints.map(h => h.line));
  ok('TI: the note has the full explanation as its tooltip', by[2] && /cycle/.test(by[2].tooltip) && by[2].tooltip.length > by[2].label.length, by[2]);
  ok('TI: slow memory is flagged with a plus', by[3] && /\+ cycles$/.test(by[3].label), by[3]);
  ok('TI: only asked-for lines are looked at', F.cycleHints(t, '/x/t', 3, 3).length === 1 && F.cycleHints(t, '/x/t', 3, 3)[0].line === 3);
}
{
  const c = run('6502', '        lda #5\n        lda $D020,X\nl1:     bne l1\n        sta $02\n');
  const by = Object.fromEntries(F.cycleHints(c, '/x/t', 0, 99).map(h => [h.line, h.label]));
  ok('6502: a plain instruction shows its number', by[0] === '2 cycles', by);
  ok('6502: a page-crossing instruction shows a plus', by[1] === '4+ cycles', by);
  ok('6502: a branch shows both times', by[2] === '2/3 cycles', by);
}
{
  const z = run('z80', '       org $8000\n       ld a,5\n       ldir\n       jr nz,$\n');
  const by = Object.fromEntries(F.cycleHints(z, '/x/t', 0, 99).map(h => [h.line, h.label]));
  ok('Z80: a plain instruction shows its number', by[1] === '7 cycles', by);
  ok('Z80: a repeat shows both times', /^\d+\/\d+ cycles$/.test(by[2] || ''), by);
}

// ---- through the VS Code pieces (the stand-in for VS Code) ----
(async () => {
  const mock = require('./mock-vscode'); const orig = Module._load;
  Module._load = function (req, ...r) { return req === 'vscode' ? mock : orig.call(this, req, ...r); };
  const ext = require('../extension.js'); const { providers: P, commands: C, makeDoc, settings } = mock.__;
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'retroasm-sp-'));
  mock.workspace.workspaceFolders = [{ uri: mock.Uri.file(ws) }];
  const file = path.join(ws, 'one.a99');
  fs.writeFileSync(file, '       DEF  START\nSTART  LWPI >8300\n       LI   R0,>10 * note\n       JMP  START\n       END\n');
  const doc = makeDoc(file, 'retroasm');
  const state = new Map(); const ctx = { extensionPath: path.join(__dirname, '..'), subscriptions: [], workspaceState: { get: (k) => state.get(k), update: async (k, v) => { state.set(k, v); } } };
  ext.activate(ctx);
  await new Promise(r => setTimeout(r, 500));
  const diag = mock.__.collections.find(c => c.name === 'retroasm').get(doc.uri).filter(d => d.code === 'oneSpaceComment');
  ok('the warning reaches VS Code with its fix name', diag.length === 1 && diag[0].range.start.line === 2, diag.map(d => d.message));
  const acts = P.CodeActions.provideCodeActions(doc, diag[0].range, { diagnostics: diag });
  ok('a quick fix is offered', acts.length === 1 && /two spaces/.test(acts[0].title) && acts[0].kind === 'quickfix', acts);
  const e = acts[0].edit.edits[0];
  ok('the quick fix adds one space at the underline', e && e.text === ' ' && e.range.start.line === 2 && e.range.start.character === diag[0].range.start.character, e);
  ok('other warnings get no such fix', P.CodeActions.provideCodeActions(doc, diag[0].range, { diagnostics: [{ source: 'Retro ASM', code: undefined, range: diag[0].range }] }).length === 0);

  const range = new mock.Range(0, 0, 4, 0);
  ok('cycle notes are off until asked for', P.InlayHints.provideInlayHints(doc, range).length === 0);
  await C['retroAsm.toggleCycles']();
  const hints = P.InlayHints.provideInlayHints(doc, range);
  ok('after the toggle, instruction lines get a note at the end of the line', hints.length >= 3 && hints.every(h => h.position.character === doc.lineAt(h.position.line).text.length), hints.map(h => [h.position.line, h.label]));
  ok('the notes have a tooltip and sit a little apart', hints[0].tooltip && hints[0].paddingLeft === true, hints[0]);
  await C['retroAsm.toggleCycles']();
  ok('a second toggle hides them again', P.InlayHints.provideInlayHints(doc, range).length === 0);
  settings.showCycles = true; mock.__.events.config.forEach(l => l({ affectsConfiguration: (k) => k === 'retroAsm' || k === 'retroAsm.showCycles' }));
  ok('the setting switches them on', P.InlayHints.provideInlayHints(doc, range).length >= 3);
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
