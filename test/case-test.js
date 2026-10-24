// Tests for the letter-case change: node test/case-test.js (ext-test.js runs it too).
// All the sample code here is made up.
const Module=require('module');const path=require('path');const fs=require('fs');const os=require('os');
const mock=require('./mock-vscode');const orig=Module._load;Module._load=function(req,...r){return req==='vscode'?mock:orig.call(this,req,...r)};
const {loadFile,loadFolder,prepare,guessDialect}=require('../lib/dialect');const {Project}=require('../lib/project');const F=require('../lib/features');
const CF=require('../lib/caseformat');
let fails=0;const ok=(name,cond,extra)=>{if(!cond){fails++;console.log('FAIL',name,extra===undefined?'':JSON.stringify(extra));}else console.log('ok  ',name);};
const dia=(id)=>loadFile(path.join(__dirname,'../dialects',id+'.json'));
const fmt=(id,text,opts)=>CF.formatText(text,dia(id),opts);
const lines=(...l)=>l.join('\n');

// ---- the chip files hold the rules ----
{const want={tms9900:'upper,upper,upper,upper',z80:'upper,keep,upper,keep','6502':'upper,keep,upper,keep',bbc:'upper,keep,upper,keep'};
 for(const id of Object.keys(want)){const c=dia(id).caseFormat;ok(`${id}: case rules come from the chip file`,[c.instructions,c.directives,c.registers,c.labels].join()===want[id],c);}
 const bare=prepare({id:'x',instructions:{}});ok('a chip file with no caseFormat gets the defaults',JSON.stringify(bare.caseFormat)===JSON.stringify(CF.DEFAULT_CASE),bare.caseFormat);
 let msg='';try{prepare({id:'x',caseFormat:{labels:'shout'}});}catch(e){msg=e.message;}ok('a bad caseFormat value is refused with a clear message',/caseFormat\.labels.*upper.*lower.*keep/.test(msg),msg);
 msg='';try{prepare({id:'x',caseFormat:{colour:'upper'}});}catch(e){msg=e.message;}ok('an unknown caseFormat part is refused',/caseFormat\.colour/.test(msg),msg);
 ok('notes starting with _ are allowed in caseFormat',!!prepare({id:'x',caseFormat:{_about:'hello',labels:'lower'}}).caseFormat&&prepare({id:'x',caseFormat:{_about:'hello',labels:'lower'}}).caseFormat.labels==='lower');}

// ---- TI-99/4A (labels in capitals too) ----
{const src=lines('* sample made up, lda r1','       def  start','start  li   r0,>ff12','       mov  r0,@buf(r1)','       blwp @vsbw','       jmp  start   ; loop, li r0','buf    bss  10','       text \'Hello r1\'','       end');
 const want=lines('* sample made up, lda r1','       DEF  START','START  LI   R0,>ff12','       MOV  R0,@BUF(R1)','       BLWP @VSBW','       JMP  START   ; loop, li r0','BUF    BSS  10','       TEXT \'Hello r1\'','       END');
 const r=fmt('tms9900',src);ok('TI: words change; comments, quotes and hex stay as typed',r.text===want,r.text.split('\n'));
 ok('TI: labels follow whatever case they were typed in',fmt('tms9900',lines('Loop   dec  r1','       jne  LOOP','       jne  loop')).text===lines('LOOP   DEC  R1','       JNE  LOOP','       JNE  LOOP'));
 ok('TI: .ifdef style directives are left as typed',fmt('tms9900',lines('       .ifdef FOO','       li   r1,1','       .endif')).text===lines('       .ifdef FOO','       LI   R1,1','       .endif'));
 ok('TI: COPY lines keep their file name',fmt('tms9900','       copy "DSK1.Stuff"\n       copy DSK1.Stuff').text==='       COPY "DSK1.Stuff"\n       COPY DSK1.Stuff');}

// ---- 6502 (C64, KickAssembler) ----
{const src=lines('// clear the screen, lda x','start:  lda #$ff','        sta $d020,x     // store it','loop:   inx','        bne loop','msg:    .byte "hello; ok"','        jmp start');
 const want=lines('// clear the screen, lda x','start:  LDA #$ff','        STA $d020,X     // store it','loop:   INX','        BNE loop','msg:    .byte "hello; ok"','        JMP start');
 ok('6502: instructions and registers change; .byte, labels, hex, text and comments stay',fmt('6502',src).text===want,fmt('6502',src).text.split('\n'));
 ok('6502: a block comment is left alone',fmt('6502',lines('/* lda x','   sta y */','        lda #1')).text===lines('/* lda x','   sta y */','        LDA #1'));
 const up={rules:{labels:'upper'}};const r=fmt('6502',lines('start:  lda #0','        jmp start','        jmp Start'),up);
 ok('6502: with labels set to upper, definitions and uses change together (this chip treats Start and start as one label)',r.text===lines('START:  LDA #0','        JMP START','        JMP START'),r.text.split('\n'));}
