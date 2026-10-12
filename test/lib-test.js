const path=require('path'),fs=require('fs');
const {loadFile}=require('../lib/dialect');const {Project}=require('../lib/project');const F=require('../lib/features');
const D=loadFile(path.join(__dirname,'../dialects/tms9900.json'));
const P=new Project();
const fx=path.join(__dirname,'fixtures');
for(const f of ['game.a99','data.a99','paddle.a99']) P.set(path.join(fx,f),fs.readFileSync(path.join(fx,f),'utf8'),D);
const g=path.join(fx,'game.a99'), m=path.join(fx,'paddle.a99');
const show=(file,needle,sub)=>{const M=P.get(file);const ln=M.rawLines.findIndex(l=>l.includes(needle));const ch=M.rawLines[ln].indexOf(sub||needle.trim().split(/\s+/)[0]);const h=F.hoverAt(P,file,ln,ch+1);console.log('\n### '+needle.trim()+'  ['+(sub||'mnem')+']');console.log(h?h.parts.join('\n\n'):'(no hover)');};
const args=process.argv.slice(2);
if(args[0]==='hover'){
 const G=P.get(g);
 for(const [n,s] of [['MOVB *R1+,@VDPWD','MOVB'],['MOV  R7,R7','MOV'],['LI   R0,FIRST_ZONE','LI'],['MOV  @ZONE_LIST(R1)','MOV'],['MOVB @32(R3)','MOVB'],['CB   @-1(R3)','CB'],['AI   R1,->0100','AI'],['SLA  R3,2','SLA'],['SLA  R4,0','SLA'],['MPY  R5,R1','MPY'],['AI   R3,ZONE_BUF-64','AI'],['LDCR R1,3','LDCR'],['STCR R2,8','STCR'],['BLWP @>0000','BLWP'],['B    *R11','B'],['BL   @SET_VIDEO','BL'],['LIMI 0','LIMI'],['LWPI WRKSP','LWPI'],['JNE  MN_FILL','JNE'],['CB   @BONUS_DIGIT','CB'],['MOVB @ONE_BYTE,@ROVER_FACE','MOVB'],['B    @MENU','B'],['LI   R1,ZONE_LIST','LI']]) show(g,n,s);
} else if(args[0]==='sym'){
 show(g,'BL   @SET_VIDEO','SET_VIDEO');show(g,'MOVB *R1+,@VDPWD','VDPWD');show(g,'LI   R1,>8000','>8000');show(g,'MOVB *R1+,@VDPWD','R1');show(g,'MPY  R5,R1','R5');show(g,'MOV  R11,@SAVE_RET','R11');show(g,'CB   @BONUS_DIGIT','BONUS_DIGIT');show(g,'CB   @BONUS_DIGIT','ONE_BYTE');show(g,'LI   R1,ZONE_LIST','ZONE_LIST');show(g,'MSG_ROW    EQU','MSG_ROW');show(g,'MOVB *R1+,@VDPWD','*R1+');show(g,'COPY "data.a99"','data');show(g,'BYTE >E2','BYTE');show(g,'EVEN  ','EVEN');show(g,'... then falls through into MENU','MENU');
 show(m,'BLANK  BLWP @VSBW','VSBW');show(m,'MOVB @>8379,R3','>8379');show(m,'WS     BSS','BSS');show(m,'RT   ','RT');show(m,'MOVB R5,@SPRITE+1','SPRITE');show(m,'CLR  R0','R0');
} else if(args[0]==='parse'){
 for(const f of [g,m]){const M=P.get(f);M.lines.forEach((pl,i)=>{if(pl.mnem||pl.label)console.log(String(i+1).padStart(3),(pl.label?pl.label.name:'').padEnd(14),(pl.mnem?pl.mnem.text:'').padEnd(5),JSON.stringify(pl.operands.map(o=>o.text)),pl.comment?'| '+pl.comment.text.slice(0,30):'');});}
} else if(args[0]==='misc'){
 for(const f of [g,m]){console.log('\n== outline',path.basename(f));for(const n of F.buildOutline(P,f)){console.log(`${n.kind.padEnd(8)} ${n.name.padEnd(16)} ${n.line+1}-${n.endLine+1}  ${n.detail}`);for(const c of n.children)console.log(`   - ${c.name} ${c.line+1}-${c.endLine+1}`);}
 console.log('== checks');for(const c of F.check(P,f))console.log(` ${c.line+1}: ${c.message}`);
 console.log('== folds',JSON.stringify(F.foldingRanges(P,f).map(r=>[r.start+1,r.end+1,r.kind[0]])));
 console.log('== tokens',F.semanticTokens(P,f).length, 'unit',P.unit(f).map(x=>path.basename(x)));}
 console.log(F.explainLines(P,g,36,48));
 // addresses of the original game, looked up in the made-up .skool file
 const S=require('../lib/skool');const sk=S.findSkool(g,'');const ix=S.parseSkool(fs.readFileSync(sk,'utf8'));
 console.log('\n== original',path.basename(sk),S.hex4(ix.min),'to',S.hex4(ix.max),ix.entries.length,'entries');
 P.get(g).lines.forEach((pl,i)=>{if(!pl.comment)return;for(const r of S.findRefsInText(pl.comment.text)){const x=S.lookup(ix,r.addr);console.log(` ${i+1}: ${S.hex4(r.addr)} -> ${x?`line ${x.line+1}${x.exact?'':' (inside)'}: ${x.entry.title}`:'not in the file'}`);}});
}
