// Tests for editing a screen in the pixel editor: node test/pixellink-test.js (ext-test.js runs it too).
// The pixel editor itself is a separate program; here a tiny stand-in plays its part. The code is made up (test/fixtures/screen-demo.a99).
const Module=require('module');const path=require('path');const fs=require('fs');const os=require('os');
const mock=require('./mock-vscode');const orig=Module._load;Module._load=function(req,...r){return req==='vscode'?mock:orig.call(this,req,...r)};
const {loadFile}=require('../lib/dialect');const {Project}=require('../lib/project');const A=require('../lib/analysis');const SC=require('../lib/screen');const PL=require('../lib/pixellink');const T=require('../lib/tools');
let fails=0;const ok=(name,cond,extra)=>{if(!cond){fails++;console.log('FAIL',name,extra===undefined?'':JSON.stringify(extra));}else console.log('ok  ',name);};
const dia=(id)=>loadFile(path.join(__dirname,'../dialects',id+'.json'));
const fx=path.join(__dirname,'fixtures','screen-demo.a99');const TEXT=fs.readFileSync(fx,'utf8');
const proj=(text)=>{const P=new Project();P.set('/x/f',text,dia('tms9900'));return P;};
const bytesOf=(P,label)=>{const m=P.get('/x/f');return A.dataBlock(P,'/x/f',SC.labelLine(m,label)).bytes;};
// apply edits ({line,start,end,text}) to text, last first
const apply=(text,edits)=>{const lines=text.split('\n');for(const e of edits.slice().sort((a,b)=>b.line-a.line||b.start-a.start))lines[e.line]=lines[e.line].slice(0,e.start)+e.text+lines[e.line].slice(e.end);return lines.join('\n');};
const result=(tables,extra)=>Object.assign({format:PL.FORMAT,nonce:'n',tables,notes:[]},extra);

// ---- finding the pixel editor and starting it ----
{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'retroasm-pe-'));fs.writeFileSync(path.join(dir,'pixel_editor.py'),'');
 ok('a folder holding pixel_editor.py is found',PL.locateEditor(dir).script===path.join(dir,'pixel_editor.py'));
 ok('the path of pixel_editor.py itself works too',PL.locateEditor(path.join(dir,'pixel_editor.py')).folder===dir);
 ok('an empty setting says it is switched off',/switched off/.test(PL.locateEditor('').error));
 ok('a folder that is not there is named',/can't find "\/no\/such\/folder"/.test(PL.locateEditor('/no/such/folder').error));
 const bare=fs.mkdtempSync(path.join(os.tmpdir(),'retroasm-pe-'));ok('a folder without pixel_editor.py says so',/no pixel_editor.py/.test(PL.locateEditor(bare).error));
 const plan=PL.launchPlan('python','/p/pixel_editor.py','/tmp/share');
 ok('it starts on its own free port, with no browser, linked to the shared folder',plan.command==='python'&&plan.args.join(' ')==='-u /p/pixel_editor.py --link /tmp/share --port 0 --no-browser',plan);
 ok('the page address is picked out of its first line',PL.startedUrl('Pixel Editor is running at http://127.0.0.1:45857/app/\nLeave this window open')==='http://127.0.0.1:45857/app/'&&PL.startedUrl('Port 8766 is busy')===null);
 const share=PL.shareFiles('CODE','game.a99',3,'abc');ok('what is shared: a copy of the file and a small note',share['in.a99']==='CODE'&&JSON.parse(share['meta.json']).line===3&&JSON.parse(share['meta.json']).nonce==='abc');}

// ---- reading the reply ----
ok('a good reply is accepted',!!PL.parseResult(JSON.stringify(result([{label:'A',bytes:[1,2]}]))).result);
ok('junk is refused politely',/could not be read/.test(PL.parseResult('{nope').error)&&/not from the pixel editor/.test(PL.parseResult('{"format":"x"}').error));
ok('bytes outside 0-255 are refused',/not made of bytes/.test(PL.parseResult(JSON.stringify(result([{label:'A',bytes:[1,256]}]))).error));

