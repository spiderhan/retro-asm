// Compare our addresses with a real xas99 listing: node test/layout-check.js file.a99 file.lst
const path=require('path'),fs=require('fs');const {loadFile}=require('../lib/dialect');const {Project}=require('../lib/project');
const src=path.resolve(process.argv[2]);const D=loadFile(path.join(__dirname,'../dialects/tms9900.json'));const P=new Project();
for(const f of fs.readdirSync(path.dirname(src)).filter(f=>f.endsWith('.a99')))P.set(path.join(path.dirname(src),f),fs.readFileSync(path.join(path.dirname(src),f),'utf8'),D);
P.loadAddress=()=>0;
// listing: "NNNN AAAA WWWW" lines; "> file" / "< file" mark COPY in and out
let stack=[src],checked=0,bad=0,seenLine=new Set();
for(const l of fs.readFileSync(process.argv[3],'utf8').split(/\r?\n/)){
  let m=/^\s+\*{4} \*{4}\s+> (.+)$/.exec(l);if(m){const f=path.join(path.dirname(src),m[1].trim());if(f!==stack[stack.length-1])stack.push(f);continue;}
  m=/^\s+< (.+)$/.exec(l);if(m){stack.pop();continue;}
  m=/^(\d{4}) ([0-9A-F]{4}) /.exec(l);if(!m)continue;
  const file=stack[stack.length-1],ln=+m[1]-1,key=file+':'+ln;if(seenLine.has(key))continue;seenLine.add(key);
  const pl=P.get(file).lines[ln];if(pl.mnem&&pl.mnem.upper==='EQU')continue;
  const info=P.lineInfo(file,ln);checked++;
  if(!info||info.addr!==parseInt(m[2],16)){bad++;if(bad<=8)console.log('MISMATCH',path.basename(file),ln+1,'listing',m[2],'ours',info&&info.addr.toString(16),'|',P.get(file).rawLines[ln].slice(0,50));}
}
const L=P.layout(src);console.log(path.basename(src),'lines checked:',checked,'mismatches:',bad,'end >'+L.relocEnd.toString(16).toUpperCase(),'approx:',L.approx);process.exit(bad?1:0);
