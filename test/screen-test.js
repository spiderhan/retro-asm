// Tests for the whole-screen preview (@screen): node test/screen-test.js (ext-test.js runs it too).
// The sample code is made up (test/fixtures/screen-demo.a99).
const Module=require('module');const path=require('path');const fs=require('fs');const os=require('os');
const mock=require('./mock-vscode');const orig=Module._load;Module._load=function(req,...r){return req==='vscode'?mock:orig.call(this,req,...r)};
const {loadFile}=require('../lib/dialect');const {Project}=require('../lib/project');const A=require('../lib/analysis');const SC=require('../lib/screen');const SH=require('../lib/screen-html');
let fails=0;const ok=(name,cond,extra)=>{if(!cond){fails++;console.log('FAIL',name,extra===undefined?'':JSON.stringify(extra));}else console.log('ok  ',name);};
const dia=(id)=>loadFile(path.join(__dirname,'../dialects',id+'.json'));
const fx=path.join(__dirname,'fixtures','screen-demo.a99');const TEXT=fs.readFileSync(fx,'utf8');
const load=(text)=>{const P=new Project();P.set('/x/f',text,dia('tms9900'));const spec=SC.markedScreens(P.get('/x/f'))[0].spec;return {P,spec,g:SC.gather(P,'/x/f',spec,A.dataBlock)};};
const px=(r,x,y)=>r.pixels[y*SC.WIDTH+x];

// ---- reading the line ----
{const s=SC.parseMarker('* @screen ti-bitmap bands=3 shared=no run=GO grid=MAP gridat=>1800 patterns=P0,P1,P2 patat=>0000 colours=C0 colat=>2000 sprites=S96,S100 sprat=>1800 spritelist=L listat=>1F00 regs=>02,>E2,>06,>FF,>03,>3E,>03,>01');
 ok('every word is read',s&&s.kind==='ti-bitmap'&&s.bands===3&&s.shared===false&&s.run==='GO'&&s.grid==='MAP'&&s.gridAt===0x1800&&s.patterns.join()==='P0,P1,P2'&&s.patAt===0&&s.colours.join()==='C0'&&s.colAt===0x2000&&s.sprites.join()==='S96,S100'&&s.sprAt===0x1800&&s.spriteList==='L'&&s.listAt===0x1F00,s);
 ok('the eight register values are read',s.regs.join()==='2,226,6,255,3,62,3,1',s.regs);
 ok('a good line has nothing unreadable',s.bad.length===0,s.bad);}
{const s=SC.parseMarker('@screen ti-bitmap colours=- sprites=- spritelist=- future=xyz run=GO');
 ok('"-" means none, and words it does not know are ignored',s.colours.length===0&&s.sprites.length===0&&s.spriteList===null&&s.run==='GO'&&s.bad.length===0,s);}
{const s=SC.parseMarker('@screen ti-bitmap bands=9 gridat=>ZZ regs=>02,>E2,>1FF');
 ok('numbers that cannot be read are listed, not guessed',s.bad.join()==='gridat,bands,regs'&&s.gridAt===null&&s.bands===null&&s.regs===null,s);}
ok('shared=yes is read',SC.parseMarker('@screen ti-bitmap shared=yes').shared===true);
ok('a comment that only mentions @screen is not a marker',SC.parseMarker('This text mentions @screen ti-bitmap but is not one')===null);
ok('hex can be written with $ or 0x too',SC.hexValue('$1F')===31&&SC.hexValue('0x1F')===31&&SC.hexValue('>1f')===31&&SC.hexValue('zz')===null);
ok('it is described in plain English',/^a whole screen: 3 bands, shapes at >0000, colours at >2000, grid at >1800, sprites listed at >1F00$/.test(SC.describe(SC.parseMarker('@screen ti-bitmap bands=3 patterns=A patat=>0000 colours=B colat=>2000 grid=C gridat=>1800 sprites=D spritelist=E listat=>1F00'))),SC.describe(SC.parseMarker('@screen ti-bitmap bands=3 patterns=A patat=>0000 colours=B colat=>2000 grid=C gridat=>1800 sprites=D spritelist=E listat=>1F00')));
ok('a kind it does not know is said so',/ti-bitmap/.test(SC.describe(SC.parseMarker('@screen c64-bitmap'))));