// ---- putting tables into the file ----
{const P=proj(TEXT);const grid=bytesOf(P,'GFXMAP').slice();grid[0]=(grid[0]+1)&255;grid[767]=(grid[767]+1)&255;
 const plan=PL.planEdits(P,'/x/f',result([{label:'GFXMAP',bytes:Array.from(grid)}]),A.dataBlock);
 ok('only the numbers that differ are edited',plan.edits.length===2&&plan.changed.join()==='GFXMAP'&&plan.problems.length===0,plan);
 const text2=apply(TEXT,plan.edits);const P2=proj(text2);
 ok('the new numbers are in the file',bytesOf(P2,'GFXMAP').join()===grid.join());
 ok('... and everything else is exactly as it was',text2.split('\n').filter((l,i)=>l!==TEXT.split('\n')[i]).length===2);
 ok('... written the way the file writes numbers (>HEX, capitals)',/^\s+BYTE >[0-9A-F]{2}/.test(text2.split('\n')[plan.edits[0].line]));
 const same=PL.planEdits(P,'/x/f',result([{label:'GFXMAP',bytes:Array.from(bytesOf(P,'GFXMAP'))}]),A.dataBlock);
 ok('tables that did not change are reported as the same, with no edits',same.edits.length===0&&same.same.join()==='GFXMAP'&&/Nothing changed/.test(PL.summary(same,[])));
 ok('the summary says what happened and that Ctrl+Z undoes it',/Updated 1 table from the pixel editor \(GFXMAP\)\. Ctrl\+Z undoes it\./.test(PL.summary(plan,[])));
 ok('notes from the pixel editor are added to the summary',/not sent/.test(PL.summary(plan,['A change was not sent.'])));}
{const P=proj(TEXT);const good=Array.from(bytesOf(P,'GFXMAP')).map(b=>(b+1)&255);
 const plan=PL.planEdits(P,'/x/f',result([{label:'GFXMAP',bytes:good},{label:'NOSUCH',bytes:[1]}]),A.dataBlock);
 ok('if one table cannot go in, nothing changes at all',plan.edits.length===0&&plan.changed.length===0&&/no label called NOSUCH/.test(plan.problems.join()),plan);
 ok('... and the summary says so first',/^Nothing was changed\./.test(PL.summary(plan,[])));
 const sized=PL.planEdits(P,'/x/f',result([{label:'GFXMAP',bytes:good.slice(0,700)}]),A.dataBlock);
 ok('a table of a different size is refused with the reason',sized.edits.length===0&&/now holds 768 bytes, but the pixel editor sent 700/.test(sized.problems.join()),sized.problems);
 const named=proj(TEXT.replace('       BYTE >00,>00,>00,>00,>00,>00,>00,>00\n','       BYTE FULL,>00,>00,>00,>00,>00,>00,>00\n'));
 const nm=PL.planEdits(named,'/x/f',result([{label:'GFXPAT0',bytes:new Array(2048).fill(1)}]),A.dataBlock);
 ok('a table with a name in it is left alone, and the reason is given',nm.edits.length===0&&/GFXPAT0 is not followed by BYTE or DATA lines made of plain numbers/.test(nm.problems.join()),nm.problems);}

