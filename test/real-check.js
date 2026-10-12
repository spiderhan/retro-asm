// Run the checks over a folder of real source files: node test/real-check.js <folder> [how many warnings to show]
// .a99 files are read as TMS9900. .z80, .asm, .a80, .s and .6502 files as Z80, 6502 (C64) or 6502 (BBC Micro), whichever fits the code.
const path=require('path'),fs=require('fs');const {loadFile,guessDialect}=require('../lib/dialect');const {Project}=require('../lib/project');const F=require('../lib/features');
const dir=path.resolve(process.argv[2]);const chip=(n)=>loadFile(path.join(__dirname,'../dialects/'+n+'.json'));
const TI=chip('tms9900'),others=[chip('6502'),chip('bbc'),chip('z80')];const P=new Project();P.fileSize=(p)=>{try{return fs.statSync(p).size;}catch(e){return null;}};
const files=fs.readdirSync(dir).filter(f=>/\.(a99|z80|asm|a80|s|6502)$/i.test(f)).map(f=>path.join(dir,f));
for(const f of files){const text=fs.readFileSync(f,'utf8');P.set(f,text,/\.a99$/i.test(f)?TI:guessDialect(text,others.filter(D=>D.fileExtensions.includes(path.extname(f).toLowerCase()))));}
// files pulled in from other folders (INCLUDE "lib/maths.asm"), read the same way as the file that pulls them in
for(let pass=0;pass<4;pass++)for(const m of [...P.models.values()])for(const inc of m.includes){const t=P.resolveInclude(m.file,inc.name);if(!inc.binary&&!P.get(t)&&fs.existsSync(t))P.set(t,fs.readFileSync(t,'utf8'),m.D);}
for(const f of files){let t=Date.now();const c=F.check(P,f);const o=F.buildOutline(P,f);F.semanticTokens(P,f);const D=P.get(f).D;console.log(`\n== ${path.basename(f)}${D===TI?'':' ('+D.short+')'}: ${P.get(f).lines.length} lines, ${o.length} outline items, ${c.length} warnings, ${Date.now()-t} ms`);for(const x of c.slice(0,+process.argv[3]||15))console.log(`  ${x.line+1}: ${x.message}`);}