// ---- finding the tables and checking them ----
{const {P,spec,g}=load(TEXT);
 ok('the example file has one @screen line, on line 2',SC.markedScreens(P.get('/x/f')).length===1&&SC.markedScreens(P.get('/x/f'))[0].line===1);
 ok('all ten named labels are found',g.tables.length===10&&g.tables.every(t=>!t.why),g.tables.map(t=>[t.label,t.why]));
 ok('each band is 2048 bytes, the grid 768',g.tables.filter(t=>t.role==='patterns'||t.role==='colours').every(t=>t.bytes.length===2048)&&g.tables.find(t=>t.role==='grid').bytes.length===768);
 ok('the bands sit 2048 apart in video memory',g.tables.filter(t=>t.role==='patterns').map(t=>t.at).join()==='0,2048,4096'&&g.tables.filter(t=>t.role==='colours').map(t=>t.at).join()==='8192,10240,12288');
 ok('a sprite block named ...SPR4 starts at picture 4',g.tables.find(t=>t.role==='sprites').first===4);
 ok('the example screen has nothing to complain about',SC.check(spec,g).length===0,SC.check(spec,g));}
const problems=(text)=>{const {spec,g}=load(text);return SC.check(spec,g).map(p=>p.text);};
ok('a missing label is named',problems(TEXT.replace('GFXPAT1\n','GFXOTHER\n')).some(t=>/no label called GFXPAT1/.test(t)),problems(TEXT.replace('GFXPAT1\n','GFXOTHER\n')));
ok('a grid that is a line short is explained',problems(TEXT.replace(/GFXMAP\n       BYTE [^\n]*\n/,'GFXMAP\n')).some(t=>/GFXMAP holds 760 bytes, but the screen grid is 768/.test(t)));
ok('a shape table that is a line short is explained',problems(TEXT.replace(/GFXCOL2\n       BYTE [^\n]*\n/,'GFXCOL2\n')).some(t=>/GFXCOL2 holds 2040 bytes, but one band of colours is 2048/.test(t)));
ok('a sprite list with no >D0 is explained',problems(TEXT.replace('       BYTE >D0\n','')).some(t=>/GFXSLIST never reaches >D0/.test(t)));
ok('a sprite list that ends in >D0 is fine, even as a whole entry',problems(TEXT.replace('       BYTE >D0\n','       BYTE >D0,>00,>00,>00\n')).length===0);
ok('a sprite block that is not whole pictures is explained',problems(TEXT.replace(/GFXSPR4\n       BYTE [^\n]*\n/,'GFXSPR4\n       BYTE >FF,>C0,>A0\n')).some(t=>/not a whole number of sprite pictures/.test(t)));
ok('the wrong number of tables for the bands is explained',problems(TEXT.replace('patterns=GFXPAT0,GFXPAT1,GFXPAT2','patterns=GFXPAT0,GFXPAT1')).some(t=>/3 bands need 3 shapes tables/.test(t)));
ok('a start label that does not exist is reported',problems(TEXT.replace('GFXRUN LIMI','GFXELSE LIMI')).some(t=>/no label called GFXRUN/.test(t)));
ok('an unknown kind is said so',problems(TEXT.replace('ti-bitmap','zx-bitmap')).some(t=>/only know the "ti-bitmap"/.test(t)));

