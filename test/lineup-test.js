// Tests for lining the code up in columns and for converting a TI-99/4A file to xas99 style:
// node test/lineup-test.js (ext-test.js runs it too). All the sample code here is made up.
const Module=require('module');const path=require('path');const fs=require('fs');const os=require('os');
const mock=require('./mock-vscode');const orig=Module._load;Module._load=function(req,...r){return req==='vscode'?mock:orig.call(this,req,...r)};
const {loadFile,loadFolder,prepare,guessDialect}=require('../lib/dialect');const {Project}=require('../lib/project');const F=require('../lib/features');
const {parseLine,statements}=require('../lib/parser');
const LU=require('../lib/lineup');const X=require('../lib/xas99');const CF=require('../lib/caseformat');
let fails=0;const ok=(name,cond,extra)=>{if(!cond){fails++;console.log('FAIL',name,extra===undefined?'':JSON.stringify(extra));}else console.log('ok  ',name);};
const dia=(id)=>loadFile(path.join(__dirname,'../dialects',id+'.json'));
const up=(id,text,opts)=>{const r=LU.lineUpEdits(text,dia(id),opts);return {text:CF.applyEdits(text,r.edits),edits:r.edits,columns:r.columns};};
const conv=(text,id)=>{const r=X.xas99Edits(text,dia(id||'tms9900'));return {text:CF.applyEdits(text,r.edits),edits:r.edits,r};};
const lines=(...l)=>l.join('\n');const sp=(n)=>' '.repeat(n);
// What each line says, ignoring the spaces between the parts: its label, instruction, operands and comment.
// Lining up must never change this (converting may change the comment's start, never its words).
const shape=(text,D)=>{const st={};return text.split(/\r?\n/).map(l=>{const pl=parseLine(l,D,st);return JSON.stringify([statements(pl).map(s=>[s.label&&s.label.name,s.mnem&&s.mnem.text,s.operands.map(o=>o.text.replace(/\s+/g,'')).join('|')]),pl.comment&&pl.comment.text.trim()]);}).join('\n');};
const same=(id,a,b)=>shape(a,dia(id))===shape(b,dia(id));

// ---- the chip files hold the layouts ----
{const want={tms9900:'8,14,32,2',z80:'8,16,32,2','6502':'8,12,32,2',bbc:'4,12,32,2'};
 for(const id of Object.keys(want)){const c=dia(id).lineUp;ok(`${id}: layout comes from the chip file`,[c.instruction,c.operands,c.comment,c.commentGap].join()===want[id],c);}
 ok('the Z80 and BBC layouts differ from the TI one',dia('z80').lineUp.operands!==dia('tms9900').lineUp.operands&&dia('bbc').lineUp.instruction!==dia('tms9900').lineUp.instruction);
 const bare=prepare({id:'x',instructions:{}});ok('a chip file with no lineUp gets 8, 16, 32 and a gap of 2',JSON.stringify(bare.lineUp)===JSON.stringify(LU.DEFAULT_LINEUP),bare.lineUp);
 const bad=(raw)=>{try{prepare({id:'x',lineUp:raw});return '';}catch(e){return e.message;}};
 ok('a number that is not a whole number is refused with a clear message',/lineUp\.instruction.*whole number/.test(bad({instruction:'eight'})),bad({instruction:'eight'}));
 ok('an unknown name is refused',/lineUp\.colour/.test(bad({colour:3})));
 ok('operands must come after the instruction, and the comment after the operands',/operands must be bigger/.test(bad({instruction:20}))&&/comment must be bigger/.test(bad({comment:10})));
 ok('notes starting with _ are allowed',bad({_about:'hello',instruction:6})==='');}

