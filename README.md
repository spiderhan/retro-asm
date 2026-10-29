# Retro Assembly Helper

Tooltips in plain English, proper colours, and quick ways to jump around assembly source for old home computers.

New here? **[QUICKSTART.md](QUICKSTART.md)** gets you from install to a built program in ten minutes.

## Computers it knows

| Computer | Chip | Written the way of | Files it opens by itself | More about it |
|---|---|---|---|---|
| TI-99/4A | TMS9900 | xas99 | `.a99` | the main sections below use it for their examples |
| ZX Spectrum | Z80 | sjasmplus (and SkoolKit's `skool2asm` output) | `.z80` | **ZX Spectrum** below |
| Commodore 64 | 6502 | KickAssembler | (`.asm`, see below) | **Commodore 64** below |
| BBC Micro (and Master) | 6502 / 65C02 | BeebAsm | `.6502` | **BBC Micro** below |
| TI-99/4A GPL (cartridge programs) | GPL, TI's own language run from GROM | xga99 | `.gpl` | **TI-99/4A GPL** below |

Everything in **What you get** works for all four: tooltips, a plain-English sentence for each line, go to definition, find uses, rename, the outline, summary lines above routines, warnings, addresses and sizes, the side panel, the explain page, the cheat sheet, build and run. The few parts that only suit one computer say so.

`.asm` and `.s` files are used by lots of assemblers, so VS Code doesn't hand them to this extension unless you ask (see **Commodore 64**). Once it has them, it looks at the lines in the file and picks the chip that fits.

Each chip is one data file, so other chips can be added without touching the code (see **Adding a chip of your own**).

## Install

1. Download the newest `retro-asm-<version>.vsix` from the [Releases page](https://github.com/spiderhan/retro-asm/releases).
2. In VS Code, open the Extensions panel.
3. Click the `...` menu at the top of the panel and choose **Install from VSIX...**
4. Pick the file you downloaded.

Open an assembly file: `.a99`, `.z80` or `.6502` open by themselves. The bottom-right corner of the window shows the chip it is reading the file as (for example **TMS9900**, **Z80** or **6502 (BBC Micro)**), and a chip icon appears on the bar down the left of the window.

### Set up the assemblers and emulators

The extension reads and checks your code on its own. To **build** a program and **run** it, each computer also needs two other programs, which are free but not part of this extension: an assembler (it turns your code into a program) and an emulator (it pretends to be the computer).

Run **Retro ASM: Set up tools** (Ctrl+Shift+P). It lists, for each computer, what is needed, whether it was found and where, and where to get what is missing. Pick any line to open its download page or to point to a copy you already have. The side panel's **Project** section also shows **Missing: ...** and opens the same list.

| Computer | Assembler | Emulator | Also needs |
|---|---|---|---|
| TI-99/4A | xas99 | Classic99 (Windows only) | Python 3. To step through a program: MAME and its TI-99/4A ROMs (see **Step through a program**) |
| ZX Spectrum | sjasmplus | Fuse | |
| Commodore 64 | KickAssembler (`KickAss.jar`) | VICE | Java |
| BBC Micro | BeebAsm | BeebEm (Windows only) | |

The easiest way: download each one, then **unpack it into your tools folder** (`retro-asm-tools` in your home folder; **Set up tools** has a line that opens it). It doesn't matter what the folders inside are called (`xdt99-3.6.5-Windows` is fine). For KickAssembler, put `KickAss.jar` in the folder. After that, **Build** (Ctrl+Alt+B) and **F5** just work. Nothing is installed, downloaded or run for you.

Each tool is looked for in this order: a file you picked in **Set up tools**, next to your source, your tools folder, your PATH, and the usual install folders (Program Files and so on). So anything you have already installed the normal way is found too.

## What you get

### File icons

Assembly files get a small orange chip icon in the Explorer and on editor tabs. VS Code shows it when your file icon theme has no icon of its own for these files (the built-in theme doesn't), so other files keep their usual icons. A `.asm` file shows it once it is opened as Retro Assembly (see **Changing the chip**).

### The side panel

Click the chip icon on the bar down the left of VS Code (or run **Retro ASM: Show the side panel**). It has five parts, each of which can be folded away or dragged into a different order:

- **Project:** the chip, how big the program is and how much room is left, its files, how many warnings there are, the last build, the biggest routines, and names that nothing uses (often fine, but sometimes a spelling slip or spare code). The buttons at the top build, and build and run.
- **This line:** follows the cursor. The line in plain English, its address and size, the registers it reads and changes, what the instruction does, which flags it sets and how many cycles it takes, and the routine it is in (how big it is and where it is called from).
- **Registers:** follows the cursor and answers "what is in my registers right now?". It reads the routine from its top down to your line and lists each register with what it holds (`R0 >0100`, `HL the address of buffer`, `A a copy of B`), the line that put it there (click to go there), and any memory place you stored to (`SCORE ← R1 (>4100)`). A register a jump or loop could have changed is marked *unsure*. Put the cursor on a call (`BL @PRINT`, `CALL put`, `JSR plot`) and it also shows what that routine needs, what you have in those registers now (a warning if nothing has been put there), and which registers it will change, so you know what you would lose. Inside a routine it lists what the routine expects from its caller. It takes the meaning of each register from the comment above the routine (`; In: R1 = the letter to print`, `; Out: R2 = position after`) or from your `; @reg` lines (see below). It works for all four computers. It reads the code; it never runs it, so treat it as a good reminder, not a promise: a routine outside your files (a ROM call) is shown as "not known", and a register set through a table or a calculation is shown as changed rather than guessed.
- **Memory map:** the machine's whole memory as a bar, with your program and the hardware it uses marked on it, how much room is left, and where each file sits.
- **Hardware used:** every screen, sound, keyboard, port and ROM address your code uses, grouped by what it is, with a short explanation. Open one to see each line that uses it, and click to go there. Addresses outside the program that the chip file doesn't know (usually your own variables) are kept in a folded-away list at the bottom.

Everything in the panel is worked out on your own computer from your code and the chip files, the same way the tooltips are. It doesn't use AI, needs no account or key, and sends nothing over the internet.

### Tooltips (hover the mouse)

The examples here are TI-99/4A code. The other computers get the same kinds of tooltip with their own instructions and addresses: `LDA ($FB),Y` or `JSR $FFD2` on the C64, `LD A,(IX+3)` or `CALL 3435` on the Spectrum, `LDA #22:JSR oswrch` or `&FE4E` on the BBC.

| Hover over | You see |
|---|---|
| An instruction (`MOVB`, `JNE`, `LDCR` ...) | What it does, how it is written, **what this exact line does**, and how long it takes (see **How long it takes** below). For example `MOVB *R1+,@VDPWD` says: *Copy the byte R1 points at (R1 then moves on by 1) into the byte at VDPWD (>8C00).* A jump looks at the line above it, so `DEC R2` then `JNE LOOP` says: *Jump to LOOP if R2 is not 0.* |
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
| The **Outline** panel in the Explorer side bar | A list of every routine, with its loop labels tucked inside it. A label that nothing uses and that has nothing under it (like an end-of-text marker) is tucked in too, not listed as a routine. Labels also have two colours: a routine (something called) and a plain label (a spot you jump to, or a marker). The strip along the top of the editor shows which routine you are in. |
| Ctrl+click a `COPY "file"` (or `INCLUDE`) line | Open that file. |
| The small arrows in the margin | Fold a routine or a long comment block away. |
| **F2** on a label | Rename it everywhere. |

### Help while writing

- Suggestions as you type: instructions (with their explanation) and your own labels and registers.
- Wavy underlines for likely mistakes: a misspelt instruction, the wrong number of operands, a label that doesn't exist, a label defined twice. Turn this off with the `retroAsm.checks` setting.

### Capitals and lower case

Type in whatever case you like and let the extension tidy it up, so you never need Caps Lock.

- **When you press Save** (Ctrl+S), instructions, registers and labels are changed to the case the chip file asks for. The TI-99/4A is all capitals, so `li r0,>ff12` becomes `LI   R0,>ff12`. The other chips change instructions and registers to capitals and leave directives and labels as you typed them.
- **Shift+Alt+U** (or **Retro ASM: Change the letter case of instructions, registers and labels**) does it whenever you like: for the lines you have selected, or for the whole file if nothing is selected. **Format Document** and **Format Selection** do the same.
- **Never changed:** comments, text in quotes, numbers (`>ff12`, `$d020`), the file name after `COPY` or `INCLUDE`, and directives that start with a dot (`.byte`, `.ifdef`), because some assemblers only read those in lower case.
- **Labels** are only changed when the chip file says so (`"labels": "upper"` or `"lower"`). A label is then changed everywhere it is used in the file. A label you `COPY` in from another file is changed when you save that file. If two labels would end up the same (`foo` and `FOO` on a chip that tells them apart), both are left alone and you are told.
- **Auto-save never changes anything**, so a line is never changed while you are still typing on it. Switch the save step off with the `retroAsm.formatCaseOnSave` setting.
- Which case each chip uses is the `caseFormat` section of its chip file (see **Adding a chip of your own**).

### Lining up the columns

Make the label, the instruction, the operands and the comment of every line start in the same place, so the code reads like a table. It works for all four computers.

- **Shift+Alt+L** (or **Retro ASM: Line up the label, instruction, operands and comment in columns**) does it for the lines you have selected, or for the whole file if nothing is selected. It is never done by itself: not when you save, and not by Format Document.
- A label starts at the left edge. The instruction, the operands and a comment at the end of a line each start at a set place. Each chip starts with its own layout (the number is how many characters come before it):
- **A label pushed in from the left by accident is left alone.** On the TI-99/4A a label only counts as a label at the left edge, so `   START LWPI WS` is read as the instruction `START`. Line up now spots that the next word is a real instruction and leaves the line exactly as typed, instead of spreading it into the instruction, operand and comment columns. Move the label back to the left edge and line up again.

| Chip | Instruction | Operands | Comment |
|---|---|---|---|
| TI-99/4A | 8 | 14 | 32 |
| ZX Spectrum | 8 | 16 | 32 |
| Commodore 64 | 8 | 12 | 32 |
| BBC Micro | 4 | 12 | 32 |

- If something is too long for its place (a long label, say), it keeps one space after it and the rest of the line follows on. A comment always keeps at least two spaces before it, so on the TI-99/4A the one-space comment warning goes away too.
- **Only the spaces between the parts change.** The words, the operands (exactly as you typed them, even `R0, R1`) and the comments are copied as they were. A Tab between the parts becomes spaces.
- **Left as they are:** blank lines, whole-line comments, `name = value` and `*=address` lines, lines with a `{` or `}`, a line that has a label followed by more statements after a colon (BeebAsm's `.loop : LDA #1`), and on the TI-99/4A a sum that carries on after a space (`LI R0,5 + 2`).
- **Your own columns:** set `retroAsm.lineUpColumns` for the chip, listing only the numbers you want to change, for example `{ "tms9900": { "instruction": 8, "operands": 13, "comment": 30 } }`. The chips are `tms9900`, `z80`, `6502` and `bbc`. To change a chip for good, edit the `lineUp` section of its chip file (see **Adding a chip of your own**).
- It goes well with the letter-case tidy-up (Shift+Alt+U): do them in either order.

### Convert a TI-99/4A file to xas99 style

For a TI-99/4A file written by hand, or for another assembler, that xas99 stops on. Press Ctrl+Shift+P and choose **Retro ASM: Convert the whole file to xas99 style (TI-99/4A)**. It always does the whole file, in one step you can undo with Ctrl+Z. It does two things, the two that the extension already warns about (see **More mistakes caught before you build**):

- **Two spaces before a comment** that follows code. xas99, in its normal mode, reads a comment after a single space as part of the operands. This includes a comment stuck on straight after the operands with a `;`.
- **No spaces next to a comma** in the operands. `MOV R0, R1` becomes `MOV R0,R1`, because xas99 stops reading at the first space.

**Left as they are:** text in quotes (`TEXT 'a, b'`), whole-line comments, comments that already have two spaces or a Tab, and a sum that carries on after a space (`LI R0,5 + 2`). **Nothing else is changed**: not the letter case, not the columns (use the two tidy-ups above for those), and any other difference between assemblers (different directive names, say) is not converted. On any other chip you are told it is only for the TI-99/4A and nothing changes.

### Starter code

Ready-made pieces of code, so you don't have to remember the usual start and end of a program. Two ways to use them:

- **Type its name** in lower case on an empty line and pick it from the suggestions (two letters are enough in the label column, for example `pr` for `program`). The code replaces the line, with its labels in the first column. **Tab** jumps to each spot to fill in; a name used twice (such as a loop's label) changes everywhere at once.
- **Right-click** in the code and choose **Retro ASM: Insert starter code** (or run it from the command palette), then pick one. On an empty line it replaces the line; otherwise it goes on the lines below.

Only lower-case names bring them up, so typing a label such as `LOOP` or `PRINT` won't offer them.

TI-99/4A (TMS9900):

| Name | What you get |
|---|---|
| `program` | A whole program to start from: `DEF START`, `LWPI` to set up the registers, `LIMI 0`, room for your code, then a wait at the end so you can see what it did (**FCTN =** goes back to the title screen), the 32 bytes for the registers and `END START`. |
| `routine` | A routine called with `BL @NAME` that comes back with `RT`. |
| `loop` | Count a register down to 0, going round once for each count (`LI`, `DEC`, `JNE`). |
| `vdpwrite` | Write one byte to video memory by talking to the video chip directly (put a letter on the screen). |

ZX Spectrum (Z80, sjasmplus), Commodore 64 (6502, KickAssembler) and BBC Micro (6502, BeebAsm) have the same set, written their own way:

| Name | Spectrum | C64 | BBC Micro |
|---|---|---|---|
| `program` | `DEVICE ZXSPECTRUM48`, `ORG $8000`, `ei`, room for your code, a wait at the end, and `SAVESNA` to make a snapshot (.sna) for an emulator. | `BasicUpstart2(start)` (so `RUN` starts it), room for your code, `rts` back to BASIC. | `ORG &1900`, room for your code, `RTS` back to BASIC, and `SAVE` so **Build** puts it on a disc that runs by itself. |
| `routine` | Called with `call`, back with `ret`. | Called with `jsr`, back with `rts`. | Called with `JSR`, back with `RTS`. |
| `loop` | Count B down with `djnz`. | Count X down with `dex` / `bne`. | Count X down with `DEX` / `BNE`. |
| `printchar` | Print a letter with the ROM (`CHAN-OPEN`, then `rst $10`). | Print a letter with the KERNAL's `CHROUT` (`jsr $FFD2`). | Print a letter with `OSWRCH` (`JSR &FFEE`). |

On the Spectrum and the BBC, put your routines where `program` says (before `SAVESNA` or `.end`), or they won't be saved with the rest.

The starter code offered is for the chip shown in the bottom-right corner. An empty `.6502` file is taken as BBC Micro and an empty `.asm` file as C64; check the corner and click it to switch if needed (`.a99` and `.z80` files are always clear).

It all comes from the chip files (see **Adding a chip of your own**), and it is part of the extension, so there is nothing else to install.

### Build and run

- **Ctrl+Alt+B** (Cmd+Alt+B) builds. **F5** builds, then starts the emulator.
- Each computer's assembler and emulator are found by themselves (see **Set up the assemblers and emulators** above): xas99 and Classic99 for the TI-99/4A, sjasmplus and Fuse for the Spectrum, KickAssembler and VICE for the C64, BeebAsm and BeebEm for the BBC. If one can't be found, the message says so and its **Set up tools** button opens the list.
- If there is a `build.bat` (or `build.sh`) next to your source, that is what runs, and it is given the name of the main source file (the one that pulls in the others), as in `build.bat hello.a99`. If not, the assembler is run directly. Or set your own command in `retroAsm.build.command`.
- **F5** starts the emulator with what the build made: the `.sna` snapshot (Spectrum, from a `SAVESNA` line), the `.prg` (C64), the `.ssd` disc (BBC). If that file wasn't made, you are told which one, rather than an empty emulator opening.
- The first time a project wants to run something of its own (a `build.bat`, an xas99 or Classic99 found in its folders, or a command in its `.vscode/settings.json`), you are asked first, showing the exact command. Say **Allow** and you won't be asked again in that folder unless the command changes. See **Safety** below.
- The assembler's errors are underlined on the right lines and listed in the Problems panel. Everything it printed is in the **Retro ASM** output panel.
- On Windows, Classic99 is started after a build. If it is already open, it is left alone and you are reminded to reload the program there. Classic99 runs on Windows only; on a Mac or Linux set `retroAsm.build.runCommand` to another TI emulator. For any other emulator, set `retroAsm.build.runCommand` too.

### Step through a program (TI-99/4A)

This stops your program on a line you choose and lets you step through it one instruction at a time, on a **real emulated TI-99/4A** (MAME), watching what the computer really does. It is new and only for the TI-99/4A so far.

**What you need once:** MAME (from mamedev.org, unpacked into its own folder, for example inside your tools folder) and the TI-99/4A system ROMs as `ti99_4a.zip` in a folder called `roms` beside `mame.exe`. **Set up tools** now lists MAME and tells you if it isn't found. If your ROMs live somewhere else, set `retroAsm.debug.romFolder`.

**How to use it:**
1. Put `AORG >A000` (or any address from `>A000` up) before your code. The debugger puts the program in the TI's extra 32K memory, so it needs a fixed address there. Code placed at `>2000` to `>3FFF` should also work (not tried yet). A program with **more than one `AORG`** (say a block at `>A000` and another at `>C000`) is loaded as separate pieces, as long as each piece sits inside `>2000`-`>3FFF` or `>A000`-`>FFFF`.
2. Click in the gutter beside a line of code to set a breakpoint (a red dot). Only lines that make an instruction can have one; a comment or data line gets a grey dot with a note.
3. Press **Ctrl+Shift+P** and run **Retro ASM: Debug in MAME (TI-99/4A)** (or use **Run and Debug** and pick *Retro ASM: TI-99/4A in MAME*). The program is assembled, MAME opens, and the program stops on its first instruction.
4. Use VS Code's usual buttons: **Continue**, **Step Over** (a `BL` or `BLWP` call is run in one go), **Step Into**, **Step Out** (runs to where the routine returns to) and **Pause**.
5. The **Variables** panel shows PC, WP, ST, the status flags (L>, A>, EQ, C, OV, OP, X) and R0 to R15. In **Watch** or the Debug Console you can type a register (`R3`), a label (`score` shows the word stored there) or an address (`>8300`).
6. **Change a register while stopped.** In the Variables panel, double-click a value (or right-click, **Set Value**) and type a new one: `5` (plain numbers are decimal), `>1F` or `0x1F` (hex), or a label (its address). You can change R0 to R15, WP and ST, and flip a status flag by typing `on` or `off`. In the Debug Console you can type `R3 = >1F`, or `@SCORE = 10` to change the word stored at a label or address (`@>8310 = >ABCD`). **PC can't be changed**: the chip has already read its next instruction, so it would run that one anyway. To run from somewhere else, put a breakpoint there and press Continue.
7. **Break at a name or address.** In the Breakpoints panel (Run and Debug), the **+** on the *Function Breakpoints* heading opens a box. Type a label (`PRINT`), one of the supplied routines (`VSBW`, `VMBW`, `VSBR`, `VMBR`, `VWTR`, `KSCAN`) or an address (`>A000`, `0xA000`) and the program stops when it gets there. This is the way to stop in a routine that has no lines of your own. You can give it a condition or hit count like any breakpoint. `KSCAN` stops at the start of the small wrapper that calls the TI's keyboard routine. Where there is no source line you see the name and address in the Call Stack and the registers as usual.
8. **Call stack.** The Call Stack panel lists who called the routine you are in. The TI has no real call stack, so this is read from two clues: after `BL` the way back is in R11 (shown as *via R11*, a good guess), and after `BLWP` or `XOP` the old workspace and return address are saved in the new R13 and R14 (exact). Click a caller to see its line and its registers. Older callers are hidden if a routine saved R11 somewhere of its own or called another routine with `BL`: the chip alone can't show those.

**Try it:** `examples/debugger/` has small made-up programs for checking the debugger. `kscan-demo.a99` shows PRESS A KEY and then each key you press (it uses `KSCAN`); `blocks-demo.a99` has its code and its text in two separate blocks of memory; `memory-demo.a99` uses `VSBR` and `VMBR` and lets you change a word in memory from the Debug Console; `lowmem-demo.a99` has its code at `>2000`. Each has a comment saying what you should see and where to put a breakpoint.

**Good to know:**
- F5 on a code file still builds and starts Classic99 as before. Debugging is its own command.
- The MAME window stays open beside VS Code while you debug; closing VS Code's debugger closes it.
- If your program says `REF VSBW,VMBW` (or `VSBR`, `VMBR`, `VWTR`), the debugger supplies simple versions of those routines itself, because the loader that normally does it isn't there. `KSCAN` is also supplied: it calls the TI's own keyboard routine (in the console ROM), so the key comes back in `>8375` (`>FF` = none) and bit `>20` of `>837C` says a key was pressed. Other `REF` names (`GPLLNK`, `XMLLNK`, `DSRLNK`, `NUMASG` ...) belong to the Editor/Assembler cartridge, which isn't loaded; you are warned, and calling one restarts the TI.
- Before your program starts, a few instructions set the screen to white text on light blue (the way Classic99 does). You don't step through them; the debugger stops at your first instruction. A program that sets its own colours overrides them.
- Your own program is loaded after MAME has started the TI's menu, so the screen and memory are as the TI left them. A program that expects something set up by a cartridge or the disc system won't find it.
- **Keys only reach the TI while it is running.** MAME reads the keyboard only while the program runs, so a breakpoint that stops on every pass makes the keyboard look dead. To test keys, let the program run freely (or break only on the line that handles a key).
- It talks to MAME only on your own computer (address 127.0.0.1); nothing goes over the internet.
- **Stop only when something is true.** Right-click a red dot and choose **Edit Breakpoint**. *Expression* takes things like `R2 = 5`, `R0 >= >0100`, `@SCORE > 9` or `R1 & 1` (a register, a number such as `>1F`, a label, or `@` plus an address or label; join with `and` / `or`). *Hit Count* takes `10` (the 10th time), `>=10` or `%10` (every 10th time). This is how to stop inside a loop. Stepping always stops where it lands, whatever the condition says.
- Not done yet: the other three computers (Spectrum, C64, BBC Micro), `GPLLNK`/`XMLLNK`/`DSRLNK` and the other cartridge routines, and callers older than the last `BL`.

### More mistakes caught before you build

Every chip warns when a short jump or branch can't reach its label (`JR`/`DJNZ` on the Z80, `BNE`/`BEQ` ... on the 6502). These ones are for the TI-99/4A:

- A short jump (`JMP`, `JEQ`, `JNE` ...) to a label that is too far away.
- `BL` inside a routine that returns with `B *R11` but never saved R11.
- A label that lands on an odd address when code or `DATA` follows (a missing `EVEN`), and whole-word instructions aimed at an odd address.
- A space after a comma in the operands, which xas99 rejects.
- **A comment with only one space before it** (`LI R0,>10 * set up`). xas99, in its normal mode, reads the text after a single space as part of the operands and stops with an error such as *Unknown symbol*. Two or more spaces, a Tab, or a `;` all end the operands properly. The warning underlines the one space and offers a quick fix (click the light bulb, or press Ctrl+.) that adds the second space. Instructions with no operands (`RT * done`) and comments that carry on a sum (`LI R0,5 + 2`) are left alone. Only the TI-99/4A chip does this, because the other assemblers read comments differently.
- A blue note when the comment above a routine says "Uses R0, R1" but the code also changes another register.

### Addresses and sizes

- The tooltip for any instruction shows its memory address and how many bytes it takes. The tooltip for a label shows its address.
- **Ctrl+Alt+A** (Cmd+Alt+A) shows every line's address down the left of the code, like an assembler listing.
- The bottom-right corner shows the size of the whole program against the room there is, for example `TMS9900 · 18.9K of 24.0K`. Hover it for the details.
- Addresses match what the real assemblers produce: checked against xas99 (TI), SkoolKit (Spectrum), BeebAsm (BBC) and py65 (C64 instruction sizes).
- On the TI-99/4A, programs loaded with Editor/Assembler are assumed to start at `>A000`; change `retroAsm.loadAddress` if yours doesn't. Code after `AORG` uses the address it gives.
- Sums with labels are worked out in tooltips, so `PAT_END-PAT` shows as a number.

### How long it takes (cycles)

The tooltip for an instruction, and **This line** in the side panel, say how many clock cycles it takes, written the way it is on that line. Handy for working out whether a loop fits in one screen refresh.

- **C64 and BBC (6502):** `LDA $D020,X` says *4 cycles, or 5 if adding X to the address crosses into the next page of 256 bytes*. Branches give both times: *2 cycles if it doesn't jump, 3 if it does*. On the BBC, the Master's 65C02 numbers are added where they are different, and the hardware at `&FC00`-`&FEFF` is marked as slower.
- **ZX Spectrum (Z80):** the times are T-states. Jumps and repeats give both numbers: `LDIR` says *21 cycles for each byte it copies, 16 for the last one*. An address in 16384-32767 is marked as shared with the screen, as it can run a little slower while the picture is drawn.
- **TI-99/4A (TMS9900):** the time depends on where things are in memory. The console ROM and the 256 bytes at `>8300` are fast. The 32K expansion, cartridges and the video and sound chips are slow, and each read or write there adds 4 cycles. So `MOV @X,@Y` says *30 cycles, plus up to 24 more in slow memory (it reads or writes memory 6 times; each slow one adds 4)*.
- How fast each machine goes: C64 about 1 million cycles a second, BBC 2 million, TI-99/4A 3 million, Spectrum 3.5 million. The cheat sheet says this too.
- Checked against: the 6502 data sheet and py65 (6502), SkoolKit's Z80 simulator (every way of writing every Z80 instruction) and the TMS9900 data manual.

**Cycle counts beside the code.** Switch on `retroAsm.showCycles` (or press **Ctrl+Alt+T** / Cmd+Alt+T) and every instruction line gets a small grey note at its end: `12+ cycles`, `4+ cycles`, `2/3 cycles`. A plain number is the time. A **+** means it can take longer (on the TI, when the memory is slow; on the 6502, when an address crosses into the next page). Two numbers with a slash are the two times the instruction can take, for a jump or a repeat (the hover says which is which). Hover the note for the full sentence that the instruction's tooltip gives. It starts off, because it adds a note to every line. VS Code's own `editor.inlayHints.enabled` must not be `off`.

### A summary above each routine

A small grey line above every routine says who calls it (click it to see where), where it sits and how big it is, and which registers it changes, including the ones changed by routines it calls. Turn it off with `retroAsm.routineSummaries`.

### Pictures, and the picture editor

Sprites, characters and tiles are kept as lists of numbers (`BYTE`, `DATA`, `DEFB`, `.byte`, `EQUB`). The extension can show those numbers as a picture, and let you draw on it.

**Mark a block as a picture** with a comment that starts `@sprite`, just above it (or at the end of its first line):

```
* @sprite 16x16
MAN    BYTE >03,>07,>05,>07,>02,>01,>0F,>1F
       BYTE >37,>27,>07,>06,>06,>06,>0E,>00
       ...
```

The comment is ignored by the assembler. After `@sprite` comes the shape: one of the computer's own (below) or a size such as `16x8`.

An **Edit picture** link then appears above the block (hover `@sprite` for a short explanation of the block and the same link). Click it and the picture editor opens beside your code:

- Click or drag to draw. Clicking a pixel that is already that colour, or using the right mouse button, rubs it out.
- Each stroke changes the numbers in your code straight away. Only the numbers that change are touched, written the way you wrote them (`>3C`, `$3c`, `%00111100`, `60`...). **Ctrl+Z** in the code undoes it, and the editor has its own Undo too.
- Typing new numbers in the code changes the picture.
- Clear, invert, flip, and move the whole picture one pixel at a time. Several pictures in a row (animation frames) get a "1 of 4" picker.
- It shows the picture at real size, and each row's pixels and bytes, so you can see how a drawing becomes numbers.

If a block uses a name or a sum instead of a plain number (`BYTE FULL,>81`), the editor shows it but won't change it, and says why.

**No marker yet?** A block whose name or comments say it's a drawing (`PAT_...`, "sprite", "drawing" and so on) gets an **Edit as a picture?** link. Click it, pick a shape, and the `@sprite` line is added for you. **A picture right below another one** gets an **Edit picture (same shape as above)?** link. Click it and the same `@sprite` line is added above it, with no question asked. You can also right-click any data lines and choose **Retro ASM: Edit these bytes as a picture**, or choose **Retro ASM: New picture here** to put a new, empty picture at the cursor.

**A blank picture, quickly:** on an empty line, type `sprite` (in lower case) and pick a size from the suggestions: `sprite 8x8`, `sprite 16x16` and the computer's other shapes. An empty picture goes in, already marked and named (`SPR1`, `sprite1`... whichever is free), with the name selected so you can type over it; Tab moves on. For a size that isn't listed, type it on the end: `sprite24x16`. **sprite ...** opens **New picture here**, which also asks how many frames.

| Computer | Shapes | How the bytes are kept |
|---|---|---|
| TI-99/4A | `8x8`, `16x16` | One byte a row. A 16x16 sprite is four 8x8 blocks: top-left, bottom-left, top-right, bottom-right. |
| ZX Spectrum | `8x8`, `16x16` | One row after another (2 bytes a row for 16 wide). |
| Commodore 64 | `8x8`, `c64` (24x21 sprite), `c64multi` (12x21 multicolour sprite), `charmulti` (4x8 multicolour character) | One row after another, 3 bytes a row for sprites. Sprites are 64 bytes apart. Multicolour pixels are 2 bits each and twice as wide. |
| BBC Micro | `8x8` (VDU 23), `mode4`, `mode1` (four colours), `mode2` (sixteen colours) | In 8-row cells: 8 bytes down, then the next cell across. MODE 1 and MODE 2 spread each pixel's bits across the byte. |

Add a size to a shape to change it (`@sprite mode2 8x8`), or an order (`rows`, `columns` or `cells`) to a plain size (`@sprite 16x16 columns`). Each computer's shapes are in its chip file (the `sprites` section), so a chip file of your own can add more.

The `examples/sprites` folder has a file for each computer to try it on: `sprites.a99`, `sprites.z80`, `sprites.asm` (C64) and `sprites.6502` (BBC).

**Tooltips** draw pictures too. Hover a data line, or the label of a block: a marked block is drawn in its shape, and an unmarked one that looks like a drawing is drawn as 8x8 characters (and, on the TI, as 16x16 sprites). `retroAsm.pictures` can make that always or never.

On the C64, write the marker with `//`, not inside `/* */`.

### Sound and video values

This part is for the TI-99/4A (the Spectrum's border, keyboard and sound ports are covered in **ZX Spectrum** below). Hover a number that is on its way to the sound chip or the video chip and the tooltip says what it means: `>9F` is "volume of voice 1: off", and a value sent to a video register is spelt out (screen on, 16x16 sprites ...). This works for `LI` followed by `MOVB` to `>8400` or `>8C02`, for `BLWP @VWTR`, and for byte lists that are sent to the sound chip.

### Sound player (TI-99/4A)

If you keep a sound in your code as BYTE or DATA lines, you can hear it. Put a comment with `@sound` just above the block, and a **Play sound** link appears above it:

```
* @sound
BEEP   BYTE 3,>8E,>0F,>90,10     ; voice 1 at about 440 Hz, for 10/60 s
       BYTE 1,>9F,1              ; voice 1 off
       BYTE 0                    ; the end
```

The layout it reads is the console's sound list. Each step is a count, then that many bytes for the sound chip, then how long to wait in 60ths of a second. A count of 0 ends the list.

Click the link and a player opens beside your code. It has **Play**, **Stop** and **repeat**, a picture of the pitch and loudness of each voice (three tone voices and the noise), and a table of the steps with what each byte does in plain English. Change a number in the code and the player updates. The player never changes your code.

A block that is *named* like a sound (`SND_...`, `MUSIC`, `BEEP`, `TUNE` ...), or has a comment that says so, and reads cleanly as a sound list from start to finish, gets a **Play as a sound?** link even without the marker. A block that doesn't read as a list is left alone. If a marked block doesn't add up, the link says why (for example *Step 2 says 5 bytes go to the sound chip, but the data stops*).

Hover `@sound` for what the sound is (how many steps, how long) and a **Play sound** link. It only knows the TI-99/4A's sound chip for now. The other computers have different sound chips, so each needs its own player. `retroAsm.soundLinks` switches the links off. The `examples/sounds` folder has `sounds.a99` to try it on (it is data only, not a program to run).

### Screen preview (TI-99/4A)

A whole bitmap screen can be kept in your code as its tables of shapes, colours and a grid. When a file has an `@screen` comment line that names those tables, a **Show this screen** link appears above it, with a plain-English line such as *a whole screen: 3 bands, shapes at >0000, colours at >2000, grid at >1800, sprites listed at >1F00*:

```
* @screen ti-bitmap bands=3 shared=no run=SCRRUN grid=SCRMAP gridat=>1800 patterns=SCRPAT0,SCRPAT1,SCRPAT2 patat=>0000 colours=SCRCOL0,SCRCOL1,SCRCOL2 colat=>2000 sprites=SCRSPR96 sprat=>1800 spritelist=SCRSLIST listat=>1F00 regs=>02,>E2,>06,>FF,>03,>3E,>03,>01
```

Click the link and a preview opens beside your code. It draws the picture the way the video chip would, from the tables in the file: each square of the grid picks a shape, each band of the screen has its own shapes and colours (unless `shared=yes`), and the sprites in the sprite list are drawn on top (switch them off with **show sprites**). Under the picture a table says where each table goes in video memory, how big it is, and whether that is the right size. Hover `@screen` for the same list, and a table that is the wrong size or a name that can't be found is also underlined in the `@screen` comment and listed in the Problems panel. A table that is the wrong size, or a name that can't be found, gets a plain note, and the picture is still drawn from what is there. Change a number in the code and the preview updates. It never changes your code.

The right sizes are 2048 bytes for each band of shapes and each band of colours, 768 for the grid (32 across, 24 down), and a sprite list of 4 bytes a sprite that ends in `>D0`. It also checks the eight video register values on the line against the addresses on the line (for example register 2 against `gridat`), and warns if they disagree. Words in the line that Retro ASM doesn't know are ignored, so the line can grow. `retroAsm.screenLinks` switches the links off. The `examples/screens` folder has `screen-demo.a99` (made up) to try it on.

What the preview does **not** do yet: it ignores the video chip's rule that only four sprites show on one row, it draws from the addresses and tables named in the line (not from where the register values say they are), and it only draws the TI-99/4A bitmap screen.

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

To build, you need KickAssembler (`KickAss.jar`) and Java, and to run, VICE: see **Set up the assemblers and emulators** above. With them in place **Build** runs `java -jar KickAss.jar "game.asm"` and **F5** then starts VICE with `-autostart game.prg`. To use other commands, set `retroAsm.build.command` and `retroAsm.build.runCommand`, for example `java -jar C:\path\to\KickAss.jar "${file}"` and `"C:\path\to\x64sc.exe" "${fileDirname}\${fileBasenameNoExtension}.prg"`.

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

To build, you need sjasmplus, and to run, Fuse: see **Set up the assemblers and emulators** above. With them in place **Build** runs `sjasmplus "game.z80"`. Put a `SAVESNA "game.sna",start` line in the code (the starter code has one) so the build makes a snapshot, and **F5** starts Fuse with it. To use other commands, set `retroAsm.build.command` and `retroAsm.build.runCommand`, for example `"C:\Fuse\fuse.exe" "${fileDirname}\game.sna"`. sjasmplus's error messages (`game.asm(33): error: ...`) are underlined on the right lines.

Things it doesn't follow yet:

- Lines inside `IF`, `DUP` and `REPT` blocks may be put in more than once (or not at all), so addresses after one are marked as rough. The same goes for `STRUCT`, `PAGE` and `SLOT`.
- sjasmplus's numbered labels (`1:` with `jr 1B`) and `MODULE` names aren't followed.
- The 3-operand unofficial forms such as `RLC (IX+3),B` aren't known.
- Fuse hasn't been tried with the real program yet (only a stand-in), so check that **F5** opens your snapshot. Building was tried with the real sjasmplus 1.24.0: errors are underlined on the right lines, and a clean file makes its `.sna`.

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
- **Plain-English numbers.** Hover the number in `LDA #19` before `JSR osbyte` and it says *wait for the next screen refresh*; `LDA #22:JSR oswrch` followed by `LDA #1:JSR oswrch` says *MODE 1*; `STA &FE20` says what the video ULA setting means; `STA &FE00` then `STA &FE01` name the 6845 register being set; `STA &FE4E` lists the interrupts switched on or off.
- **BBC warnings.** A 65C02 instruction before `CPU 1`, code that runs past a `GUARD`, a write to the operating system's zero page (`&90`-`&FF`) in a program that also calls the OS, and code sitting in screen memory for the MODE you switched to.
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
- **BBC BASIC's own assembler** (inside `[ ]` in a `.bas` BASIC program) is read since 0.18.0: see **BBC BASIC listings** just below the BBC Micro notes. Only the `[ ]` parts are read; there are no warnings or addresses there yet.

### BBC BASIC listings (`.bas`)

Lots of BBC programs are a BASIC program with machine code inside `[` and `]`:

```basic
 50 [OPT pass%
 60 .start
 70 LDA #65 : JSR oswrch
 80 ]
```

Open a `.bas` file and the file type in the bottom-right corner reads **BBC BASIC**. The BASIC lines get BASIC colours. Between `[` and `]` the code is read as BBC assembly, so you get the same colours and tooltips as a `.6502` file (an instruction, a number, `&FE4E`, an OS call such as `LDA #19` before `JSR &FFF4`). Go to definition, find all references and the outline work on the `.labels`.

- A plain number given a name on a BASIC line (`oswrch = &FFEE`, `LET ptr = &70`) is kept, so `JSR oswrch` is explained.
- The size of an instruction is shown, but **not its address**: where the code lands is set by `P%` when the program runs.
- A `[` inside a string, after `REM`, or on a `DATA` line is not the start of assembly. `OPT` is skipped.
- No warnings, cycle counts or build for `.bas` files.

## TI-99/4A GPL (GROM, xga99)

GPL is TI's own language. The console runs it one step at a time from GROM (read-only chips), which is how its menus and many cartridges start. A `.gpl` file is read the way xga99 reads it.

- **What works:** tooltips and a plain-English sentence for every GPL command (about 100, including the screen-drawing ones inside `FMT` ... `FEND`), the memory marks in front of an address (`@` the console's fast memory, `*` an address kept in memory, `V@` video memory, `G@` GROM, `#` a video chip setting, and an offset in brackets such as `V@>0400(@TICKS)`), the names xga99 already knows (`KEY`, `TIMER`, `YPT` ...), colours, the outline, go to definition, find uses, rename, warnings for unknown names and wrong operand counts, letter case and Line up.
- **Build:** **Retro ASM: Build** runs xga99 (needs Python) and makes a GROM image, `name.gbc`; its error messages are underlined on their lines. There is no run step: a GROM image can't be started on its own. For a cartridge image for MAME, set `retroAsm.build.command` to `python xga99.py -c "${file}"` (with the right path to `xga99.py`).
- **What is not there:** no Registers panel (GPL has no registers), no timing and no debugger.
- **Try it:** `test/fixtures/gpl-demo.gpl` is a small made-up GPL file.

## Changing the chip

- Click the chip name in the bottom-right corner (or run **Retro ASM: Switch chip**) to choose how files with this extension are read. On a new file that hasn't been saved yet, the choice is used for that file; save it with an extension to keep it.
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
| `littleEndian` | Words are stored low byte first (word data such as `DW` is read that way, for pictures). | Spectrum, C64, BBC |
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

The `timing` section and each instruction's `cycles` give the time in the tooltip. `cycles` can be a number; two numbers, such as `[7, 12]`, for an instruction that may or may not jump (worded by `timing.pair`, or the instruction's own `cyclesPair`); a number for each way of writing the operand, named by `timing.modes` (these work like the sizing forms, with `zeroPage` for the shorter form, and `"4+"` means one more when a page is crossed); or a list of rules tried on the operands, as in `z80.json`. `cyclesAlt` with `timing.altLabel` gives a second chip's numbers (the BBC Master's 65C02), `cyclesNote` adds a sentence, and `timing.slow` marks addresses that run slower. `tms9900.json` shows `access` (how often it reads or writes memory), `operandCost`, `slowAccess` and `cyclesByCount` (a time that depends on a count). A chip file with no `timing` section just shows no time.

`bbc.json` shows the directive kinds `if`, `elif`, `else`, `endif`, `for`, `next` and `skipto`, `reserves` (a gap that puts nothing into the program file), and a `build` section that names the assembler and the emulator to look for (`tool`, `run`), with the command to run each.

The `caseFormat` section says which letter case to use when the file is saved (see **Capitals and lower case**). Each of `instructions`, `directives`, `registers` and `labels` is `upper`, `lower` or `keep` (leave as typed). The words themselves come from the file's own `instructions`, `directives` and `registers`, so there is nothing else to list. Leave the section out and instructions and registers become capitals, while directives and labels are left as typed. `tms9900.json` changes all four; the other three chip files change instructions and registers.

The `lineUp` section says where **Lining up the columns** starts each part of a line: `instruction`, `operands` and `comment` are the number of characters in front of it, and `commentGap` is the fewest spaces kept before a comment when the code is too long to reach the comment's place. A label always starts at the left edge. Leave the section out and the numbers are 8, 16, 32 and 2. Each number is a whole number from 1 to 120, `operands` must be bigger than `instruction`, and `comment` bigger than `operands`; a mistake is reported when the file is read. Your own `retroAsm.lineUpColumns` setting wins over this.

The `snippets` section is the starter code (see **Starter code**). Each one is named by what you type (lower-case letters and digits only) and has a `name`, an `about` line and a `body`: the lines to put in. In the body, `${1:NAME}` is a spot to fill in (Tab moves to the next; the same number is filled in everywhere at once), `$0` is where the cursor ends up, and a real `$` (a hex number on the C64 or Spectrum) is written `\$`, which in the JSON file itself is `"\\$"`. All four built-in chip files have examples (`tms9900.json`, `z80.json`, `6502.json` and `bbc.json`).

The `sprites` section lists the picture shapes for the picture editor: each has a `name`, `width` and `height`, and can have an `order` (`rows`, `columns` or `cells`), `pixelBits` (which bits of a byte make each pixel, for pixels of more than one bit), `colours` and `colourNames`, `pixelWidth` (2 for double-width pixels) and `stride` (how far apart pictures are, such as 64 for C64 sprites). `newSprite` says how to write a new picture. `6502.json` and `bbc.json` have the fullest examples.

`z80.json` also shows `ioPorts` (hardware reached with IN and OUT, and how to read a value sent there), `addressGuess` (when a plain number is probably an address), `build` (what to say when no build command is set) and, in `registers`, which registers are pairs.

## Settings

| Setting | What it does |
|---|---|
| `retroAsm.defaultDialect` | The chip to assume when nothing else decides. Starts as `tms9900`. |
| `retroAsm.dialectByExtension` | Which chip for which file extension. *Switch chip* fills this in. |
| `retroAsm.dialectFolders` | Where your own chip files live. Starts as `asm-dialects`. |
| `retroAsm.build.command`, `retroAsm.build.runCommand` | Your own build and emulator commands. Empty means work it out. |
| `retroAsm.toolsFolder` | The folder you unpack assemblers and emulators into. Empty means `retro-asm-tools` in your home folder. |
| `retroAsm.toolPaths` | The tools you pointed to with **Set up tools**, by name. Filled in for you. |
| `retroAsm.build.xas99Path`, `retroAsm.build.python` | Where xas99.py is, and how to run Python, if the defaults don't find them. |
| `retroAsm.build.askFirst` | Ask before running a build script, tool or command that comes from the project. On to start with. Only your own user settings can switch it off, never a project. |
| `retroAsm.debug.romFolder` | The folder with `ti99_4a.zip` for MAME when you step through a program. Empty means the `roms` folder beside `mame.exe`. |
| `retroAsm.loadAddress` | Where the program loads (hex). Empty means the chip's usual place. |
| `retroAsm.showAddresses` | Addresses beside the code, on or off. |
| `retroAsm.showCycles` | Cycle counts beside the code, on or off. Off to start with. |
| `retroAsm.routineSummaries` | The summary line above each routine, on or off. |
| `retroAsm.pictures` | Pictures in tooltips: `auto`, `always` or `never`. `never` also hides the *Edit as a picture?* links. |
| `retroAsm.pictureLinks` | The *Edit picture* links above picture data, on or off. |
| `retroAsm.soundLinks` | The *Play sound* links above sound data, on or off. |
| `retroAsm.screenLinks` | The *Show this screen* links above an `@screen` comment, on or off. |
| `retroAsm.checks` | Wavy underlines on or off. |
| `retroAsm.formatCaseOnSave` | Change the letter case of instructions, registers and labels when you press Save (see **Capitals and lower case**). On to start with. |
| `retroAsm.lineUpColumns` | Where Shift+Alt+L starts the instruction, the operands and the comment, for one chip, for example `{ "tms9900": { "comment": 30 } }`. Empty to start with, so each chip uses the layout in its chip file (see **Lining up the columns**). |
| `retroAsm.hoverInComments` | Tooltips and jumping for label names inside comments, on or off. |
| `retroAsm.original.skoolFile` | The `.skool` file of the original game (or its folder). Empty means look near the source. |

## Things to know

- It does not assemble anything itself: building runs your own build script, the computer's assembler (xas99, sjasmplus, KickAssembler or BeebAsm), or the command you set. It never downloads or installs anything: **Set up tools** only looks, and sends you to each tool's own download page.
- Addresses, sizes, jump distances and the register summaries are only worked out for chips whose file has a `sizing` section (TMS9900, both 6502s and Z80 all have one).
- The register summary reads the code top to bottom. It can't tell which path a routine takes, so treat it as a guide.
- For TMS9900 it follows the xas99 layout: a label starts in the first column, and after the operands the first space starts a comment.
- Sums are worked out left to right for TMS9900, the same as xas99 does (`2+3*4` is 20).
- xas99 local labels (`!`) and macros are coloured but not followed.
- Addresses of the original game are read from SkoolKit `.skool` files only (not `.ctl` files or plain Z80 source).
- **Grey "ghost text" suggestions are not from this extension.** If you use an AI helper such as GitHub Copilot, it may suggest lines in grey that you accept with Tab. It doesn't know which chip you are writing for, so it can suggest instructions from another one (`ADD` is a Z80 instruction; the TMS9900's is `A`). The extension underlines these. To turn the grey suggestions off in assembly files only, add this to your VS Code settings (`settings.json`):

  ```json
  "[retroasm]": { "editor.inlineSuggest.enabled": false }
  ```

  The extension's own suggestions (the pop-up list of instructions, labels and starter code) keep working.

## Safety

Building runs programs, so a project downloaded from someone else could run anything when you press build. The extension guards against that in three ways:

- **Folders you haven't trusted.** When VS Code asks "Do you trust the authors of the files in this folder?" and you say no, tooltips, colours, links, the outline and the checks all still work. Build, run, the project's own build settings and its own chip files (`asm-dialects`) are switched off until you trust the folder.
- **Asked first.** In a trusted folder, a build script, tool or command that comes from the project is shown to you before it runs the first time (see **Build and run**). If the command changes later, you are asked again. Changes *inside* a `build.bat` you've already allowed are not noticed, so only allow scripts from people you trust.
- **Odd file names.** A file or folder name with `"`, `` ` ``, `$`, `%` or a line break in it is refused for building, because those characters could sneak an extra command into it.

- **Stepping through a program.** MAME is started by the extension (asked first if it came from the project) and is reached only on 127.0.0.1, your own computer. It writes its own settings beside `mame.exe`, never into your project.

Chip files are checked as they load: a search pattern that could lock up the editor (one like `(a+)+`) stops that chip file loading, and the **Retro ASM** output panel says which pattern and why. Text taken from a `.skool` file is cleaned before it goes into a tooltip.

## Checking it works (for changing the extension)

From the `retro-asm` folder:

| Command | What it checks |
|---|---|
| `node test/ext-test.js` | The whole extension against a small stand-in for VS Code. Quick. Set `XAS99` to the path of `xas99.py` to include the build. |
| `node test/tools-test.js` | Finding the assemblers and emulators (in the tools folder, on the PATH, and so on), and the build and emulator commands for each computer, using stand-in tools. Set `SJASMPLUS` to a real `sjasmplus` to also build a made-up Spectrum program with it. `node test/ext-test.js` runs it too. |
| `node test/sprite-test.js` | The picture editor: the example files, every computer's way of storing pixels, numbers kept in their own style, and drawing in the editor changing the code. `node test/ext-test.js` runs it too. |
| `node test/sound-test.js` | The sound player: reading a sound list, the sound chip's pitch, volume and noise, the example file, the player page, and the links in the editor. `node test/ext-test.js` runs it too. |
| `node test/screen-test.js` | The screen preview: reading the `@screen` line, finding and checking the tables, drawing the screen (bands, colours, sprites), the preview page, and the links in the editor. `node test/ext-test.js` runs it too. |
| `node test/markerhover-test.js` | The tooltips on `@sprite` and `@sound` comments: the text, where they start and end, the links, and switching them off. `node test/ext-test.js` runs it too. |
| `node test/case-test.js` | The letter-case change: each chip's rules, what is never changed, labels, every test file giving the same warnings and no more changes on a second run, and the save, Format Document and Shift+Alt+U parts. `node test/ext-test.js` runs it too. |
| `node test/lineup-test.js` | Lining up and the xas99 conversion: each chip's layout, what is left alone, only the spaces changing (the words, warnings and line count stay the same), a second run changing nothing, your own columns and a bad setting, and the commands. `node test/ext-test.js` runs it too. |
| `node test/gpl-test.js` | The GPL chip file against a made-up GPL program: no false warnings, the memory marks (`V@`, `G@`, `#`, `*`, offsets) explained, names such as `I/O` and `ROW+` recognised, and the xga99 build command and error messages. Set `XGA99` to the path of `xga99.py` to also build the program with the real xga99. `node test/ext-test.js` runs it too. |
| `node test/listing-test.js` | Reading an xas99 listing: which line is at which address, the program's bytes, where it starts. Made-up listing. `node test/ext-test.js` runs it too. |
| `node test/condition-test.js` | Breakpoint conditions and hit counts: what each one means, and the messages for ones that make no sense. `node test/ext-test.js` runs it too. |
| `node test/vdp-routines-test.js` | The added VSBW, VMBW, VSBR, VMBR and VWTR routines run on a pretend chip and screen chip, checked against what each is documented to do. `node test/ext-test.js` runs it too. |
| `node test/utils-test.js` | The added VSBW / VMBW routines: calls pointed at them, other words left alone. `node test/ext-test.js` runs it too. |
| `node test/callstack-test.js` | The "who called me" guess for the debugger (`BL` and `BLWP` callers, and the cases it must ignore). `node test/ext-test.js` runs it too. |
| `node test/debug-test.js` | The debugger against a pretend MAME: breakpoints, step in, over and out, registers, watches, closing. `node test/ext-test.js` runs it too. |
| `node test/mame-test.js` | The link to MAME against a pretend one (only ever 127.0.0.1). `node test/ext-test.js` runs it too. |
| `python test/mame-lua-check.py` | The script that runs inside MAME, run against a pretend MAME and a pretend TI chip (`pip install lupa`). |
| `node test/mame-proof.js <mame.exe> [roms folder]` | Needs real MAME: loads a tiny program, stops it, steps it and checks the registers. |
| `node test/lib-test.js misc` | Prints the outline, warnings, folds and original-game addresses for the test files. |
| `node test/real-check.js <folder>` | Runs the checks over every `.a99`, `.z80`, `.asm`, `.a80`, `.s` and `.6502` file in a folder (a finished program should give 0 warnings). |
| `node test/beebasm-check.js file.6502 [beebasm]` | Builds the file with the real BeebAsm and compares the address of every label with ours. Give the path to `beebasm` (or set `BEEBASM`); `node test/ext-test.js` runs it too when `BEEBASM` is set. |
| `python test/z80-size-check.py [file.asm]` | Compares the Z80 sizes with SkoolKit's Z80 assembler (`pip install skoolkit`): every way of writing every instruction, or every line of a file. |
| `python test/z80-cycle-check.py` | Compares the Z80 cycle counts with SkoolKit's Z80 simulator: every way of writing every instruction is run, with jumps taken and not taken. |
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

## Version history

A short list of the big steps. The full details of every release are in `CHANGELOG.md`.

| Version | What it added |
|---|---|
| 0.24 | **Screen preview (TI-99/4A):** mark a whole bitmap screen with `@screen` and see the picture drawn from its tables, with their sizes checked |
| 0.23 | **Sound player (TI-99/4A):** mark a sound list with `@sound` and play it, with a picture of each voice and what every byte does |
| 0.22 | **TI-99/4A GPL:** plain-English tooltips, colours, warnings and a build with xga99 for `.gpl` files (cartridge programs in GROM) |
| 0.21 | **More for the TI-99/4A debugger:** change registers and memory while stopped, a call stack, programs in several blocks of memory, and `KSCAN` |
| 0.20 | **Step through a TI-99/4A program** in MAME: breakpoints on your own lines (with conditions and hit counts), step in, over and out, registers and watches |
| 0.19 | **Line up** the label, instruction, operands and comment in columns (Shift+Alt+L), and **convert a whole TI-99/4A file to xas99 style** |
| 0.18 | **BBC BASIC listings (`.bas`):** colours and tooltips for machine code between `[` and `]` |
| 0.17 | **BBC Micro:** plain-English tooltips for OS calls (`OSBYTE`, `OSWRCH`, VDU codes) and hardware numbers (`&FE20`, `&FE4E`), and warnings for 65C02 without `CPU 1`, code past a `GUARD`, OS zero page, and code in screen memory |
| 0.16.1 | A project's own `build.bat` / `build.sh` is now told which file is the main one, and a failed build says why in the message |
| 0.16 | **Set up tools:** finds each computer's assembler and emulator (project, tools folder, PATH, usual install folders), tells you what is missing and where to get it, and **Build** / **F5** now work for the Spectrum (sjasmplus, Fuse) and C64 (KickAssembler, VICE) without any settings |
| 0.15 | A warning for a **comment with only one space before it** (xas99 reads it as part of the operands), and **cycle counts** shown beside each line |
| 0.14 | A **Registers** section in the side panel: what is in each register at the line you are on |
| 0.13 | Change the **letter case** of instructions, registers and labels (so you never need Caps Lock) |
| 0.11 | The **picture editor**: draw sprites and characters with the mouse and the numbers in your code change to match |
| 0.9 - 0.10 | **Starter code** (snippets) for all four computers |
| 0.8 | How long each instruction takes (**clock cycles**) |
| 0.7 | **BBC Micro** (6502 / 65C02, BeebAsm) |
| 0.5 | The **ZX Spectrum** (Z80) does everything the other chips do |
| 0.4 | **Commodore 64** (6502, KickAssembler) |
| 0.3 | Side by side with an original game's SkoolKit disassembly |
| 0.2 | **Build** and **build and run**, with the assembler's errors underlined |
| 0.1 | First version: TI-99/4A (TMS9900) |

## Roadmap

Ideas for later, roughly in the order we plan to do them. Nothing here is promised or has a date. Tick a line (`[x]`) and move it to the version history when it ships.

**BBC Micro**
- [ ] **Master and BBC B differences.** Tooltip notes where an address means something different on the Master (for example `&FE30` and `&FE34`), and a warning for Master-only operating system calls.
- [ ] **Macros, `COPYBLOCK`, `CLEAR` and `-D` names.** Give labels inside a macro their addresses, and follow these four so the layout matches BeebAsm. They are known now but do not change the layout.
- [ ] **A source-file list and a `!BOOT` file** for builds that need no emulator.
- [ ] **BBC BASIC: addresses.** Work out where the `[ ]` code lands when `P%` (or `O%`) is set to a plain number, so tooltips can show addresses, and follow `DIM` blocks where that is possible.
- [ ] **BBC BASIC: checks.** Warn about a label used but never defined, a missing `OPT` pass, or a `]` with no `[`, as the other chips do for their own code.
- [ ] **BBC BASIC: more of the language.** Read the BASIC around the assembly (procedures, variables) for go to definition, and read tokenised BBC BASIC files (the binary form saved by the BBC itself), not only text listings.

**Building and projects**
- [ ] **Several named build targets.** A list of builds per project, with a key to switch between them, instead of one build command.
- [ ] **New and imported projects.** Commands to start a project from a template, or to bring in existing source.

**Bigger jobs**
- [ ] **An emulator and debugger inside VS Code.** Run the program in a tab, with breakpoints, stepping and watching labels and memory. The biggest gap against other extensions, and the biggest piece of work. It would have to be built in, since the extension must not need other extensions.
- [ ] **Game Boy.** A fifth chip, written the way of RGBDS. It is close to the Z80, so the Z80 chip file is the starting point (see **Adding a chip of your own**).

**Probably not worth doing**
- TI BASIC, Extended BASIC and GPL file types (recognising them only).
- More emulators and build outputs such as MAME, js99er, cartridge and disk files. Those belong to the build tool, not to a reading and writing helper.

## Licence

MIT. See `LICENSE`: anyone may use, change and share the code, as long as the licence notice stays with it.
