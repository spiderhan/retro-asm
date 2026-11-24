// Tests for sjasmplus's way of writing (Z80 and Spectrum Next): several statements on one line,
// numbered labels (1: with JR 1F and JR 1B) and SLDOPT lines. Run: node test/sjasm-test.js
// (ext-test.js runs it too). All the sample code here is made up.
const path=require('path');
const {loadFolder}=require('../lib/dialect');const {Project}=require('../lib/project');const F=require('../lib/features');
const CF=require('../lib/caseformat');const P=require('../lib/parser');
let fails=0;const ok=(name,cond,extra)=>{if(!cond){fails++;console.log('FAIL',name,extra===undefined?'':JSON.stringify(extra));}else console.log('ok  ',name);};
const chips=loadFolder(path.join(__dirname,'../dialects')).dialects;
const chip=(id)=>chips.find(d=>d.id===id);
const lines=(...l)=>l.join('\n');
const open=(id,text)=>{const p=new Project();const f=path.join(__dirname,'made-up.z80');p.set(f,text,chip(id));return {p,f,m:p.get(f),checks:F.check(p,f)};};
const parts=(id,line)=>P.statements(P.parseLine(line,chip(id),{})).map(s=>[s.label?s.label.name:'',s.mnem?s.mnem.text:'',s.operands.map(o=>o.text).join(',')].join('|'));
const col=(m,ln,word,nth)=>{let c=-1;for(let k=0;k<=(nth||0);k++)c=m.rawLines[ln].indexOf(word,c+1);return c;};

const SRC=lines(
 '        ORG $8000',                                  // 0
 '        SLDOPT COMMENT WPMEM, LOGPOINT, ASSERTION',  // 1
 'scan:   ld a, (flags)',                              // 2
 '        bit 0, a : jr nz, 1F : set 0, e',            // 3
 '1:      bit 1, a : jr nz, 1F : set 1, e',            // 4
 '1:',                                                 // 5
 '        ld b, 8',                                    // 6
 '2       djnz 2B',                                    // 7
 '.wait:  dec a : jr nz, .wait',                       // 8
 '        ex af, af\' : ld a, 1B',                     // 9
 '        ret',                                        // 10
 'flags:  db "a:b", \':\', 0');                        // 11