// ---- TI-99/4A: instruction at 8, operands at 14, comment at 32 ----
{const src=lines('* made up','       DEF  START','START LI R0,>10 ; set up','  MOV R0,@BUF(R1)','LOOP DEC R1','    JNE LOOP * again','  RT   * done','       END');
 const want=lines('* made up',sp(8)+'DEF'+sp(3)+'START','START'+sp(3)+'LI'+sp(4)+'R0,>10'+sp(12)+'; set up',sp(8)+'MOV'+sp(3)+'R0,@BUF(R1)','LOOP'+sp(4)+'DEC'+sp(3)+'R1',sp(8)+'JNE'+sp(3)+'LOOP'+sp(14)+'* again',sp(8)+'RT'+sp(22)+'* done',sp(8)+'END');
 const r=up('tms9900',src);ok('TI: label, instruction, operands and comment go to their columns',r.text===want,r.text.split('\n'));
 ok('TI: doing it twice changes nothing more',up('tms9900',r.text).edits.length===0);
 ok('TI: only the spaces changed, never a word',same('tms9900',src,r.text));
 const l1=up('tms9900',lines('LONGLABELNAME LI R2,5','VERYLONGLABELNAMEHERE DEC R1 * x')).text.split('\n');
 ok('TI: a label too long for its column keeps one space, and the rest follows on',l1[0]==='LONGLABELNAME LI R2,5'&&/^VERYLONGLABELNAMEHERE DEC R1 {2,}\* x$/.test(l1[1]),l1);}
{const keep=lines('* a whole-line comment','       ; an indented comment','','   ','       LI   R0,5 + 2','       END');
 const r=up('tms9900',keep);ok('TI: comment-only lines, blank lines and a sum that carries on are left alone (only END is moved)',r.text===lines('* a whole-line comment','       ; an indented comment','','   ','       LI   R0,5 + 2',sp(8)+'END')&&r.edits.every(e=>e.line===5),r.text.split('\n'));
 const o=up('tms9900',"  LI R0, 5  * x\n  TEXT 'a ; b * c' * note");
 ok('TI: the spacing inside the operands and the text in quotes is copied as typed',o.text===sp(8)+'LI'+sp(4)+'R0, 5'+sp(13)+'* x\n'+sp(8)+'TEXT'+sp(2)+"'a ; b * c'"+sp(7)+'* note',o.text.split('\n'));
 ok('TI: a comment after only one space ends up with two or more (the one-space warning goes)',(()=>{const t=up('tms9900','       LI   R0,>10 * star').text;const P=new Project();P.set('/x/t',t,dia('tms9900'));return /  \* star$/.test(t)&&!F.check(P,'/x/t').some(c=>c.fix==='oneSpaceComment');})());}

// ---- Z80: instruction at 8, operands at 16, comment at 32 ----
{const src=lines('start: ld hl,SCREEN ; point at it','  loop: djnz loop','        defm "a ; b"','  ret','; a note');
 const want=lines('start:'+sp(2)+'ld'+sp(6)+'hl,SCREEN'+sp(7)+'; point at it','loop:'+sp(3)+'djnz'+sp(4)+'loop',sp(8)+'defm'+sp(4)+'"a ; b"',sp(8)+'ret','; a note');
 const r=up('z80',src);ok('Z80: an indented label moves to column 0 (its colon stays); text in quotes is not a comment',r.text===want,r.text.split('\n'));
 ok('Z80: a second run changes nothing, and only the spaces changed',up('z80',r.text).edits.length===0&&same('z80',src,r.text));
 ok('Z80: "name = value" lines are left alone',up('z80','speed = 5\nstart: ld a,speed').text==='speed = 5\nstart:'+sp(2)+'ld'+sp(6)+'a,speed');}

// ---- 6502 (C64, KickAssembler): instruction at 8, operands at 12, comment at 32 ----
{const src=lines('// made up','*=$0801','BasicUpstart2(start)','.const border = $d020','start: lda #$ff // white','  sta border','loop: {','  inc border','}','/* a block','   comment */','  jmp start');
 const r=up('6502',src);const l=r.text.split('\n');
 ok('6502: instructions line up, with the comment in its column',l[4]==='start:'+sp(2)+'lda'+sp(1)+'#$ff'+sp(16)+'// white'&&l[5]===sp(8)+'sta'+sp(1)+'border'&&l[11]===sp(8)+'jmp'+sp(1)+'start',l);
 ok('6502: "*=$0801", lines with { or }, and block comments are left as typed',l[1]==='*=$0801'&&l[6]==='loop: {'&&l[8]==='}'&&l[9]==='/* a block'&&l[10]==='   comment */',l);
 ok('6502: a call written with brackets has nothing added inside it',l[2]===sp(8)+'BasicUpstart2(start)',l[2]);
 ok('6502: a second run changes nothing, and only the spaces changed',up('6502',r.text).edits.length===0&&same('6502',src,r.text));}

