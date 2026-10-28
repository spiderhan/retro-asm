// Tests for the sound player: node test/sound-test.js (ext-test.js runs it too).
const Module=require('module');const path=require('path');const fs=require('fs');const os=require('os');
const mock=require('./mock-vscode');const orig=Module._load;Module._load=function(req,...r){return req==='vscode'?mock:orig.call(this,req,...r)};
const {loadFile}=require('../lib/dialect');const {Project}=require('../lib/project');const A=require('../lib/analysis');const F=require('../lib/features');const SN=require('../lib/sound');const SH=require('../lib/sound-html');
let fails=0;const ok=(name,cond,extra)=>{if(!cond){fails++;console.log('FAIL',name,extra===undefined?'':JSON.stringify(extra));}else console.log('ok  ',name);};
const dia=(id)=>loadFile(path.join(__dirname,'../dialects',id+'.json'));
const one=(id,text)=>{const P=new Project();P.set('/x/f',text,dia(id));return P;};
// how often the wave crosses zero, per second: a stand-in for "what pitch is it"
const hz=(out,sr)=>{let z=0;for(let i=1;i<out.length;i++)if((out[i]>0)!==(out[i-1]>0))z++;return z/2/(out.length/sr);};
const play=(bytes)=>{const a=SN.analyse(bytes);const f=SN.chipFrames(a.steps);return {a,f,out:SN.renderFrames(f.frames,44100)};};

// ---- reading a list ----
{const a=SN.analyse([3,0x8E,0x0F,0x90,10, 1,0x9F,1, 0]);
 ok('two steps, 11 sixtieths, properly ended',a.steps.length===2&&a.ticks===11&&a.ended&&a.spare===0,a);
 ok('a step keeps its bytes and its wait',JSON.stringify(a.steps[0])===JSON.stringify({bytes:[0x8E,0x0F,0x90],ticks:10}));}
ok('bytes after the ending are counted, not played',SN.analyse([1,0x9F,1,0,7,7]).spare===2);
ok('a list that stops in the middle of a step is explained',/Step 2 says 5 bytes/.test(SN.analyse([1,0x9F,1, 5,0x80,0x01]).error||''),SN.analyse([1,0x9F,1,5,0x80,0x01]));
ok('a list with no ending still plays, and says so',(()=>{const a=SN.analyse([1,0x9F,4]);return !a.error&&a.ended===false&&a.ticks===4;})());
ok('a list that is only an ending is explained',/empty/.test(SN.analyse([0]).error||''));
ok('over a minute is cut short',(()=>{const a=SN.analyse([1,0x90,255, 1,0x90,255, 1,0x90,255, 1,0x90,255, 1,0x90,255, 1,0x90,255, 1,0x90,255, 1,0x90,255, 1,0x90,255, 1,0x90,255, 1,0x90,255, 1,0x90,255, 1,0x90,255, 1,0x90,255, 1,0x90,255, 1,0x90,255, 1,0x90,255, 0]);const f=SN.chipFrames(a.steps);return a.tooLong&&f.truncated&&f.frames.length===SN.MAX_TICKS;})());

// ---- the sound chip ----
{const {f}=play([3,0x8E,0x0F,0x90,6, 0]);
 ok('pitch: low 4 bits then high 6 bits make 254',f.frames[0].per[0]===254,f.frames[0]);
 ok('0 is the loudest, 15 off, and voices start off',f.frames[0].att.join()==='0,15,15,15',f.frames[0].att);}
{const {out}=play([3,0x8E,0x0F,0x90,30, 0]);const h=hz(out,44100);
 ok('a 254 pitch number sounds near 440 Hz',Math.abs(h-440)<12,h);
 ok('it makes sound',out.some(v=>Math.abs(v)>0.1));}
{const {out}=play([3,0x8E,0x0F,0x9F,30, 0]);ok('voice off is silent',out.every(v=>v===0));}
{const {f}=play([1,0x90,3, 1,0x92,3, 0]);ok('a quieter step is 2 dB lower each number',f.frames[0].att[0]===0&&f.frames[3].att[0]===2);
 const q=play([1,0x90,5,0]).out,r=play([1,0x95,5,0]).out;const pk=(o)=>Math.max(...o);
 ok('quietness 5 is clearly softer than full volume',pk(r)<pk(q)*0.5&&pk(r)>0,[pk(q),pk(r)]);}
{const {f}=play([2,0x90,0x40,2, 0]);ok('a following byte after a volume sets the volume too (low 4 bits)',f.frames[0].att[0]===0);}
{const {f}=play([4,0xA1,0x02,0xC1,0x03,1, 0]);ok('voices 2 and 3 are set independently',f.frames[0].per[1]===(2<<4|1)&&f.frames[0].per[2]===(3<<4|1),f.frames[0].per);}
{const w=play([2,0xE4,0xF0,20, 0]),p=play([2,0xE0,0xF0,20, 0]);
 ok('noise sounds, and quiet voices stay quiet',w.out.some(v=>Math.abs(v)>0.1));
 ok('hiss and buzz are not the same sound',w.out.join('').length>0&&w.out.some((v,i)=>v!==p.out[i]));
 ok('noise settings are kept',w.f.frames[0].nc===4&&p.f.frames[0].nc===0);}
{const a=play([2,0xE7,0xF0,10, 0]).f;ok('noise following voice 3 is remembered (setting 3)',a.frames[0].nc===7&&(a.frames[0].nc&3)===3);}
{const {out,f}=play([1,0x9F,0, 1,0x90,0, 0]);ok('a step that waits 0 changes the sound but takes no time',f.frames.length===0&&out.length===0);}
{const {f}=play([3,0x8E,0x0F,0x90,2, 1,0x92,2, 0]);ok('later steps keep what earlier ones set',f.frames[2].per[0]===254&&f.frames[2].att[0]===2,f.frames[2]);}

