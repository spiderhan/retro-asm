// Tests for the picture editor: node test/sprite-test.js (ext-test.js runs it too).
const Module=require('module');const path=require('path');const fs=require('fs');const os=require('os');
const mock=require('./mock-vscode');const orig=Module._load;Module._load=function(req,...r){return req==='vscode'?mock:orig.call(this,req,...r)};
const {loadFile}=require('../lib/dialect');const {Project}=require('../lib/project');const A=require('../lib/analysis');const F=require('../lib/features');const SP=require('../lib/sprites');
let fails=0;const ok=(name,cond,extra)=>{if(!cond){fails++;console.log('FAIL',name,extra===undefined?'':JSON.stringify(extra));}else console.log('ok  ',name);};
const dia=(id)=>loadFile(path.join(__dirname,'../dialects',id+'.json'));
const one=(id,text)=>{const P=new Project();P.set('/x/f',text,dia(id));return P;};

// ---- the example files ----
const ex=path.join(__dirname,'../examples/sprites');
const expect={'sprites.a99':['tms9900',{MAN:1,ALIEN:2,COIN:1,SHIELD:1}],'sprites.z80':['z80',{ghost:1,key:1,coin:4}],'sprites.asm':['6502',{balloon:1,bird:2,tree:1,brick:1}],'sprites.6502':['bbc',{rocket:1,mushroom:1,runner:1}]};
for(const f of Object.keys(expect)){
 const [id,want]=expect[f];const P=new Project();const file=path.join(ex,f);P.set(file,fs.readFileSync(file,'utf8'),dia(id));
 ok(`${f}: no warnings`,F.check(P,file).filter(c=>c.severity!=='hint').length===0,F.check(P,file).map(c=>c.message));
 const got={};for(const m of SP.markedBlocks(P,file,A.dataBlock)){const blk=A.dataBlock(P,file,m.line);const pic=SP.pictureOf(P,file,blk,m.spec);got[m.label]=pic.error||pic.frames.length;
  if(!pic.error){let same=true;pic.frames.forEach((px,i)=>{const b=SP.encode(px,pic.shape);if(b.join()!==blk.bytes.slice(i*pic.shape.stride,i*pic.shape.stride+pic.shape.frameBytes).join())same=false;});ok(`${f} ${m.label}: picture turns back into the same bytes`,same);}}
 ok(`${f}: every marked picture found, with its number of frames`,JSON.stringify(got)===JSON.stringify(want),got);
}
// ---- how bytes become pixels ----
{const P=one('tms9900','* @sprite 16x16\nS      BYTE 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, >80,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,1\n');const blk=A.dataBlock(P,'/x/f',1);const pic=SP.pictureOf(P,'/x/f',blk,'16x16');
 ok('TI 16x16: byte 17 is the top row of the right half',pic.frames[0][8]===1&&pic.frames[0].reduce((a,b)=>a+b)===2);ok('TI 16x16: the last byte is the bottom-right corner',pic.frames[0][255]===1);}
{const D=dia('bbc');const m1=SP.shapeFor(D,'mode1 4x8'),m2=SP.shapeFor(D,'mode2 2x8');
 ok('BBC MODE 1: bits 7 and 3 make the left pixel',SP.decode([0x88],0,m1)[0]===3&&SP.decode([0x08],0,m1)[0]===1&&SP.decode([0x80],0,m1)[0]===2);
 ok('BBC MODE 2: bits 7,5,3,1 make the left pixel',SP.decode([0xAA],0,m2)[0]===15&&SP.decode([0xAA],0,m2)[1]===0&&SP.decode([0x02],0,m2)[0]===1);
 const c=SP.shapeFor(D,'mode4');ok('BBC: 8-row cells go across first',SP.byteIndex(c,0,1)===8&&SP.byteIndex(c,8,0)===16);}
{const D=dia('6502');const s=SP.shapeFor(D,'c64multi');ok('C64 multicolour: 2 bits a pixel, 3 bytes a row, 64 apart',s.bitsPerPixel===2&&s.bytesPerRow===3&&s.stride===64&&s.frameBytes===63);
 ok('C64: two sprites in 127 bytes (no spare byte at the end)',SP.frameCount(127,SP.shapeFor(D,'c64'))===2&&SP.frameCount(126,SP.shapeFor(D,'c64'))===1);}
{const P=one('z80','; @sprite 8x8\ng:  DEFW $0201,$0403,$0605,$0807\n');const blk=A.dataBlock(P,'/x/f',1);ok('Z80 words are stored low byte first',blk.bytes.join()==='1,2,3,4,5,6,7,8',blk.bytes);
 const nb=blk.bytes.slice();nb[0]=0xFF;const e=SP.editsFor(P,'/x/f',blk,nb);ok('changing one byte of a word changes just that word',e.length===1&&e[0].text==='$02FF',e);}
{const P=one('tms9900','* @sprite 8x8\nC      DATA >3C42,>99A5,>A199,>423C\n');const blk=A.dataBlock(P,'/x/f',1);ok('TI words are stored left byte first',blk.bytes[0]===0x3C&&blk.bytes[1]===0x42);}
// ---- numbers stay written the way they were ----
{const z=dia('z80'),t=dia('tms9900'),b=dia('bbc');const f=(txt,D,v)=>SP.formatNumber(v,SP.numberStyle(txt,D));
 ok('hex keeps its prefix and case',f('$3c',z,0xAB)==='$ab'&&f('#3C',z,0xAB)==='#AB'&&f('0x3C',z,0xAB)==='0xAB'&&f('>3C',t,0xAB)==='>AB'&&f('&3C',b,0xAB)==='&AB');
 ok('binary keeps its width',f('%00011000',z,0x81)==='%10000001'&&f(':0011',t,1)===':0001');
 ok('decimal stays decimal',f('24',b,255)==='255');ok('3Ch style gets a 0 in front of a letter',f('3Ch',z,0xAB)==='0ABh');
 ok('a name is not a plain number',SP.numberStyle('FULL',t)===null&&SP.numberStyle('LO(x)',b)===null);}