// ---- BBC Micro (BeebAsm): instruction at 4, operands at 12, comment at 32 ----
{const src=lines('ORG &1900','.start','.loop LDA #1:STA &70 \\ both','  LDA#5','speed = &70','.next: INX','  .skip : DEX','  jmp loop');
 const r=up('bbc',src);const l=r.text.split('\n');
 ok('BBC: a .label on its own line stays in column 0',l[1]==='.start');
 ok('BBC: statements after a colon stay glued on after the first; the comment goes to its column',/^\.loop LDA {3}#1:STA &70 {10}\\ both$/.test(l[2]),l[2]);
 ok('BBC: LDA#5 (nothing between the instruction and the operand) gets nothing added',l[3]===sp(4)+'LDA#5',l[3]);
 ok('BBC: "name = value" is left alone',l[4]==='speed = &70');
 ok('BBC: a label followed by more statements after a colon is left alone',l[5]==='.next: INX'&&l[6]==='  .skip : DEX',l.slice(5,7));
 ok('BBC: a second run changes nothing, and only the spaces changed',up('bbc',r.text).edits.length===0&&same('bbc',src,r.text));}

// ---- columns, a range, line endings ----
{const t=lines('a1 li r0,1 * x','b1 li r1,2 * y','c1 li r2,3 * z');
 const r=up('tms9900',t,{fromLine:1,toLine:1}).text.split('\n');ok('only the chosen lines change when a range is given',r[0]==='a1 li r0,1 * x'&&r[2]==='c1 li r2,3 * z'&&r[1].startsWith('b1'+sp(6)+'li'),r);
 const c=up('tms9900','x LI R0,1  * y',{columns:{instruction:4,operands:8,comment:20}});ok("your own columns replace the chip file's",c.text==='x'+sp(3)+'LI'+sp(2)+'R0,1'+sp(8)+'* y',c.text);
 ok('your columns are checked: a mistake gives a clear message',(()=>{try{up('tms9900','x',{columns:{operands:3}});return false;}catch(e){return /operands must be bigger/.test(e.message);}})());
 const w=up('z80','a: ld a,1\r\nret\r\n');ok('Windows line endings are kept',w.text==='a:'+sp(6)+'ld'+sp(6)+'a,1\r\n'+sp(8)+'ret\r\n',w.text);
 ok('empty text and blank lines are fine',up('z80','').text===''&&up('z80','\n\n  \n').text==='\n\n  \n');
}

// ---- convert to xas99 (TI-99/4A) ----
{const src=lines('* made up','       DEF  START','START  LWPI >8300','       LI   R0,>10 * one space','       LI   R1,>10  * two spaces','       LI   R2,5\t* a tab','       LI   R3,5;glued','       MOV  R0, R1','       MOV  R0 ,R1',"       BYTE 'A', 'B'","       TEXT 'a, b'",'       RT   * no operands','       LI   R4,5 + 2','       LI   R5,5','       END');
 const r=conv(src);const l=r.text.split('\n'),s0=src.split('\n');
 ok('xas99: a comment after one space gets two',l[3]==='       LI   R0,>10  * one space',l[3]);
 ok('xas99: two spaces and a Tab are left as they are',l[4]===s0[4]&&l[5]===s0[5]);
 ok('xas99: a comment glued on after a ; gets two spaces',l[6]==='       LI   R3,5  ;glued',l[6]);
 ok('xas99: spaces next to a comma are taken out',l[7]==='       MOV  R0,R1'&&l[8]==='       MOV  R0,R1'&&l[9]==="       BYTE 'A','B'",l.slice(7,10));
 ok('xas99: text in quotes is not touched',l[10]===s0[10],l[10]);
 ok('xas99: a sum that carries on is not turned into a comment',l[12]===s0[12],l[12]);
 ok('xas99: lines with nothing to fix and whole-line comments are not changed',[0,1,2,11,13,14].every(i=>l[i]===s0[i]));
 ok('xas99: the counts say what was done',r.r.comments===2&&r.r.commas===3,{c:r.r.comments,m:r.r.commas});
 ok('xas99: a second run changes nothing',conv(r.text).edits.length===0);
 ok('xas99: an instruction with no operands and one space before its comment gets two',conv('       RT * done').text==='       RT  * done');
 ok('xas99: the words are the same afterwards',same('tms9900',src,r.text));
 const P1=new Project(),P2=new Project();P1.set('/x/t',src,dia('tms9900'));P2.set('/x/t',r.text,dia('tms9900'));
 const bad=(P)=>F.check(P,'/x/t').filter(c=>/Only one space|space in the middle/.test(c.message)).length;
 ok('xas99: the one-space and space-in-operands warnings are gone afterwards',bad(P1)>=4&&bad(P2)===0,{before:bad(P1),after:bad(P2)});}
{ok('xas99: the other chips are told it is not for them and nothing changes',['z80','6502','bbc'].every(id=>{const r=conv('  ld a,1 ; x\n',id);return r.r.applies===false&&r.edits.length===0;}));
 ok('xas99: Windows line endings are kept',conv('       LI   R0, 5 * x\r\n       END\r\n').text==='       LI   R0,5  * x\r\n       END\r\n');}

// ---- every test file: the words, the warnings and the line count stay the same ----
{const fx=path.join(__dirname,'fixtures');const all=loadFolder(path.join(__dirname,'../dialects')).dialects;
 const pickOf={'.a99':'tms9900','.z80':'z80','.6502':'bbc'};let n=0,changed=0,converted=0;
 const msgs=(P,f)=>F.check(P,'/x/'+f).map(c=>c.message).filter(m=>!/Only one space|space in the middle/.test(m)).join('|');
 const spaceWarnings=(P,f)=>F.check(P,'/x/'+f).filter(c=>/Only one space|space in the middle/.test(c.message)).length;
 const proj=(f,t,D)=>{const P=new Project();P.set('/x/'+f,t,D);return P;};
 for(const f of fs.readdirSync(fx)){if(f.endsWith('.skool')||f.endsWith('.bas'))continue;const ext=path.extname(f);const text=fs.readFileSync(path.join(fx,f),'utf8');
  const D=pickOf[ext]?all.find(d=>d.id===pickOf[ext]):guessDialect(text,all.filter(d=>d.fileExtensions.includes(ext)));
  const r=LU.lineUpEdits(text,D);const out=CF.applyEdits(text,r.edits);if(r.edits.length)changed++;
  ok(`${f}: line-up twice changes nothing more; the words, the warnings and the line count stay the same`,
     LU.lineUpEdits(out,D).edits.length===0&&shape(text,D)===shape(out,D)&&msgs(proj(f,text,D),f)===msgs(proj(f,out,D),f)&&text.split('\n').length===out.split('\n').length);
  if(D.syntax.operandsEndAtSpace){const c=X.xas99Edits(text,D);const cout=CF.applyEdits(text,c.edits);if(c.edits.length)converted++;
   ok(`${f}: convert to xas99 leaves the other warnings as they were, clears the spacing ones, and a second run changes nothing`,
      X.xas99Edits(cout,D).edits.length===0&&msgs(proj(f,text,D),f)===msgs(proj(f,cout,D),f)&&spaceWarnings(proj(f,cout,D),f)===0&&shape(text,D)===shape(cout,D));}
  n++;}
 ok('the fixtures include files that do change',changed>=6&&n>=9,{n,changed,converted});}

// ---- inside VS Code (a stand-in for it) ----
(async()=>{
 const ws=fs.mkdtempSync(path.join(os.tmpdir(),'retroasm-lineup-'));
 const messy=lines('* made up','       def  start','start li r0,>ff12 * one space','  mov r0, @buf(r1)','  jmp start ; loop','buf bss 10','  end','');
 const f1=path.join(ws,'messy.a99');fs.writeFileSync(f1,messy);const f2=path.join(ws,'plain.txt');fs.writeFileSync(f2,messy);const f3=path.join(ws,'z.z80');fs.writeFileSync(f3,'start: ld a,1 ; x\n');
 mock.workspace.workspaceFolders=[{uri:mock.Uri.file(ws)}];
 const {commands:C,makeDoc,settings,warnings}=mock.__;
 const doc=makeDoc(f1,'retroasm'),other=makeDoc(f2,'plaintext'),zdoc=makeDoc(f3,'retroasm');
 const state=new Map();const ctx={extensionPath:path.join(__dirname,'..'),subscriptions:[],workspaceState:{get:(k)=>state.get(k),update:async(k,v)=>{state.set(k,v);}}};
 require('../extension.js').activate(ctx);await new Promise(r=>setTimeout(r,300));
 const apply=(text,list)=>{const ls=text.split('\n');for(const e of list.slice().sort((a,b)=>b.range.start.line-a.range.start.line||b.range.start.character-a.range.start.character)){const l=e.range.start.line;ls[l]=ls[l].slice(0,e.range.start.character)+e.newText+ls[l].slice(e.range.end.character);}return ls.join('\n');};
 const run=async(command,document,selection)=>{let applied=null;mock.window.activeTextEditor={document,selection:selection||{isEmpty:true},edit:async(cb)=>{const list=[];cb({replace:(range,newText)=>list.push({range,newText})});applied=list;return true;}};await C[command]();return applied;};
 const wantUp=CF.applyEdits(messy,LU.lineUpEdits(messy,dia('tms9900')).edits);
 const a1=await run('retroAsm.lineUp',doc);ok('the line-up command lines up the whole file when nothing is selected',a1&&apply(messy,a1)===wantUp&&wantUp!==messy,a1&&a1.length);
 const a2=await run('retroAsm.lineUp',doc,{isEmpty:false,start:new mock.Position(2,0),end:new mock.Position(2,5)});ok('the line-up command changes only the selected lines',a2&&a2.length>0&&a2.every(e=>e.range.start.line===2),a2&&a2.map(e=>e.range.start.line));
 const a3=await run('retroAsm.lineUp',doc,{isEmpty:false,start:new mock.Position(2,0),end:new mock.Position(4,0)});ok('a selection ending at the start of a line leaves that line out',a3&&a3.length>0&&a3.every(e=>e.range.start.line>=2&&e.range.start.line<=3),a3&&a3.map(e=>e.range.start.line));
 ok('other kinds of file are never touched',(await run('retroAsm.lineUp',other))===null&&(await run('retroAsm.convertToXas99',other))===null);
 settings.lineUpColumns={tms9900:{instruction:4,operands:9,comment:24}};
 const a4=await run('retroAsm.lineUp',doc);const t4=apply(messy,a4).split('\n');ok('the retroAsm.lineUpColumns setting changes the columns for that chip',t4[1]===sp(4)+'def'+sp(2)+'start',t4.slice(1,3));
 const az=await run('retroAsm.lineUp',zdoc);const zl=az?apply('start: ld a,1 ; x\n',az).split('\n')[0]:'';ok('the setting for one chip does not change another chip',zl.indexOf('ld')===8&&zl.indexOf('a,1')===16&&zl.indexOf('; x')===32,zl);
 settings.lineUpColumns={tms9900:{operands:2}};warnings.length=0;
 const a5=await run('retroAsm.lineUp',doc);ok('a setting that does not make sense is reported and nothing changes',a5===null&&warnings.some(w=>/retroAsm\.lineUpColumns.*operands must be bigger/.test(w)),warnings);
 settings.lineUpColumns={};
 const c1=await run('retroAsm.convertToXas99',doc);const t=c1?apply(messy,c1).split('\n'):[];ok('the convert command fixes the comment spacing and the space after a comma (whole file)',t[2]==='start li r0,>ff12  * one space'&&t[3]==='  mov r0,@buf(r1)',t.slice(2,4));
 const c2=await run('retroAsm.convertToXas99',zdoc);ok('the convert command does nothing to a file for another chip',c2===null);
 ok('the commands are in the package file, the line-up with its shortcut and setting',(()=>{const j=JSON.parse(fs.readFileSync(path.join(__dirname,'../package.json'),'utf8'));const cm=(id)=>j.contributes.commands.some(c=>c.command===id);return cm('retroAsm.lineUp')&&cm('retroAsm.convertToXas99')&&j.contributes.keybindings.some(k=>k.command==='retroAsm.lineUp'&&k.key==='shift+alt+l')&&j.contributes.configuration.properties['retroAsm.lineUpColumns'].type==='object';})());
 console.log(fails?`\n${fails} FAILED`:'\nall passed');process.exit(fails?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
