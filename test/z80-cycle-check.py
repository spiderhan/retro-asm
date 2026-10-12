"""Check the Z80 chip file's cycle counts (T-states) against SkoolKit's Z80 simulator (pip install skoolkit).

    python test/z80-cycle-check.py

Every way of writing every Z80 instruction (the same list test/z80-size-check.py uses) is put into
memory and run once by SkoolKit, with the flags all clear and all set and with B and BC at 1 and 2,
so both times of a jump or a repeat are seen. The numbers must match the ones the tooltip gives.
"""
import json, os, subprocess, sys, tempfile
from skoolkit import z80
from skoolkit.simulator import Simulator

HERE = os.path.dirname(os.path.abspath(__file__))
sys.argv = sys.argv[:1]
src = open(os.path.join(HERE, 'z80-size-check.py'), encoding='utf8').read().replace('\nmain()\n', '\n')
exec(compile(src, 'z80-size-check.py', 'exec'))          # every_form() and friends, without running its main()
ASM2 = z80.Assembler()


def measured(text):
    b = ASM2.assemble(text, 32768)
    seen = set()
    for f in (0, 0xFF):
        for bc in ((0, 1), (0, 2), (1, 1), (2, 2)):
            mem = [0] * 65536
            mem[32768:32768 + len(b)] = b
            sim = Simulator(mem, {'PC': 32768, 'F': f, 'B': bc[0], 'C': bc[1], 'SP': 40000, 'A': 1, 'HL': 50000})
            t0 = sim.registers[25]
            sim.run()
            seen.add(sim.registers[25] - t0)
    return sorted(seen)


def ours(lines):
    src = 'LBL EQU 777\n  ORG 32768\n' + '\n'.join('  ' + l for l in lines) + '\n'
    with tempfile.NamedTemporaryFile('w', suffix='.asm', delete=False) as f:
        f.write(src)
        name = f.name
    js = ("const r=process.argv[1];const fs=require('fs');const {loadFile}=require(r+'/lib/dialect');"
          "const {Project}=require(r+'/lib/project');const F=require(r+'/lib/features');const X=require(r+'/lib/explain');"
          "const D=loadFile(r+'/dialects/z80.json');const P=new Project();const f=process.argv[2];"
          "P.set(f,fs.readFileSync(f,'utf8'),D);const m=P.get(f);const ctx=F.makeCtx(P,f);const out=[];"
          "for(let i=2;i<m.lines.length;i++){const pl=m.lines[i];if(!pl.mnem)continue;const ins=D.instr(pl.mnem.upper);"
          "const t=ins?X.timeFor(ins,pl,ctx,i):null;out.push(t?[...new Set(t.values)].sort((a,b)=>a-b):null)}"
          "console.log(JSON.stringify(out))")
    out = subprocess.run(['node', '-e', js, os.path.dirname(HERE), name], capture_output=True, text=True, check=True).stdout
    os.unlink(name)
    return json.loads(out)


def main():
    forms = sorted(every_form())
    plain = {t: measured(t) for t in forms if 'LBL' not in t and t == t.upper()}
    def expect(t):
        # the copies with a label or in small letters take the same time as the one they came from
        for n in ('5', '300', '32770'):
            u = t.upper().replace('LBL', n)
            if u in plain:
                return plain[u]
        return None
    want = [expect(t) for t in forms]
    got = ours(forms)
    bad = [(t, w, g) for t, w, g in zip(forms, want, got) if w is None or w != g]
    for t, w, g in bad[:40]:
        print(f'DIFFERENT  {t}: SkoolKit {w}, the extension {g}')
    print(f'{len(forms)} checked, {len(bad)} different')
    sys.exit(1 if bad else 0)


main()
