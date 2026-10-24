// Tests for end-marker labels: node test/marker-test.js (ext-test.js runs it too).
// The sample code is made up (test/fixtures/markers.a99).
const path=require('path'),fs=require('fs');
const {loadFile}=require('../lib/dialect');const {Project}=require('../lib/project');const F=require('../lib/features');
let fails=0;const ok=(name,cond,extra)=>{if(!cond){fails++;console.log('FAIL',name,extra===undefined?'':JSON.stringify(extra));}else console.log('ok  ',name);};
const D=loadFile(path.join(__dirname,'../dialects/tms9900.json'));const P=new Project();
const f=path.join(__dirname,'fixtures','markers.a99');P.set(f,fs.readFileSync(f,'utf8'),D);
const out=F.buildOutline(P,f);const tops=out.filter(n=>n.kind==='routine').map(n=>n.name);
const kids=n=>(out.find(x=>x.name===n)||{children:[]}).children.map(c=>c.name);
ok('called routines are routines',tops.includes('START')&&tops.includes('SHOW'),tops);
ok('a label reached only by jumps is inside its routine',kids('START').includes('AGAIN')&&kids('SHOW').includes('LOOP'),out.map(n=>[n.name,kids(n.name)]));
ok('an unused label with code after it is still a routine',tops.includes('NEXT'),tops);
ok('an end marker is not a routine',!tops.includes('MSGEND')&&!tops.includes('MSG2END'),tops);
ok('an end marker sits under the text above it',kids('MSG').includes('MSGEND')&&kids('MSG2').includes('MSG2END'),out.map(n=>[n.name,kids(n.name)]));
const M=P.get(f);const tok=name=>{const ln=M.rawLines.findIndex(l=>l.startsWith(name));const t=F.semanticTokens(P,f).find(x=>x.line===ln&&x.start===0);return t&&t.type;};
ok('an end marker has the label colour',tok('MSGEND')==='label',tok('MSGEND'));
ok('a called routine keeps the routine colour',tok('SHOW')==='function',tok('SHOW'));
process.exit(fails?1:0);
