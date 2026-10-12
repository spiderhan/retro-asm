"""Check the Z80 chip file's sizes against SkoolKit's Z80 assembler (pip install skoolkit).

    python test/z80-size-check.py              every way of writing every Z80 instruction
    python test/z80-size-check.py game.asm     every line of a program (sjasmplus / skool2asm style)

A way of writing only counts if SkoolKit turns it into bytes and back into the same text, so
the forms SkoolKit lets through by accident (such as "RL A,B") are left out.
"""
import itertools, json, os, re, subprocess, sys, tempfile, types
from skoolkit import z80
import skoolkit.disassembler as dis

HERE = os.path.dirname(os.path.abspath(__file__))
ASM = z80.Assembler()
CFG = types.SimpleNamespace(defb_size=8, defm_size=66, defw_size=1, handle_rst=False, wrap=False, opcodes='ALL',
                            asm_hex=False, asm_lower=False,
                            imaker=lambda a, op, data, *x: types.SimpleNamespace(address=a, operation=op, data=data))
REGS = set("A B C D E H L I R F AF AF' BC DE HL SP IX IY IXH IXL IYH IYL NZ Z NC PO PE P M".split())
ALU = ('ADD', 'ADC', 'SUB', 'SBC', 'AND', 'OR', 'XOR', 'CP')


def sizes_from_node(lines):
    """Our size for each line, from the extension's own code."""
    src = 'LBL EQU 777\n  ORG 32768\n' + '\n'.join('  ' + l for l in lines) + '\n'
    with tempfile.NamedTemporaryFile('w', suffix='.asm', delete=False) as f:
        f.write(src)
        name = f.name
    js = ("const r=process.argv[1];const fs=require('fs');const {loadFile}=require(r+'/lib/dialect');"
          "const {Project}=require(r+'/lib/project');const D=loadFile(r+'/dialects/z80.json');const P=new Project();"
          "const f=process.argv[2];P.set(f,fs.readFileSync(f,'utf8'),D);const L=P.layout(f).files.get(f);"
          "console.log(JSON.stringify(L.size.map((s,i)=>L.approx[i]?null:s)))")
    out = subprocess.run(['node', '-e', js, os.path.dirname(HERE), name], capture_output=True, text=True, check=True).stdout
    os.unlink(name)
    return json.loads(out)[2:]


def round_trip(text):
    b = ASM.assemble(text, 32768)
    if not b:
        return None
    snap = [0] * 65536
    snap[32768:32768 + len(b)] = b
    ins = dis.Disassembler(snap, CFG).disassemble(32768, 32768 + len(b), 'd')
    if len(ins) != 1:
        return None
    norm = lambda s: s.upper().replace(' ', '')
    want = norm(text).replace('(IX)', '(IX+0)').replace('(IY)', '(IY+0)')
    got = norm(ins[0].operation)
    mn = text.split()[0]
    if got in (want, want.replace('+0)', ')')) or (mn in ALU and got == want.replace(mn + 'A,', mn, 1)):
        return len(b)
    return None


def every_form():
    regs = "A B C D E H L IXH IXL IYH IYL I R F".split()
    pairs = "AF AF' BC DE HL SP IX IY".split()
    mem = "(HL) (BC) (DE) (SP) (C) (IX+5) (IY-3) (IX) (5) (300)".split()
    nums = "0 1 2 5 8 16 56 300".split()
    conds = "NZ Z NC C PO PE P M".split()
    cands = regs + pairs + mem + nums + conds
    names = json.load(open(os.path.join(HERE, '..', 'dialects', 'z80.json')))['instructions'].keys()
    out = {}
    for m in names:
        for n in (0, 1, 2):
            for combo in itertools.product(cands, repeat=n):
                t = m + (' ' + ','.join(combo) if combo else '')
                if m in ('JR', 'DJNZ'):
                    t = t.replace('300', '32770')
                size = round_trip(t)
                if size:
                    out[t] = size
    # each again with a label for the number, and in small letters
    for t, size in list(out.items()):
        l = re.sub(r'(^|[ ,(+-])(300|5)(?=$|[,)])', lambda q: q.group(1) + 'LBL', t)
        out[l] = size
        out[t.lower()] = size
    return out


def from_file(path):
    out = {}
    for raw in open(path, encoding='utf8'):
        code = re.sub(r';.*', '', raw).strip()
        code = re.sub(r'^[A-Za-z_.][\w.]*:?\s+(?=[a-zA-Z])', '', code) if not raw[:1].isspace() else code
        if not code:
            continue
        mn = code.split(None, 1)[0].upper()
        if mn in ('ORG', 'EQU', 'END', 'INCLUDE', 'DEVICE') or mn.startswith('.') or code.endswith(':'):
            continue
        ops = code.split(None, 1)[1] if ' ' in code else ''
        parts = re.split(r'("[^"]*")', ops)
        for i in range(0, len(parts), 2):
            parts[i] = re.sub(r"(?<![$#%0-9A-Za-z_])([A-Za-z_][A-Za-z0-9_.]*'?)",
                              lambda q: q.group(1) if q.group(1).upper() in REGS else '0', parts[i])
        t = mn + ' ' + ''.join(parts)
        b = 2 if mn in ('JR', 'DJNZ') else len(ASM.assemble(t, 32768))
        if b:
            out[code] = b
    return out


def main():
    want = from_file(sys.argv[1]) if len(sys.argv) > 1 else every_form()
    items = list(want.items())
    got = sizes_from_node([t for t, _ in items])
    bad = [(t, w, g) for (t, w), g in zip(items, got) if w != g]
    for t, w, g in bad[:40]:
        print(f'DIFFERENT  {t}: SkoolKit {w} bytes, the extension {g}')
    print(f'{len(items)} checked, {len(bad)} different')
    sys.exit(1 if bad else 0)


main()
