// Tests for the BBC Micro extras: plain-English tooltips for OS calls and hardware numbers,
// and the BBC-only warnings. All the sample code here is made up.
// Run: node test/os-test.js (ext-test.js runs it too).
const path = require('path'), fs = require('fs');
const { loadFile } = require('../lib/dialect'); const { Project } = require('../lib/project'); const F = require('../lib/features');
let fails = 0; const ok = (name, cond, extra) => { if (!cond) { fails++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } else console.log('ok  ', name); };
const chip = (id) => loadFile(path.join(__dirname, '../dialects', id + '.json'));
const run = (id, text) => { const P = new Project(); P.set('/x/t', text, chip(id)); return P; };
const hoverText = (P, text, needle, nth) => {
  const lines = text.split('\n'); let seen = 0;
  for (let ln = 0; ln < lines.length; ln++) { const i = lines[ln].indexOf(needle); if (i >= 0 && seen++ === (nth || 0)) {
    const h = F.hoverAt(P, '/x/t', ln, i + Math.floor(needle.length / 2)); return h ? JSON.stringify(h) : ''; } }
  return '';
};
const checks = (P) => F.check(P, '/x/t');

// ---- tooltips ----
{
  const t = [
    'oswrch = &FFEE', 'osbyte = &FFF4', 'ORG &1900', '.go',
    '    LDA #19:JSR osbyte',            // 4
    '    LDA #22:JSR oswrch',            // 5
    '    LDA #1:JSR oswrch',             // 6
    '    LDA #65:JSR oswrch',            // 7
    '    LDA #&D8:STA &FE20',            // 8
    '    LDA #13:STA &FE00',             // 9
    '    LDA #&7F:STA &FE4E',            // 10
    '    LDA #&C0:STA &FE21',            // 11
    '    RTS', ''].join('\n');
  const P = run('bbc', t);
  ok('OSBYTE 19 is explained as waiting for the screen refresh', /vertical sync|screen refresh/i.test(hoverText(P, t, '#19')), hoverText(P, t, '#19'));
  ok('the OSBYTE call itself is named', /OSBYTE/.test(hoverText(P, t, 'osbyte', 1)));
  ok('VDU 22 is explained as a MODE change', /MODE/.test(hoverText(P, t, '#22')));
  ok('the number after VDU 22 is the MODE', /MODE 1/.test(hoverText(P, t, '#1:')), hoverText(P, t, '#1:'));
  ok('OSWRCH of 65 prints A', /'A'/.test(hoverText(P, t, '#65')));
  ok('a store to the video ULA is decoded', /Video ULA/.test(hoverText(P, t, '&FE20')));
  ok('a store to the 6845 register number is decoded', /6845|register/i.test(hoverText(P, t, '&FE00')));
  ok('a store to the interrupt enable register is decoded', /interrupt/i.test(hoverText(P, t, '&FE4E')));
  ok('a store to the palette is decoded', /colour|palette/i.test(hoverText(P, t, '&FE21')));
}
// other chips get nothing extra
{
  const t = '       LI   R0,>10\n       MOV  R0,R1\n';
  ok('TI-99 hovers are unchanged', !/OSBYTE|VDU/.test(hoverText(run('tms9900', t), t, '>10')));
  const c = 'oswrch = $FFD2\n lda #22\n jsr oswrch\n';
  ok('C64 hovers have no BBC text', !/VDU|OSBYTE/.test(hoverText(run('6502', c), c, '#22')));
}

// ---- warnings ----
{
  const text = fs.readFileSync(path.join(__dirname, 'fixtures/bbcchecks.6502'), 'utf8');
  const P = run('bbc', text);
  const cs = checks(P);
  const at = (ln, re) => cs.some(c => c.line === ln - 1 && re.test(c.message));
  ok('a 65C02 instruction before CPU 1 is warned about', at(10, /65C02/), cs.map(c => c.line + 1));
  ok('the same instruction after CPU 1 is fine', !cs.some(c => c.line === 11), cs.map(c => c.line + 1));
  ok('STZ after CPU 1 is fine', !cs.some(c => c.line === 12));
  ok('code running past GUARD is warned about once', cs.filter(c => /GUARD/.test(c.message)).length === 1 && at(22, /GUARD/));
  ok('a write to OS zero page is mentioned', at(17, /belongs to the operating system/));
  ok('a write to &70 is not', !at(18, /operating system/));
  ok('code in screen memory for the MODE is mentioned', at(24, /MODE 1/));
  // ordinary indirect addressing is not a 65C02 thing
  const t5 = 'ORG &1900\n.a\n  LDA (&70),Y\n  LDA (&70,X)\n  JMP (&0200)\n  INC &70\n  BIT &70\n  LDA &70\n';
  ok('plain 6502 indirect forms are not flagged as 65C02', !checks(run('bbc', t5)).some(c => /65C02/.test(c.message)), checks(run('bbc', t5)).map(c => c.message));
  const t6 = 'ORG &1900\n.a\n  LDA (&70)\n  JMP (&0200,X)\n  BIT #1\n  INC A\n';
  ok('the 65C02-only forms are flagged', checks(run('bbc', t6)).filter(c => /65C02/.test(c.message)).length === 4, checks(run('bbc', t6)).map(c => c.line));
  // CLEAR removes the guard
  const t2 = 'ORG &1900\nGUARD &1902\nCLEAR &1900, &2000\n.a\n  NOP\n  NOP\n  NOP\n';
  ok('CLEAR removes a GUARD', !checks(run('bbc', t2)).some(c => /GUARD/.test(c.message)));
  // no OS calls: no zero page note
  const t3 = 'ORG &1900\n.a\n  LDA #1\n  STA &A0\n';
  ok('zero page note only when the program calls the OS', !checks(run('bbc', t3)).some(c => /operating system/.test(c.message)));
  // other chips are untouched
  const t4 = 'ORG $0800\n  bra l1\nl1 nop\n';
  ok('the 6502 (C64) chip does not get BBC warnings', !checks(run('6502', t4)).some(c => /65C02|GUARD/.test(c.message)));
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