// ---- the example file ----
const ex=path.join(__dirname,'../examples/sounds/sounds.a99');
{const P=new Project();P.set(ex,fs.readFileSync(ex,'utf8'),dia('tms9900'));
 ok('sounds.a99: no warnings',F.check(P,ex).filter(c=>c.severity!=='hint').length===0,F.check(P,ex).map(c=>c.message));
 const got={};for(const m of SN.markedBlocks(P,ex,A.dataBlock)){const a=SN.analyse(A.dataBlock(P,ex,m.line).bytes);got[m.label]=a.error||`${a.steps.length}/${a.ticks}`;}
 ok('sounds.a99: the three marked sounds are found and read',JSON.stringify(got)===JSON.stringify({BEEP:'2/11',ZAP:'5/12',CHORD:'2/31'}),got);
 const up=P.get(ex).rawLines.findIndex(l=>l.startsWith('SND_UP'));
 ok('sounds.a99: SND_UP is not marked but reads as a sound',!SN.markedBlocks(P,ex,A.dataBlock).some(m=>m.label==='SND_UP')&&SN.looksLikeSound(A.dataBlock(P,ex,up)));}
// ---- what is NOT taken for a sound ----
{const P=one('tms9900','PAT_ROCK BYTE >3C,>7E,>FF,>DB,>FF,>7E,>3C,>18\n');ok('a picture is not offered as a sound',!SN.looksLikeSound(A.dataBlock(P,'/x/f',0)));
 const Q=one('tms9900','TABLE BYTE 3,>8E,>0F,>90,10,0\n');ok('a sound-shaped block with no sound name or comment is left alone',!SN.looksLikeSound(A.dataBlock(Q,'/x/f',0)));
 const R=one('tms9900','* the music table\nTABLE BYTE 9,1,2\n');ok('a sound-named block that does not read as a list is left alone',!SN.looksLikeSound(A.dataBlock(R,'/x/f',1)));
 const T=one('tms9900','* This text mentions @sound but is not one\nPAT1   BYTE 1,2,3,4,5,6,7,8\n');ok('a comment that only mentions @sound is not a marker',SN.markedBlocks(T,'/x/f',A.dataBlock).length===0);
 const U=one('tms9900','BEEP   BYTE 3,>8E,>0F,>90,10,0 ; @sound\n');ok('a marker at the end of the first line counts',SN.markedBlocks(U,'/x/f',A.dataBlock).length===1);
 ok('only the TI chip file turns the player on',!!SN.settings(dia('tms9900'))&&['z80','6502','bbc','gpl'].every(id=>!SN.settings(dia(id))));}