// ---- the tooltip and the warnings ----
{const {P,spec,g}=load(TEXT);const M=P.get('/x/f');
 ok('"@screen" and its kind are the part that has the tooltip',!!SC.markerAt(M,1,3)&&!!SC.markerAt(M,1,12)&&SC.markerAt(M,1,0)===null&&SC.markerAt(M,1,60)===null&&SC.markerAt(M,0,5)===null,[SC.markerAt(M,1,3)&&1,SC.markerAt(M,1,12)&&1,SC.markerAt(M,1,60)]);
 const parts=SC.hoverParts(spec,g,SC.check(spec,g));
 ok('the tooltip says what the line is, in plain English',/^\*\*A whole screen: 3 bands, shapes at >0000/.test(parts[0]),parts[0]);
 ok('... lists each table with its size and where it goes',/Shapes: `GFXPAT0` \(2048 bytes\), goes to video memory at >0000/.test(parts[1])&&/Screen grid: `GFXMAP` \(768 bytes\)/.test(parts[1])&&/Starts at: `GFXRUN`/.test(parts[1]),parts[1]);
 ok('... and says all is well when it is',/Everything the line names was found/.test(parts[parts.length-1]));
 const bad=load(TEXT.replace(/GFXMAP\n       BYTE [^\n]*\n/,'GFXMAP\n').replace('GFXPAT1\n','GFXOTHER\n'));
 const bp=SC.hoverParts(bad.spec,bad.g,SC.check(bad.spec,bad.g));
 ok('a problem is marked on its table and spelled out',/⚠ Shapes: `GFXPAT1` /.test(bp[1])&&/⚠ Screen grid: `GFXMAP` \(760 bytes\)/.test(bp[1])&&/⚠ There is no label called GFXPAT1/.test(bp[bp.length-1]),bp);
 ok('a kind it does not know gets only the description',SC.hoverParts(SC.parseMarker('@screen c64-bitmap'),{tables:[]},[]).length===1);
 const pf=(text)=>{const q=new Project();q.set('/x/f',text,dia('tms9900'));return SC.problemsFor(q,'/x/f',A.dataBlock);};
 ok('the example screen has no warnings',pf(TEXT).length===0,pf(TEXT));
 const raw=TEXT.split('\n')[1];
 const w1=pf(TEXT.replace('GFXPAT1\n','GFXOTHER\n'));
 ok('a missing name is underlined on that name in the @screen comment',w1.length===1&&w1[0].line===1&&raw.slice(w1[0].start,w1[0].end)==='GFXPAT1'&&w1[0].severity==='warning'&&/no label called GFXPAT1/.test(w1[0].message),w1);
 const w2=pf(TEXT.replace(/GFXMAP\n       BYTE [^\n]*\n/,'GFXMAP\n'));
 ok('a wrong size is underlined on the table name (the one in "grid=")',w2.length===1&&raw.slice(w2[0].start,w2[0].end)==='GFXMAP'&&raw.slice(w2[0].start-5,w2[0].start)==='grid=',w2);
 const w3=pf(TEXT.replace(' regs=>02,>E2,>06,>FF,>03,>3E,>01,>04',''));
 ok('a marker problem sits on "@screen", and a gentle note is only information',w3.length===1&&raw.slice(w3[0].start,w3[0].end)==='@screen'&&w3[0].severity==='info',w3);
 ok('a kind it does not know is not nagged about',pf(TEXT.replace('ti-bitmap','zx-bitmap')).length===0);}

