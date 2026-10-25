-- Retro ASM: the go-between that sits inside MAME and lets the extension control a TI-99/4A.
--
-- The extension puts a line "local CONFIG = { ... }" in front of this text (see lib/mame.js) and
-- gives the whole thing to MAME with -autoboot_script. MAME must be started with -debug, or it
-- does not allow scripts to stop and step the program.
--
-- It talks in plain lines of text over a local connection. The extension sends one line, and gets
-- one line back:
--   hello              -> ok      (start: the machine is allowed to boot and the program is loaded)
--   regs               -> regs PC=A000 WP=8300 ST=0000 R0=0000 ... R15=0000   (all in hex)
--   mem ADDR LEN       -> mem 0200123402010005...                             (ADDR and LEN in hex)
--   setreg NAME VALUE  -> ok        (change R0-R15, WP or ST while stopped; VALUE in hex)
--   poke ADDR HEX      -> ok        (write bytes into memory while stopped)
--   bp ADDR / bpclr ADDR / step / go / pause / quit  -> ok
-- (Breakpoints, step and go use MAME's own debugger commands; they are the steadiest way in.)
-- And it sends these on its own, whenever they happen:
--   stopped PC         (the program stopped: a breakpoint, a step, or a pause, or just loaded)
--   err WORDS          (something went wrong, in plain words)

local sock = emu.file("", 7)
sock:open("socket.127.0.0.1:" .. CONFIG.port)

local debugger, cpu, space
local gotHello, started, loaded = false, false, false
local stopSeen = true           -- true = the last thing we told the extension was "stopped"
local ticks = 0
local fromPc, holdoff = nil, 0   -- after a step or go: ignore a "stop" that is just the old one
local breaks = {}               -- address -> MAME's number for that breakpoint
local nextBreak = 1
local inbuf = ""

local REGS = { "PC", "WP", "ST", "IR" }
for i = 0, 15 do REGS[#REGS + 1] = "R" .. i end

local function send(line) sock:write(line .. "\n") end

local function pc() return cpu.state["PC"].value & 0xFFFF end


-- The TI's memory cannot be read properly by a script's ordinary memory calls (they go through the
-- live bus and give junk). MAME's own debugger commands use a separate clean path, so use those.
local function lastLine()
  local log = debugger.consolelog
  return log[#log] or ""
end

local function read_bytes(a, n)
  local out, i = {}, 0
  while i < n do
    local k = math.min(8, n - i)
    local fmt, args = {}, {}
    for j = 0, k - 1 do
      fmt[#fmt + 1] = "%02X"
      args[#args + 1] = string.format("b@%X", (a + i + j) & 0xFFFF)
    end
    debugger:command('printf "' .. table.concat(fmt) .. '",' .. table.concat(args, ","))
    local hex = lastLine():match("^%s*(%x+)%s*$")
    if not hex or #hex ~= k * 2 then error("could not read memory, MAME said: " .. lastLine()) end
    out[#out + 1] = hex
    i = i + k
  end
  return table.concat(out)
end

-- The TI's debugger write always writes a whole 16-bit word, so a single byte write would wipe the
-- byte next to it. So memory is written a word at a time (a half word at either end of the program
-- is first read, so the byte next to it is kept).
local function write_bytes(a, hex)
  local bytes, n = {}, 0
  for byte in hex:gmatch("%x%x") do
    bytes[(a + n) & 0xFFFF] = tonumber(byte, 16)
    n = n + 1
  end
  if n == 0 then return end
  local first = a & 0xFFFE
  local last = (a + n - 1) | 1
  for w = first, last, 2 do
    local hi, lo = bytes[w], bytes[w + 1]
    if hi == nil or lo == nil then
      local cur = read_bytes(w, 2)
      hi = hi or tonumber(cur:sub(1, 2), 16)
      lo = lo or tonumber(cur:sub(3, 4), 16)
    end
    debugger:command(string.format("do w@0x%X=0x%X", w & 0xFFFF, (hi << 8) | lo))
  end
end

-- MAME says "Breakpoint 3 set at ..."; keep the number so the breakpoint can be cleared later.
local function set_break(a)
  local before = #debugger.consolelog
  debugger:command(string.format("bpset %X", a))
  local idx
  for i = #debugger.consolelog, before + 1, -1 do
    idx = tonumber((debugger.consolelog[i] or ""):match("[Bb]reakpoint (%d+) set"))
    if idx then break end
  end
  local n = idx or nextBreak
  nextBreak = nextBreak + 1
  return n
end

local function handle(line)
  local cmd, rest = line:match("^(%S+)%s*(.*)$")
  if cmd == "hello" then
    gotHello = true
    send("ok")
  elseif cmd == "regs" then
    local out = {}
    for _, r in ipairs(REGS) do out[#out + 1] = string.format("%s=%04X", r, cpu.state[r].value & 0xFFFF) end
    send("regs " .. table.concat(out, " "))
  elseif cmd == "mem" then
    local a, n = rest:match("^(%x+)%s+(%x+)$")
    a, n = tonumber(a, 16), tonumber(n, 16)
    send("mem " .. read_bytes(a, n):upper())
  elseif cmd == "setreg" then
    local name, v = rest:match("^(%S+)%s+(%x+)$")
    if not name then error("setreg needs a register name and a hex value") end
    v = tonumber(v, 16) & 0xFFFF
    local n = name:match("^R(%d+)$")
    if n and tonumber(n) <= 15 then
      -- R0-R15 are really words of memory at the workspace pointer
      local wp = cpu.state["WP"].value & 0xFFFF
      write_bytes(wp + 2 * tonumber(n), string.format("%04X", v))
    elseif name == "WP" or name == "ST" then
      cpu.state[name].value = v
    elseif name == "PC" then
      error("PC cannot be changed (the chip has already read its next instruction); put a breakpoint where you want to go instead")
    else
      error("I cannot change '" .. name .. "'")
    end
    send("ok")
  elseif cmd == "poke" then
    local a, h = rest:match("^(%x+)%s+(%x+)$")
    if not a or #h % 2 ~= 0 then error("poke needs an address and an even number of hex digits") end
    write_bytes(tonumber(a, 16), h)
    send("ok")
  elseif cmd == "bp" then
    local a = tonumber(rest, 16)
    if not breaks[a] then breaks[a] = set_break(a) end
    send("ok")
  elseif cmd == "bpclr" then
    local a = tonumber(rest, 16)
    if breaks[a] then debugger:command("bpclear " .. breaks[a]); breaks[a] = nil end
    send("ok")
  elseif cmd == "step" then
    stopSeen = false
    fromPc, holdoff = pc(), 5
    debugger:command("step")
    send("ok")
  elseif cmd == "go" then
    stopSeen = false
    fromPc, holdoff = pc(), 5
    debugger:command("go")
    send("ok")
  elseif cmd == "probe" then
    -- A diagnostic: write a test byte and read it back through the debugger commands.
    local a = tonumber(rest, 16)
    local out = {}
    local function try(name, f)
      local ok, v = pcall(f)
      out[#out + 1] = name .. "=" .. (ok and tostring(v) or ("error:" .. tostring(v):gsub("[%s]+", "_")))
    end
    try("read2", function() return read_bytes(a, 2) end)
    try("after_write_5A", function() write_bytes(a, "5A"); return read_bytes(a, 2) end)
    try("after_write_A5", function() write_bytes(a, "A5"); return read_bytes(a, 2) end)
    try("console_says", function() return lastLine() end)
    send("probe " .. table.concat(out, " "))
  elseif cmd == "pause" then
    debugger.execution_state = "stop"
    send("ok")
  elseif cmd == "quit" then
    send("ok")
    manager.machine:exit()
  else
    send("err I do not know the command '" .. tostring(cmd) .. "'")
  end
end

-- Starting the program.
-- MAME's TMS9900 has already read the next instruction by the time it stops, and it will still run
-- that one, whatever we do to PC. So PC cannot simply be changed. But if the waiting instruction is
-- "B *Rn" (branch to the address held in register Rn; the console's own program does this all the
-- time), the program can be started by putting its start address into that register of our own
-- workspace. So: stop the machine, look at what is waiting, and if it is "B *Rn" do that;
-- otherwise let it run a moment and try again.
local phase = "boot"        -- boot -> inject (-> retry -> inject ...) -> entering -> done
local attempts, waitTicks, entryBp = 0, 0, nil

local function try_inject()
  local ir = cpu.state["IR"].value & 0xFFFF
  if ir < 0x0450 or ir > 0x045F then return false end
  local n = ir & 15
  for _, b in ipairs(CONFIG.blocks) do write_bytes(b.addr, b.hex) end   -- each separate piece of the program
  write_bytes(CONFIG.wp + 2 * n, string.format("%04X", CONFIG.entry))   -- register Rn = the start address
  cpu.state["WP"].value = CONFIG.wp
  cpu.state["ST"].value = 0           -- interrupts off, so nothing else steals the steps
  return true
end

local lastErr
local function tick()
  if not started then
    debugger = manager.machine.debugger
    if not debugger then
      send("err MAME was not started with -debug, so it will not let a script stop the program")
      started = true
      return
    end
    cpu = manager.machine.devices[":maincpu"]
    space = cpu.spaces["program"]
    started = true
  end
  if not cpu then return end

  -- Read whatever the extension has sent.
  repeat
    local got = sock:read(200)
    inbuf = inbuf .. got
  until #got == 0
  for line in inbuf:gmatch("([^\n]*)\n") do
    local ok, why = pcall(handle, line)
    if not ok then send("err " .. (tostring(why):gsub("\n", " "))) end
  end
  inbuf = inbuf:match("[^\n]*$")

  if not gotHello then
    -- With -debug MAME can start stopped; wait for the extension, then let the machine boot.
    return
  end

  ticks = ticks + 1
  if not loaded then
    if phase == "boot" then
      if ticks == 1 then
        debugger.execution_state = "run"            -- let the console start up
      elseif ticks >= CONFIG.bootFrames then
        debugger.execution_state = "stop"
        phase = "inject"
      end
    elseif phase == "inject" then
      if debugger.execution_state ~= "stop" then return end    -- wait until MAME has really stopped
      if try_inject() then
        print("retro-asm bridge: program loaded; starting it")
        entryBp = set_break(CONFIG.entry)           -- stop again as the program's first instruction comes up
        phase = "entering"
        debugger:command("go")
      else
        attempts = attempts + 1
        if attempts > 400 then
          error("could not find a safe moment to start the program (the console never reached a 'B *Rn' instruction)")
        end
        debugger.execution_state = "run"
        waitTicks = 1
        phase = "retry"
      end
    elseif phase == "retry" then
      waitTicks = waitTicks - 1
      if waitTicks <= 0 then
        debugger.execution_state = "stop"
        phase = "inject"
      end
    elseif phase == "entering" then
      if debugger.execution_state == "stop" then
        if pc() ~= CONFIG.entry then
          error(string.format("the program did not start where expected: PC is %04X, not %04X", pc(), CONFIG.entry))
        end
        debugger:command("bpclear " .. entryBp)
        print("retro-asm bridge: program started, PC is " .. string.format("%04X", pc()))
        loaded = true
        stopSeen = false
        phase = "done"
      end
    end
    return
  end

  -- Tell the extension when the program has stopped.
  if debugger.execution_state == "stop" then
    if not stopSeen then
      if holdoff > 0 and pc() == fromPc then
        holdoff = holdoff - 1       -- probably the old stop; give it a few ticks to really move
      else
        stopSeen = true
        holdoff = 0
        send(string.format("stopped %04X", pc()))
      end
    end
  end
end

-- Any mistake inside the script is reported (to the extension, and to MAME's own text output)
-- instead of being lost.
emu.register_periodic(function()
  local ok, why = pcall(tick)
  if not ok then
    why = tostring(why):gsub("\n", " ")
    if why ~= lastErr then
      lastErr = why
      print("retro-asm bridge error: " .. why)
      send("err " .. why)
    end
  end
end)