// ---- the page ----
{const html=SH.page('abc123','vscode-resource');
 ok('the page is safe: scripts only with the nonce, nothing loaded from outside',/default-src 'none'/.test(html)&&/script-src 'nonce-abc123'/.test(html)&&!/https?:\/\//.test(html));
 let parses=true;try{new Function('acquireVsCodeApi','document','window',SH.SCRIPT.replace(/^const vscode.*$/m,''));}catch(e){parses=e.message;}
 ok('the script in the page is valid',parses===true,parses);
 // run the page's own copies of the sound code and compare with the library
 const sandbox=new Function(SH.SCRIPT.split('const $ =')[0].replace(/^const vscode.*$/m,'')+';return {chipFrames,renderFrames};')();
 const a=SN.analyse([3,0x8E,0x0F,0x90,10,2,0xE4,0xF0,5,0]);
 const x=sandbox.renderFrames(sandbox.chipFrames(a.steps).frames,44100),y=SN.renderFrames(SN.chipFrames(a.steps).frames,44100);
 ok('the page makes exactly the same sound as the library',x.length===y.length&&x.every((v,i)=>v===y[i]));}

// ---- in the editor (with a stand-in for VS Code) ----
const ext=require('../extension.js');const {providers:PV,commands:C,events,settings}=mock.__;
const ws=fs.mkdtempSync(path.join(os.tmpdir(),'retroasm-snd-'));fs.copyFileSync(ex,path.join(ws,'sounds.a99'));
mock.workspace.workspaceFolders=[{uri:mock.Uri.file(ws)}];
function liveDoc(file){let text=fs.readFileSync(file,'utf8');const d={uri:mock.Uri.file(file),languageId:'retroasm',isDirty:false,save:async()=>true,getText:()=>text,get lineCount(){return text.split(/\r?\n/).length;},lineAt:(i)=>({text:text.split(/\r?\n/)[i]}),setText:(t)=>{text=t;}};mock.__.docs.push(d);return d;}
const doc=liveDoc(path.join(ws,'sounds.a99'));
const ctx={extensionPath:path.join(__dirname,'..'),subscriptions:[],workspaceState:{get:()=>undefined,update:async()=>{}}};
(async()=>{
 const api=ext.activate(ctx);await new Promise(r=>setTimeout(r,300));
 const lenses=()=>PV.CodeLens.provideCodeLenses(doc);
 const fire=()=>{for(const f of events.change)f({document:doc,contentChanges:[{}]});};
 const lineOf=(p)=>doc.getText().split('\n').findIndex(l=>l.startsWith(p));
 let titles=lenses().map(l=>l.command.title);
 ok('"Play sound" above each of the three marked sounds',titles.filter(t=>/Play sound/.test(t)).length===3,titles);
 ok('"Play as a sound?" above SND_UP only',lenses().filter(l=>/Play as a sound\?/.test(l.command.title)).length===1&&lenses().some(l=>/Play as a sound\?/.test(l.command.title)&&doc.lineAt(l.range.start.line).text.startsWith('SND_UP')),titles);
 ok('steps and seconds are shown',titles.includes('2 steps, 0.18 s')&&titles.includes('5 steps, 0.20 s'),titles);
 settings.soundLinks=false;ok('the links can be switched off',!lenses().some(l=>/sound/i.test(l.command.title)));delete settings.soundLinks;
 // open BEEP
 const beep=lineOf('BEEP');
 ok('the link opens the player',await C['retroAsm.playSound'](doc.uri.toString(),beep)===true&&mock.__.panels.length>=1);
 const panel=mock.__.panels[mock.__.panels.length-1];await new Promise(r=>setTimeout(r,60));
 ok('the page is safe in the editor too',/default-src 'none'/.test(panel.webview.html)&&/script-src 'nonce-/.test(panel.webview.html));
 const st=api.soundNow();
 ok('the player gets BEEP with its steps and what each byte does',st.title==='BEEP'&&!st.error&&st.steps.length===2&&st.ticks===11&&/voice 1/.test(st.steps[0].items[0].text)&&st.steps[0].items[0].hex==='>8E',st.error||st);
 // typing in the code changes the sound
 const t=doc.getText().split('\n');t[beep]=t[beep].replace(',10',',20');doc.setText(t.join('\n'));fire();
 await new Promise(r=>setTimeout(r,80));const last=panel.sent[panel.sent.length-1];
 ok('typing a new wait updates the player',last&&last.type==='state'&&last.ticks===21,last&&last.ticks);
 // lines move: found again by name
 doc.setText('* a new line at the top\n'+doc.getText());fire();
 const st2=api.soundNow();ok('after lines move, the sound is found again by its label',st2.title==='BEEP'&&!st2.error&&st2.ticks===21,st2.error);
 // the cursor
 const lz=lineOf('ZAP');mock.window.activeTextEditor={document:doc,selection:{active:new mock.Position(lz+1,0),start:new mock.Position(lz+1,0)}};
 ok('with no link, the cursor in a block plays that block',await C['retroAsm.playSound']()===true&&api.soundNow().title==='ZAP');
 // the unmarked one
 const beforeText=doc.getText();
 ok('Play as a sound? opens SND_UP',await C['retroAsm.playSound'](doc.uri.toString(),lineOf('SND_UP'))===true&&api.soundNow().title==='SND_UP'&&api.soundNow().steps.length===4);
 ok('... without changing the file',doc.getText()===beforeText);
 // a broken list
 const t3=doc.getText().split('\n');const bi=t3.findIndex(l=>l.startsWith('SND_UP'));t3[bi]=t3[bi].replace('BYTE 3,','BYTE 9,');doc.setText(t3.join('\n'));fire();await new Promise(r=>setTimeout(r,80));
 ok('a list that does not add up shows a clear message',/^Step \d+ says \d+ bytes/.test(api.soundNow().error||''),api.soundNow().error);
 ok('and its link turns into a warning only if marked (this one is just not offered)',!lenses().some(l=>/Play as a sound\?/.test(l.command.title)));
 // a chip with no sound player
 fs.writeFileSync(path.join(ws,'a.z80'),'snd:  DB 1,2,3\n');const zdoc=liveDoc(path.join(ws,'a.z80'));
 mock.__.info=mock.__.info||[];
 ok('a chip without a sound player says so and opens nothing',await C['retroAsm.playSound'](zdoc.uri.toString(),0)===false&&api.soundNow().title==='SND_UP');
 ok('and gets no sound links',!PV.CodeLens.provideCodeLenses(zdoc).some(l=>/sound/i.test(l.command.title)));
 console.log(fails?`\n${fails} failed`:'\nall passed');process.exit(fails?1:0);
})().catch(e=>{console.log('FAIL crashed',e&&e.stack||e);process.exit(1);});