// ---- in the editor (with a stand-in for VS Code and a stand-in pixel editor) ----
const py=T.locateRuntime('python',{});
if(!py){console.log('skip the editor tests (Python was not found, and the pixel editor needs it)');console.log(fails?`\n${fails} failed`:'\nall passed');process.exit(fails?1:0);}
const ext=require('../extension.js');const {providers:PV,commands:C,events,settings}=mock.__;
const ws=fs.mkdtempSync(path.join(os.tmpdir(),'retroasm-pl-'));fs.copyFileSync(fx,path.join(ws,'game.a99'));
const fake=fs.mkdtempSync(path.join(os.tmpdir(),'retroasm-fake-pe-'));
fs.writeFileSync(path.join(fake,'pixel_editor.py'),'import sys, time\nprint("Pixel Editor is running at http://127.0.0.1:54321/app/", flush=True)\ntime.sleep(120)\n');
mock.workspace.workspaceFolders=[{uri:mock.Uri.file(ws)}];
const opened=[];mock.env={openExternal:async(u)=>{opened.push(String(u&&u.path!==undefined&&u.scheme?u.scheme+':'+u.path:u));return true;},clipboard:{writeText:async()=>{}}};
const infos=[];const realInfo=mock.window.showInformationMessage;mock.window.showInformationMessage=(m)=>{infos.push(m);return realInfo(m);};
function liveDoc(file){let text=fs.readFileSync(file,'utf8');const d={uri:mock.Uri.file(file),languageId:'retroasm',isDirty:false,save:async()=>true,getText:()=>text,get lineCount(){return text.split(/\r?\n/).length;},lineAt:(i)=>({text:text.split(/\r?\n/)[i]}),setText:(t)=>{text=t;}};mock.__.docs.push(d);return d;}
const doc=liveDoc(path.join(ws,'game.a99'));
let steps=0;
mock.__.applyEdit=async(we)=>{steps++;const lines=doc.getText().split('\n');const list=we.edits.slice().sort((a,b)=>b.range.start.line-a.range.start.line||b.range.start.character-a.range.start.character);
 for(const e of list){const l=e.range.start.line;const s=lines[l]||'';const ln2=e.range.end.line;const tail=(lines[ln2]||'').slice(e.range.end.character);const parts=(s.slice(0,e.range.start.character)+e.text+tail).split('\n');lines.splice(l,ln2-l+1,...parts);}
 doc.setText(lines.join('\n'));for(const f of events.change||[])f({document:doc,contentChanges:[{}]});return true;};
