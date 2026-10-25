# Checks the Lua script that runs inside MAME (mame/ti99-bridge.lua) WITHOUT MAME.
# It runs the script in a Lua interpreter against a small pretend MAME and a pretend TI chip.
# The pretend chip copies the two awkward things the real one does (found with the real MAME):
#   - it has already read the next instruction when it stops, and still runs THAT one afterwards,
#     whatever PC was changed to;
#   - a debugger write puts a whole 16-bit word on the bus, so a one-byte write wipes its neighbour.
# The pretend console runs a little loop of "LI R1,0" then "B *R5" (the real console does a lot of "B *R5").
# This proves the script's own logic; it does NOT prove that real MAME behaves the same way.
#   pip install lupa
#   python test/mame-lua-check.py
import json, os, subprocess, sys
from lupa import LuaRuntime

here = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(here)
program = [0x02,0x00,0x12,0x34, 0x02,0x01,0x00,0x05, 0xA0,0x01, 0x10,0xFF]
js = "process.stdout.write(require('./lib/mame').makeScript({blocks:[{addr:0xA000,bytes:%s},{addr:0xA100,bytes:[0xAA,0xBB,0xCC]}],bootFrames:5}))" % json.dumps(program)
script = subprocess.run(['node', '-e', js], cwd=root, capture_output=True, text=True, check=True).stdout

MOCK = r'''
mock = { inq = {}, out = {}, exited = false, stepping = false }
local mem, bps, nextbp = {}, {}, 1
local function word(a) a = a & 0xFFFE; return ((mem[a] or 0) << 8) | (mem[a+1] or 0) end
local function setword(a, v) a = a & 0xFFFE; mem[a] = (v >> 8) & 0xFF; mem[a+1] = v & 0xFF end
-- the pretend console: at 0000  LI R1,>0000 ; at 0004  B *R5 (R5 is 0, so it goes round again)
setword(0, 0x0201); setword(2, 0x0000); setword(4, 0x0455)
local st = { PC = {value=0}, WP = {value=0x83E0}, ST = {value=0}, IR = {value=0} }
for i = 0, 15 do
  st["R"..i] = setmetatable({}, {
    __index = function(t, k) if k == "value" then return word(st.WP.value + 2*i) end end,
    __newindex = function(t, k, v) if k == "value" then setword(st.WP.value + 2*i, v) end end })
end
local log = {}
local debugger = { execution_state = "stop", consolelog = setmetatable({}, { __index = function(_, i) return log[i] end, __len = function() return #log end }) }
debugger.command = function(self, c)
  local verb, arg = c:match("^(%S+)%s*(.*)$")
  if verb == "bpset" then local i = nextbp; nextbp = nextbp + 1; bps[i] = tonumber(arg, 16); log[#log+1] = "Breakpoint " .. i .. " set at " .. arg
  elseif verb == "bpclear" then bps[tonumber(arg)] = nil
  elseif verb == "do" then
    local kind, a, v = arg:match("^([bw])@0x(%x+)=0x(%x+)$"); a = tonumber(a, 16); v = tonumber(v, 16)
    if kind == "w" then mem[a] = v >> 8; mem[a + 1] = v & 0xFF
    elseif a % 2 == 0 then mem[a] = v; mem[a + 1] = 0
    else mem[a - 1] = 0; mem[a] = v end
  elseif verb == "printf" then
    local out = ""
    for a in arg:match('^"[^"]*",(.*)$'):gmatch("b@(%x+)") do out = out .. string.format("%02X", mem[tonumber(a, 16)] or 0) end
    log[#log+1] = out
  elseif verb == "step" then mock.stepping = true
  elseif verb == "go" then debugger.execution_state = "run"
  else error("pretend MAME does not know the command " .. c) end
end
local cpu = { shortname = "tms9900", state = st }
cpu.spaces = { program = { readv_u8 = function() return 0x04 end, writev_u8 = function() end } }

local decoded = nil     -- the instruction read at the last stop, not yet run
local function run_instruction(ir, pa)       -- pa = PC after the hook has added 2
  if ir >= 0x0450 and ir <= 0x045F then st.PC.value = st["R" .. (ir & 15)].value            -- B *Rn
  elseif ir == 0x0201 then st.R1.value = word(pa); st.PC.value = (pa + 2) & 0xFFFF           -- LI R1,x (console)
  elseif ir >= 0x0200 and ir <= 0x020F then st["R"..(ir & 15)].value = word(pa); st.PC.value = (pa + 2) & 0xFFFF   -- LI
  elseif (ir & 0xF000) == 0xA000 then
    local s, d = "R"..(ir & 15), "R"..((ir >> 6) & 15)
    st[d].value = (st[d].value + st[s].value) & 0xFFFF; st.PC.value = pa
  elseif (ir & 0xFF00) == 0x1000 then
    local disp = ir & 0xFF; if disp >= 128 then disp = disp - 256 end
    st.PC.value = (pa + 2*disp) & 0xFFFF
  else error("pretend chip does not know opcode " .. string.format("%04X", ir)) end
end
local function hit_bp(pc) for _, a in pairs(bps) do if a == pc then return true end end return false end
function mock.engine()
  if debugger.execution_state == "stop" and not mock.stepping then
    if decoded == nil then decoded = word(st.PC.value); st.IR.value = decoded end   -- it stops with the next instruction read
    return
  end
  local executed = 0
  mock.runs = (mock.runs or 0) + 1       -- a slightly different amount each time, as real timing is
  for _ = 1, 3000 + (mock.runs % 3) do
    if decoded == nil then
      local pc = st.PC.value
      decoded = word(pc); st.IR.value = decoded
      if (mock.stepping and executed > 0) or hit_bp(pc) then
        mock.stepping = false; debugger.execution_state = "stop"; return
      end
    end
    local ir = decoded; decoded = nil
    run_instruction(ir, (st.PC.value + 2) & 0xFFFF)
    executed = executed + 1
  end
end
emu = {
  file = function() return {
    open = function() end,
    write = function(self, s) mock.out[#mock.out+1] = s end,
    read = function(self, n) if #mock.inq == 0 then return "" end return table.remove(mock.inq, 1) end } end,
  register_periodic = function(f) mock.periodic = f end }
manager = { machine = { debugger = debugger, devices = { [":maincpu"] = cpu },
  exit = function() mock.exited = true end } }
'''
lua = LuaRuntime(unpack_returned_tuples=True)
lua.execute(MOCK)
lua.execute(script)
mock = lua.globals().mock