for(const id of ['z80','z80n']){
 // ---- several statements on one line ----
 ok(`${id}: "a : b : c" is three statements`,parts(id,'        bit 0, a : jr nz, 1F : set 0, e').join(' / ')==='|bit|0,a / |jr|nz,1F / |set|0,e',parts(id,'        bit 0, a : jr nz, 1F : set 0, e'));
 ok(`${id}: no spaces round the ":" works too`,parts(id,'        xor a:ld b,a:ret').join(' / ')==='|xor|a / |ld|b,a / |ret|');
 ok(`${id}: a label's own ":" does not split the line`,parts(id,'loop:   ld a, 1 : inc a').join(' / ')==='loop|ld|a,1 / |inc|a');
 ok(`${id}: an indented label with ":" still works`,parts(id,'   loop: ld a, 1 : inc a').join(' / ')==='loop|ld|a,1 / |inc|a');
 ok(`${id}: a label alone on a line`,parts(id,'loop:').join()==='loop||'&&parts(id,'  loop:').join()==='loop||');
 ok(`${id}: a label with no ":" in front of several statements`,parts(id,'loop    ld a, 1 : inc a').join(' / ')==='loop|ld|a,1 / |inc|a');
 ok(`${id}: "end:" in the first column is a label, as sjasmplus reads it`,parts(id,'end:    ret : nop').join(' / ')==='end|ret| / |nop|');
 ok(`${id}: indented, "di:halt" is two instructions`,parts(id,'        di:halt').join(' / ')==='|di| / |halt|');
 ok(`${id}: ":" inside quotes or brackets is left alone`,parts(id,'msg:    db "a:b", \':\', 0').join()==='msg|db|"a:b",\':\',0');
 ok(`${id}: AF' is still a register, not the start of quoted text`,parts(id,"        ex af, af' : ld a, 1").join(' / ')==="|ex|af,af' / |ld|a,1");
 ok(`${id}: a ":" in a comment is left alone`,parts(id,'        ld a, 1 ; note: this').join()==='|ld|a,1');

 const {p,f,m,checks}=open(id,SRC);
 ok(`${id}: the sample gives no warnings`,checks.length===0,checks.map(c=>`${c.line+1}: ${c.message}`));
 // ---- each statement has its own address ----
 {const a=(ln,part)=>{const i=p.lineInfo(f,ln,part);return i&&[i.addr,i.size].join();};
  ok(`${id}: each statement on a line has its own address and size`,a(3,0)==[0x8003,2].join()&&a(3,1)==[0x8005,2].join()&&a(3,2)==[0x8007,2].join(),[a(3,0),a(3,1),a(3,2)]);}
 // ---- numbered labels ----
 const sym=(ln,word,nth)=>F.symbolAt(p,f,ln,col(m,ln,word,nth));
 const target=(ln,word)=>{const s=sym(ln,word);return s?p.findDefs(f,s.name).map(d=>d.line):null;};
 ok(`${id}: 1F goes to the next 1`,String(target(3,'1F'))==='4'&&String(target(4,'1F'))==='5',[target(3,'1F'),target(4,'1F')]);
 ok(`${id}: 2B goes to the last 2, even on its own line`,String(target(7,'2B'))==='7',target(7,'2B'));
 ok(`${id}: from the label, the lines that jump to it are found`,p.findRefs(f,sym(4,'1:').name).map(r=>r.line).join()==='3'&&p.findRefs(f,sym(5,'1:').name).map(r=>r.line).join()==='4');
 ok(`${id}: 1B outside a jump is still a binary number`,sym(9,'1B')===null&&p.eval(f,'1B')===1);
 ok(`${id}: a numbered label does not start a new home for .names`,String(target(8,'.wait',1))==='8',target(8,'.wait',1));
 {const h=F.hoverAt(p,f,3,col(m,3,'1F'));ok(`${id}: the tooltip on 1F says which line it means`,!!h&&/next label `1` after this line: line 5/.test(h.parts.join(' ')),h&&h.parts);}
 {const h=F.hoverAt(p,f,4,0);ok(`${id}: the tooltip on 1: explains numbered labels`,!!h&&/numbered label/.test(h.parts.join(' ')),h&&h.parts);}
 {const o=F.buildOutline(p,f);ok(`${id}: numbered labels sit inside the routine, not in the list of routines`,o.map(n=>n.name).join()==='scan,flags'&&o[0].children.map(c=>c.name).join()==='1,1,2,.wait',o.map(n=>[n.name,n.children.map(c=>c.name)]));}
 {const bad=open(id,lines('go:     jr 9F','        jr 9B','        ret')).checks;ok(`${id}: a jump to a numbered label that isn't there is reported`,bad.length===2&&/No label called 9F/.test(bad[0].message),bad.map(c=>c.message));}
 {const far=open(id,lines('        ORG $8000','1:      nop','        jr 1B','        ds 200','        jr 1B','        ret')).checks;ok(`${id}: a short jump to a numbered label that is too far away is reported (and a near one is not)`,far.length===1&&far[0].line===4&&/1B is too far away for JR/.test(far[0].message),far.map(c=>`${c.line+1}: ${c.message}`));}
 // ---- SLDOPT ----
 {const d=chip(id).directive('SLDOPT');ok(`${id}: SLDOPT is known and its words are not taken for labels`,!!d&&d.symbolOperands===false);}
 // ---- letter case ----
 {const r=CF.formatText(SRC,chip(id)).text.split('\n');
  ok(`${id}: letter case changes every statement on a line`,r[3]==='        BIT 0, A : JR nz, 1F : SET 0, E'&&r[4]==='1:      BIT 1, A : JR nz, 1F : SET 1, E'&&r[8]==='.wait:  DEC A : JR nz, .wait',[r[3],r[4],r[8]]);
  ok(`${id}: a second go changes nothing more`,CF.formatText(r.join('\n'),chip(id)).edits.length===0);}
}
// ---- the rest of the sjasmplus directives ----
for(const id of ['z80','z80n']){
 const ALL=lines(
  '        ORG $8000',
  '        DEFINE SPEED 3',
  '        DEFINE DEBUG',
  '        DEFINE+ SPEED 4',
  '        UNDEFINE DEBUG',
  '        DEFARRAY colours 1,2,3',
  '        DEFARRAY+ colours 4',
  '        IFN SPEED',
  '        nop',
  '        ELSEIF SPEED > 2',
  '        nop',
  '        ENDIF',
  'start:  IFUSED',
  '        nop',
  '        ENDIF',
  '        IFNUSED start',
  '        ENDIF',
  'count = 3',
  '        WHILE count > 0',
  'count = count - 1',
  '        ENDW',
  '        D24 $123456',
  '        DG ..##..## XX..XX..',
  '        DH "0123ABCD"',
  '        HEX "01"',
  '        DP "Ahoy!"',
  '        ABYTE 1 "abc"',
  '        ABYTEC 0 "abc"',
  '        ABYTEZ 0 "abc"',
  '        ENCODING "DOS"',
  '        EXPORT start',
  '        TAPOUT "made-up.tap"',
  '        TAPEND',
  '        OUTPUT "made-up.bin"',
  '        FPOS 0',
  '        SIZE 10',
  '        OUTEND',
  '        HEXOUT "made-up.hex"',
  '        HEXEND',
  '        SAVEHEX "made-up.hex",$8000,10',
  '        SAVEDEV "made-up.bin",0,0,10',
  '        SAVEHOB "made-up.$c","made.c",$8000,10',
  '        SAVETRD "made-up.trd","made.c",$8000,10',
  '        EMPTYTRD "made-up.trd"',
  '        SAVE3DOS "made-up",$8000,10',
  '        SAVEAMSDOS "made-up",$8000,10',
  '        SAVECDT EMPTY "made-up.cdt"',
  '        SAVECPCSNA "made-up.sna"',
  '        SAVECPR "made-up.cpr"',
  '        SETBP $8000',
  '        SETBREAKPOINT',
  '        BPLIST "made-up.txt" zesarux',
  '        SHELLEXEC "echo"',
  '        RELOCATE_START',
  '        RELOCATE_END',
  '        RELOCATE_TABLE',
  '        MODULE tools',
  '        ENDMOD',
  '        DEFDEVICE mine,$4000,4',
  '        INCLUDELUA "made-up.lua"',
  '        MMU 0,1',
  '        CSPECTMAP "made-up.map"',
  '        ret');
 {const c=open(id,ALL).checks;ok(`${id}: every sjasmplus directive is known, and none gives a warning`,c.length===0,c.map(x=>`${x.line+1}: ${x.message}`));}
 for(const k of ['DISP','PHASE','TEXTAREA','ENT','DEPHASE','UNPHASE','ENDT','INSERT','INCHOB','INCTRD','LUA','ENDLUA'])ok(`${id}: ${k} is known`,!!chip(id).directive(k));
 {const d=chip(id).directive('DISP');ok(`${id}: DISP has a tooltip in plain words`,!!d&&/copied/.test(d.summary));}
 // ---- sizes ----
 {const {p,f}=open(id,lines('        ORG $8000','a1:     D24 $123456','a2:     DG ..##..## XX..XX..','a3:     DH "0123ABCD"','a4:     DP "Ahoy!"','a5:     DH "01 23"','a6:     ret'));
  const at=(ln)=>p.lineInfo(f,ln).addr.toString(16);
  ok(`${id}: D24 is 3 bytes, DG 1 byte for each 8 marks, DH 1 for each 2 digits, DP the text and its length`,[1,2,3,4,5,6].map(at).join()==='8000,8003,8005,8009,800f,8011',[1,2,3,4,5,6].map(at));
  ok(`${id}: those addresses aren't marked as rough`,!p.lineInfo(f,6).approx);}
 // ---- DISP ... ENT ----
 {const {p,f}=open(id,lines('        ORG $8000','        ld hl,moved','        DISP $C000','moved:  ld a,1','        jp moved','        ENT','after:  ret'));
  ok(`${id}: a label inside DISP gets the address the code will run at`,p.labelAddress(f,'moved').addr===0xC000,p.labelAddress(f,'moved'));
  ok(`${id}: after ENT the address carries on from where the bytes really are`,p.labelAddress(f,'after').addr===0x8008,p.labelAddress(f,'after'));
  ok(`${id}: DISP addresses aren't marked as rough`,!p.lineInfo(f,6).approx);}
 {const {p,f}=open(id,lines('        ORG $8000','d1:     DISP $C000','        nop','e1:     ENT','e2:     nop'));
  // checked against sjasmplus: a label on these lines gets the address from before the line
  ok(`${id}: a label on the DISP line gets the real address, one on the ENT line the "runs at" address`,p.labelAddress(f,'d1').addr===0x8000&&p.labelAddress(f,'e1').addr===0xC001&&p.labelAddress(f,'e2').addr===0x8001,['d1','e1','e2'].map(n=>p.labelAddress(f,n)));}
 // ---- a dot in front of a directive, and .3 to repeat ----
 {const {p,f,checks}=open(id,lines('        ORG $8000','        .db 1,2','        .3 inc a','        .(2) nop','        .ds 2','last:   ret'));
  ok(`${id}: ".db" and ".3 inc a" give no warnings`,checks.length===0,checks.map(x=>`${x.line+1}: ${x.message}`));
  ok(`${id}: ".3 inc a" counts 3 bytes and ".(2) nop" 2`,p.labelAddress(f,'last').addr===0x8009,p.labelAddress(f,'last'));
  const h=F.hoverAt(p,f,1,9);ok(`${id}: ".db" has the DB tooltip`,!!h&&/single bytes/.test(h.parts.join(' ')),h&&h.parts);}
 // ---- LUA ... ENDLUA ----
 {const {checks,m}=open(id,lines('        LUA ALLPASS','x = 1','for i = 1, 3 do sj.add_byte(i) end','        ENDLUA','        ret'));
  ok(`${id}: the Lua lines between LUA and ENDLUA aren't checked as assembly`,checks.length===0,checks.map(x=>`${x.line+1}: ${x.message}`));
  ok(`${id}: ENDLUA is read again as a directive`,m.lines[3].mnem&&m.lines[3].mnem.upper==='ENDLUA'&&m.lines[4].mnem.upper==='RET');}
 // ---- square brackets ----
 {const {p,f,checks}=open(id,lines('        ORG $8000','        ld a,[hl]','        ld [ix+2],a','        ld hl,[$5000]','        jp [hl]','last:   db "[x]"'));
  ok(`${id}: [hl] gives no warnings`,checks.length===0,checks.map(x=>`${x.line+1}: ${x.message}`));
  ok(`${id}: [hl] is sized like (hl)`,p.labelAddress(f,'last').addr===0x8008,p.labelAddress(f,'last'));
  ok(`${id}: brackets in quotes are left alone`,p.get(f).lines[5].operands[0].text==='"[x]"');}
}
// ---- IF picks the branch that is really built (checked against sjasmplus 1.24.0) ----
for(const id of ['z80','z80n']){
 const {p,f,checks}=open(id,lines(
  '        ORG $8000','        DEFINE WORDY','lab     equ 5',
  '        IFDEF WORDY','w1:     nop','        ENDIF',
  '        IFDEF lab','w2:     nop','        ENDIF',
  '        IFNDEF nothing','w4:     nop','        ENDIF',
  '        IFN 0','w5:     nop','        ELSEIF 1','w6:     nop','        ENDIF',
  '        IF 0','w7:     nop','        ELSEIF 1','w8:     nop','        ELSE','w9:     nop','        ENDIF',
  'DEBUG   equ 1','        IF DEBUG','        call w1','        ELSE','        ret','        ENDIF',
  'end1:   ret'));
 const at=(n)=>{const a=p.labelAddress(f,n);return a?a.addr.toString(16)+(a.approx?'?':''):'-';};
 ok(`${id}: IFDEF (DEFINE words only), IFNDEF, IFN, ELSEIF and IF ... ELSE give sjasmplus's addresses`,['w1','w4','w5','w8','end1'].map(at).join()==='8000,8001,8002,8003,8007',['w1','w4','w5','w8','end1'].map(at));
 ok(`${id}: lines in a branch that isn't built are left out`,p.lineInfo(f,7).skipped&&p.lineInfo(f,15).skipped&&!p.lineInfo(f,4).skipped);
 ok(`${id}: no warnings`,checks.length===0,checks.map(x=>`${x.line+1}: ${x.message}`));
 const h=F.hoverAt(p,f,12,9);ok(`${id}: the tooltip on IFN 0 says the test is true`,!!h&&/the test is true/.test(h.parts.join(' ')),h&&h.parts);
}
// ---- the Spectrum Next ----
{const {p,f,checks}=open('z80n',lines('        ORG $8000','        mul de','        jp [c]','last:   ret'));
 ok('z80n: "mul de" and "jp [c]" give no warnings',checks.length===0,checks.map(x=>`${x.line+1}: ${x.message}`));
 ok('z80n: "jp [c]" is 2 bytes, like "jp (c)"',p.labelAddress(f,'last').addr===0x8004,p.labelAddress(f,'last'));
 const h=F.hoverAt(p,f,1,9);ok('z80n: "mul de" has a tooltip',!!h&&/Multiply D by E/.test(h.parts.join(' ')),h&&h.parts);}
{const {guessDialect}=require('../lib/dialect');
 ok('z80n: ".device zxspectrumnext" picks the Next',guessDialect('        .device zxspectrumnext\n        nop\n',[chip('z80'),chip('z80n')]).id==='z80n');}
// MMU works on any machine, so plain Z80 doesn't send it to the Next
ok('z80: MMU is plain Z80 too, with the Next\'s own wording kept for the Next',!!chip('z80').directive('MMU')&&/NEXTREG/.test(chip('z80n').directive('MMU').summary)&&!/NEXTREG/.test(chip('z80').directive('MMU').summary));
// the other chips are not touched
ok('TI: ":" after a label is still only a label mark',!chip('tms9900').syntax.colonStatements&&!chip('tms9900').syntax.numberLabels);
ok('C64: ":" is not a statement separator',!chip('6502').syntax.colonStatements);
console.log(fails?`\n${fails} FAILED`:'\nall passed');process.exit(fails?1:0);