// ---- drawing it ----
{const {spec,g}=load(TEXT);const r=SC.render(spec,g);
 ok('256 x 192 colour numbers, never 0',r.pixels.length===256*192&&r.pixels.every(v=>v>=1&&v<=15));
 ok('top row: solid squares, black on the band-0 colour',px(r,0,0)===1);
 ok('band 0 checker square: white on dark blue',px(r,8,8)===15&&px(r,9,8)===4,[px(r,8,8),px(r,9,8)]);
 ok('band 1 uses its own colours (light yellow-ish A on dark red 6)',px(r,0,64)===10&&px(r,1,64)===6,[px(r,0,64),px(r,1,64)]);
 ok('band 2 uses its own shapes and colours',px(r,0,128)===1&&px(r,16,128)===12&&px(r,17,128)===2,[px(r,0,128),px(r,16,128),px(r,17,128)]);
 ok('one sprite is drawn',r.sprites===1);
 ok('its top corners and bottom corner are in the sprite colour',px(r,100,40)===9&&px(r,115,40)===9&&px(r,115,55)===9&&px(r,100,55)===9,[px(r,100,40),px(r,115,40),px(r,115,55)]);
 ok('its middle is see-through, so the screen shows',px(r,105,48)!==9);
 const n=SC.render(spec,g,{sprites:false});
 ok('sprites can be left out',n.sprites===0&&px(n,100,40)!==9&&n.pixels.filter((v,i)=>v!==r.pixels[i]).length>20);
 ok('... and nothing else changes',n.pixels.every((v,i)=>v===r.pixels[i]||r.pixels[i]===9));
 const rr=(f)=>{const L=load(TEXT);f(L);return SC.render(L.spec,L.g);};
 ok('8x8 sprites (register 1) draw only the first picture',px(rr(L=>{L.spec.regs[1]=0xE0;}),107,40)===9&&px(rr(L=>{L.spec.regs[1]=0xE0;}),108,40)!==9);
 ok('doubled sprites are twice the size',px(rr(L=>{L.spec.regs[1]=0xE3;}),131,40)===9&&px(rr(L=>{L.spec.regs[1]=0xE3;}),132,40)!==9);
 ok('the early-clock flag moves a sprite 32 to the left',px(rr(L=>{L.g.tables.find(t=>t.role==='list').bytes[3]=0x89;}),68,40)===9);
 ok('a sprite off the top is cut, not wrapped',px(rr(L=>{L.g.tables.find(t=>t.role==='list').bytes[0]=0xF0;}),100,0)===9);
 ok('colour 0 sprites are not drawn',rr(L=>{L.g.tables.find(t=>t.role==='list').bytes[3]=0x00;}).sprites===0);
 ok('sprites after the >D0 are ignored',rr(L=>{L.g.tables.find(t=>t.role==='list').bytes.splice(0,0,0xD0,0,0,0);}).sprites===0);
 ok('a lower sprite number sits in front',(()=>{const L=load(TEXT);const l=L.g.tables.find(t=>t.role==='list');l.bytes.splice(4,0,0x27,0x64,0x04,0x06);return px(SC.render(L.spec,L.g),100,40)===9;})());
 ok('a see-through colour shows the backdrop (register 7)',(()=>{const L=load(TEXT);L.g.tables.find(t=>t.role==='colours'&&t.index===0).bytes.fill(0x00);return px(SC.render(L.spec,L.g,{sprites:false}),8,8)===4;})());
 ok('a missing table is drawn empty, not a crash',(()=>{const L=load(TEXT.replace('GFXPAT1\n','GFXOTHER\n'));const q=SC.render(L.spec,L.g);return q.pixels.length===49152;})());
 ok('one table for every band is used for all three',(()=>{const L=load(TEXT);L.g.tables=L.g.tables.filter(x=>x.role!=='colours'||x.index===0);const q=SC.render(L.spec,L.g,{sprites:false});return px(q,0,64)===15&&px(q,1,64)===4;})());
 ok('shared=yes draws every band from the first tables',(()=>{const L=load(TEXT);L.spec.shared=true;L.g.tables=L.g.tables.filter(x=>(x.role!=='patterns'&&x.role!=='colours')||x.index===0);const q=SC.render(L.spec,L.g,{sprites:false});return px(q,16,128)===15&&px(q,17,128)===4;})());}

