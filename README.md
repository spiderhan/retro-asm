# Retro Assembly Helper

Tooltips in plain English, proper colours, and quick ways to jump around assembly source for old home computers.

## Computers it knows

| Computer | Chip | Written the way of | Files it opens by itself | More about it |
|---|---|---|---|---|
| TI-99/4A | TMS9900 | xas99 | `.a99` | the main sections below use it for their examples |
| ZX Spectrum | Z80 | sjasmplus (and SkoolKit's `skool2asm` output) | `.z80` | **ZX Spectrum** below |
| Commodore 64 | 6502 | KickAssembler | (`.asm`, see below) | **Commodore 64** below |
| BBC Micro (and Master) | 6502 / 65C02 | BeebAsm | `.6502` | **BBC Micro** below |

Everything in **What you get** works for all four: tooltips, a plain-English sentence for each line, go to definition, find uses, rename, the outline, summary lines above routines, warnings, addresses and sizes, the side panel, the explain page, the cheat sheet, build and run. The few parts that only suit one computer say so.

`.asm` and `.s` files are used by lots of assemblers, so VS Code doesn't hand them to this extension unless you ask (see **Commodore 64**). Once it has them, it looks at the lines in the file and picks the chip that fits.

Each chip is one data file, so other chips can be added without touching the code (see **Adding a chip of your own**).

## Install

1. Download the newest `retro-asm-<version>.vsix` from the [Releases page](https://github.com/spiderhan/retro-asm/releases).
2. In VS Code, open the Extensions panel.
3. Click the `...` menu at the top of the panel and choose **Install from VSIX...**
4. Pick the file you downloaded.

Open an assembly file: `.a99`, `.z80` or `.6502` open by themselves. The bottom-right corner of the window shows the chip it is reading the file as (for example **TMS9900**, **Z80** or **6502 (BBC Micro)**), and a chip icon appears on the bar down the left of the window.

## What you get

### The side panel

Click the chip icon on the bar down the left of VS Code (or run **Retro ASM: Show the side panel**). It has four parts, each of which can be folded away or dragged into a different order:

- **Project:** the chip, how big the program is and how much room is left, its files, how many warnings there are, the last build, the biggest routines, and names that nothing uses (often fine, but sometimes a spelling slip or spare code). The buttons at the top build, and build and run.
- **This line:** follows the cursor. The line in plain English, its address and size, the registers it reads and changes, what the instruction does and which flags it sets, and the routine it is in (how big it is and where it is called from).
- **Memory map:** the machine's whole memory as a bar, with your program and the hardware it uses marked on it, how much room is left, and where each file sits.
- **Hardware used:** every screen, sound, keyboard, port and ROM address your code uses, grouped by what it is, with a short explanation. Open one to see each line that uses it, and click to go there. Addresses outside the program that the chip file doesn't know (usually your own variables) are kept in a folded-away list at the bottom.

Everything in the panel is worked out on your own computer from your code and the chip files, the same way the tooltips are. It doesn't use AI, needs no account or key, and sends nothing over the internet.

### Tooltips (hover the mouse)

The examples here are TI-99/4A code. The other computers get the same kinds of tooltip with their own instructions and addresses: `LDA ($FB),Y` or `JSR $FFD2` on the C64, `LD A,(IX+3)` or `CALL 3435` on the Spectrum, `LDA #22:JSR oswrch` or `&FE4E` on the BBC.

| Hover over | You see |
|---|---|
| An instruction (`MOVB`, `JNE`, `LDCR` ...) | What it does, how it is written, and **what this exact line does**. For example `MOVB *R1+,@VDPWD` says: *Copy the byte R1 points at (R1 then moves on by 1) into the byte at VDPWD (>8C00).* A jump looks at the line above it, so `DEC R2` then `JNE LOOP` says: *Jump to LOOP if R2 is not 0.* |
| A label | Where it is defined, the line itself, the comment block written above it, its value if it is an `EQU`, and how many times it is used. |
| A routine built into the machine | TI-99/4A Editor/Assembler helpers (`VSBW`, `VMBW`, `KSCAN`, `DSRLNK` ...), C64 KERNAL routines (`CHROUT` at `$FFD2` ...), Spectrum ROM routines (`CLS`, `BEEPER` ...) and BBC operating system calls (`OSWRCH`, `OSBYTE` ...) say what they do and what to put in the registers first. For the TI helpers: what the name stands for (VSBW = VDP Single Byte Write), and this works whether the program brings it in with `REF`, sets it with `EQU`, or has its own copy of the routine. |
| A number | Decimal, hex and binary, plus the left and right bytes. Known addresses say what lives there: `>8C00` on the TI, `$D020` on the C64, `23560` or `$5C78` on the Spectrum, `&FE4E` on the BBC. |
| A register | Your own note for it (see below) and anything special about it (on the TI, R11, R12 and where it lives in memory; A, X and Y on the 6502; pairs such as HL on the Z80). |
| The `*`, `@` or `+` of an operand (or `#`, `( ),Y`, `(IX+n)` ...) | What that way of writing an operand means. |
| A directive (`EQU`, `BYTE`, `.byte`, `DEFB`, `EQUB` ...) | What it tells the assembler to do. |

A label name written inside a comment works too.

### Jumping around

Shortcuts are shown as Windows / Mac.

| Do this | To |
|---|---|
| **F12**, or Ctrl+click / Cmd+click on a label | Go to where it is defined. Works across files joined by `COPY`, `INCLUDE` or `#import`. |
| **Alt+Left** / **Ctrl+-** | Go back to where you were. |
| **Shift+F12** | List everywhere a label is used. (F12 on the definition itself does the same.) |
| **Ctrl+Shift+O** / **Cmd+Shift+O** | Type a label name and jump to it in this file. |
| **Ctrl+T** / **Cmd+T** | The same, across every file. |
| The **Outline** panel in the Explorer side bar | A list of every routine, with its loop labels tucked inside it. The strip along the top of the editor shows which routine you are in. |
| Ctrl+click a `COPY "file"` (or `INCLUDE`) line | Open that file. |
| The small arrows in the margin | Fold a routine or a long comment block away. |
| **F2** on a label | Rename it everywhere. |

### Help while writing

- Suggestions as you type: instructions (with their explanation) and your own labels and registers.
- Wavy underlines for likely mistakes: a misspelt instruction, the wrong number of operands, a label that doesn't exist, a label defined twice. Turn this off with the `retroAsm.checks` setting.

### Build and run

- **Ctrl+Alt+B** (Cmd+Alt+B) builds. **F5** builds, then starts the emulator.
- What follows is how it works on the TI-99/4A (xas99 and Classic99). BeebAsm and BeebEm are found the same way for the BBC; for the C64 and the Spectrum you give the commands once in the settings. Each computer's own section below says how.
- If there is a `build.bat` (or `build.sh`) next to your source, that is what runs. If not, xas99 is run directly when an `xdt99` folder is nearby. Or set your own command in `retroAsm.build.command`.
- The first time a project wants to run something of its own (a `build.bat`, an xas99 or Classic99 found in its folders, or a command in its `.vscode/settings.json`), you are asked first, showing the exact command. Say **Allow** and you won't be asked again in that folder unless the command changes. See **Safety** below.
- The assembler's errors are underlined on the right lines and listed in the Problems panel. Everything it printed is in the **Retro ASM** output panel.
- On Windows, Classic99 is found by itself if a `classic99` folder sits near your source. If it is already open, it is left alone and you are reminded to reload the program there. For anything else, set `retroAsm.build.runCommand`.

### More mistakes caught before you build

Every chip warns when a short jump or branch can't reach its label (`JR`/`DJNZ` on the Z80, `BNE`/`BEQ` ... on the 6502). These ones are for the TI-99/4A:

- A short jump (`JMP`, `JEQ`, `JNE` ...) to a label that is too far away.
- `BL` inside a routine that returns with `B *R11` but never saved R11.
- A label that lands on an odd address when code or `DATA` follows (a missing `EVEN`), and whole-word instructions aimed at an odd address.
- A space after a comma in the operands, which xas99 rejects.
- A blue note when the comment above a routine says "Uses R0, R1" but the code also changes another register.

### Addresses and sizes

- The tooltip for any instruction shows its memory address and how many bytes it takes. The tooltip for a label shows its address.
- **Ctrl+Alt+A** (Cmd+Alt+A) shows every line's address down the left of the code, like an assembler listing.
- The bottom-right corner shows the size of the whole program against the room there is, for example `TMS9900 · 18.9K of 24.0K`. Hover it for the details.
- Addresses match what the real assemblers produce: checked against xas99 (TI), SkoolKit (Spectrum), BeebAsm (BBC) and py65 (C64 instruction sizes).
- On the TI-99/4A, programs loaded with Editor/Assembler are assumed to start at `>A000`; change `retroAsm.loadAddress` if yours doesn't. Code after `AORG` uses the address it gives.
- Sums with labels are worked out in tooltips, so `PAT_END-PAT` shows as a number.

### A summary above each routine

A small grey line above every routine says who calls it (click it to see where), where it sits and how big it is, and which registers it changes, including the ones changed by routines it calls. Turn it off with `retroAsm.routineSummaries`.

### Pictures

Hover a `BYTE` or `DATA` line, or the label of a block, and character and sprite drawings are shown as pictures (8 bytes as one character, 32 bytes as a 16x16 sprite). It does this when the label or comments say it is a drawing (`PAT_...`, "sprite", "drawing" and so on); `retroAsm.pictures` can make it always or never.

### Sound and video values

This part is for the TI-99/4A (the Spectrum's border, keyboard and sound ports are covered in **ZX Spectrum** below). Hover a number that is on its way to the sound chip or the video chip and the tooltip says what it means: `>9F` is "volume of voice 1: off", and a value sent to a video register is spelt out (screen on, 16x16 sprites ...). This works for `LI` followed by `MOVB` to `>8400` or `>8C02`, for `BLWP @VWTR`, and for byte lists that are sent to the sound chip.

### Side by side with the original game

Porting a game from another computer? If you have its disassembly as a [SkoolKit](https://skoolkit.ca) `.skool` file, addresses of the original written in your comments become links:

```
; JUMP: start a jump (Spectrum routine $9D08).
```

- **Hover** `$9D08` to see the first few lines of the original code there, with the name and title of that part of the program.
- **Ctrl+click** it (Cmd+click on a Mac), or click **Open beside the code** in the tooltip, and the `.skool` file opens beside your code at that line. The cursor stays in your code, and the next address you click reuses the same side pane.
- **F12** on it opens the `.skool` file at that line in the same pane.
- Or run **Retro ASM: Show the original game's code at an address** from the Command Palette and type an address.

Any `$` followed by four hex digits in a comment counts, as long as the `.skool` file covers that address, so counts like `$1388` (below the start of the program) are left alone. An address in the middle of an instruction or a block of data goes to the line it is part of.

The `.skool` file is found by itself when it sits in the source's folder, in a folder inside it (up to two levels down), or in the folder above. When several turn up together (a game and its loader, say) the biggest is used. To pick one yourself, set `retroAsm.original.skoolFile` to the file (or to the folder holding it).

### Explain a whole routine

Put the cursor in a routine (or select some lines), right-click and choose **Retro ASM: Explain these lines in plain English** (Ctrl+Alt+E / Cmd+Alt+E). A page opens beside the code with one plain-English sentence per line.

### Cheat sheet

Right-click and choose **Retro ASM: Show the cheat sheet for this chip** for every instruction on one page, plus that computer's memory map and the addresses worth knowing (and the hardware ports on the Spectrum).

## Your own notes

**In the source.** Add a comment line and it shows in the tooltip for that register from there down (use the comment mark of your assembler: `;`, `//` or `\`):

```
; @reg R4 = Player X
; @reg R5 = Player Y
```

A later `@reg` line for the same register takes over from that point, so different routines can use a register for different things.

**In a notes file.** Run **Retro ASM: Create or open my notes file** from the Command Palette (Ctrl+Shift+P / Cmd+Shift+P). It makes `asm-notes.json` next to your source, where you can keep notes for registers, memory addresses and names. Save it and the tooltips update.

## Commodore 64 (6502, KickAssembler)

KickAssembler files usually end in `.asm`, which VS Code doesn't hand to this extension by itself (lots of other assemblers use `.asm` too). To use it for your C64 code, add this to your settings (or to `.vscode/settings.json` in the project):

```json
"files.associations": { "*.asm": "retroasm" }
```

An `.asm`, `.s` or `.6502` file could be written for KickAssembler, BeebAsm (BBC Micro) or a Z80 assembler, so the extension looks at the lines in it and picks the chip that fits (a file pulled in by another one uses the same chip as that one). To fix the choice for good, use **Switch chip**.

What you get:

- Tooltips for all 56 instructions, and a plain-English sentence for each line, including the different ways of writing an address (`#5`, `$D020,X`, `($FB),Y` and so on).
- The C64's memory map, its chips (VIC-II, SID, the two CIAs) and the main KERNAL routines explained when you hover an address such as `$D020` or `$FFD2`.
- KickAssembler's way of writing: `//` and `/* */` comments, `label:`, `*=$0801`, `BasicUpstart2(start)`, `.const`, `.label`, `.var`, `.byte`, `.word`, `.text`, `.fill`, `.align`, `#import`, macros and `.for` loops. Its colour names (`BLACK`, `WHITE` ...) are known.
- Addresses and sizes for each line, worked out the way the 6502 does it: an address from `$00` to `$FF` (the zero page) makes a shorter instruction.
- A warning when a branch (BNE, BEQ ...) can't reach its label: they only go 128 bytes back or 127 ahead.

To build, set `retroAsm.build.command` to run KickAssembler, for example `java -jar C:\path\to\KickAss.jar "${file}"`, and `retroAsm.build.runCommand` to start VICE, for example `"C:\path\to\x64sc.exe" "${fileDirname}\${fileBasenameNoExtension}.prg"`.

Things it doesn't follow yet:

- KickAssembler treats `border` and `BORDER` as different names; this extension treats them as the same.
- `!` labels (`!loop:` with `bne !loop-`) are coloured but not followed, and neither are names inside a scope (`music.init`).
- Lines inside `.for`, `.if` and `.while` blocks are put into the program a number of times (or not at all), so addresses after one are marked as rough.
- Segments (`.segment`) and the unofficial ("illegal") instructions aren't covered.
- KickAssembler's errors should be underlined in the code after a build, but this hasn't been tried with the real KickAssembler yet. Everything it prints is in the **Retro ASM** output panel either way.

## ZX Spectrum (Z80, sjasmplus)

`.z80` files open by themselves. For `.asm` (and `.a80`) files, add the same setting as for the C64 above:

```json
"files.associations": { "*.asm": "retroasm", "*.a80": "retroasm" }
```

An `.asm` file full of Z80 instructions is then read as Z80, even with 6502 files in the same folder.

What you get:

- Tooltips for every Z80 instruction (and the unofficial `SLL`), with a plain-English sentence for each line, what each one does to the flags, and the pitfalls (`DEC BC` changes no flags, so `JR NZ` after it doesn't test BC).
- Jumps explained from the line above: `CP 'Q'` then `JR NC,.done` says *Jump to .done if A is greater than or equal to 'Q' (81)*; `BIT 0,A` then `JR Z` says *if bit 0 of A was 0*; `OR A` then `RET Z` says *Return if A is 0*.
- The Spectrum itself: hover an address such as `23560`, `$5C78` or `$4000` for the system variable or screen area that lives there, and a call such as `CALL 3435` or `RST 16` for the ROM routine (CLS, PRINT-A, BEEPER, PR-STRING, CHAN-OPEN and others), with what to put in the registers first. Decimal and hex both work.
- Ports: `OUT ($FE),A` says what port $FE is, and a value on its way there is decoded: `LD A,2` before it says *border red*. `LD A,$FB` before `IN A,($FE)` says which keys that reads (*Q W E R T*). 128K paging (`$7FFD`), the AY sound chip and the Kempston joystick are known too.
- Addresses and sizes for every line, worked out the Z80 way (IX and IY instructions are a byte longer, and `(IX+n)` another one). Checked against SkoolKit's Z80 assembler for every way of writing every instruction, and for every line of a full Spectrum game's disassembly.
- The ROM calculator: after `RST $28` come a list of sums for the calculator, not instructions. A disassembly of a game shows those bytes as instructions, so they're marked as data in the tooltips, aren't checked for mistakes, and don't count in the routine's register summary.
- Warnings when `JR` or `DJNZ` can't reach its label (128 bytes back, 127 ahead), with the fix, and when `JR` is given a test it can't do (`JR PE,...`).
- sjasmplus's way of writing: local labels (`.loop` belongs to the label above it, so every routine can have its own), `main.loop`, `'A'` for a letter, `$`, `#` or `0FFh` for hex, `%` for binary, `DEFB "text",0`, `DEFM`, `DZ`, `DC`, `BLOCK`, `ALIGN`, `=`, `MACRO`/`ENDM` (either way round), `IF`/`ENDIF`, `DEVICE`, `SAVESNA`, `INCLUDE` and `INCBIN`. SkoolKit's `skool2asm` output reads the same way: `skool2asm.py -c game.skool > game.asm` turns a `.skool` disassembly into a file this works on.
- The summary line above each routine lists register pairs as pairs: *Changes A, BC, HL*.

To build, set `retroAsm.build.command` to run your assembler, for example `sjasmplus "${file}"`. To start an emulator after a build, put a `SAVESNA "game.sna",start` line in the code and set `retroAsm.build.runCommand`, for example `"C:\Fuse\fuse.exe" "${fileDirname}\game.sna"`. sjasmplus's error messages (`game.asm(33): error: ...`) are underlined on the right lines.

Things it doesn't follow yet:

- Lines inside `IF`, `DUP` and `REPT` blocks may be put in more than once (or not at all), so addresses after one are marked as rough. The same goes for `STRUCT`, `PAGE` and `SLOT`.
- sjasmplus's numbered labels (`1:` with `jr 1B`) and `MODULE` names aren't followed.
- The 3-operand unofficial forms such as `RLC (IX+3),B` aren't known.
- `build.command` and the error messages haven't been tried with the real sjasmplus yet. Everything it prints is in the **Retro ASM** output panel either way.

## BBC Micro (6502, BeebAsm)

There is more than one assembler for the BBC Micro, but **BeebAsm** is the one most people use today: it is the stardot community's own, it writes code the same way as the BBC's built-in BASIC assembler, it makes a disc image you can run straight away, and big projects such as the documented Elite source code are written for it. So that is the way this chip reads.

`.6502` files (BeebAsm's usual ending) open by themselves. For `.asm` files, add the `files.associations` setting shown for the C64 above; the extension then tells BeebAsm code from KickAssembler or Z80 code by looking at it.

What you get:

- Everything the other chips have: tooltips for all 56 instructions with a plain-English sentence for each line, go to definition, find uses, rename, the outline, summary lines above routines, warnings, the side panel and the cheat sheet.
- BeebAsm's way of writing: `.label` (anywhere on a line), `\` or `;` comments, `&FFEE` (or `$FFEE`) for hex, `%1010` for binary, `'A'` for a letter, `name = value`, `EQUB`, `EQUW`, `EQUD`, `EQUS`, `SKIP`, `SKIPTO`, `ALIGN`, `ORG`, `GUARD`, `SAVE`, `INCLUDE`, `INCBIN`, `PUTFILE`, `MAPCHAR`, `CPU`, `PRINT`, `ASSERT`, and the BBC BASIC style sums: `LO()`, `HI()`, `<` and `>`, `AND`, `OR`, `EOR`, `DIV`, `MOD`, `^`, `<<`, `>>`, `P%` or `*` for "this address", `TRUE` and `FALSE`.
- **Several statements on one line**, the BBC way: `LDA #22:JSR oswrch`. Hover any of them for its own tooltip and address; the explain page and the side panel follow them in order, and `DEX:BNE loop` says *Jump to loop if X is not 0*.
- **{ } blocks** keep their names to themselves, so every routine can have its own `.loop`. Go to definition, rename and the outline all pick the right one. `.*name` and `.^name` work too.
- **IF / ELIF / ELSE / ENDIF** are followed: the part that is really put into the program is laid out and the rest is shown as *left out* (and isn't checked). A name set in both halves of an IF isn't reported as "defined twice".
- **FOR ... NEXT** loops are worked out time by time, and **MACRO ... ENDMACRO** calls are sized from the macro with the values given, so addresses after them stay exact.
- **BeebAsm minds capitals**: `st4` and `ST4` are different names, as BeebAsm treats them, and a warning says so when they get mixed up.
- The BBC itself: the memory map (zero page, the OS vectors, PAGE at &1900, the screen in each MODE, paged ROMs, SHEILA), the operating system calls (`OSWRCH`, `OSBYTE`, `OSWORD`, `OSFILE`, `OSCLI` ...) with what to put in A, X and Y, the vectors at &200 (`IRQ1V`, `WRCHV` ...), and the hardware in SHEILA: the 6845 video chip, the video ULA and its palette, both VIAs (keyboard, sound, timers, vsync), the paged ROM latch, the ADC for joysticks. Hover `&FE4E` and it says *System VIA interrupt enable*.
- The 65C02 extras for the BBC Master (`BRA`, `PHX`, `PLY`, `STZ`, `TSB`, `TRB`, `LDA (&70)`), after a `CPU 1` line.
- Addresses and sizes checked against the real BeebAsm: every 6502 and 65C02 instruction, BeebAsm's own demos, a large 65C02 demo with macros and scopes (1,343 labels) and the Elite source code (38,000 lines, 1,234 labels), all to the byte.

**Build and run.** With BeebAsm next to your source (or in a folder above it, or on your PATH) and no build command set, **Build** (Ctrl+Alt+B) runs

```
beebasm -i "game.6502" -do "game.ssd" -boot "Name"
```

which makes a disc image that starts the program by itself. The name after `-boot` is the one on your program's first `SAVE "Name", start, end` line (without a SAVE line BeebAsm puts nothing on the disc, and the output panel says so). BeebAsm's error messages are underlined on the right lines. **F5** then starts BeebEm with the disc if it finds `BeebEm\BeebEm.exe` near the source or in `Program Files`. For another emulator set `retroAsm.build.runCommand`, for example `"C:\b2\b2.exe" -b -0 "${fileDirname}\${fileBasenameNoExtension}.ssd"`. As always, a tool found in the project folder is shown to you before it runs the first time.

Things it doesn't follow yet:

- Labels inside a macro aren't given addresses (the macro could be used many times), and a macro whose size depends on something it can't work out (such as `RND`) marks the addresses after it as rough.
- String functions (`STR$`, `MID$` ...) and `TIME$` aren't worked out, so an `IF` that depends on them is marked as rough unless every branch is the same size.
- `COPYBLOCK`, `CLEAR` and the `-D` names given to BeebAsm on its command line aren't followed.
- BBC BASIC's own assembler (inside `[ ]` in a BASIC program) isn't read; only BeebAsm source.

## Changing the chip

- Click the chip name in the bottom-right corner (or run **Retro ASM: Switch chip**) to choose how files with this extension are read.
- To use it on another extension such as `.asm`, click the language name in the bottom-right corner, choose **Retro Assembly**, then switch chip.

### Adding a chip of your own

1. Run **Retro ASM: Start a new chip file from the template**. It creates `asm-dialects/<name>.json` in your project.
2. Fill it in. Every tooltip sentence comes from this file, so write them in your own words.
3. Save. It reloads by itself (or run **Retro ASM: Reload chip files**) and appears in the **Switch chip** list.

A file in `asm-dialects` with the same `id` as a built-in chip replaces it, which is how to reword the built-in tooltips: copy `tms9900.json`, `z80.json`, `6502.json` (C64) or `bbc.json` out of the extension's `dialects` folder into `asm-dialects` and edit it there.

For assemblers that write things differently, the `syntax` section has switches, all off unless a chip file turns them on. The last column says which built-in chip file uses each one, so you can copy from a working example (C64 = `6502.json`, BBC = `bbc.json`, Z80 = `z80.json`).

| Switch | What it does | Used by |
|---|---|---|
| `lineComment` | Comment markers, which can be more than one character (`"//"`). | all four |
| `blockComment` | A pair that starts and ends a comment over several lines: `["/*", "*/"]`. | C64 |
| `labelsNeedColon` | A label must end with `:`. Anything else at the start of a line is an instruction. | C64, BBC |
| `starOrigin` | `*=$0801` says where the code goes. | C64 |
| `braceBlocks` | `{` and `}` only group lines (scopes, loops, macros). | C64, BBC |
| `parenCalls` | `name(a, b)` is a macro call, and `sin(x)` in a sum is a function, not a label. | C64 |
| `dottedNames` | In `music.init`, only `music` is looked up. | C64 |
| `hereSymbol` | The sign for "this address" (`"*"`). | C64, BBC |
| `lowHighBytes` | `<value` and `>value` take its low and high byte. | C64, BBC |
| `joinIndexed` | `$D020,X` is described as one address plus X, not as two separate things. | C64, BBC |
| `primeAfterName` | A `'` straight after a name is part of it (the Z80's `AF'`), not the start of text. | Z80 |
| `dotInNames` | `main.loop` is one name. | Z80 |
| `dotLocals` | A label starting with `.` belongs to the label above it. | Z80 |
| `addressByShape` | A number in brackets, or a jump target, is a memory address (for the address notes). | Z80 |
| `dotLabels` | A label starts with `.` and can sit anywhere on a line (BeebAsm). | BBC |
| `colonStatements` | `:` separates statements on one line. | BBC |
| `assignments` | `name = value` gives a name to a number. | BBC |
| `braceScopes` | `{ }`, FOR ... NEXT and MACRO ... ENDMACRO keep the names made inside them to themselves. `braceMacros: false` makes a macro end at ENDMACRO rather than at `}`. | BBC |
| `caseSensitive` | `loop` and `LOOP` are different names. | BBC |
| `basicMath` | Sums the BBC BASIC way: `AND`, `OR`, `EOR`, `DIV`, `MOD`, `^` for powers, `=` and `<>` give -1 for true, `[ ]` work like brackets. | BBC |
| `functions` | Names that are functions in a sum (`LO(x)`, `HI(x)`), not labels. | BBC |
| `hereNames`, `nameSuffix` | Other names for "this address" (`P%`), and a character a name can end with (`%`, as in `LOAD%`). | BBC |
| `tightOperands`, `decimals` | `LDA#5` and `ASLA` need no space; numbers can have a fraction (`2.5`). | BBC |

The `sizing` section can list `forms`: ways of writing an operand and how many bytes the instruction then takes, with a smaller size for zero-page addresses. A form can be kept to some instructions (`only`), and `extra` adds bytes on top (the Z80's IX and IY). Setting `evenAlign` to `false` turns off the TMS9900's rule that code starts on an even address.

`bbc.json` shows the directive kinds `if`, `elif`, `else`, `endif`, `for`, `next` and `skipto`, `reserves` (a gap that puts nothing into the program file), and a `build` section that names the assembler and the emulator to look for (`tool`, `run`), with the command to run each.

`z80.json` also shows `ioPorts` (hardware reached with IN and OUT, and how to read a value sent there), `addressGuess` (when a plain number is probably an address), `build` (what to say when no build command is set) and, in `registers`, which registers are pairs.

## Settings

| Setting | What it does |
|---|---|
| `retroAsm.defaultDialect` | The chip to assume when nothing else decides. Starts as `tms9900`. |
| `retroAsm.dialectByExtension` | Which chip for which file extension. *Switch chip* fills this in. |
| `retroAsm.dialectFolders` | Where your own chip files live. Starts as `asm-dialects`. |
| `retroAsm.build.command`, `retroAsm.build.runCommand` | Your own build and emulator commands. Empty means work it out. |
| `retroAsm.build.xas99Path`, `retroAsm.build.python` | Where xas99.py is, and how to run Python, if the defaults don't find them. |
| `retroAsm.build.askFirst` | Ask before running a build script, tool or command that comes from the project. On to start with. Only your own user settings can switch it off, never a project. |
| `retroAsm.loadAddress` | Where the program loads (hex). Empty means the chip's usual place. |
| `retroAsm.showAddresses` | Addresses beside the code, on or off. |
| `retroAsm.routineSummaries` | The summary line above each routine, on or off. |
| `retroAsm.pictures` | Pictures in tooltips: `auto`, `always` or `never`. |
| `retroAsm.checks` | Wavy underlines on or off. |
| `retroAsm.hoverInComments` | Tooltips and jumping for label names inside comments, on or off. |
| `retroAsm.original.skoolFile` | The `.skool` file of the original game (or its folder). Empty means look near the source. |

## Things to know

- It does not assemble anything itself: building runs your own build script, xas99, BeebAsm, or the command you set.
- Addresses, sizes, jump distances and the register summaries are only worked out for chips whose file has a `sizing` section (TMS9900, both 6502s and Z80 all have one).
- The register summary reads the code top to bottom. It can't tell which path a routine takes, so treat it as a guide.
- For TMS9900 it follows the xas99 layout: a label starts in the first column, and after the operands the first space starts a comment.
- Sums are worked out left to right for TMS9900, the same as xas99 does (`2+3*4` is 20).
- xas99 local labels (`!`) and macros are coloured but not followed.
- Addresses of the original game are read from SkoolKit `.skool` files only (not `.ctl` files or plain Z80 source).

## Safety

Building runs programs, so a project downloaded from someone else could run anything when you press build. The extension guards against that in three ways:

- **Folders you haven't trusted.** When VS Code asks "Do you trust the authors of the files in this folder?" and you say no, tooltips, colours, links, the outline and the checks all still work. Build, run, the project's own build settings and its own chip files (`asm-dialects`) are switched off until you trust the folder.
- **Asked first.** In a trusted folder, a build script, tool or command that comes from the project is shown to you before it runs the first time (see **Build and run**). If the command changes later, you are asked again. Changes *inside* a `build.bat` you've already allowed are not noticed, so only allow scripts from people you trust.
- **Odd file names.** A file or folder name with `"`, `` ` ``, `$`, `%` or a line break in it is refused for building, because those characters could sneak an extra command into it.

Chip files are checked as they load: a search pattern that could lock up the editor (one like `(a+)+`) stops that chip file loading, and the **Retro ASM** output panel says which pattern and why. Text taken from a `.skool` file is cleaned before it goes into a tooltip.

## Checking it works (for changing the extension)

From the `retro-asm` folder:

| Command | What it checks |
|---|---|
| `node test/ext-test.js` | The whole extension against a small stand-in for VS Code. Quick. Set `XAS99` to the path of `xas99.py` to include the build. |
| `node test/lib-test.js misc` | Prints the outline, warnings, folds and original-game addresses for the test files. |
| `node test/real-check.js <folder>` | Runs the checks over every `.a99`, `.z80`, `.asm`, `.a80`, `.s` and `.6502` file in a folder (a finished program should give 0 warnings). |
| `node test/beebasm-check.js file.6502 [beebasm]` | Builds the file with the real BeebAsm and compares the address of every label with ours. Give the path to `beebasm` (or set `BEEBASM`); `node test/ext-test.js` runs it too when `BEEBASM` is set. |
| `python test/z80-size-check.py [file.asm]` | Compares the Z80 sizes with SkoolKit's Z80 assembler (`pip install skoolkit`): every way of writing every instruction, or every line of a file. |
| `node test/layout-check.js file.a99 file.lst` | Compares every address with an xas99 listing made with `-L`. |
| `node test/real-hover.js <folder> <file.a99> "<text on a line>" [word]` | Prints the tooltip for a word on a line of your own code. With no text, prints the summary lines and the program's size. |
| `npm install`, then `npm run test:vscode` | The real thing: opens a copy of VS Code and tries tooltips, go to definition, the outline, the summary lines, warnings, the original-game links and a build inside it. See below. |

`npm run test:vscode` downloads a copy of VS Code into `.vscode-test` the first time (about 150 MB) and leaves your own VS Code alone. A VS Code window opens and closes by itself; don't type into it while it runs. To include the build test, set `XAS99` to the path of `xas99.py`; without it the build test is skipped. To include F5 (build, then start Classic99), set `CLASSIC99` to the path of `classic99.exe`; Classic99 opens for a moment and is closed again. On Windows:

```
set XAS99=C:\path\to\xdt99\xas99.py
set CLASSIC99=C:\path\to\classic99\classic99.exe
npm run test:vscode
```

The test files in `test/fixtures` are made up (a small "Crystal Rover" program, a paddle demo, a short `.skool` file, a C64 "Star Hopper" program, a Spectrum "catch the star" toy and a BBC Micro "stars" demo), not taken from any real game.

## Licence

MIT. See `LICENSE`: anyone may use, change and share the code, as long as the licence notice stays with it.
