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
// the other chips are not touched
ok('TI: ":" after a label is still only a label mark',!chip('tms9900').syntax.colonStatements&&!chip('tms9900').syntax.numberLabels);
ok('C64: ":" is not a statement separator',!chip('6502').syntax.colonStatements);
console.log(fails?`\n${fails} FAILED`:'\nall passed');process.exit(fails?1:0);