// BeebAsm tells Start and start apart, so labels are only changed where that is safe
{const up={rules:{labels:'upper'}};const r=fmt('bbc',lines('.start','  lda #0','  jmp start','  jmp Start'),up);
 ok('BBC: with labels set to upper, a different spelling is a different label and is left alone',r.text===lines('.START','  LDA #0','  JMP START','  JMP Start'),r.text.split('\n'));
 const c=fmt('bbc',lines('.foo','  nop','.FOO','  nop','  jmp foo'),up);
 ok('BBC: labels that would become the same are left alone and reported (the instructions still change)',c.text===lines('.foo','  NOP','.FOO','  NOP','  JMP foo')&&c.skippedLabels.slice().sort().join()==='FOO,foo',c);}

// ---- BBC Micro (BeebAsm: .labels, several statements on a line, labels tell cases apart) ----
{const src=lines('ORG &1900','.start','  lda #&ff:sta &70   \\ lda','  jmp start','  ldx #LO(table)');
 const want=lines('ORG &1900','.start','  LDA #&ff:STA &70   \\ lda','  JMP start','  LDX #LO(table)');
 ok('BBC: statements after a colon change too; .labels, hex and comments stay',fmt('bbc',src).text===want,fmt('bbc',src).text.split('\n'));}

// ---- Z80 (sjasmplus) ----
{const src=lines('start:  ld hl,SCREEN        ; point at it, ld a,b','        ld a,0ffh','        ex af,af\'','        ld (ix+3),a','        defm "ld a,b"','        jr nz,start');
 const want=lines('start:  LD HL,SCREEN        ; point at it, ld a,b','        LD A,0ffh','        EX AF,AF\'','        LD (IX+3),A','        defm "ld a,b"','        JR nz,start');
 const r=fmt('z80',src);ok('Z80: instructions and registers change; hex, text and comments stay',r.text===want,r.text.split('\n'));
 ok('Z80: a condition such as nz is not a register, so it is left alone',/JR nz,start/.test(r.text));}

// ---- the same on every line ending, and only where asked ----
{const r=fmt('z80','        ld a,1\r\n        ret\r\n');ok('Windows line endings are kept',r.text==='        LD A,1\r\n        RET\r\n',r.text);
 const t=lines('        ld a,1','        ld b,2','        ld c,3');
 ok('only the chosen lines change when a range is given',fmt('z80',t,{fromLine:1,toLine:1}).text===lines('        ld a,1','        LD B,2','        ld c,3'));
 ok('empty text and blank lines are fine',fmt('z80','').text===''&&fmt('z80','\n\n  \n').text==='\n\n  \n');
 const once=fmt('z80',t).text;ok('doing it twice changes nothing more',fmt('z80',once).edits.length===0);}

// ---- every test file: a second run changes nothing, and the warnings stay the same ----
{const fx=path.join(__dirname,'fixtures');const all=loadFolder(path.join(__dirname,'../dialects')).dialects;
 const pickOf={'.a99':'tms9900','.z80':'z80','.6502':'bbc'};let n=0,changed=0;
 for(const f of fs.readdirSync(fx)){if(f.endsWith('.skool'))continue;const ext=path.extname(f);const text=fs.readFileSync(path.join(fx,f),'utf8');
  const D=pickOf[ext]?all.find(d=>d.id===pickOf[ext]):guessDialect(text,all.filter(d=>d.fileExtensions.includes(ext)));
  const r=CF.formatText(text,D);const again=CF.formatText(r.text,D);if(r.edits.length)changed++;
  const before=new Project(),after=new Project();before.set('/x/'+f,text,D);after.set('/x/'+f,r.text,D);
  const cb=F.check(before,'/x/'+f).map(c=>c.message).join('|'),ca=F.check(after,'/x/'+f).map(c=>c.message).join('|');
  ok(`${f}: a second run changes nothing and the warnings are the same`,again.edits.length===0&&cb===ca,{again:again.edits.length,cb,ca});n++;}
 ok('the fixtures include files that do change',changed>=3&&n>=9,{n,changed});}

