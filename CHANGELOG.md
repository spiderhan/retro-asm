# Changelog

## 0.10.0

New: **starter code for the ZX Spectrum, Commodore 64 and BBC Micro**, the same set as the TI-99/4A: `program`, `routine`, `loop`, and `printchar` (print a letter on the screen with the machine's own ROM routine).

- **Spectrum (sjasmplus):** `program` builds a 48K snapshot with `SAVESNA`, turns interrupts on so `halt` works, and waits at the end.
- **C64 (KickAssembler):** `program` uses `BasicUpstart2`, so LOAD and RUN start it, and goes back to BASIC at the end.
- **BBC Micro (BeebAsm):** `program` starts at `&1900` and has the `SAVE` line that **Build** uses to make a disc that runs by itself.
- On the Spectrum and the BBC, `program` marks where routines go, so they are saved with the rest.
- Checked: the Spectrum code was built with sjasmplus and run in SkoolKit's Spectrum simulator, which showed the "A" on screen. The BBC code was built with BeebAsm and makes a working disc image. The C64 code passes the extension's checks but hasn't been through KickAssembler yet.
- Tests: every chip now has its four, and each set gives no warnings.

## 0.9.1

- **Fix: `program` now waits at the end.** It used to go straight back to the title screen with `BLWP @>0000`, so anything your code drew (such as the letter from `vdpwrite`) vanished at once. It now waits, still letting the console notice **FCTN =** (QUIT) to go back to the title screen. The `BLWP @>0000` way out is left as a comment.
- README, **Things to know**: grey "ghost text" suggestions come from an AI helper such as Copilot, not from this extension, and can be from the wrong chip (`ADD` in TI code). It shows the one setting that turns them off in assembly files only.

## 0.9.0

New: **starter code** (snippets) for the TI-99/4A.

- Type `program`, `routine`, `loop` or `vdpwrite` in lower case on an empty line and pick it from the suggestions, or right-click and choose **Retro ASM: Insert starter code**. `program` gives the usual start and end of a TI-99/4A program (`DEF`, `LWPI`, `LIMI 0`, `BLWP @>0000`, the registers' `BSS 32`, `END`); Tab then moves between the spots to fill in.
- Only lower-case names bring them up, so typing a label such as `LOOP` doesn't. In the label column they wait for a second letter.
- The starter code lives in the chip files (a new `snippets` section), so it ships inside the extension and a chip file of your own can have its own. The other three computers will get theirs next. The new-chip template has an example.
- New tests: the suggestions, the command, and a check that each chip's starter code gives no warnings.

## 0.8.0

New: **how long each instruction takes.** The tooltip for an instruction now has a *Time* line with its clock cycles, for the way it is written on that line, and **This line** in the side panel shows it too.

- **C64 and BBC (6502):** the time for each way of writing the operand, with one more when an address crosses into the next page (`LDA $D020,X`: 4 or 5). Branches give both times (2 if it doesn't jump, 3 if it does, 4 into another page). On the BBC, the 65C02's extra instructions are covered, the BBC Master's numbers are added where they are different (`JMP (&20E)`, `ASL &3000,X`), and the half-speed hardware at &FC00-&FEFF is marked.
- **ZX Spectrum (Z80):** T-states for every instruction, with both times for jumps, calls, returns, `DJNZ` and the repeating instructions (`LDIR`: 21 for each byte, 16 for the last). Addresses in 16384-32767 are marked as shared with the screen (contended memory).
- **TI-99/4A (TMS9900):** cycles for the instruction and each operand (`*R1+`, `@LABEL(R2)` ...), how many times it reads or writes memory, and how much slower it gets in slow memory (4 more for each). Shifts, `LDCR` and `STCR` work out the time from the count; `DIV`, `ABS` and the jumps give the range.
- The cheat sheet says how fast each machine runs and what slows it down.
- All the numbers live in the chip files (a `timing` section and each instruction's `cycles`), so a chip file of your own can have them too. See **Adding a chip of your own** in the README.
- Checked: every 6502 and 65C02 number against the 6502 data sheet and py65 (which has one slip, `DEC` with a full address, left out); every way of writing every Z80 instruction (2,397 of them) against SkoolKit's Z80 simulator, run with jumps taken and not taken; the TMS9900 against the TMS9900 data manual. New check: `python test/z80-cycle-check.py`.
- New tests in `test/ext-test.js` for all four chips, the tooltip and the side panel.

## 0.7.4

- The code now lives on GitHub: [spiderhan/retro-asm](https://github.com/spiderhan/retro-asm). The extension's details link to it, and problems can be reported on its Issues page.
- README: the install steps now start from the Releases page, where each new `.vsix` is put.

## 0.7.3

Ready to share: the docs and code are general, for any program.

- No more mentions of the one game the extension was first tested on, in the docs, comments or tests.
- `npm run test:vscode` no longer looks for xas99 in a particular folder of the author's; set `XAS99` to include the build test.

## 0.7.2

Documentation only; the extension works exactly as before.

- README: the table of chip-file `syntax` switches said `6502.json` uses them all, but the switches are spread over the C64, BBC and Z80 files. A new column now says which built-in chip file uses each one, so you know where to copy a working example from.
- README: the tip on rewording the built-in tooltips now names all four chip files, and adding a chip mentions **Retro ASM: Reload chip files**. Tidied a repeated line under **Addresses and sizes**.
- The new-chip template points to all four chip files as examples (it left out `bbc.json`).
- Code comments in `lib/layout.js`, `lib/project.js`, `lib/decoders.js` and `test/vscode/run.js` brought up to date for all four chips.

## 0.7.1

- **README covers every computer, not just the TI-99/4A.** A new table at the top lists the four computers it knows (TI-99/4A, ZX Spectrum, Commodore 64, BBC Micro), with the chip, the assembler style and the files each one opens. The install steps, the tooltip table, jumping around, build and run, warnings, addresses and the cheat sheet now say how they work on the other computers too, and the parts that only suit the TI-99/4A (its extra warnings, sound and video values) say so.
- **Fix: `// @reg` notes now work in Commodore 64 code.** Register notes were only picked up after `;`, `*` or `\`, so KickAssembler's `//` comments were ignored.
- The "add a `@reg` note" tip in a register's tooltip now uses that chip's own comment mark (`//` on the C64, `;` elsewhere) instead of always `;`.
- New tests: `@reg` notes and the tip, on all four chips.

## 0.7.0

New chip: **6502 for the BBC Micro**, written the **BeebAsm** way (the assembler most BBC programmers use today; it follows the BBC's own BASIC assembler). `.6502` files open by themselves; `.asm` and `.s` files are read as BBC code when they look like it.

- All 56 instructions, plus the 65C02's extras for the BBC Master (`BRA`, `PHX`, `STZ`, `TSB` ... after `CPU 1`).
- The BBC's memory map, operating system calls (`OSWRCH`, `OSBYTE`, `OSWORD`, `OSFILE` ...), the vectors at &200 and the hardware in SHEILA (video chip and ULA, both VIAs, paged ROM select, joystick ADC) explained when you hover an address.
- BeebAsm's way of writing: `.labels`, `\` comments, `&` hex, `name = value`, `EQUB`/`EQUW`/`EQUD`/`EQUS`, `SKIP`, `SKIPTO`, `ALIGN`, `GUARD`, `SAVE`, `INCLUDE`, `INCBIN`, `PUTFILE`, `MAPCHAR`, `PRINT`, `ASSERT`, `LO()`/`HI()`, `AND`/`OR`/`EOR`/`DIV`/`MOD`, `P%`, `TRUE`/`FALSE`, names ending in `%`, and `LDA#5` with no space.
- **Several statements on one line** (`LDA #22:JSR oswrch`): each gets its own tooltip, address and size, the explain page reads them in order, branches are explained from the statement before them (`DEX:BNE loop`), and typing after a `:` suggests instructions.
- **{ } scopes**: each block can have its own `.loop`; go to definition, find uses and rename pick the right one.
- **IF / ELSE / ENDIF** follow the part that is really assembled; the rest is shown as left out and isn't checked. A name set in both parts isn't a mistake. An IF that can't be worked out still keeps exact addresses when every part is the same size.
- **FOR ... NEXT** is laid out once for each time round (so an IF inside that depends on the counter is right too), and **macro calls** are sized from the macro, with the values given.
- **Capitals matter** in BeebAsm (`st4` and `ST4` are different names); this chip treats them that way, and says so when a name only differs in capitals.
- Addresses work like a two-pass assembler: a zero-page name set further down the file still makes the shorter instruction.
- **Build** finds BeebAsm next to the source (or a few folders up, or on the PATH) and makes a disc image that starts the program by itself, using the name on the first `SAVE` line. **F5** starts BeebEm with that disc. BeebAsm's errors are underlined.
- Checked against the real BeebAsm 1.11: every 6502 and 65C02 instruction, BeebAsm's demos, a large 65C02 demo (1,343 labels) and the Elite source code (38,000 lines, 1,234 labels) all match to the byte, with no false warnings on Elite.
- New check: `node test/beebasm-check.js file.6502 [path to beebasm]`. `node test/ext-test.js` runs it when `BEEBASM` is set. `test/real-check.js` now reads `.s` and `.6502` files too.
- New chip-file switches, all off unless a chip file asks for them, so the other chips work as before: `dotLabels`, `colonStatements`, `assignments`, `braceScopes`, `braceMacros`, `caseSensitive`, `basicMath`, `functions`, `hereNames`, `nameSuffix`, `tightOperands`, `decimals`; directive kinds `if`, `elif`, `else`, `endif`, `for`, `next`, `skipto` and the `reserves`, `scope` and `clearsRough` flags; `build.tool` and `build.run`.
- All chips: `INCLUDE` names are also looked for in the folders above (BeebAsm reads them from the folder it was started in), and `\` in them works on a Mac too. `\` comments and `&` hex are coloured.

## 0.6.0

- **An icon:** a little pixel-art chip in the Extensions list.
- **A side panel:** click the chip icon on the bar down the left of VS Code. Four parts:
  - **Project:** chip, program size and room left, files, warnings, last build, the biggest routines and names that nothing uses. Build and build-and-run buttons at the top.
  - **This line:** follows the cursor. The line in plain English, address and size, registers read and changed, the instruction's notes and flags, and the routine it is in.
  - **Memory map:** the whole 64K as a bar with your program and the hardware it uses marked on it, each area of memory, room left, and where each file sits.
  - **Hardware used:** the screen, sound, keyboard, port and ROM addresses the code uses, with a short explanation and every line that uses each one.
- It is all worked out from the code and the chip files on your own computer. No AI, no account or key, nothing sent over the internet (a test now checks that the code has no way to reach the internet or an AI service).
- New command: **Retro ASM: Show the side panel**.
- Z80: 667 more Spectrum ROM addresses that point part-way through ROM routines (such as TEST-CHAR inside GET-CHAR) are explained when you hover them, but kept out of the cheat sheet. Chip files can add these with `moreAddresses`.

## 0.5.2

- Z80: two more Spectrum addresses that games often use: the ROM's BEEP routine ($03F8, plays a note from the calculator stack) and the second half of KSTATE ($5C04).

## 0.5.1

- Z80: after `RST $28` (the Spectrum's ROM calculator) come a list of sums, not instructions, but a disassembly shows them as instructions. Those lines now say they are calculator data, get no warnings (so a stray `JR C` in a game's disassembly is no longer flagged), and are left out of the routine's register summary. The `RST $28` line itself says what follows it, and the `JR C` that ends the list explains that its second byte is really the start of the code after it.
- Chip files can mark data that follows an instruction (`dataAfter`).

## 0.5.0

The Z80 is finished: it now does everything the TMS9900 and 6502 do, for the ZX Spectrum.

- **Addresses and sizes** for every Z80 instruction, checked against SkoolKit's Z80 assembler for all 2,397 ways of writing them and for every line of a full Spectrum game's disassembly (turned into `.asm` with `skool2asm`). The summary line above each routine now shows where it is, how big it is and which registers it changes.
- **Warnings** when `JR` or `DJNZ` can't reach its label (with the fix), and when `JR` is given a test it can't do (`JR PE`).
- **Smarter sentences:** jumps, calls and returns with a test (`JR NC,x`, `RET Z`, `CALL C,x`) are explained from the line above, as on the other chips. `C` means "smaller" after `CP` and "a 1 fell out" after a shift. `DEC BC` changing no flags is taken into account. `XOR A`, `OR A`, `AND A`, `EX DE,HL` and friends get their own sentences.
- **Every instruction** now says what it does to the flags, which registers it reads and changes, and the usual pitfalls. The unofficial `SLL` is known.
- **The Spectrum:** its memory map, ROM routines (CLS, PRINT-A, BEEPER, PR-STRING, CHAN-OPEN, the calculator ...) and system variables (LAST-K, FRAMES, CHARS, ATTR-P ...), in hex or decimal. A `CALL 3435` line says it calls CLS.
- **Ports:** `IN` and `OUT` know port $FE (border, speaker, keyboard), 128K paging, the AY sound chip and the Kempston joystick. A value on its way to a port is decoded (*border red*, *keyboard row Q W E R T*, *RAM bank 3 at $C000*).
- **sjasmplus and Pasmo:** `.loop` local labels (each routine can have its own), `'A'` for a letter (and `AF'` still works), `DEFB "text",0`, `DEFM` with numbers between the words, `DZ`, `DC`, `BLOCK`, `ALIGN`, `=`, `DEFL`, `MACRO`/`ENDM` written either way round, `IF`/`ENDIF`, `DUP`/`REPT`, `DEVICE`, `SAVESNA` and the rest. sjasmplus's error messages are read after a build (not yet tried with the real sjasmplus).
- **`.asm` files** can be 6502 or Z80: the extension now looks at the instructions in the file and picks the chip that fits. A file pulled in by another one uses the same chip. **Switch chip** still decides for good.
- With no build command set, a 6502 or Z80 file now says how to set one up, instead of looking for xas99.
- The cheat sheet lists the hardware ports.
- New chip-file switches, all off unless a chip file asks for them, so the TMS9900 and 6502 work as before: `primeAfterName`, `dotInNames`, `dotLocals`, `addressByShape`, sizing `only`/`not`/`extra`, `ioPorts`, `addressGuess`, `build`, and register `wide`/`parts`/`noRanges`. Operand counts can choose `rw`, `implicit` and `resultReg` (`{"1": ..., "2": ...}`).
- New check: `python test/z80-size-check.py`. `test/real-check.js` now takes `.z80` and `.asm` files too.

## 0.4.1

- The Editor/Assembler helpers (VSBW, VMBW, VSBR, VMBR, VWTR, KSCAN, GPLLNK, XMLLNK, DSRLNK, LOADER) now say what their names stand for, such as **VSBW = VDP Single Byte Write**, with a line on what video memory is.
- Their explanation now shows even when the program defines the name itself, with an `EQU` or its own copy of the routine (as programs that run without the Editor/Assembler cartridge must). Before, it only showed for names brought in with `REF`.

## 0.4.0

- New chip: **6502 for the Commodore 64**, written the KickAssembler way. All 56 instructions, the C64's memory map, chips and KERNAL routines, KickAssembler's directives and colour names, and addresses and sizes worked out the 6502 way (checked against a 6502 assembler for every instruction and way of writing its operand).
- Branches that can't reach their label are spotted on the 6502 too, measured in bytes.
- New `syntax` switches for chip files, so assemblers that write things differently can be described: `//` and `/* */` comments, labels that need a colon, `*=`, `{ }` blocks, `name(...)` macro calls, `name.member`, `*` for "this address", `<` and `>` for low and high bytes. All are off unless a chip file asks for them, so the TMS9900 and Z80 behave as before.
- Chip files can give each way of writing an operand its own size (`sizing.forms`), and can turn off the TMS9900's even-address rule (`sizing.evenAlign`).
- Macros show in the outline and can be folded.
- KickAssembler's error messages are read after a build (not yet tried with the real KickAssembler).

## 0.3.1

Safety, before the code goes public.

- Folders you haven't trusted: the extension now keeps working there, with build, run, the project's own build settings and its own chip files switched off. Before, it switched itself off completely, tooltips included.
- Before running a build script, tool or command that comes from the project, it asks once, showing the exact command, and remembers the answer for that folder. New setting `retroAsm.build.askFirst` (only your own user settings can switch it off).
- A file or folder name containing `"`, `` ` ``, `$`, `%` or a line break is refused for building, so it can't add a command of its own.
- Chip files with a search pattern that could lock up the editor (such as `(a+)+`) are not loaded, and the output panel says why.
- Labels read from a `.skool` file must be plain names before they go into a tooltip.
- Added an MIT licence.
- `test/real-hover.js` now works on any project you point it at.

## 0.3.0

- Side by side with the original game: addresses such as `$A420` in comments open the original's SkoolKit `.skool` disassembly at that address (Ctrl+click, F12, or a link in the tooltip). The tooltip shows the first lines of the original code there. New setting `retroAsm.original.skoolFile`; by default the file is found near the source.
- New command: **Retro ASM: Show the original game's code at an address**.
- Classic99 is now started directly rather than through the command prompt, so no extra command window should open with it (Windows).
- A run command in quotes with spaces in its path (`"C:\Program Files\...\classic99.exe"`) is now recognised when checking whether the emulator is already open.
- Build and build-and-run no longer wait for their pop-up messages to be closed before finishing.
- The cheat sheet uses the chip of the code beside it, instead of asking, when a help page has the focus.
- Tests: a new test that runs inside real VS Code (`npm run test:vscode`), and the test files are now made-up code.

## 0.2.0

- Build (Ctrl+Alt+B) and build-and-run (F5), with the assembler's errors underlined in the code.
- New checks: jump too far, R11 lost by a BL, labels on odd addresses, a space after a comma, registers missing from a "Uses" comment.
- Memory addresses and sizes: in tooltips, beside the code (Ctrl+Alt+A), and the whole program's size in the status bar. Checked line by line against xas99 listings.
- A summary line above each routine: who calls it, where it is, how big, which registers it changes.
- BYTE and DATA blocks drawn as pictures in tooltips.
- Sound chip and video register values explained in tooltips.

## 0.1.0

- First version: TMS9900 (TI-99/4A, xas99) and a Z80 starter.
- Tooltips, colours, outline, go to definition, find uses, rename, folding, suggestions, checks.
- Explain-in-plain-English page and a cheat sheet.
- Your own notes, and your own chip files.
