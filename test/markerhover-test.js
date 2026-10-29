// Tests for the tooltips on @sprite and @sound comments: node test/markerhover-test.js (ext-test.js runs it too).
// The sample code is made up (examples/sprites/sprites.a99 and examples/sounds/sounds.a99).
const Module=require('module');const path=require('path');const fs=require('fs');const os=require('os');
const mock=require('./mock-vscode');const orig=Module._load;Module._load=function(req,...r){return req==='vscode'?mock:orig.call(this,req,...r)};
const {loadFile}=require('../lib/dialect');const {Project}=require('../lib/project');const A=require('../lib/analysis');const MH=require('../lib/markerhover');
let fails=0;const ok=(name,cond,extra)=>{if(!cond){fails++;console.log('FAIL',name,extra===undefined?'':JSON.stringify(extra));}else console.log('ok  ',name);};
const dia=(id)=>loadFile(path.join(__dirname,'../dialects',id+'.json'));
const one=(id,text)=>{const P=new Project();P.set('/x/f',text,dia(id));return P;};
const exSpr=path.join(__dirname,'../examples/sprites/sprites.a99'),exSnd=path.join(__dirname,'../examples/sounds/sounds.a99');
const SP=fs.readFileSync(exSpr,'utf8'),SN=fs.readFileSync(exSnd,'utf8');
const idx=(text,start)=>text.split('\n').findIndex(l=>l.startsWith(start));

// ---- the library ----
{const P=one('tms9900',SP);const ln=idx(SP,'* @sprite 16x16');
 const h=MH.spriteHover(P,'/x/f',ln,4,A.dataBlock);
 ok('hovering "@sprite" says what it does and what is below',h&&/marks the bytes below as a picture/.test(h.parts[0])&&/`MAN` is drawn as /.test(h.parts[1])&&/16x16/.test(h.parts[1]),h&&h.parts);
 ok('... it covers just the word "@sprite", and links to the picture editor',h&&h.start===2&&h.end===9&&h.link&&h.link.command==='retroAsm.editSprite'&&h.link.line===idx(SP,'MAN'),h&&[h.start,h.end,h.link]);
 ok('hovering on the size or elsewhere on the line is not the tooltip',MH.spriteHover(P,'/x/f',ln,12,A.dataBlock)===null&&MH.spriteHover(P,'/x/f',ln,0,A.dataBlock)===null);
 const mention=idx(SP,'* The @sprite comment above');
 ok('a comment that only mentions @sprite is not a marker',MH.spriteHover(P,'/x/f',mention,8,A.dataBlock)===null);
 const lone=one('tms9900','* @sprite 8x8\n       LI R0,1\n');
 const lh=MH.spriteHover(lone,'/x/f',0,4,A.dataBlock);
 ok('a marker with no data below says so',lh&&/no BYTE or DATA lines/.test(lh.parts[1])&&!lh.link,lh&&lh.parts);
 const odd=one('tms9900','* @sprite 8x8\nPIC    BYTE 1,2,3\n');
 const oh=MH.spriteHover(odd,'/x/f',0,4,A.dataBlock);
 ok('a block that is not whole pictures says why',oh&&/holds 3 bytes/.test(oh.parts[1])&&!oh.link,oh&&oh.parts);}
{const P=one('tms9900',SN);const ln=idx(SN,'* @sound');
 const h=MH.soundHover(P,'/x/f',ln,4,A.dataBlock);
 ok('hovering "@sound" says what it does and what is below',h&&/marks the bytes below as a sound/.test(h.parts[0])&&/is a sound of 2 steps, 0\.18 seconds/.test(h.parts[1]),h&&h.parts);
 ok('... with a link to the player',h&&h.start===2&&h.end===8&&h.link&&h.link.command==='retroAsm.playSound'&&h.link.line===ln+1,h&&[h.start,h.end,h.link]);
 ok('a sound comment is not a picture one',MH.spriteHover(P,'/x/f',ln,4,A.dataBlock)===null);
 const bad=one('tms9900','* @sound\nZAP    BYTE 9,>8E,>0F\n');
 const bh=MH.soundHover(bad,'/x/f',0,4,A.dataBlock);
 ok('a list that does not add up says why',bh&&/^⚠ Step 1 says 9 bytes/.test(bh.parts[1])&&!bh.link,bh&&bh.parts);
 ok('a chip with no sound player gets no tooltip',MH.soundHover(one('z80','; @sound\nsnd:  DB 1,2,3\n'),'/x/f',0,4,A.dataBlock)===null);}