// ---- markers ----
{const P=one('tms9900','* This text mentions @sprite but is not one\nPAT1   BYTE 1,2,3,4,5,6,7,8\n');ok('a comment that only mentions @sprite is not a marker',SP.markedBlocks(P,'/x/f',A.dataBlock).length===0);
 const P2=one('tms9900','ALIEN  BYTE 1,2,3,4,5,6,7,8 ; @sprite 8x8\n');ok('a marker at the end of the first line counts',SP.markedBlocks(P2,'/x/f',A.dataBlock).length===1);
 ok('a size the chip has no name for still works',SP.shapeFor(dia('z80'),'24x16').bytesPerRow===3);
 ok('a wrong shape gives a clear message',/not a picture shape/.test(SP.shapeFor(dia('z80'),'c64').error||''));
 ok('a width that splits a byte is refused',/multiple of 8/.test(SP.shapeFor(dia('z80'),'12x8').error||''));}
{const lines=SP.newSpriteLines(dia('tms9900'),'SPR1',SP.shapeFor(dia('tms9900'),'16x16'),1);ok('a new TI sprite: marker, label on the first data line, 32 zero bytes',lines[0]==='* @sprite 16x16'&&/^SPR1   BYTE >00/.test(lines[1])&&lines.slice(1).join(',').split('>00').length-1===32,lines);
 const l2=SP.newSpriteLines(dia('bbc'),'ship',SP.shapeFor(dia('bbc'),'8x8'),2);ok('a new BBC picture: .label on its own line',l2[0]==='; @sprite 8x8'&&l2[1]==='.ship'&&/^    EQUB &00/.test(l2[2])&&l2.length===4,l2);}