const ctx={extensionPath:path.join(__dirname,'..'),subscriptions:[],workspaceState:{get:()=>undefined,update:async()=>{}}};
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const shared=()=>fs.readdirSync(os.tmpdir()).filter(n=>n.startsWith('retroasm-pixel-')).map(n=>path.join(os.tmpdir(),n)).filter(d=>fs.existsSync(path.join(d,'in.a99')));
const gridNow=()=>{const P=proj(doc.getText());return bytesOf(P,'GFXMAP');};
(async()=>{
 const before=shared().length;
 const api=ext.activate(ctx);await sleep(300);
 const lenses=()=>PV.CodeLens.provideCodeLenses(doc).map(l=>l.command.title);
 const hover=()=>{const h=PV.Hover.provideHover(doc,new mock.Position(1,4));return h&&h.contents.map(c=>c.value).join('\n');};
 // switched off: nothing shows
 ok('with the setting empty (as it comes) there is no pixel editor link on the @screen line',!lenses().some(t=>/pixel editor/.test(t)));
 ok('... and none in the tooltip',!/pixel editor/.test(hover()||''));
 ok('... and the command is hidden from the command list',JSON.parse(fs.readFileSync(path.join(__dirname,'..','package.json'),'utf8')).contributes.menus.commandPalette.some(c=>c.command==='retroAsm.editScreenInPixelEditor'&&/pixelEditor.path != ''/.test(c.when)));
 ok('... and the command says how to switch it on',await C['retroAsm.editScreenInPixelEditor'](doc.uri.toString(),1)===false&&infos.some(m=>/switched off.*retroAsm.pixelEditor.path/.test(m)),infos);
 const pj=JSON.parse(fs.readFileSync(path.join(__dirname,'..','package.json'),'utf8')).contributes.configuration.properties['retroAsm.pixelEditor.path'];
 ok('the setting exists and is empty by default',pj&&pj.type==='string'&&pj.default==='');
 // switched on
 settings['pixelEditor.path']=fake;
 ok('with the setting filled in, the link sits on the @screen line next to "Show this screen"',lenses().includes('$(edit) Edit in pixel editor')&&lenses().includes('$(device-desktop) Show this screen'),lenses());
 ok('... and the tooltip has a link that is allowed to run the command',(()=>{const h=PV.Hover.provideHover(doc,new mock.Position(1,4));const l=h.contents[h.contents.length-1];return /command:retroAsm.editScreenInPixelEditor\?/.test(l.value)&&l.isTrusted.enabledCommands.join()==='retroAsm.editScreenInPixelEditor';})());
 // wrong folder
 settings['pixelEditor.path']='/no/such/folder';infos.length=0;
 ok('a wrong folder is named and nothing is started',await C['retroAsm.editScreenInPixelEditor'](doc.uri.toString(),1)===false&&infos.some(m=>/can't find "\/no\/such\/folder"/.test(m))&&opened.length===0,infos);
 settings['pixelEditor.path']=fake;
 // starting it
 ok('the link starts the pixel editor and opens its page',await C['retroAsm.editScreenInPixelEditor'](doc.uri.toString(),1)===true&&opened.length===1&&/^http:\/\/127\.0\.0\.1:54321\/app\/\?link=[0-9a-f]{12}$/.test(opened[0]),opened);
 const dirs=shared().slice(before===0?0:0);const dir=dirs[dirs.length-1];
 ok('a copy of the file and a note were left for it',!!dir&&fs.readFileSync(path.join(dir,'in.a99'),'utf8')===doc.getText()&&JSON.parse(fs.readFileSync(path.join(dir,'meta.json'),'utf8')).name==='game.a99'&&JSON.parse(fs.readFileSync(path.join(dir,'meta.json'),'utf8')).line===1);
 const nonce1=JSON.parse(fs.readFileSync(path.join(dir,'meta.json'),'utf8')).nonce;
 ok('the page address carries the same number',opened[0].endsWith('?link='+nonce1));
 // clicking again reuses it
 ok('clicking again reuses the running pixel editor, with a new number',await C['retroAsm.editScreenInPixelEditor'](doc.uri.toString(),1)===true&&opened.length===2&&shared().length===dirs.length&&JSON.parse(fs.readFileSync(path.join(dir,'meta.json'),'utf8')).nonce!==nonce1);
 const nonce=JSON.parse(fs.readFileSync(path.join(dir,'meta.json'),'utf8')).nonce;
 // a reply
 const grid=Array.from(gridNow());const next=grid.slice();next[0]=(next[0]+5)&255;next[100]=(next[100]+5)&255;
 const reply=(o)=>{fs.writeFileSync(path.join(dir,'out.json'),JSON.stringify(Object.assign({format:PL.FORMAT,nonce,tables:[{label:'GFXMAP',bytes:next}],notes:[]},o)));};
 steps=0;infos.length=0;reply({notes:['You changed the backdrop colour; that was not sent.']});await sleep(1300);
 ok('"Send to code" puts the new numbers into the file',gridNow().join()===next.join(),gridNow().slice(0,3));
 ok('... as one step in the editor, so one Ctrl+Z undoes it',steps===1,steps);
 ok('... and says what it did, including the pixel editor\'s notes',infos.some(m=>/Updated 1 table from the pixel editor \(GFXMAP\)\. Ctrl\+Z undoes it\..*backdrop colour/.test(m)),infos);
 // an older page
 mock.__.warnings.length=0;const keep=doc.getText();reply({nonce:'old'});await sleep(1300);
 ok('a reply from an older pixel editor page is not applied',doc.getText()===keep&&mock.__.warnings.some(m=>/older pixel editor page/.test(m)),mock.__.warnings);
 // a reply that does not fit
 mock.__.warnings.length=0;reply({tables:[{label:'GFXMAP',bytes:next.slice(0,10)}]});await sleep(1300);
 ok('a reply that does not fit leaves the file alone and says why',doc.getText()===keep&&mock.__.warnings.some(m=>/Nothing was changed\..*now holds 768 bytes/.test(m)),mock.__.warnings);
 // tidy up: closing the extension stops the pixel editor and clears the shared folder
 ext.deactivate();await sleep(200);
 ok('closing VS Code stops the pixel editor and clears the shared folder',!fs.existsSync(dir));
 console.log(fails?`\n${fails} failed`:'\nall passed');process.exit(fails?1:0);
})().catch(e=>{console.log('FAIL crashed',e&&e.stack||e);try{ext.deactivate();}catch(x){}process.exit(1);});