// ---- in the editor (with a stand-in for VS Code) ----
const ext=require('../extension.js');const {providers:PV,events,settings}=mock.__;
const ws=fs.mkdtempSync(path.join(os.tmpdir(),'retroasm-mh-'));fs.copyFileSync(exSpr,path.join(ws,'sprites.a99'));fs.copyFileSync(exSnd,path.join(ws,'sounds.a99'));
mock.workspace.workspaceFolders=[{uri:mock.Uri.file(ws)}];
function liveDoc(file){let text=fs.readFileSync(file,'utf8');const d={uri:mock.Uri.file(file),languageId:'retroasm',isDirty:false,save:async()=>true,getText:()=>text,get lineCount(){return text.split(/\r?\n/).length;},lineAt:(i)=>({text:text.split(/\r?\n/)[i]}),setText:(t)=>{text=t;}};mock.__.docs.push(d);return d;}
const sdoc=liveDoc(path.join(ws,'sprites.a99')),wdoc=liveDoc(path.join(ws,'sounds.a99'));
const ctx={extensionPath:path.join(__dirname,'..'),subscriptions:[],workspaceState:{get:()=>undefined,update:async()=>{}}};
(async()=>{
 ext.activate(ctx);await new Promise(r=>setTimeout(r,300));
 const hover=(doc,l,c)=>PV.Hover.provideHover(doc,new mock.Position(l,c));
 const text=(h)=>h&&h.contents.map(c=>c.value).join('\n');
 const ls=idx(SP,'* @sprite 16x16'),h1=hover(sdoc,ls,4);
 ok('in the editor, "@sprite" has a tooltip',h1&&/marks the bytes below as a picture/.test(text(h1))&&/`MAN`/.test(text(h1)),text(h1));
 ok('... with a link that is allowed to open the picture editor',(()=>{const l=h1.contents[h1.contents.length-1];return /\[Edit picture\]\(command:retroAsm.editSprite\?/.test(l.value)&&l.isTrusted&&l.isTrusted.enabledCommands.join()==='retroAsm.editSprite';})(),h1&&h1.contents.map(c=>c.value));
 ok('... covering "@sprite"',h1.range.start.line===ls&&h1.range.start.character===2&&h1.range.end.character===9);
 const lw=idx(SN,'* @sound'),h2=hover(wdoc,lw,4);
 ok('in the editor, "@sound" has a tooltip with a link to the player',h2&&/marks the bytes below as a sound/.test(text(h2))&&/\[Play sound\]\(command:retroAsm.playSound\?/.test(text(h2)),text(h2));
 const ment=idx(SP,'* The @sprite comment above');
 ok('a comment that only mentions @sprite has no picture tooltip',!/marks the bytes/.test(text(hover(sdoc,ment,8))||''));
 settings.pictureLinks=false;settings.soundLinks=false;
 ok('the tooltips go when the links are switched off',!/marks the bytes/.test(text(hover(sdoc,ls,4))||'')&&!/marks the bytes/.test(text(hover(wdoc,lw,4))||''));
 delete settings.pictureLinks;delete settings.soundLinks;
 console.log(fails?`\n${fails} failed`:'\nall passed');process.exit(fails?1:0);
})().catch(e=>{console.log('FAIL crashed',e&&e.stack||e);process.exit(1);});