// ---- inside VS Code (a stand-in for it) ----
(async()=>{
 const ws=fs.mkdtempSync(path.join(os.tmpdir(),'retroasm-case-'));
 const lower=lines('* made up','       def  start','start  li   r0,>ff12','       mov  r0,@buf(r1)','       jmp  start','buf    bss  10','       end','');
 const f1=path.join(ws,'lower.a99');fs.writeFileSync(f1,lower);const f2=path.join(ws,'plain.txt');fs.writeFileSync(f2,lower);
 mock.workspace.workspaceFolders=[{uri:mock.Uri.file(ws)}];
 const {providers:P,commands:C,events,makeDoc,settings}=mock.__;
 const doc=makeDoc(f1,'retroasm'),other=makeDoc(f2,'plaintext');
 const state=new Map();const ctx={extensionPath:path.join(__dirname,'..'),subscriptions:[],workspaceState:{get:(k)=>state.get(k),update:async(k,v)=>{state.set(k,v);}}};
 require('../extension.js').activate(ctx);await new Promise(r=>setTimeout(r,300));
 const want=fmt('tms9900',lower).text;
 const apply=(text,tes)=>{const ls=text.split('\n');for(const e of tes.slice().sort((a,b)=>b.range.start.line-a.range.start.line||b.range.start.character-a.range.start.character)){const l=e.range.start.line;ls[l]=ls[l].slice(0,e.range.start.character)+e.newText+ls[l].slice(e.range.end.character);}return ls.join('\n');};
 const e1=P.DocumentFormattingEdit.provideDocumentFormattingEdits(doc);
 ok('Format Document gives the changes',e1.length>5&&apply(lower,e1)===want,e1.length);
 ok('only the changed words are replaced, not whole lines',e1.every(e=>e.range.start.line===e.range.end.line&&(e.range.end.character-e.range.start.character)<=8));
 const e2=P.DocumentRangeFormattingEdit.provideDocumentRangeFormattingEdits(doc,new mock.Range(2,0,3,0));
 ok('Format Selection changes just the selected lines (a selection ending at the start of a line leaves that line out)',e2.length>0&&e2.every(e=>e.range.start.line===2),e2.map(e=>e.range.start.line));
 ok('other kinds of file are never touched',P.DocumentFormattingEdit.provideDocumentFormattingEdits(other).length===0);
 // on save
 const save=(reason)=>{let got=null;events.willSave[0]({document:doc,reason,waitUntil:(p)=>{got=p;}});return got;};
 const s1=save(1);ok('pressing Save changes the case',s1&&apply(lower,await s1)===want);
 ok('auto-save (after a delay, or leaving the window) changes nothing',save(2)===null&&save(3)===null);
 settings.formatCaseOnSave=false;ok('the setting turns it off',save(1)===null);settings.formatCaseOnSave=true;
 { let got=null;events.willSave[0]({document:other,reason:1,waitUntil:(p)=>{got=p;}});ok('saving some other kind of file does nothing',got===null);}
 // the shortcut
 const run=async(selection)=>{let applied=null;mock.window.activeTextEditor={document:doc,selection,edit:async(cb)=>{const list=[];cb({replace:(range,newText)=>list.push({range,newText})});applied=list;return true;}};await C['retroAsm.changeCase']();return applied;};
 const a1=await run({isEmpty:true});ok('the shortcut changes the whole file when nothing is selected',a1&&apply(lower,a1)===want);
 const a2=await run({isEmpty:false,start:new mock.Position(4,0),end:new mock.Position(4,5)});ok('the shortcut changes only the selected lines',a2&&a2.length>0&&a2.every(e=>e.range.start.line===4),a2&&a2.map(e=>e.range.start.line));
 ok('the command is in the package file with its shortcut and setting',(()=>{const j=JSON.parse(fs.readFileSync(path.join(__dirname,'../package.json'),'utf8'));return j.contributes.commands.some(c=>c.command==='retroAsm.changeCase')&&j.contributes.keybindings.some(k=>k.command==='retroAsm.changeCase'&&k.key==='shift+alt+u')&&j.contributes.configuration.properties['retroAsm.formatCaseOnSave'].default===true;})());
 console.log(fails?`\n${fails} FAILED`:'\nall passed');process.exit(fails?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
