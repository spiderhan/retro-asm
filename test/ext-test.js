const Module=require('module');const path=require('path');const fs=require('fs');const os=require('os');
const mock=require('./mock-vscode');const orig=Module._load;Module._load=function(req,...r){return req==='vscode'?mock:orig.call(this,req,...r)};
const ext=require('../extension.js');const {providers:P,commands:C,events,makeDoc,settings}=mock.__;
const {Position}=mock;
// work on a copy of the fixtures, in a "workspace" folder
const ws=fs.mkdtempSync(path.join(os.tmpdir(),'retroasm-'));for(const f of fs.readdirSync(path.join(__dirname,'fixtures')))fs.copyFileSync(path.join(__dirname,'fixtures',f),path.join(ws,f));
mock.workspace.workspaceFolders=[{uri:mock.Uri.file(ws)}];
const game=makeDoc(path.join(ws,'game.a99'),'retroasm');const data=makeDoc(path.join(ws,'data.a99'),'retroasm');const mis=makeDoc(path.join(ws,'paddle.a99'),'retroasm');const z=makeDoc(path.join(ws,'z.z80'),'retroasm');
const state=new Map();const ctx={extensionPath:path.join(__dirname,'..'),subscriptions:[],workspaceState:{get:(k)=>state.get(k),update:async(k,v)=>{state.set(k,v);}}};
let fails=0;const ok=(name,cond,extra)=>{if(!cond){fails++;console.log('FAIL',name,extra===undefined?'':JSON.stringify(extra));}else console.log('ok  ',name);};
const at=(doc,needle,sub)=>{const lines=doc.getText().split(/\r?\n/);const l=lines.findIndex(x=>x.includes(needle));return new Position(l,lines[l].indexOf(sub||needle)+1);};
(async()=>{
 const api=ext.activate(ctx);
 await new Promise(r=>setTimeout(r,500));
 const h=P.Hover.provideHover(game,at(game,'MOVB *R1+,@VDPWD','MOVB'));ok('hover on instruction',h&&h.contents.some(c=>c.value.includes('This line')),h);
 const h2=P.Hover.provideHover(game,at(game,'LI   R1,ZONE_LIST','ZONE_LIST'));ok('hover on label from COPY file',h2&&h2.contents[0].value.includes('ZONE'),h2);
 const hv=P.Hover.provideHover(mis,at(mis,'BLANK  BLWP @VSBW','VSBW'));ok('hover on a REF helper says what it stands for',hv&&hv.contents.some(c=>/VDP Single Byte Write/.test(c.value)),hv);
 { // a helper the program defines itself (an EQU, or its own copy) still gets its explanation
  const {loadFile}=require('../lib/dialect');const {Project}=require('../lib/project');const F=require('../lib/features');
  const D=loadFile(path.join(__dirname,'../dialects/tms9900.json'));const PJ=new Project();
  PJ.set('/x/equ.a99','VSBW   EQU  >2020\nSTART  BLWP @VSBW\n       END\n',D);
  PJ.set('/x/own.a99','START  BLWP @VMBW\n       JMP  START\nVMBW   DATA WS,VMBW1\nVMBW1  RTWP\nWS     BSS  32\n       END\n',D);
  const e=F.hoverAt(PJ,'/x/equ.a99',1,14),o=F.hoverAt(PJ,'/x/own.a99',0,14);
  ok('hover on a helper set with EQU explains it',e&&e.parts.some(x=>/VDP Single Byte Write/.test(x)),e&&e.parts);
  ok('hover on a helper the program wrote itself explains it',o&&o.parts.some(x=>/VDP Multiple Byte Write/.test(x)),o&&o.parts);
 }
 const d=P.Definition.provideDefinition(game,at(game,'BL   @SET_VIDEO','SET_VIDEO'));ok('go to definition',d.length===1&&d[0].range.start.line===74,d);
 const d2=P.Definition.provideDefinition(game,at(game,'LI   R1,ZONE_LIST','ZONE_LIST'));ok('go to definition in other file',d2.length===1&&d2[0].uri.fsPath.endsWith('data.a99'),d2);
 const d3=P.Definition.provideDefinition(game,at(game,'COPY "data.a99"','data'));ok('open COPY file',d3&&d3.uri.fsPath.endsWith('data.a99'));
 const d4=P.Definition.provideDefinition(mis,at(mis,'END  START','START'));ok('START stays in its own program',d4.length===1&&d4[0].uri.fsPath.endsWith('paddle.a99'),d4.map(x=>x.uri.fsPath));
 const d5=P.Definition.provideDefinition(game,at(game,'falls through into MENU','MENU'));ok('jump from a name in a comment',d5.length===1&&d5[0].range.start.line===37,d5);
 const r=P.Reference.provideReferences(game,at(game,'ONE_BYTE    BYTE','ONE_BYTE'),{includeDeclaration:true});ok('find all uses',r.length===4,r.length);
 const s=P.DocumentSymbol.provideDocumentSymbols(game);ok('outline',s.some(x=>x.name==='MENU'&&x.children.length===1)&&s.length>10,s.map(x=>x.name));
 for(const doc of [game,mis,z]){P.DocumentSymbol.provideDocumentSymbols(doc);P.FoldingRange.provideFoldingRanges(doc);}
 ok('outline + folding on every file',true);
 const ws2=P.WorkspaceSymbol.provideWorkspaceSymbols('setvid');ok('search labels across files',ws2.some(x=>x.name==='SET_VIDEO'),ws2.map(x=>x.name));
 const tk=P.DocumentSemanticTokens.provideDocumentSemanticTokens(game);ok('colours',tk.data.length>100,tk.data.length);
 P.DocumentSemanticTokens.provideDocumentSemanticTokens(z);P.DocumentSemanticTokens.provideDocumentSemanticTokens(mis);
 const links=P.DocumentLink.provideDocumentLinks(game);ok('COPY link',links.filter(l=>l.target.scheme==='file').length===1&&links.find(l=>l.target.scheme==='file').target.fsPath.endsWith('data.a99'),links.map(l=>l.target.toString()));
 // ---- version 0.3: addresses in the original game (a .skool file) ----
 const orig=links.filter(l=>l.target.scheme==='command');ok('original addresses are links',orig.length===2&&orig.every(l=>l.target.toString().startsWith('command:retroAsm.openOriginal')),orig.map(l=>[l.range.start.line+1,l.target.toString()]));
 const oline=game.getText().split(/\r?\n/)[orig[0].range.start.line];ok('the link covers just "$8010"',oline.slice(orig[0].range.start.character,orig[0].range.end.character)==='$8010',oline);
 ok('a number the .skool file does not cover is not a link',!links.some(l=>/2710|10000/.test(decodeURIComponent(l.target.toString()))));
 const ho=P.Hover.provideHover(game,at(game,'original $8044','$8044'));const hov=ho&&ho.contents.map(c=>c.value).join('\n');
 ok('tooltip for an original address',hov&&hov.includes('Menu')&&hov.includes('ld hl,$4000')&&hov.includes('line 26')&&hov.includes('command:retroAsm.openOriginal'),hov);
 ok('the open link in that tooltip is allowed to run',ho&&ho.contents[ho.contents.length-1].isTrusted&&ho.contents[ho.contents.length-1].isTrusted.enabledCommands.includes('retroAsm.openOriginal'));
 const ho2=P.Hover.provideHover(game,at(game,'original $8010','$8010'));ok('entry title in the tooltip',ho2&&ho2.contents[0].value.includes('Real set-up, after the border'),ho2&&ho2.contents[0].value);
 const dO=P.Definition.provideDefinition(game,at(game,'original $8044','$8044'));ok('F12 on an original address',dO&&dO.length===1&&dO[0].uri.fsPath.endsWith('orig.skool')&&dO[0].range.start.line===25,dO);
 const op=await C['retroAsm.openOriginal'](0x8016,game.uri.fsPath);ok('open the original at an entry point',op&&op.line===21,op);
 const op2=await C['retroAsm.openOriginal']('$8049',game.uri.fsPath);ok('open the original from typed hex',op2&&op2.line===27,op2);
 const op3=await C['retroAsm.openOriginal'](0x8055,game.uri.fsPath);ok('an address inside a data line goes to that line',op3&&op3.line===30,op3);
 ok('an address outside the file is refused',(await C['retroAsm.openOriginal'](0x2710,game.uri.fsPath))===false);
 const hl=P.DocumentHighlight.provideDocumentHighlights(game,at(game,'JNE  MN_FILL','MN_FILL'));ok('highlight uses',hl.length===2,hl.length);
 const pr=P.Rename.prepareRename(game,at(game,'JNE  MN_FILL','MN_FILL'));const re=P.Rename.provideRenameEdits(game,at(game,'JNE  MN_FILL','MN_FILL'),'MENU_FILL');ok('rename',pr.placeholder==='MN_FILL'&&re.edits.length===2,re.edits.length);
 let threw=false;try{P.Rename.provideRenameEdits(game,at(game,'JNE  MN_FILL','MN_FILL'),'MOV');}catch(e){threw=true;}ok('rename refuses an instruction name',threw);
 // completion: fake a line being typed
 const typing=(text)=>{const lines=game.getText().split(/\r?\n/);lines[lines.length-1]=text;const doc=Object.assign({},game,{getText:()=>game.getText(),lineAt:(i)=>({text:i===lines.length-1?text:lines[i]})});return P.CompletionItem.provideCompletionItems(doc,new Position(lines.length-1,text.length));};
 const c1=typing('       MO');ok('suggest instructions',c1.some(i=>i.label==='MOVB'&&i.insertText==='MOVB ')&&c1.some(i=>i.label==='MOV'&&i.insertText==='MOV  '),c1.length);
 const c2=typing('       BL   @');ok('suggest labels',c2.some(i=>i.label==='SET_VIDEO')&&c2.some(i=>i.label==='R4'&&i.detail==='Rover X'),c2.length);
 ok('no suggestions in label column',typing('LAB').length===0);ok('no suggestions in a comment',typing('       CLR  R0  ; cle').length===0&&typing('; hello').length===0&&typing('       CLR  R0  ').length===0);
 ok('lowercase typing gets lowercase',typing('       mo').some(i=>i.insertText==='mov  '));
 // ---- version 0.9: starter code (snippets) ----
 { const s1=typing('pr');const pg=s1.find(i=>i.label==='program');
   ok('starter code offered in the label column',pg&&pg.insertText instanceof mock.SnippetString&&pg.insertText.value.includes('LWPI WRKSPC')&&pg.range.start.character===0&&pg.range.end.character===2,s1.map(i=>i.label));
   const s2=typing('       lo');ok('starter code offered with the instructions',s2.some(i=>i.label==='loop'&&i.range.start.character===0&&i.filterText==='       loop'),s2.map(i=>i.label));
   ok('a capital label does not offer starter code',typing('LOOP').length===0&&typing('PR').length===0);
   ok('one letter in the label column is not enough',typing('p').length===0);
   ok('starter code only while the word is alone on the line',!typing('       CLR  pr').some(i=>i.label==='program')&&!typing('START  lo').some(i=>i.label==='loop'));
   ok('a tooltip shows the code',pg&&pg.documentation.value.includes('END  START')&&!pg.documentation.value.includes('$'),pg&&pg.documentation.value);
   // ---- 0.12: typing "sprite" offers an empty picture of each shape ----
   const sp=typing('sprite');const s16=sp.find(i=>i.label==='sprite 16x16');
   ok('"sprite" offers each shape and "sprite ..."',sp.some(i=>i.label==='sprite 8x8')&&s16&&sp.some(i=>i.label==='sprite ...'&&i.command&&i.command.command==='retroAsm.newSprite'),sp.map(i=>i.label));
   ok('... a marked, empty 16x16 with a free name',s16&&s16.insertText.value.startsWith('* @sprite 16x16\n${1:SPR1}')&&(s16.insertText.value.match(/>00/g)||[]).length===32&&s16.range.start.character===0,s16&&s16.insertText.value);
   ok('"sprite24x16" offers that size',typing('       sprite24x16').some(i=>i.label==='sprite 24x16'&&(i.insertText.value.match(/>00/g)||[]).length===48));
   ok('a size that cannot be is not offered',!typing('sprite0x5').some(i=>i.label==='sprite 0x5'));
   ok('"SPRITE" in capitals is a label, not a picture',typing('SPRITE').length===0);
   // every chip's starter code passes the checks
   const {loadFile,snippetPreview}=require('../lib/dialect');const {Project}=require('../lib/project');const F=require('../lib/features');
   for(const n of ['tms9900','z80','6502','bbc']){const D=loadFile(path.join(__dirname,'../dialects/'+n+'.json'));
     const prog=D.snippets.find(s=>s.key==='program');const rest=D.snippets.filter(s=>s!==prog).map(s=>s.preview).join('\n');
     ok(n+': has starter code',prog&&D.snippets.length===4,D.snippets.map(s=>s.key));if(!prog)continue;
     const PJ=new Project();PJ.set('/x/s.a99',snippetPreview(prog.text.replace('$0',()=>rest.replace(/\$/g,'\\$'))),D);const w=F.check(PJ,'/x/s.a99');
     ok(n+': starter code gives no warnings',w.length===0,w.map(x=>[x.line+1,x.message]));}
   // Retro ASM: Insert starter code
   const lines=game.getText().split(/\r?\n/);const inserted=[];
   const fake=(lineText)=>{const doc=Object.assign({},game,{lineAt:(i)=>({text:i===3?lineText:lines[i]})});return {document:doc,selection:{start:new Position(3,0),end:new Position(3,0),isEmpty:true},insertSnippet:async(sn,where)=>{inserted.push({sn,where});return true;}};};
   mock.window.activeTextEditor=fake('');let r1=await C['retroAsm.insertSnippet']();
   ok('insert starter code on a blank line',r1===true&&inserted[0].sn.value.includes('MOVB R1,@>8C00')&&inserted[0].where.start.line===3&&inserted[0].where.start.character===0,inserted[0]);
   mock.window.activeTextEditor=fake('       CLR  R0');await C['retroAsm.insertSnippet']();
   ok('insert starter code below a line that has code',inserted[1]&&inserted[1].sn.value.startsWith('\n')&&inserted[1].where.line===3&&inserted[1].where.character===14,inserted[1]);
   mock.window.activeTextEditor=null; }
 // checks
 await new Promise(r=>setTimeout(r,500));
 // explain + cheat sheet + notes + new chip
 mock.window.activeTextEditor={document:game,selection:{start:new Position(41,0),end:new Position(41,0),isEmpty:true}};
 await C['retroAsm.explainSelection']();const page=P.content.provideTextDocumentContent(mock.Uri.from({scheme:'retroasm-help',path:'/Plain English.md'}));ok('explain routine',page.includes('MN\\_FILL')&&page.includes('lines 38 to 69'),page.slice(0,80));
 await C['retroAsm.showReference']();const sheet=P.content.provideTextDocumentContent(mock.Uri.from({scheme:'retroasm-help',path:'/TMS9900 cheat sheet.md'}));ok('cheat sheet',sheet.includes('Jump if not equal')&&sheet.includes('Memory map'),sheet.length);
 await C['retroAsm.createNotesFile']();const nf=path.join(ws,'asm-notes.json');ok('notes file created',fs.existsSync(nf));
 const notes=JSON.parse(fs.readFileSync(nf,'utf8'));notes.registers={R9:'Frame counter'};notes.addresses={'>8322':'My note for the rover'};notes.files={'paddle.a99':{registers:{R5:'Bat X'}}};fs.writeFileSync(nf,JSON.stringify(notes));
 events.save.forEach(f=>f({uri:mock.Uri.file(nf)}));
 const hn=P.Hover.provideHover(mis,at(mis,'SOC  @SERVE,R9','R9'));ok('note from notes file',hn.contents[0].value.includes('Frame counter'),hn.contents[0].value);
 const hn2=P.Hover.provideHover(mis,at(mis,'MOVB R5,@SPRITE+1','R5'));ok('per-file note',hn2.contents[0].value.includes('Bat X'),hn2.contents[0].value);
 const hn3=P.Hover.provideHover(game,at(game,'MOVB @ONE_BYTE,@ROVER_FACE','ROVER_FACE'));ok('address note',hn3.contents.some(c=>c.value.includes('My note for the rover')),hn3.contents.map(c=>c.value));
 await C['retroAsm.newDialect']();const nd=path.join(ws,'asm-dialects','6809.json');ok('new chip file created',fs.existsSync(nd));
 // switch: mock quick pick picks the LAST item = the new 6809 chip, for .a99
 await C['retroAsm.switchDialect']();ok('switch chip remembered',settings.dialectByExtension&&settings.dialectByExtension['.a99']==='6809',settings.dialectByExtension);
 const h6=P.Hover.provideHover(game,at(game,'JMP  NOWHERE','JMP'));ok('tooltips now come from the new chip file',h6&&h6.contents[0].value.includes('Jump'),h6&&h6.contents[0].value);
 settings.dialectByExtension={};events.config.forEach(f=>f({affectsConfiguration:()=>true}));
 const hb=P.Hover.provideHover(game,at(game,'MOVB *R1+,@VDPWD','MOVB'));ok('and back to TMS9900',hb&&hb.contents[0].value.includes('Move byte'));
 C['retroAsm.reloadDialects']();
 const hz=P.Hover.provideHover(z,at(z,'djnz loop','djnz'));ok('z80 file uses z80',hz&&hz.contents[0].value.includes('DJNZ'),hz&&hz.contents[0].value);
 // ---- version 0.2 features ----
 const lens=P.CodeLens.provideCodeLenses(game);ok('summary line above routines',lens.some(l=>/Called from 1 place/.test(l.command.title))&&lens.some(l=>/bytes/.test(l.command.title))&&lens.some(l=>/Changes R0/.test(l.command.title)),lens.map(l=>l.command.title).slice(0,6));
 const ha=P.Hover.provideHover(game,at(game,'MOVB *R1+,@VDPWD','MOVB'));ok('address in tooltip',ha.contents.some(c=>/Address:.*A0/.test(c.value)),ha.contents.map(c=>c.value).slice(-2));
 const hp=P.Hover.provideHover(data,at(data,'BYTE >3C,>7E,>FF,>DB,>FF,>7E,>3C,>18','BYTE'));ok('picture in tooltip',hp.contents.some(c=>c.value.includes('██')),hp.contents.length);
 const editor={document:game,selection:{start:new Position(41,0),end:new Position(41,0),isEmpty:true},marks:null,setDecorations(t,m){this.marks=m;}};
 mock.window.visibleTextEditors=[editor];mock.window.activeTextEditor=editor;
 C['retroAsm.toggleAddresses']();ok('addresses beside the code',editor.marks&&editor.marks.some(m=>/^A0[0-9A-F]{2}$/.test(m.renderOptions.before.contentText)),editor.marks&&editor.marks.length);
 C['retroAsm.toggleAddresses']();ok('addresses hidden again',editor.marks&&editor.marks.length===0);
 // ---- version 0.3.1: safety ----
 const B=require('../lib/build');const S=require('../lib/skool');const {riskyPattern}=require('../lib/dialect');
 ok('a file name with a quote mark is refused for building',/can't be passed safely/.test(B.plan('/tmp/x" & touch evil & ".a99',{},'linux').error||''));
 ok('an ordinary file name is fine',!B.plan(path.join(ws,'game.a99'),{command:'echo ${fileBasename}'},'linux').error);
 ok('risky chip-file patterns are spotted',['(a+)+','(a|ab)*','(x*)*y','^(\\s*\\w+)+$','\\1'].every(r=>riskyPattern(r))&&['^R(1[0-5]|[0-9])$','^\\*R\\d+\\+?$','^(ab)+$'].every(r=>!riskyPattern(r)));
 fs.writeFileSync(path.join(ws,'asm-dialects','slow.json'),JSON.stringify({id:'slow',name:'Slow',registers:{names:['A'],pattern:'^(a+)+$'}}));
 mock.__.warnings.length=0;C['retroAsm.reloadDialects']();
 ok('a chip file with a risky pattern is not loaded, and you are told',mock.__.warnings.some(w=>/could not be read/.test(w)));
 fs.unlinkSync(path.join(ws,'asm-dialects','slow.json'));C['retroAsm.reloadDialects']();
 ok('a .skool label can only be a plain name',S.parseSkool('@label=NAME`](command:x)\nc$8000 ld a,1\n').entries[0].label==='NAME');
 // a folder that isn't trusted: tooltips work, build doesn't
 mock.workspace.isTrusted=false;
 const ht=P.Hover.provideHover(game,at(game,'MOVB *R1+,@VDPWD','MOVB'));ok('untrusted folder: tooltips still work',ht&&ht.contents.length>0);
 ok('untrusted folder: build is refused',await C['retroAsm.build']()===false&&mock.__.warnings.some(w=>/isn't trusted/.test(w)));
 {const infos=[],si=mock.window.showInformationMessage;mock.window.showInformationMessage=(m)=>{infos.push(m);};C['retroAsm.reloadDialects']();mock.window.showInformationMessage=si;ok('untrusted folder: its own chip files are not loaded',infos.some(m=>/TMS9900/.test(m))&&!infos.some(m=>/6809/.test(m)),infos);}
 mock.workspace.isTrusted=true;C['retroAsm.reloadDialects']();
 // a build script in the project: asked first, once
 if(process.platform!=='win32'){
  const sh=path.join(ws,'build.sh'),mark=path.join(ws,'ran.txt');fs.writeFileSync(sh,'echo ran > ran.txt\n');
  mock.__.warnings.length=0;mock.__.warnAnswer=undefined;
  let r=await C['retroAsm.build']();ok('a build.sh is not run if you say no',r===false&&!fs.existsSync(mark)&&mock.__.warnings.some(w=>/wants to run build\.sh/.test(w)),[r,mock.__.warnings]);
  mock.__.warnAnswer='Allow';r=await C['retroAsm.build']();ok('it runs once you allow it',r===true&&fs.existsSync(mark),r);
  fs.unlinkSync(mark);mock.__.warnings.length=0;mock.__.warnAnswer=undefined;
  r=await C['retroAsm.build']();ok('and you are not asked again',r===true&&fs.existsSync(mark)&&!mock.__.warnings.some(w=>/wants to run/.test(w)),[r,mock.__.warnings]);
  fs.writeFileSync(sh,'echo changed > ran.txt\n');fs.unlinkSync(sh);fs.unlinkSync(mark);state.clear();
  mock.__.inspect=(k)=>k==='build.askFirst'?{globalValue:false}:undefined;
  fs.writeFileSync(sh,'echo ran > ran.txt\n');r=await C['retroAsm.build']();ok('askFirst off in your own settings: no question',r===true&&fs.existsSync(mark));
  mock.__.inspect=(k)=>k==='build.askFirst'?{workspaceValue:false}:undefined;state.clear();fs.unlinkSync(mark);
  r=await C['retroAsm.build']();ok('a project cannot switch the question off for you',r===false&&!fs.existsSync(mark));
  mock.__.inspect=null;fs.unlinkSync(sh);
 }
 // ---- version 0.4: 6502 (Commodore 64, KickAssembler) ----
 const c64=makeDoc(path.join(ws,'c64demo.asm'),'retroasm');makeDoc(path.join(ws,'c64data.asm'),'retroasm');
 events.open.forEach(f=>f(c64));
 const c64text=(doc,needle,sub)=>{const hv=P.Hover.provideHover(doc,at(doc,needle,sub));return hv?hv.contents.map(c=>c.value).join('\n'):'';};
 ok('.asm files use the 6502 chip',/Load A/.test(c64text(c64,'lda #BLACK','lda')),c64text(c64,'lda #BLACK','lda'));
 ok('built-in colour names have their values',/the number BLACK \(0\)/.test(c64text(c64,'lda #BLACK','lda')));
 ok('6502: address plus X explained',/the byte at SCREEN \(\$0400\) \+ X/.test(c64text(c64,'!loop:  sta SCREEN,x','sta')));
 ok('6502: zero-page pointer explained',/Y places past the address stored at ptr \(\$FB\)/.test(c64text(c64,'lda (ptr),y','lda')));
 ok('6502: low byte of an address',/low byte of the address of irq/.test(c64text(c64,'lda #<irq','lda')));
 ok('6502: branch after a compare',/if X is not equal to the number 250/.test(c64text(c64,'bne !loop-','bne')));
 ok('6502: C64 hardware address explained',/Background colour/.test(c64text(c64,'sta $D021','$D021')));
 ok('KickAssembler .const is found',/\$D020/.test(c64text(c64,'sta BORDER','BORDER')));
 const dc=P.Definition.provideDefinition(c64,at(c64,'sta BORDER','BORDER'));ok('go to a .const',dc.length===1&&dc[0].range.start.line===2,dc);
 const df=P.Definition.provideDefinition(c64,at(c64,'dec frame','frame'));ok('go to a label in an #import file',df.length===1&&df[0].uri.fsPath.endsWith('c64data.asm'),df);
 ok('6502: addresses and sizes worked out',/\$0847 · 21 bytes/.test(P.CodeLens.provideCodeLenses(c64).map(l=>l.command.title).join('\n')),P.CodeLens.provideCodeLenses(c64).map(l=>l.command.title));
 const outline=P.DocumentSymbol.provideDocumentSymbols(c64).map(s=>s.name);
 ok('outline shows routines and the macro, not macro values or loop counters',['start','clear_screen','print_title','irq','setColours','colours'].every(n=>outline.includes(n))&&!outline.includes('edge')&&!outline.includes('i'),outline);
 await new Promise(r=>setTimeout(r,700));
 const c64warn=mock.__.collections.find(c=>c.name==='retroasm').get(c64.uri);ok('the made-up C64 program gives no warnings',c64warn.length===0,c64warn.map(d=>[d.range.start.line+1,d.message]));
 // a branch that can't reach
 const farFile=path.join(ws,'far.asm');fs.writeFileSync(farFile,'*=$1000\nstart:  nop\n        .fill 200, 0\n        bne start\n        rts\n');
 const far=makeDoc(farFile,'retroasm');events.open.forEach(f=>f(far));await new Promise(r=>setTimeout(r,700));
 const fw=mock.__.collections.find(c=>c.name==='retroasm').get(far.uri);ok('6502: a branch that is too far is spotted',fw.some(d=>/203 bytes back/.test(d.message)&&/JMP start/.test(d.message)),fw.map(d=>d.message));
 // ---- version 0.5: Z80 (ZX Spectrum) ----
 const zx=makeDoc(path.join(ws,'zxdemo.asm'),'retroasm');makeDoc(path.join(ws,'zxdata.asm'),'retroasm');
 events.open.forEach(f=>f(zx));
 const zt=(needle,sub)=>{const hv=P.Hover.provideHover(zx,at(zx,needle,sub));return hv?hv.contents.map(c=>c.value).join('\n'):'';};
 ok('an .asm file full of Z80 code is read as Z80',/\*\*LD\*\* — Load/.test(zt('ld hl,ATTRS','ld')),zt('ld hl,ATTRS','ld'));
 ok('the 6502 .asm file next to it is still 6502',/Load A/.test(c64text(c64,'lda #BLACK','lda')));
 ok('Z80: addresses and sizes worked out',/\$8000 · 66 bytes/.test(P.CodeLens.provideCodeLenses(zx).map(l=>l.command.title).join('\n')),P.CodeLens.provideCodeLenses(zx).map(l=>l.command.title));
 ok('Z80: size of an IX instruction',/Address:\* \$8022 · 4 bytes/.test(zt('ld (ix+2),SPEED','ld')),zt('ld (ix+2),SPEED','ld'));
 ok('Z80: jump after a compare',/Jump to \.done if A is greater than or equal to 'Q' \(81\)/.test(zt('jr nc,.done','jr')),zt('jr nc,.done','jr'));
 ok('Z80: jump after a bit test',/if bit 0 of A was 0/.test(zt('jr z,.left','jr')));
 ok('Z80: conditional return after OR',/Return if A is 0/.test(zt('ret z','ret')),zt('ret z','ret'));
 ok('Z80: border colour sent to port $FE',/border red/.test(zt('ld a,2','2')),zt('ld a,2','2'));
 ok('Z80: keyboard row read through port $FE',/Q W E R T/.test(zt('ld a,$fb','$fb')),zt('ld a,$fb','$fb'));
 ok('Z80: the port itself explained',/the ULA/.test(zt('out ($fe),a','$fe')));
 ok('Z80: a system variable explained',/LAST-K/.test(zt('.done:  ld a,(LAST_K)','LAST_K')));
 ok('Z80: a ROM routine named in the sentence',/8252 \(\$203C, PR-STRING\)/.test(zt('call 8252','call')),zt('call 8252','call'));
 ok('Z80: a ROM routine explained on its number',/BEEPER/.test(zt('call 949','949')));
 ok('Z80: AF\' is a register, and the comment after it still a comment',/spare copy of A/.test(zt("ex af,af'","af'")));
 ok('Z80: a character in single quotes',/As a letter \| `Q`/.test(zt("cp 'Q'","'Q'")),zt("cp 'Q'","'Q'"));
 const dl=P.Definition.provideDefinition(zx,at(zx,'jr z,.left','.left'));ok('Z80: go to a local .label',dl.length===1&&dl[0].range.start.line===35,dl);
 const ol=P.DocumentSymbol.provideDocumentSymbols(zx).map(s=>s.name);ok('Z80: local labels sit inside their routine in the outline',ol.includes('start')&&ol.includes('beep')&&!ol.includes('.left'),ol);
 { const zdat=mock.workspace.textDocuments.find(x=>x.uri.fsPath.endsWith('zxdata.asm'));const hv=P.Hover.provideHover(zdat,at(zdat,'DEFM "Catch"','DEFM'));
   ok('Z80: DEFM with numbers between the words',/\$8051 · 15 bytes/.test(hv?hv.contents.map(c=>c.value).join('\n'):''),hv&&hv.contents.map(c=>c.value)); }
 { const {parseLine}=require('../lib/parser');const {loadFile}=require('../lib/dialect');const z80=loadFile(path.join(__dirname,'../dialects/z80.json'));
   const pl=parseLine("  ex af,af'   ; swap 'em",z80);ok("Z80: the comment after AF' is still a comment",pl.operands.length===2&&pl.comment&&pl.comment.text==="; swap 'em",pl); }
 await new Promise(r=>setTimeout(r,700));
 const zxw=mock.__.collections.find(c=>c.name==='retroasm').get(zx.uri);ok('the made-up Spectrum program gives no warnings',zxw.length===0,zxw.map(d=>[d.range.start.line+1,d.message]));
 { // short jumps that can't reach, and a test JR can't do
  const zf=path.join(ws,'zfar.asm');fs.writeFileSync(zf,'  ORG 32768\nstart:  nop\n  DEFS 200\n  jr nz,start\n  djnz start\n  jr pe,start\n  ret\n');
  const zd=makeDoc(zf,'retroasm');events.open.forEach(f=>f(zd));await new Promise(r=>setTimeout(r,700));
  const w=mock.__.collections.find(c=>c.name==='retroasm').get(zd.uri).map(d=>d.message);
  ok('Z80: a JR that is too far is spotted',w.some(m=>/start is too far away for JR: it is 203 bytes back/.test(m)&&/Use JP/.test(m)),w);
  ok('Z80: a DJNZ that is too far is spotted',w.some(m=>/too far away for DJNZ/.test(m)&&/DEC B then JP NZ,start/.test(m)),w);
  ok('Z80: JR PE is spotted',w.some(m=>/JR can only test NZ, Z, NC or C, not PE/.test(m)),w);
 }
 { // after RST $28 come the ROM calculator's bytes, which a disassembler shows as instructions
  const zc=path.join(ws,'zcalc.asm');fs.writeFileSync(zc,'  ORG 32768\nstart:  call $2d28\n  rst $28\n  and h\n  dec b\n  jr c,$ab32\n  ret\nmore:  rst $28\n  DEFB $a4,$05,$38\n  ret\n');
  const zd=makeDoc(zc,'retroasm');events.open.forEach(f=>f(zd));await new Promise(r=>setTimeout(r,700));
  const w=mock.__.collections.find(c=>c.name==='retroasm').get(zd.uri);ok('Z80: no warning on the calculator\'s bytes after RST $28',w.length===0,w.map(d=>[d.range.start.line+1,d.message]));
  const ht=(n,s)=>{const hv=P.Hover.provideHover(zd,at(zd,n,s));return hv?hv.contents.map(c=>c.value).join('\n'):'';};
  ok('Z80: RST $28 says the lines after it are calculator data',/ROM calculator/.test(ht('  rst $28','rst'))&&/not instructions/.test(ht('  rst $28','rst')),ht('  rst $28','rst'));
  ok('Z80: a calculator byte says it is data, not an instruction',/Data for the ROM calculator, not an instruction/.test(ht('and h','and')),ht('and h','and'));
  ok('Z80: the JR C that ends the list says it swallowed a byte',/end-calc/.test(ht('jr c,$ab32','jr'))&&/second byte/.test(ht('jr c,$ab32','jr')));
  ok('Z80: real code after the list is explained again',/Return to the caller/.test(ht('  ret','ret')),ht('  ret','ret'));
  const lz=P.CodeLens.provideCodeLenses(zd).map(l=>l.command.title).join('\n');ok('Z80: the calculator bytes don\'t count as changing registers',!/Changes/.test(lz)||!/\bB\b/.test(lz),lz);
 }
 { // every ROM routine and system variable is known, and points inside routines too
  const {loadFile}=require('../lib/dialect');const {Project}=require('../lib/project');const F=require('../lib/features');
  const z80=loadFile(path.join(__dirname,'../dialects/z80.json'));const PJ=new Project();
  PJ.set('/x/rom.asm','  ORG 32768\n  call $0c3b\n  call $0077\n  ld a,($5c3b)\n  ld bc,$0800\n  ret\n',z80);
  const hv=(l,c)=>{const h=F.hoverAt(PJ,'/x/rom.asm',l,c);return h?h.parts.join('\n'):'';};
  ok('Z80: any ROM routine is named (PO-SAVE)',/\*\*PO-SAVE\*\* \(ROM routine\)/.test(hv(1,9)),hv(1,9));
  ok('Z80: a point inside a ROM routine is named',/inside the ROM routine CH-ADD\+1/.test(hv(2,9)),hv(2,9));
  ok('Z80: any system variable is named (FLAGS)',/\*\*FLAGS\*\* \(system variable, 23611\)/.test(hv(3,9)),hv(3,9));
  ok('Z80: a plain count isn\'t mistaken for a ROM address',!/ROM/.test(hv(4,10)),hv(4,10));
  ok('Z80: the cheat sheet lists ROM routines but not the points inside them',(()=>{const s=require('../lib/explain').referenceSheet(z80);return /PO-SAVE/.test(s)&&!/TEMP-PTR1/.test(s);})());
 }
 { // the assembler's error messages (sjasmplus)
  const B=require('../lib/build');
  const out=B.parseOutput('zxdemo.asm(33): error: Label not found: nowhere\nzxdemo.asm(35): warning[rdlow]: Reading memory at low address\n',ws);
  ok('sjasmplus errors are read',out.length===2&&out[0].line===32&&out[0].severity==='error'&&/Label not found/.test(out[0].message)&&out[1].severity==='warning',out);
  const {loadFile}=require('../lib/dialect');const z80=loadFile(path.join(__dirname,'../dialects/z80.json'));
  const pl=B.plan(path.join(ws,'zxdemo.asm'),{},'linux',z80);ok('Z80 with no build command: says how to set one up',/sjasmplus/.test(pl.error||''),pl);
 }
 { // ---- version 0.6: the side panel ----
  const V=mock.__.views;
  ok('side panel: all five sections are registered',['retroAsm.project','retroAsm.thisLine','retroAsm.registers','retroAsm.memoryMap','retroAsm.hardware'].every(id=>V[id]),Object.keys(V));
  const look=(doc,needle)=>{const p=at(doc,needle);mock.window.activeTextEditor={document:doc,selection:{active:p,start:p,end:p,isEmpty:true}};return api.panelNow();};
  let s=look(game,'BL   @SET_VIDEO');
  ok('side panel: this line in plain English',/Call the routine SET_VIDEO/.test(s.thisLine)&&/Branch and link/.test(s.thisLine)&&/Inside routine/.test(s.thisLine),s.thisLine);
  ok('side panel: this line shows its address and size',/&gt;A0[0-9A-F]{2}<\/code> · 4 bytes/.test(s.thisLine),s.thisLine);
  ok('side panel: memory map shows where the program sits',/Your program: <b>\d+ bytes<\/b>, from <code>&gt;A000<\/code>/.test(s.memoryMap)&&/the video chip \(writing\)/.test(s.memoryMap)&&/still free/.test(s.memoryMap),s.memoryMap);
  ok('side panel: memory map marks the hardware used',/class="hw"/.test(s.memoryMap)&&/addresses? used/.test(s.memoryMap));
  { const R=V['retroAsm.registers'];const kids=R.getChildren();const items=kids.map(x=>R.getTreeItem(x));
    ok('side panel: the Registers section lists the registers at the cursor',kids.length>=2&&items.some(t=>t.label==='Registers'),items.map(t=>t.label));
    ok('side panel: the Registers section is in the package file with a welcome message',(()=>{const j=JSON.parse(fs.readFileSync(path.join(__dirname,'../package.json'),'utf8'));return j.contributes.views.retroAsm.some(v=>v.id==='retroAsm.registers')&&j.contributes.viewsWelcome.some(w=>w.view==='retroAsm.registers');})()); }
  ok('side panel: project shows the chip, files and warnings',s.project[0].label.startsWith('TMS9900')&&s.project.some(n=>/^Files \(2\)/.test(n.label)&&n.children.some(c=>c.label==='data.a99'))&&s.project.some(n=>/warning|No warnings/.test(n.label)),s.project.map(n=>n.label));
  ok('side panel: names nothing uses are listed',s.project.some(n=>/^Never used/.test(n.label)&&n.children.some(c=>c.label==='PATTAB')),s.project.map(n=>n.label));
  const vid=s.hardware.find(g=>/video chip \(writing\)/i.test(g.label));
  ok('side panel: hardware used lists the video chip and where',vid&&vid.children.some(c=>c.label==='VDPWD'&&c.children.length>=1&&c.children[0].goto),s.hardware.map(g=>[g.label,g.children.map(c=>c.label)]));
  s=look(game,'; Load the video');
  ok('side panel: a comment line',/A comment/.test(s.thisLine)||/Load the video/.test(s.thisLine),s.thisLine);
  s=look(c64,'jsr clear_screen');
  ok('side panel: C64 hardware (border colour)',s.hardware.some(g=>g.children.some(c=>c.label==='BORDER'&&/\$D020/.test(c.description))),s.hardware.map(g=>[g.label,g.children.map(c=>c.label+' '+c.description)]));
  ok('side panel: a 6502 number with # is not counted as an address',!s.hardware.some(g=>g.children.some(c=>c.uses===0)));
  s=look(zx,'ld de,title');
  ok('side panel: Spectrum ROM routines and ports',s.hardware.some(g=>g.children.some(c=>c.label==='CLS'))&&s.hardware.some(g=>/Ports/.test(g.label)&&g.children.some(c=>/ULA/.test(c.label))),s.hardware.map(g=>[g.label,g.children.map(c=>c.label)]));
  ok('side panel: Spectrum memory map',/from <code>\$8000<\/code>/.test(s.memoryMap),s.memoryMap.slice(0,300));
  // the web pages themselves: locked down, nothing loaded from outside
  const posted=[];const fake={visible:true,webview:{options:null,html:'',cspSource:'vscode-resource:',onDidReceiveMessage(f){this.recv=f;},postMessage(m){posted.push(m);}},onDidChangeVisibility(){},onDidDispose(){}};
  V['retroAsm.thisLine'].resolveWebviewView(fake);
  const html=fake.webview.html;
  ok('side panel: the page blocks anything from outside',/default-src 'none'/.test(html)&&/script-src 'nonce-/.test(html)&&!/https?:\/\//.test(html)&&fake.webview.options.localResourceRoots.length===0,html.slice(0,400));
  { const ran=[];const orig=mock.commands.executeCommand;mock.commands.executeCommand=async(n)=>{ran.push(n);};
    fake.webview.recv({type:'command',id:'workbench.action.terminal.new'});fake.webview.recv({type:'command',id:'retroAsm.showReference'});fake.webview.recv('junk');
    mock.commands.executeCommand=orig;
    ok('side panel: the page can only run Retro ASM commands',ran.length===1&&ran[0]==='retroAsm.showReference',ran); }
  ok('side panel: going to a file outside the program is refused',(await C['retroAsm.panel.goto']('/etc/passwd',0))===false);
  ok('side panel: going to a line of the program works',(await C['retroAsm.panel.goto'](game.uri.fsPath,30))===true);
  const t=V['retroAsm.project'].getChildren();const ti=t.map(x=>V['retroAsm.project'].getTreeItem(x));
  ok('side panel: tree items build',t.length>3&&ti[0].label.startsWith('Z80')&&ti[0].iconPath&&ti.some(x=>x.collapsibleState===mock.TreeItemCollapsibleState.Expanded),t.map(x=>x.label));
  // nothing in the extension reaches the internet or an AI service
  const src=[path.join(__dirname,'..','extension.js'),...fs.readdirSync(path.join(__dirname,'..','lib')).map(f=>path.join(__dirname,'..','lib',f))].map(f=>fs.readFileSync(f,'utf8')).join('\n');
  ok('no internet: no http, https, net or fetch in the code',!/require\(['"](https?|net|tls|http2|dgram)['"]\)|\bfetch\(|XMLHttpRequest|WebSocket/.test(src));
  ok('no AI keys or services in the code',!/api[_-]?key|openai|anthropic|claude|gemini|copilot|languageModel|\blm\./i.test(src));
  mock.window.activeTextEditor=editor;
 }
 { // ---- version 0.7: 6502 (BBC Micro, BeebAsm) ----
  const bbc=makeDoc(path.join(ws,'bbcdemo.6502'),'retroasm');makeDoc(path.join(ws,'bbcdata.6502'),'retroasm');
  events.open.forEach(f=>f(bbc));
  const bt=(needle,sub)=>{const hv=P.Hover.provideHover(bbc,at(bbc,needle,sub));return hv?hv.contents.map(c=>c.value).join('\n'):'';};
  { // an empty .6502 file has no code to look at: it is BBC code (its usual ending), not C64
    const ef=path.join(ws,'empty.6502');fs.writeFileSync(ef,'');const ed=makeDoc(ef,'retroasm');events.open.forEach(f=>f(ed));
    mock.window.activeTextEditor={document:ed,selection:{active:new Position(0,0),start:new Position(0,0),end:new Position(0,0),isEmpty:true}};
    ok('an empty .6502 file is read as BBC Micro',api.panelNow().project[0].label.startsWith('6502 (BBC Micro'),api.panelNow().project[0].label);
    // a new file with no extension: Switch chip is used for it now, instead of being thrown away
    const u={isDirty:true,save:async()=>true,uri:mock.Uri.from({scheme:'untitled',path:'Untitled-9'}),languageId:'retroasm',getText:()=>'',lineCount:1,lineAt:()=>({text:''})};
    mock.__.docs.push(u);events.open.forEach(f=>f(u));
    mock.window.activeTextEditor={document:u,selection:{active:new Position(0,0),start:new Position(0,0),end:new Position(0,0),isEmpty:true}};
    const before=api.panelNow().project[0].label;await C['retroAsm.switchDialect']();const after=api.panelNow().project[0].label;
    ok('Switch chip works on a new file with no extension',after!==before&&/6809/.test(after),[before,after]);
    mock.window.activeTextEditor=null; }
  ok('.6502 files written the BeebAsm way use the BBC Micro chip',(()=>{const p=at(bbc,'JSR print');mock.window.activeTextEditor={document:bbc,selection:{active:p,start:p,end:p,isEmpty:true}};return api.panelNow().project[0].label;})().startsWith('6502 (BBC Micro'),api.panelNow().project[0].label);
  ok('BBC: the first statement on a line ("LDA #22:JSR oswrch")',/Put the number 22 \(&16\) into A/.test(bt('LDA #22:JSR oswrch','LDA'))&&/Address:\* &1900 · 2 bytes/.test(bt('LDA #22:JSR oswrch','LDA')),bt('LDA #22:JSR oswrch','LDA'));
  ok('BBC: the second statement on the same line',/Call the routine oswrch \(&FFEE\)/.test(bt('LDA #22:JSR oswrch','JSR'))&&/Address:\* &1902 · 3 bytes/.test(bt('LDA #22:JSR oswrch','JSR')),bt('LDA #22:JSR oswrch','JSR'));
  ok('BBC: a branch explained from the statement before it on the line',/Jump to wait if X is not 0/.test(bt('DEX:BNE wait','BNE')),bt('DEX:BNE wait','BNE'));
  ok('BBC: an OS call explained',/OSWRCH\*\* \(OS routine\)/.test(bt('oswrch = &FFEE','&FFEE')),bt('oswrch = &FFEE','&FFEE'));
  ok('BBC: a name set with = is found',/oswrch\*\* = &FFEE/.test(bt('LDA #7:JSR oswrch','oswrch')),bt('LDA #7:JSR oswrch','oswrch'));
  ok('BBC: LO() of an address',/low byte of the address of addr/.test(bt('LDA #LO(addr)','LDA')));
  ok('BBC: a macro call is sized from the macro (8 bytes)',/Address:\* &1912 · 3 bytes/.test(bt('JSR print','JSR')),bt('JSR print','JSR'));
  ok('BBC: FALSE in an IF leaves the lines out',/the test is false/.test(bt('IF debug','IF'))&&/Left out of the program/.test(bt('LDA #&41:JSR oswrch','LDA'))&&/Address:\* &191F · 1 byte/.test(bt('NOP','NOP')),[bt('IF debug','IF'),bt('NOP','NOP')]);
  ok('BBC: FOR ... NEXT puts its lines in 8 times',/Address:\* &194A/.test(bt('.speeds','speeds')),bt('.speeds','speeds'));
  ok('BBC: a letter in single quotes',/As a letter \| `A`/.test(bt("'A'","'A'")));
  const dl=P.Definition.provideDefinition(bbc,at(bbc,'BNE loop','loop'));ok('BBC: .loop in a { } scope goes to its own .loop, not another routine\'s',dl.length===1&&dl[0].range.start.line===45,dl.map(d=>d.range.start.line+1));
  const dl2=P.Definition.provideDefinition(bbc,at(bbc,'CPX #16:BNE loop','loop'));ok('BBC: and the other .loop goes to the second one',dl2.length===1&&dl2[0].range.start.line===58,dl2.map(d=>d.range.start.line+1));
  const dt=P.Definition.provideDefinition(bbc,at(bbc,'SETPTR title','title'));ok('BBC: go to a label in an INCLUDE file',dt.length===1&&dt[0].uri.fsPath.endsWith('bbcdata.6502'),dt);
  const ren=P.Rename.provideRenameEdits(bbc,at(bbc,'BEQ done','done'),'finished');ok('BBC: rename a label in a scope changes just that scope',ren.edits.length===2,ren.edits.length);
  const lens=P.CodeLens.provideCodeLenses(bbc).map(l=>l.command.title).join('\n');
  ok('BBC: summary lines with addresses and sizes',/&1900 · 33 bytes/.test(lens)&&/&1921 · 13 bytes/.test(lens)&&/Changes A, Y/.test(lens),lens);
  const outl=P.DocumentSymbol.provideDocumentSymbols(bbc);ok('BBC: outline shows routines, with their own .loop inside',outl.some(s=>s.name==='print'&&s.children.some(c=>c.name==='loop'))&&outl.some(s=>s.name==='SETPTR'),outl.map(s=>s.name));
  const tk=P.DocumentSemanticTokens.provideDocumentSemanticTokens(bbc);ok('BBC: colours',tk.data.length>60,tk.data.length);
  await new Promise(r=>setTimeout(r,700));
  const bw=mock.__.collections.find(c=>c.name==='retroasm').get(bbc.uri);ok('the made-up BBC program gives no warnings',bw.length===0,bw.map(d=>[d.range.start.line+1,d.message]));
  // side panel on a line with two statements: the one under the cursor
  { const p=at(bbc,'LDA #22:JSR oswrch','JSR');mock.window.activeTextEditor={document:bbc,selection:{active:p,start:p,end:p,isEmpty:true}};const s=api.panelNow();
    ok('BBC side panel: the statement under the cursor',/Jump to subroutine/.test(s.thisLine)&&/&amp;1902<\/code> · 3 bytes/.test(s.thisLine),s.thisLine);
    ok('BBC side panel: the memory map starts at &1900',/from <code>&amp;1900<\/code>/.test(s.memoryMap),s.memoryMap.slice(0,400));
    ok('BBC side panel: OS calls are listed as hardware used',s.hardware.some(g=>g.children.some(c=>c.label==='OSWRCH')),s.hardware.map(g=>[g.label,g.children.map(c=>c.label)])); }
  // typing after a colon suggests instructions
  { const lines=bbc.getText().split(/\r?\n/);const text='    LDA #1:ST';lines[lines.length-1]=text;const doc=Object.assign({},bbc,{lineAt:(i)=>({text:i===lines.length-1?text:lines[i]})});
    const c=P.CompletionItem.provideCompletionItems(doc,new Position(lines.length-1,text.length));ok('BBC: suggestions for the statement after a colon',c.some(i=>i.label==='STA'),c.length); }
  // hardware, a branch that is too far, and IF/ELSE with the same name in both halves
  { const f=path.join(ws,'bbcfar.6502');fs.writeFileSync(f,'ORG &2000\n.start NOP\n  SKIP 200\n  BNE start\n  LDA #&7F:STA &FE4E\nIF TRUE\n  speed = 2\nELSE\n  speed = 4\nENDIF\n  LDA #speed\n  RTS\n');
    const d=makeDoc(f,'retroasm');events.open.forEach(x=>x(d));await new Promise(r=>setTimeout(r,700));
    const w=mock.__.collections.find(c=>c.name==='retroasm').get(d.uri).map(x=>x.message);
    ok('BBC: a branch that is too far is spotted',w.some(m=>/start is too far away for BNE: it is 203 bytes back/.test(m)),w);
    ok('BBC: a name set in both halves of an IF is not a mistake',!w.some(m=>/more than once/.test(m)),w);
    const hv=P.Hover.provideHover(d,at(d,'STA &FE4E','&FE4E'));ok('BBC: SHEILA hardware explained',hv&&/System VIA interrupt enable/.test(hv.contents.map(c=>c.value).join('\n')));
    const hs=P.Hover.provideHover(d,at(d,'LDA #speed','LDA'));ok('BBC: the IF half that is used gives the value',hs&&/the number speed \(2\)/.test(hs.contents.map(c=>c.value).join('\n')),hs&&hs.contents.map(c=>c.value)); }
  // building with BeebAsm, and starting BeebEm
  { const B=require('../lib/build');const {loadFile}=require('../lib/dialect');const bD=loadFile(path.join(__dirname,'../dialects/bbc.json'));
    const out=B.parseOutput('bbcdemo.6502:30: error: Branch out of range.\n',ws);
    ok('BeebAsm errors are read',out.length===1&&out[0].line===29&&out[0].severity==='error'&&/out of range/.test(out[0].message),out);
    const none=B.plan(path.join(ws,'bbcdemo.6502'),{},'linux',bD,{saveName:'DEMO'});ok('BBC with no BeebAsm: says how to set it up',/beebasm/i.test(none.error||'')||/beebasm/i.test(none.how||''),none);
    const tool=path.join(ws,'beebasm');fs.writeFileSync(tool,'#!/bin/sh\necho fake\n');fs.chmodSync(tool,0o755);
    const pl=B.plan(path.join(ws,'bbcdemo.6502'),{},'linux',bD,{saveName:'DEMO'});
    ok('BeebAsm next to the source is used, making a disc that starts the program',pl.command===`"${tool}" -i "bbcdemo.6502" -do "bbcdemo.ssd" -boot "DEMO"`&&pl.fromProject===true,pl);
    const pl2=B.plan(path.join(ws,'bbcdemo.6502'),{},'linux',bD,{});ok('with no SAVE name there is no -boot, and a note says why',!/-boot/.test(pl2.command)&&/SAVE/.test(pl2.note),pl2);
    fs.mkdirSync(path.join(ws,'BeebEm'));fs.writeFileSync(path.join(ws,'BeebEm','BeebEm.exe'),'');
    const rn=B.findRunner(path.join(ws,'bbcdemo.6502'),{},'win32',bD);ok('BeebEm near the source is started with the disc',rn&&rn.exe==='BeebEm.exe'&&rn.args.length===1&&rn.args[0].endsWith('bbcdemo.ssd')&&rn.fromProject,rn);
    { // a whole build through the extension, with a stand-in for BeebAsm that notes what it was given
      fs.writeFileSync(tool,'#!/bin/sh\necho "$@" > beebasm-args.txt\n');fs.chmodSync(tool,0o755);
      const p=at(bbc,'JSR print');mock.window.activeTextEditor={document:bbc,selection:{active:p,start:p,end:p,isEmpty:true}};
      mock.__.warnAnswer='Allow';const r=await C['retroAsm.build']();mock.__.warnAnswer=undefined;
      const args=fs.existsSync(path.join(ws,'beebasm-args.txt'))?fs.readFileSync(path.join(ws,'beebasm-args.txt'),'utf8'):'';
      ok('BBC: Build runs BeebAsm with the name from the SAVE line',r===true&&/-i bbcdemo\.6502 -do bbcdemo\.ssd -boot DEMO/.test(args),[r,args]);
      fs.unlinkSync(tool); }
    const real=process.env.BEEBASM;
    if(real&&fs.existsSync(real)){const cp=require('child_process');const r=cp.spawnSync(process.execPath,[path.join(__dirname,'beebasm-check.js'),path.join(ws,'bbcdemo.6502'),real],{encoding:'utf8'});ok('BBC: every label\'s address matches real BeebAsm',r.status===0,r.stdout+r.stderr);}
    else console.log('skip BeebAsm address check (set BEEBASM to the path of beebasm to run it)'); }
  mock.window.activeTextEditor=editor;
 }
 { // 0.7.1: @reg notes work with each chip's own comment mark, and the tip shows that mark
  const {loadFile}=require('../lib/dialect');const {Project}=require('../lib/project');const F=require('../lib/features');
  for(const [c,src,reg,col] of [['6502','// @reg X = enemy count\nstart: lda $10,X\n','X',15],['bbc','\\ @reg X = enemy count\n.start LDA &10,X\n','X',15],['z80','; @reg B = enemy count\nstart: ld b,3\n','B',10],['tms9900','; @reg R4 = enemy count\nSTART  LI   R4,3\n       END\n','R4',12]]){
   const D=loadFile(path.join(__dirname,'../dialects',c+'.json'));const PJ=new Project();PJ.set('/x/n.s',src,D);
   const h=F.hoverAt(PJ,'/x/n.s',1,col);ok(`${c}: @reg note shows on the register`,h&&h.parts.some(x=>/enemy count/.test(x)),h&&h.parts);
   PJ.set('/x/m.s',src.split('\n').slice(1).join('\n'),D);const t=F.hoverAt(PJ,'/x/m.s',0,col);
   const mark=D.syntax.lineComment[0];ok(`${c}: the @reg tip uses this chip's comment mark`,t&&t.parts.some(x=>x.includes(mark+' @reg')),t&&t.parts);
  }
 }
 { // 0.8.0: how long each instruction takes (cycles), on all four chips
  const {loadFile}=require('../lib/dialect');const {Project}=require('../lib/project');const F=require('../lib/features');const X=require('../lib/explain');const PN=require('../lib/panel');
  const time=(chip,src,needle)=>{const D=loadFile(path.join(__dirname,'../dialects',chip+'.json'));const PJ=new Project();PJ.set('/x/t.s',src,D);const m=PJ.get('/x/t.s');
   const ln=src.split('\n').findIndex(l=>l.includes(needle));const pl=m.lines[ln];return X.timeFor(D.instr(pl.mnem.upper),pl,F.makeCtx(PJ,'/x/t.s'),ln);};
  const same=(a,b)=>JSON.stringify([...new Set(a)].sort((x,y)=>x-y))===JSON.stringify(b);
  // TMS9900: the data manual's numbers, worked out by hand (instruction + each operand's extra)
  const ti='       AORG >A000\nSTART  MOV  @X,@Y\n       MOVB *R1+,R2\n       MOV  R1,R2\n       CLR  *R1\n       JNE  START\n       SLA  R1,4\n       SRL  R1,0\n       STCR *R2,8\n       LDCR @X,3\n       BLWP @X\n       LI   R1,5\n       RT\n       DIV  R1,R2\nX      DATA 0\nY      DATA 0\n       END\n';
  for(const [needle,c,m] of [['MOV  @X,@Y',[30],6],['MOVB *R1+',[20],6],['MOV  R1,R2',[14],4],['CLR  *R1',[14],4],['JNE',[8,10],1],['SLA',[20],3],['STCR',[48],5],['LDCR',[34],4],['BLWP',[34],7],['LI   R1,5',[12],3],['       RT',[12],3],['DIV',[16,92,124],6]]){
   const t=time('tms9900',ti,needle);ok(`tms9900 time: ${needle.trim()} = ${c.join('/')} cycles, ${m} memory uses`,t&&same(t.values,c)&&t.access===m,t);
  }
  const t0=time('tms9900',ti,'SRL  R1,0');ok('tms9900 time: a shift by R0 says the count comes from R0',t0&&/from R0/.test(t0.text)&&t0.access===4,t0);
  ok('tms9900 time: slow memory is spelled out',/up to 24 more in slow memory/.test(time('tms9900',ti,'MOV  @X,@Y').text));
  // C64: 6502 data sheet
  const c64='  *=$0801\nstart: lda #5\n  lda $fb\n  lda $d020,x\n  sta $0400,y\n  jmp ($0314)\n  inc $d020\n  dec $d020\n  bne start\n  ldx $fb,y\n  lda $fb,y\n  lda ($fb),y\n  asl\n  rts\n';
  for(const [needle,c] of [['lda #5',[2]],['lda $fb\n',[3]],['lda $d020,x',[4,5]],['sta $0400,y',[5]],['jmp ($0314)',[5]],['inc $d020',[6]],['dec $d020',[6]],['bne start',[2,3]],['ldx $fb,y',[4]],['lda $fb,y',[4,5]],['lda ($fb),y',[5,6]],['asl',[2]],['rts',[6]]]){
   const t=time('6502',c64,needle.replace('\n',''));ok(`6502 time: ${needle.trim()} = ${c.join('/')}`,t&&same(t.values,c),t);
  }
  ok('6502 time: a branch says when it takes longer',/3 if it does \(4 if it jumps into another page/.test(time('6502',c64,'bne start').text));
  // BBC: 65C02 extras, the Master's different timings and the half-speed hardware
  const bbc='CPU 1\nORG &1900\n.start LDA (&70)\n  JMP (&20E)\n  LDA &FE4E\n  STZ &70\n  BRA start\n  LDA &3000\n';
  for(const [needle,c] of [['LDA (&70)',[5]],['JMP (&20E)',[5]],['STZ',[3]],['BRA',[3]],['LDA &3000',[4]]]){const t=time('bbc',bbc,needle);ok(`bbc time: ${needle} = ${c.join('/')}`,t&&same(t.values,c),t);}
  ok('bbc time: the Master\'s 65C02 number is given too',/On the BBC Master's 65C02: 6 cycles/.test(time('bbc',bbc,'JMP (&20E)').text));
  ok('bbc time: hardware at &FE4E is slower',/half speed/.test(time('bbc',bbc,'LDA &FE4E').text)&&!/half speed/.test(time('bbc',bbc,'LDA &3000').text));
  // Spectrum: jumps, repeats and contended memory (test/z80-cycle-check.py checks every form against SkoolKit)
  const zx='  ORG 32768\nstart: ld a,(ix+3)\n  jr nz,start\n  ldir\n  ld (23560),a\n  call 24000\n';
  ok('z80 time: LD A,(IX+3) = 19',same(time('z80',zx,'ld a,(ix+3)').values,[19]));
  ok('z80 time: JR NZ = 7 or 12',/12 cycles if it jumps, 7 if not/.test(time('z80',zx,'jr nz').text));
  ok('z80 time: LDIR per byte',/21 cycles for each byte it copies, 16 for the last one/.test(time('z80',zx,'ldir').text));
  ok('z80 time: memory shared with the screen is noted',/contended/.test(time('z80',zx,'ld (23560),a').text)&&!/contended/.test(time('z80',zx,'call 24000').text));
  // and it shows in the tooltip and the side panel
  {const D=loadFile(path.join(__dirname,'../dialects/6502.json'));const PJ=new Project();PJ.set('/x/h.asm',c64,D);
   const h=F.hoverAt(PJ,'/x/h.asm',3,4);ok('the instruction tooltip has a Time line',h&&h.parts.some(x=>/^\*Time:\* 4 cycles, or 5 if adding X/.test(x)),h&&h.parts);
   const tl=PN.thisLine(PJ,'/x/h.asm',3,4);ok('the side panel has the time too',tl&&/^4 cycles, or 5/.test(tl.time||''),tl&&tl.time);}
  {const D=loadFile(path.join(__dirname,'../dialects/tms9900.json'));const PJ=new Project();PJ.set('/x/h.a99',ti,D);
   const h=F.hoverAt(PJ,'/x/h.a99',8,10);ok('tms9900 tooltip has a Time line',h&&h.parts.some(x=>/^\*Time:\* 48 cycles/.test(x)),h&&h.parts);}
 }
 // build: use the real assembler if it is around (set XAS99=/path/to/xas99.py)
 const xas=process.env.XAS99;
 if(xas&&fs.existsSync(xas)){
  const bd=mock.__.collections.find(c=>c.name==='retroasm-build');
  settings['build.command']=`python3 "${xas}" -R "\${fileBasename}" -o "\${name}.obj"`;
  const good=await C['retroAsm.build']();
  const list=bd.get(game.uri);ok('build shows the assembler\'s errors',good===false&&list.length>=2&&list.some(d=>/MOVX/.test(d.message)&&d.range.start.line===66),list.map(d=>[d.range.start.line+1,d.message]));
  mock.window.activeTextEditor={document:mis,selection:editor.selection};
  const good2=await C['retroAsm.build']();ok('a clean file builds',good2===true&&fs.existsSync(path.join(ws,'PADDLE.obj')));
  delete settings['build.command'];
  // no build.bat here: falls back to finding xas99 (not present in the temp folder) -> a clear message
  const good3=await C['retroAsm.build']();ok('missing tools give a clear message, not a crash',good3===false);
 } else console.log('skip build test (set XAS99 to run it)');
 // the picture editor has its own file of tests (it needs a document whose text can change)
 {const r=require('child_process').spawnSync(process.execPath,[path.join(__dirname,'sprite-test.js')],{encoding:'utf8'});const bad=(r.stdout||'').split('\n').filter(l=>l.startsWith('FAIL'));ok('picture editor tests (test/sprite-test.js)',r.status===0,bad.length?bad:(r.stderr||'').slice(0,500));}
 // the letter-case change has its own file of tests too
 {const r=require('child_process').spawnSync(process.execPath,[path.join(__dirname,'regs-test.js')],{encoding:'utf8'});const bad=(r.stdout||'').split('\n').filter(l=>l.startsWith('FAIL'));ok('register tracker tests (test/regs-test.js)',r.status===0,bad.length?bad:(r.stderr||'').slice(0,500));}
 {const r=require('child_process').spawnSync(process.execPath,[path.join(__dirname,'marker-test.js')],{encoding:'utf8'});const bad=(r.stdout||'').split('\n').filter(l=>l.startsWith('FAIL'));ok('end-marker label tests (test/marker-test.js)',r.status===0,bad.length?bad:(r.stderr||'').slice(0,500));}
 {const r=require('child_process').spawnSync(process.execPath,[path.join(__dirname,'spacing-test.js')],{encoding:'utf8'});const bad=(r.stdout||'').split('\n').filter(l=>l.startsWith('FAIL'));ok('comment-spacing warning and cycle-note tests (test/spacing-test.js)',r.status===0,bad.length?bad:(r.stderr||'').slice(0,500));}
 {const r=require('child_process').spawnSync(process.execPath,[path.join(__dirname,'case-test.js')],{encoding:'utf8'});const bad=(r.stdout||'').split('\n').filter(l=>l.startsWith('FAIL'));ok('letter case tests (test/case-test.js)',r.status===0,bad.length?bad:(r.stderr||'').slice(0,500));}
 console.log(fails?`\n${fails} FAILED`:'\nall passed');process.exit(fails?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