fails = 0
def check(name, cond, extra=''):
    global fails
    if not cond: fails += 1; print('FAIL', name, extra)
    else: print('ok  ', name)

lines = []
def drain():
    while len(mock.out):
        s = mock.out[1]; mock.out = lua.table_from([mock.out[i] for i in range(2, len(mock.out)+1)]) if len(mock.out) > 1 else lua.table()
        lines.extend(x for x in s.split('\n') if x)
def tick(n=1):
    for _ in range(n):
        mock.engine(); mock.periodic()
    drain()
def say(cmd):
    mock.inq[len(mock.inq)+1] = cmd + '\n'
    tick(1)
def last(prefix):
    for l in reversed(lines):
        if l.startswith(prefix): return l
    return None

tick(3)
check('says nothing before hello', not lines, lines)
say('hello'); check('hello is answered', 'ok' in lines, lines)
tick(60)
check('stops at the first instruction, even though the chip had a different one waiting', last('stopped') == 'stopped A000', lines)
check('only one stop is reported for the start', len([l for l in lines if l.startswith('stopped')]) == 1, lines)
say('mem a000 c')
check('the program was put into memory (whole words, so no byte was wiped)', last('mem') == 'mem ' + ''.join('%02X' % b for b in program), last('mem'))
say('mem a100 3'); check('a second, separate block was put in memory too', last('mem') == 'mem AABBCC', last('mem'))
say('regs'); check('workspace pointer was set and PC is the start', 'WP=8300' in last('regs') and 'PC=A000' in last('regs'), last('regs'))
say('setreg R7 BEEF'); say('regs'); check('setreg changes a workspace register', 'R7=BEEF' in last('regs'), last('regs'))
say('setreg R7 1'); say('regs'); check('...and a small value too', 'R7=0001' in last('regs'), last('regs'))
say('setreg ST 2000'); say('regs'); check('setreg changes ST', 'ST=2000' in last('regs'), last('regs'))
say('setreg PC 1234'); check('PC is refused with a plain reason', (last('err') or '').find('PC cannot be changed') >= 0, last('err'))
say('setreg R99 1'); check('a nonsense register is refused', (last('err') or '').find('cannot change') >= 0, last('err'))
say('poke a104 1122'); say('mem a104 2'); check('poke writes bytes', last('mem') == 'mem 1122', last('mem'))
say('poke a105 99'); say('mem a104 2'); check('poke of one odd byte keeps its neighbour', last('mem') == 'mem 1199', last('mem'))
say('bp a008'); say('go'); tick(5)
check('go runs to the breakpoint', last('stopped') == 'stopped A008', lines)
say('regs'); r = last('regs')
check('R0 and R1 are right at the breakpoint', 'R0=1234' in r and 'R1=0005' in r, r)
n = len([l for l in lines if l.startswith('stopped')])
say('step'); tick(8)
check('a step stops once, at the next instruction', last('stopped') == 'stopped A00A' and len([l for l in lines if l.startswith('stopped')]) == n + 1, lines)
say('regs'); check('R0 is >1239 after the step', 'R0=1239' in last('regs'), last('regs'))
say('bpclr a008'); say('nonsense'); check('unknown command gives a plain err', last('err') is not None, lines)
say('quit'); check('quit closes MAME', mock.exited is True)
print(('%d problem(s).' % fails) if fails else 'All good.')
sys.exit(1 if fails else 0)
