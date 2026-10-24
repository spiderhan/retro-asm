// Tests for the Registers section: node test/regs-test.js (ext-test.js runs it too).
// All the sample code here is made up (test/fixtures/regs*.*).
const path=require('path'),fs=require('fs');
const {loadFile}=require('../lib/dialect');const {Project}=require('../lib/project');const RT=require('../lib/regtrack');
let fails=0;const ok=(name,cond,extra)=>{if(!cond){fails++;console.log('FAIL',name,extra===undefined?'':JSON.stringify(extra));}else console.log('ok  ',name);};
const fx=path.join(__dirname,'fixtures');
function at(chip,file,needle){
  const D=loadFile(path.join(__dirname,'../dialects',chip+'.json'));const P=new Project();const f=path.join(fx,file);
  P.set(f,fs.readFileSync(f,'utf8'),D);const M=P.get(f);const ln=M.rawLines.findIndex(l=>l.includes(needle));
  if(ln<0)throw new Error('no line '+needle);return RT.registersAt(P,f,ln);}
const row=(r,n)=>r.rows.find(x=>x.reg===n);

{ // ---- TI-99/4A ----
 const r=at('tms9900','regs.a99','BL   @PRINT');
 ok('TI: a number loaded with LI is shown',row(r,'R0')&&row(r,'R0').kind==='value'&&row(r,'R0').text==='>0100',row(r,'R0'));
 ok('TI: a label loaded with LI is shown as an address',/address of BUF/.test(row(r,'R3').text),row(r,'R3'));
 ok('TI: MOV from a register that holds a number gives that number',row(r,'R4').kind==='copy'&&row(r,'R4').text==='>0100',row(r,'R4'));
 ok('TI: a register nothing has touched is not listed',!row(r,'R7')&&!row(r,'R9'),r.rows.map(x=>x.reg));
 ok('TI: memory stored to is listed with what was put there',r.memory.some(m=>m.name==='SCORE'&&/R1 \(>4100\)/.test(m.text)),r.memory);
 ok('TI: the line under the cursor is not counted yet',!row(r,'R2'),r.rows.map(x=>x.reg));
 ok('TI: on a call, what the routine needs is checked against what is in the registers',r.call&&r.call.found&&r.call.needs.length===2&&r.call.needs.every(n=>!n.missing&&n.now),r.call);
 ok('TI: on a call, the comment above the routine explains each register',r.call.needs.find(n=>n.reg==='R1').doc==='the letter to print',r.call.needs);
 ok('TI: on a call, the registers it changes are listed (not R11)',r.call.changes==='R2',r.call.changes);
 ok('TI: what a routine gives back comes from its comment',r.call.returns.length===1&&r.call.returns[0].reg==='R2',r.call.returns);
 const after=at('tms9900','regs.a99','AI   R0,2');
 ok('TI: after a call, the registers it changed say so',row(after,'R2').kind==='call'&&/PRINT/.test(row(after,'R2').text),row(after,'R2'));
 ok('TI: R11 (the way back) is left out',!row(after,'R11'),after.rows.map(x=>x.reg));
 const top=at('tms9900','regs.a99','MOV  R0,R2');
 ok('TI: inside a routine, the registers it expects are shown as coming from the caller',row(top,'R0').kind==='entry'&&row(top,'R0').doc==='screen position'&&top.needs.length===2,top.rows);
 ok('TI: a hardware address is named',top.memory.some(m=>/^>8C00 \(Video chip/.test(m.name)),top.memory);
 const rom=at('tms9900','regs.a99','BL   @ROMCALL');
 ok('TI: a call to something outside your code says it cannot tell',rom.call&&!rom.call.found,rom.call);
 // jumps and loops
 const lp=at('tms9900','regloop.a99','JNE  LOOP');
 ok('TI: a register changed in a loop is now "changed", not a number',row(lp,'R1').kind==='changed'&&row(lp,'R2').kind==='value',lp.rows);
 const sk=at('tms9900','regloop.a99','MOV  R2,R4');
 ok('TI: after a jump over a line, the register that line sets is marked unsure',row(sk,'R2').unsure==='SKIP',row(sk,'R2'));
 ok('TI: a register nothing in between touches is not marked unsure',!row(sk,'R3').unsure,row(sk,'R3'));
 const lab=at('tms9900','regloop.a99','LOOP   DEC');
 ok('TI: at the top of a loop, the register the loop changes is unsure',row(lab,'R1').unsure==='LOOP'&&!row(lab,'R2').unsure,lab.rows);
}
{ // ---- Z80 ----
 const r=at('z80','regs.z80','call put');
 ok('Z80: numbers and labels loaded with LD are shown',row(r,'A').text==='$41'&&/address of buffer/.test(row(r,'HL').text)&&row(r,'B').text==='$0A',r.rows);
 ok('Z80: a store to a named place is listed',r.memory.some(m=>m.name==='count'&&/A \(\$41\)/.test(m.text)),r.memory);
 ok('Z80: the call shows what it needs and changes',r.call.needs.map(n=>n.reg).join()==='A,HL'&&r.call.changes==='HL',r.call);
 const s=at('z80','regs.z80','ld a,b');
 ok('Z80: after the call HL is marked as changed by it',row(s,'HL').kind==='call',s.rows);
}
{ // ---- 6502 ----
 const r=at('6502','regs.asm','jsr plot');
 ok('6502: LDA #n gives a number, LDY address gives "what is stored at"',row(r,'A').text==='$41'&&row(r,'X').text==='$03'&&/what is stored at score/.test(row(r,'Y').text),r.rows);
 ok('6502: STA to a named place is listed',r.memory.some(m=>m.name==='total'&&/A \(\$41\)/.test(m.text)),r.memory);
 ok('6502: the call needs A and X, changes X',r.call.needs.map(n=>n.reg).join()==='A,X'&&r.call.changes==='X',r.call);
}
{ // ---- BBC Micro uses the same rules as the C64 ----
 const D=loadFile(path.join(__dirname,'../dialects/bbc.json'));
 ok('BBC: reads operands the 6502 way',D.registerView.bareIs==='memory'&&D.registerView.immediatePrefix==='#'&&D.instr('LDA').copy&&D.instr('STA').store);
 ok('every chip file with registers tells the panel its register size',['tms9900','z80','6502','bbc'].every(id=>loadFile(path.join(__dirname,'../dialects',id+'.json')).registerView.bits>0));
}
console.log(fails?`\n${fails} FAILED`:'\nall passed');process.exit(fails?1:0);