// ---- in the editor (with a stand-in for VS Code) ----
const ext=require('../extension.js');const {providers:PV,commands:C,events,settings}=mock.__;
const ws=fs.mkdtempSync(path.join(os.tmpdir(),'retroasm-spr-'));fs.copyFileSync(path.join(ex,'sprites.a99'),path.join(ws,'sprites.a99'));
mock.workspace.workspaceFolders=[{uri:mock.Uri.file(ws)}];
// a document whose text can change
function liveDoc(file){let text=fs.readFileSync(file,'utf8');const d={uri:mock.Uri.file(file),languageId:'retroasm',isDirty:false,save:async()=>true,getText:()=>text,get lineCount(){return text.split(/\r?\n/).length;},lineAt:(i)=>({text:text.split(/\r?\n/)[i]}),setText:(t)=>{text=t;}};mock.__.docs.push(d);return d;}
const doc=liveDoc(path.join(ws,'sprites.a99'));
let edits=0;
mock.__.applyEdit=async(we)=>{edits++;const lines=doc.getText().split('\n');const list=we.edits.slice().sort((a,b)=>b.range.start.line-a.range.start.line||b.range.start.character-a.range.start.character);
 for(const e of list){const l=e.range.start.line;const s=lines[l]||'';const ln2=e.range.end.line;const tail=(lines[ln2]||'').slice(e.range.end.character);const parts=(s.slice(0,e.range.start.character)+e.text+tail).split('\n');lines.splice(l,ln2-l+1,...parts);}
 doc.setText(lines.join('\n'));for(const f of events.change||[])f({document:doc,contentChanges:[{}]});return true;};