// ---- the page ----
{const html=SH.page('abc123','vscode-resource');
 ok('the page is safe: scripts only with the nonce, nothing loaded from outside',/default-src 'none'/.test(html)&&/script-src 'nonce-abc123'/.test(html)&&!/https?:\/\//.test(html));
 let parses=true;try{new Function('acquireVsCodeApi','document','window',SH.SCRIPT);}catch(e){parses=e.message;}
 ok('the script in the page is valid',parses===true,parses);
 // run the page against a stand-in for the browser, and read back what it painted
 const els={};let painted=null,handler=null,sent=[];
 const el=(id)=>els[id]||(els[id]={id,textContent:'',innerHTML:'',checked:true,className:'',width:0,height:0,classList:{toggle(){}},appendChild(){},getContext:()=>({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:(img)=>{painted=img;}})});
 const doc={getElementById:el,createElement:()=>({appendChild(){},classList:{},set className(v){},textContent:''})};
 new Function('acquireVsCodeApi','document','window','atob',SH.SCRIPT)(()=>({postMessage:(m)=>sent.push(m)}),doc,{addEventListener:(t,f)=>{handler=f;}},(s)=>Buffer.from(s,'base64').toString('binary'));
 const {spec,g}=load(TEXT);const a=SC.render(spec,g,{sprites:false}),b=SC.render(spec,g);
 handler({data:{type:'state',title:'Screen',where:'',about:'',palette:SC.PALETTE,pixels:Buffer.from(a.pixels).toString('base64'),withSprites:Buffer.from(b.pixels).toString('base64'),hasSprites:true,spriteCount:1,notes:[],tables:[],backdrop:'4'}});
 const at=(x,y)=>[...painted.data.slice((y*256+x)*4,(y*256+x)*4+3)].join();
 ok('the page asks for the picture when it starts',sent.some(m=>m.type==='ready'));
 ok('the page paints the sixteen colours in the right places (white square at 8,8, sprite at 100,40)',at(8,8)==='255,255,255'&&at(9,8)==='84,85,237'&&at(100,40)==='255,121,120',[at(8,8),at(9,8),at(100,40)]);
 els.sprites.checked=false;els.sprites.onchange();
 ok('with "show sprites" off, the sprite goes',at(100,40)!=='255,121,120');}

// ---- in the editor (with a stand-in for VS Code) ----
const ext=require('../extension.js');const {providers:PV,commands:C,events,settings}=mock.__;
const ws=fs.mkdtempSync(path.join(os.tmpdir(),'retroasm-scr-'));fs.copyFileSync(fx,path.join(ws,'screen-demo.a99'));
mock.workspace.workspaceFolders=[{uri:mock.Uri.file(ws)}];
function liveDoc(file){let text=fs.readFileSync(file,'utf8');const d={uri:mock.Uri.file(file),languageId:'retroasm',isDirty:false,save:async()=>true,getText:()=>text,get lineCount(){return text.split(/\r?\n/).length;},lineAt:(i)=>({text:text.split(/\r?\n/)[i]}),setText:(t)=>{text=t;}};mock.__.docs.push(d);return d;}
const doc=liveDoc(path.join(ws,'screen-demo.a99'));
const ctx={extensionPath:path.join(__dirname,'..'),subscriptions:[],workspaceState:{get:()=>undefined,update:async()=>{}}};
(async()=>{
 const api=ext.activate(ctx);await new Promise(r=>setTimeout(r,300));
 const lenses=()=>PV.CodeLens.provideCodeLenses(doc);
 const fire=()=>{for(const f of events.change)f({document:doc,contentChanges:[{}]});};
 const titles=lenses().map(l=>l.command.title);
 ok('"Show this screen" appears above the @screen line, with the plain-English line',titles.includes('$(device-desktop) Show this screen')&&titles.some(t=>/^a whole screen: 3 bands, shapes at >0000/.test(t)),titles);
 ok('the link sits on the @screen line',lenses().filter(l=>/Show this screen/.test(l.command.title)).every(l=>l.range.start.line===1));
 settings.screenLinks=false;ok('the links can be switched off',!lenses().some(l=>/screen/i.test(l.command.title)));delete settings.screenLinks;
 const before=mock.__.panels.length;
 ok('the link opens the preview',await C['retroAsm.showScreen'](doc.uri.toString(),1)===true&&mock.__.panels.length===before+1);
 const panel=mock.__.panels[mock.__.panels.length-1];await new Promise(r=>setTimeout(r,60));
 ok('the page is safe in the editor too',/default-src 'none'/.test(panel.webview.html)&&/script-src 'nonce-/.test(panel.webview.html));
 const st=api.screenNow();
 ok('the preview gets the picture, the sprite and the table list',!st.error&&Buffer.from(st.pixels,'base64').length===49152&&st.hasSprites&&st.spriteCount===1&&st.tables.length===10&&st.notes.length===0,st.error||st.notes);
 ok('... and what is where, with sizes',st.tables.find(t=>t.label==='GFXMAP').size==='768 bytes'&&st.tables.find(t=>t.label==='GFXCOL1').at===('>2800'),st.tables);
 // the tooltip
 {const at=(c)=>PV.Hover.provideHover(doc,new mock.Position(1,c));
  const h=at(4),text=h&&h.contents.map(c=>c.value).join('\n');
  ok('hovering on "@screen" explains the line',h&&/A whole screen: 3 bands/.test(text)&&/`GFXMAP`/.test(text)&&/Everything the line names was found/.test(text),text);
  ok('... and it covers just "@screen ti-bitmap"',h&&h.range.start.line===1&&h.range.start.character===2&&h.range.end.character===19,h&&h.range);
  const link=h&&h.contents[h.contents.length-1];
  ok('... with a link that is allowed to open the preview',link&&/command:retroAsm.showScreen\?/.test(link.value)&&link.isTrusted&&link.isTrusted.enabledCommands.join()==='retroAsm.showScreen',link);
  const away=at(80);ok('hovering elsewhere on the line is not the screen tooltip',!away||!/A whole screen/.test(away.contents.map(c=>c.value).join('')));}
 // typing changes the picture
 const t=doc.getText().split('\n');const sl=t.findIndex(l=>l.startsWith('GFXSLIST'));t[sl+1]=t[sl+1].replace('>64','>10');doc.setText(t.join('\n'));fire();
 await new Promise(r=>setTimeout(r,250));const last=panel.sent[panel.sent.length-1];
 ok('moving the sprite in the code updates the preview',last&&last.type==='state'&&last.withSprites!==st.withSprites,last&&last.type);
 // lines move: found again
 doc.setText('* a new line at the top\n'+doc.getText());fire();
 const st2=api.screenNow();ok('after lines move, the screen is found again',!st2.error&&/line 3/.test(st2.where),st2.error||st2.where);
 // a table that is the wrong size shows a note
 doc.setText(doc.getText().replace(/GFXMAP\n       BYTE [^\n]*\n/,'GFXMAP\n'));fire();
 const st3=api.screenNow();ok('a grid that is short shows a plain note and a marked table',st3.notes.some(n=>/GFXMAP holds 760 bytes/.test(n))&&st3.tables.find(t=>t.label==='GFXMAP').ok===false&&/should be 768/.test(st3.tables.find(t=>t.label==='GFXMAP').size),st3.notes);
 // the same problem shows as a warning in the editor
 await new Promise(r=>setTimeout(r,500));
 {const dc=mock.__.collections.find(c=>c.name==='retroasm'),list=dc.get(doc.uri);const w=list.find(d=>/GFXMAP holds 760 bytes/.test(d.message));
  const raw=doc.getText().split('\n')[w&&w.range.start.line]||'';
  ok('a short grid is a warning on its name in the @screen comment',!!w&&/^\* @screen/.test(raw)&&raw.slice(w.range.start.character,w.range.end.character)==='GFXMAP'&&w.source==='Retro ASM',w&&w.message);}
 // the marker goes
 doc.setText(doc.getText().replace(/^\* @screen[^\n]*\n/m,''));fire();
 ok('if the @screen line is deleted, the preview says so',/no @screen/.test(api.screenNow().error||''),api.screenNow().error);
 // other chips
 fs.writeFileSync(path.join(ws,'a.z80'),'; @screen ti-bitmap\nstart: nop\n');const zdoc=liveDoc(path.join(ws,'a.z80'));
 ok('a chip that is not the TI says so and opens nothing',await C['retroAsm.showScreen'](zdoc.uri.toString(),0)===false);
 ok('... and gets no screen links',!PV.CodeLens.provideCodeLenses(zdoc).some(l=>/screen/i.test(l.command.title)));
 console.log(fails?`\n${fails} failed`:'\nall passed');process.exit(fails?1:0);
})().catch(e=>{console.log('FAIL crashed',e&&e.stack||e);process.exit(1);});