const ctx={extensionPath:path.join(__dirname,'..'),subscriptions:[],workspaceState:{get:()=>undefined,update:async()=>{}}};
(async()=>{
 const api=ext.activate(ctx);await new Promise(r=>setTimeout(r,300));
 const lenses=()=>PV.CodeLens.provideCodeLenses(doc);
 const L=lenses();const titles=L.map(l=>l.command.title);
 ok('"Edit picture" links above the marked pictures',titles.filter(t=>/Edit picture/.test(t)).length===4,titles);
 ok('"Edit as a picture?" above PAT_HEART, which has no marker',L.some(l=>/Edit as a picture\?/.test(l.command.title)&&doc.lineAt(l.range.start.line).text.startsWith('PAT_HEART')),titles);
 ok('the shape and frame count are shown',titles.includes('8x8 character or sprite, 2 pictures')&&titles.includes('8x8 character or sprite (look only)'),titles);
 settings.pictureLinks=false;ok('the links can be switched off',!lenses().some(l=>/picture/i.test(l.command.title)));delete settings.pictureLinks;
 // open MAN
 const manLine=doc.getText().split('\n').findIndex(l=>l.startsWith('MAN '));
 ok('the link opens the editor',await C['retroAsm.editSprite'](doc.uri.toString(),manLine)===true&&mock.__.panels.length===1);
 const panel=mock.__.panels[0];await new Promise(r=>setTimeout(r,60));
 ok('the page is safe: scripts only with the nonce, nothing loaded from outside',/default-src 'none'/.test(panel.webview.html)&&/script-src 'nonce-/.test(panel.webview.html));
 const st=api.spriteNow();ok('the editor gets MAN as a 16x16 picture',st.title==='MAN'&&st.shape.width===16&&st.frames.length===1&&st.editable,st.error||st.title);
 // paint the top-left pixel
 const px=st.frames[0].slice();px[0]=1;
 await panel.send({type:'paint',frame:0,pixels:px});
 const after=doc.getText().split('\n')[manLine];ok('drawing changes just one number in the code',after==='MAN    BYTE >83,>07,>05,>07,>02,>01,>0F,>1F',after);
 // and typing in the code changes the picture
 const t=doc.getText().split('\n');t[manLine]=t[manLine].replace('>83','>FF');doc.setText(t.join('\n'));for(const f of events.change)f({document:doc,contentChanges:[{}]});
 await new Promise(r=>setTimeout(r,80));const last=panel.webview.postMessage&&panel.sent[panel.sent.length-1];
 ok('typing a new number updates the editor',last&&last.type==='state'&&last.frames[0].slice(0,8).join('')==='11111111',last&&last.frames&&last.frames[0].slice(0,8));
 // lines above move: the picture is still found by its name
 doc.setText('* a new line at the top\n'+doc.getText());for(const f of events.change)f({document:doc,contentChanges:[{}]});
 const st2=api.spriteNow();ok('after lines move, the picture is found again by its label',st2.title==='MAN'&&!st2.error&&st2.frames[0][0]===1,st2.error);
 // look-only picture
 const shLine=doc.getText().split('\n').findIndex(l=>l.startsWith('SHIELD'));
 await C['retroAsm.editSprite'](doc.uri.toString(),shLine);const st3=api.spriteNow();
 ok('SHIELD opens look-only, saying why',st3.editable===false&&/FULL/.test(st3.why),st3);
 const before=doc.getText();mock.__.warnings.length=0;await panel.send({type:'paint',frame:0,pixels:st3.frames[0].map(()=>0)});
 ok('painting a look-only picture changes nothing',doc.getText()===before&&mock.__.warnings.some(w=>/only be looked at/.test(w)));
 // PAT_HEART: choose a shape, the marker goes in
 const oldPick=mock.window.showQuickPick;mock.window.showQuickPick=async(items)=>items.find(i=>i.spec==='8x8');
 const hLine=doc.getText().split('\n').findIndex(l=>l.startsWith('PAT_HEART'));
 await C['retroAsm.editSprite'](doc.uri.toString(),hLine);const lines2=doc.getText().split('\n');
 ok('choosing a shape adds the @sprite line above it',lines2[hLine]==='* @sprite 8x8'&&lines2[hLine+1].startsWith('PAT_HEART'),lines2.slice(hLine-1,hLine+2));
 ok('... and opens it',api.spriteNow().title==='PAT_HEART'&&api.spriteNow().frames.length===1);
 // a new picture at the cursor
 const answers=['ROBOT','2'];const oldInput=mock.window.showInputBox;mock.window.showInputBox=async()=>answers.shift();
 mock.window.showQuickPick=async(items)=>items.find(i=>i.spec==='16x16');
 const endLine=doc.getText().split('\n').findIndex(l=>/^\s+END\s/.test(l));
 mock.window.activeTextEditor={document:doc,selection:{active:new mock.Position(endLine,0),start:new mock.Position(endLine,0)}};
 ok('New picture here',await C['retroAsm.newSprite']()===true);
 const st4=api.spriteNow();ok('it is a marked, empty 16x16 sprite with 2 frames',st4.title==='ROBOT'&&st4.frames.length===2&&st4.frames.every(f=>f.every(v=>v===0)),st4);
 const P=new Project();P.set('/x/a.a99',doc.getText(),dia('tms9900'));ok('the file still has no warnings',F.check(P,'/x/a.a99').length===0,F.check(P,'/x/a.a99').map(c=>c.message));
 mock.window.showQuickPick=oldPick;mock.window.showInputBox=oldInput;
 // a bad message from the page is ignored
 const t0=doc.getText();await panel.send({type:'paint',frame:5,pixels:[1,2,3]});ok('a broken message from the page changes nothing',doc.getText()===t0);
 // the tooltip uses the marker too
 const hv=F.hoverAt(P,'/x/a.a99',P.get('/x/a.a99').rawLines.findIndex(l=>l.startsWith('MAN ')),8);ok('the tooltip draws MAN as 16x16',hv&&hv.parts.some(p=>/As a picture\*\* \(16x16 sprite\)/.test(p)),hv&&hv.parts);
 console.log(fails?`\n${fails} FAILED`:'\nall passed');process.exit(fails?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
