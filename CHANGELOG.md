# Changelog

## 0.24.2

- **New: the `@screen` line is checked against its own video register values.** A register can only say where a table is in steps (the screen grid in 1K steps, the shapes and colours at `>0000` or `>2000`, the sprite list in 128-byte steps, the sprite pictures in 2K steps), so a table at some other address would be looked for in the wrong place by the real video chip. You now get a plain-English warning when the registers on the line and the addresses on the line disagree, for example *Register 2 puts the screen grid at >1C00, but gridat on the line says >1800.* It is underlined on the word it is about (`gridat=...`), shows in the Problems list and in the hover and preview notes, like the other `@screen` checks.
- **Also checked:** register 0 has to switch the bitmap screen on, and register 1 must not have the text-screen or multicolour bit set. A register 1 that leaves the screen switched off is only a gentle note, because the line is meant to give the values as they are once the screen is on. The bands are checked only when the line is clear: *shared* but the registers ask for separate sets, or a table for every band but the registers make the bands share the first set.
- **Nothing is reported when the registers are not there** (that is already a gentle note) or are not eight values (that already has its own message).
- **Checked against a real export:** the pixel editor's own example line gives no warnings, and neither does the made-up screen. The drawn picture was also compared with Classic99 running the same real export: the sun, the sprite, the hills and the bricks were in the same places and the same colours.
- **Tested:** 16 new checks in `test/screen-test.js` (each register against its address, the bitmap and text bits, the screen-off note, separate and shared bands both ways, fewer than eight values, and the underline on the right word), and the main run and the other checks that apply pass. **Not tested:** the rules follow general knowledge of how the TI video chip reads its registers in this mode (steps for the addresses, and which bits split the bands), checked only against the one real export, not against TI's manual or another real screen; the underline has only run in the stand-in for VS Code. The 0.24.1 `.vsix` is left alone.

## 0.24.1

- **New: hover on `@sprite` and `@sound`.** Hover the `@sprite` word in a comment and a tooltip says what it does ("This marks the bytes below as a picture"), what the block below is (its name, the picture shape, how many pictures and bytes), and has an **Edit picture** link. If the block can't be drawn on, it says why. Hover `@sound` and it says how many steps the sound has and how long it is, with a **Play sound** link. A comment that only mentions the word (for example "the @sprite comment above") gets nothing, a marker with no data below it says so, and a sound list that doesn't add up says why. These follow the same settings as the links: `retroAsm.pictureLinks` and `retroAsm.soundLinks` switch them off.
- **Why:** the `@screen` line already had a tooltip, but `@sprite` and `@sound` had nothing, so the only thing a hover showed on `@sprite` was another extension's GitHub profile card for a user called "sprite". Nothing about how `@sprite` or `@sound` work has changed.
- New files: `lib/markerhover.js` (the tooltip text) and `test/markerhover-test.js` (17 checks, run by `test/ext-test.js` too). `extension.js` gets a short function that turns that text into a tooltip.
- **Tested:** the new checks pass (the text for each case, where the tooltip starts and ends, the links, a comment that only mentions the word, the setting that switches them off, and a chip with no sound player), and so do the main run and the other checks that apply. **Not tested:** the tooltips have only run in the stand-in for VS Code, not been looked at in real VS Code, and `npm run test:vscode` was not run. The 0.24.0 `.vsix` is left alone.

## 0.24.0

- **New: screen preview (TI-99/4A).** A file with a `* @screen ti-bitmap ...` comment line (the pixel editor writes one when it exports a whole screen as a program) now gets a **Show this screen** link above that line, and a plain-English line beside it, such as *a whole screen: 3 bands, shapes at >0000, colours at >2000, grid at >1800, sprites listed at >1F00*. The link opens a preview beside your code that draws the picture from the tables the line names. Change a number in the code and the preview updates. It never changes your code.
- **How it draws:** each of the 32 by 24 squares of the grid picks a shape; each of the three bands of rows has its own shapes and colours (or one shared set, or one set used by every band, as the line says); the sprite list is drawn on top, with 8x8 or 16x16 pictures and normal or double size read from the register values on the line, the early-clock flag, and sprites with a lower number in front. A colour of 0 shows the backdrop colour (register 7). A **show sprites** box switches the sprites off.
- **It checks the tables as it goes** and says what is wrong in plain English, but still draws what it can: a name that can't be found in the file, a band of shapes or colours that is not 2048 bytes, a grid that is not 768 bytes, a sprite list that never reaches `>D0`, sprite pictures that are not whole pictures, the wrong number of tables for the bands, and numbers on the line it can't read. A table under the picture lists where each table goes in video memory and its size.
- **Words it does not know are ignored**, as the line's own rules say, so the line can grow later. A screen of a kind it does not know (anything but `ti-bitmap`) gets a plain description saying so, and no preview link.
- **`@sprite` is unchanged.** The shape tables keep their normal `@sprite` markers and still open in the picture editor.
- **New:** command **Retro ASM: Show this screen (from an @screen comment)**, setting `retroAsm.screenLinks` to switch the links off, `lib/screen.js` (reading, finding, checking, drawing), `lib/screen-html.js` (the page), `test/screen-test.js`, a made-up screen `test/fixtures/screen-demo.a99` and a copy of it in `examples/screens/`. Only the TI-99/4A chip file gets it. `test/ext-test.js` runs the new tests.
- **Hover and warnings on the `@screen` line.** Hover `@screen ti-bitmap` for the same plain-English line, each table it names with its size and where it goes in video memory, anything wrong marked with a warning sign, and a **Show this screen** link. Anything wrong also shows as a wavy underline and in the Problems list (the `retroAsm.checks` setting switches it off along with the other checks): a name that can't be found or a wrong size is underlined on that name in the comment, other problems on `@screen`. A missing register list is only a gentle note. A kind of screen it does not know is left alone, not nagged about.
- **Not in this version yet:** a check of the tables against where the registers say they are. The preview ignores the video chip's four-sprites-a-row limit, and uses the addresses on the line rather than the register values.
- **Tested:** the new checks pass (reading the line, unknown and unreadable words, finding and checking the tables with each kind of fault, the tooltip, the warnings and where they are underlined, the drawn pixels in each band, sprites in each size and the early-clock flag, the preview page run against a stand-in for the browser, and the links, tooltip, warnings and preview in a stand-in for VS Code), and so do the main run and the other checks that apply. The reader and drawing were also run over a real pixel-editor export: all ten names found, no problems, and the drawn picture was looked at (sky, sun, hills, bricks and one sprite). The link and the preview were then looked at by hand in real VS Code and drew the screen. **Not tested:** the new tooltip and warnings have only been run in the stand-in, not looked at in real VS Code, and `npm run test:vscode` was not run. Nothing has been compared with the picture a real TI or an emulator shows for the same tables, and the made-up screen was not built with xas99 (no xas99 was set up here; the real export is documented as building). On Windows, four older tests (three in `tools-test.js` and one in `gpl-test.js`) and the BeebAsm build test in `ext-test.js` fail because of how they fake programs and paths; the same ones fail on 0.23.0, so they are not from this change. The 0.23.0 `.vsix` is left alone.

## 0.23.0

- **New: sound player (TI-99/4A).** Put a comment with `@sound` above a block of BYTE or DATA lines and a **Play sound** link appears above it. It opens a player beside your code with **Play**, **Stop** and **repeat**, a picture of the pitch and loudness of the three tone voices and the noise, and a table of the steps with what each byte does in plain English. Change a number in the code and the player updates. It never changes your code.
- **The layout it reads** is the console's sound list: a count, that many bytes for the sound chip, then how long to wait in 60ths of a second, and a count of 0 to end the list. A list with no ending still plays and says so. Anything after the ending is not played. A list that stops in the middle of a step shows what is wrong. A sound over a minute long is cut short.
- **"Play as a sound?"** appears above a block that is named like a sound (`SND_`, `MUSIC`, `BEEP`, `TUNE` ...) or has a comment that says so, and reads cleanly as a sound list from start to finish. Pictures and other data are left alone.
- **How the sound is made:** the same rules as the earlier sound lab page: three square-wave voices (pitch number = 111,861 divided by the frequency), 2 dB a loudness step with 15 as off, and a 15-bit noise generator (a hiss or a buzz, at three speeds or following voice 3). The player page makes its sound with the same code the tests use.
- **New:** chip file section `sound` (only `tms9900.json` has one, so only the TI-99/4A gets the player). New setting `retroAsm.soundLinks` to switch the links off. New command **Retro ASM: Play these bytes as a sound** (it uses the block at the cursor).
- New files: `lib/sound.js`, `lib/sound-html.js`, `test/sound-test.js`, and a made-up example `examples/sounds/sounds.a99`. `test/ext-test.js` runs the new tests.
- **Only the player, not an editor, for now.** Drawing and reshaping a sound, the way the lab page does, is not in this version.
- **Tested:** the new checks pass (reading lists, pitch near 440 Hz for pitch number 254, volume steps, noise, the example file, the page's script, and the links and player in a stand-in for VS Code), and so do the main run and the other checks that apply. **Not tested:** nobody has listened to it, because there is no sound in the place it was built. It has not been tried in real VS Code (`npm run test:vscode` was not run), and the browser sound inside VS Code's panel has not been tried. It has not been checked against a real TI or MAME, and the way a count of 0 ends a list and what a wait of 0 does follow general knowledge of the TI sound list, not TI's manual. The 0.22.0 `.vsix` is left alone.

## 0.22.0

- **New: TI-99/4A GPL.** A new chip file, `dialects/gpl.json`, for `.gpl` files: GPL is TI's own language, run by the console from GROM, and xga99 is the assembler. Tooltips, colours, the outline, go to definition, find uses, rename, letter case, Line up and warnings all work on it.
- **Every command is explained in plain English:** about 100 GPL commands (the two-byte `D` versions such as `DST` and `DADD` too), the screen-drawing commands that go between `FMT` and `FEND` (`HTEXT`, `HCHAR`, `ROW`, `COL` ...), and the directives (`GROM`, `AORG`, `BYTE`, `DATA`, `TEXT`, `FOR`, `FEND` ...).
- **The memory marks are explained:** `@` (the console's fast memory), `*` (an address kept in memory), `V@` and `V*` (video memory), `G@` (GROM), `#` (a video chip setting) and an offset in brackets, for example `V@>0400(@TICKS)`. The names xga99 already knows (`KEY`, `TIMER`, `YPT` ...) are not reported as missing.
- **A small code change to make this work:** a chip file can now list marks that go in front of an address (`operandPrefixes`), so `G@SHAPE` is read as the label `SHAPE`, not as a label called `G`. The other chips don't use it, so nothing changes for them.
- **Build works with xga99.** **Retro ASM: Build** runs `xga99.py` (it is found the same way as xas99: your tools folder, next to the source, the PATH; it also needs Python) and makes a GROM image, `name.gbc`. Mistakes it reports are underlined on their line and listed in the Problems panel. There is no "run" step, because a GROM image can't be started on its own. For a cartridge image for MAME, set `retroAsm.build.command` (the message says how). `xga99` is now in the list of tools you can point to.
- **Not there yet:** the Registers panel, timing and the debugger (GPL has no registers), and checking addresses and sizes against an xga99 listing.
- **Checked against real GPL:** a read-only run over a large set of real GPL programs (about 500,000 command lines, listings with their address column removed) knew every command. The 254 warnings left were all lines that the disassembler wrote as a command followed by extra data (`CALL x, >00`), which xga99 would not accept either.
- **Not checked against TI's manual yet:** the exact wording for the compare commands (`CH`, `CGT`, `CLOG` ...), `MUL` and `DIV`, `CASE`, `COINC`, `BIAS` and the undocumented commands, and what `BR` and `BS` look at. They follow how xga99 treats them and general knowledge of GPL. Read them with that in mind. The xga99 shortcut `POP` was left out because its meaning was not clear. Every other command and directive xga99 knows is in the chip file (compared against xga99 itself).
- New test `test/gpl-test.js` and made-up program `test/fixtures/gpl-demo.gpl`; `test/ext-test.js` runs it. Set `XGA99` to the path of `xga99.py` to also build the made-up program with the real xga99 (it did, with no errors, and a deliberately wrong line was reported on the right line). That is how a mistake in the first version of the made-up program was found: `G@` is only allowed with `MOVE`. Not tried in real VS Code yet, and not tried on Windows. The 0.21.7 `.vsix` is left alone.

## 0.21.7

- **Fix: Line up no longer mangles a label that was pushed in from the left by accident.** On the TI-99/4A, `   START LWPI WS` (the label `START` indented by mistake) was read as the instruction `START` with `LWPI` as its operand and `WS` as a comment, so Line up spread the three words into those columns and the real instruction ended up far to the right. A line like that, where the first word is not an instruction but the next word is, is now left exactly as typed. Real indented instructions are still lined up.
- Test added to `test/lineup-test.js`. Line up only ever changes spaces, so the other labels in a file were never moved by it. Not tried in real VS Code yet. The 0.21.6 `.vsix` is left alone.

## 0.21.6

- **Two more made-up test programs** in `examples/debugger/`: `memory-demo.a99` (`VSBR`, `VMBR`, and changing a word with `@SCORE = >0500` in the Debug Console) and `lowmem-demo.a99` (code at `>2000`). Each says what the screen should show. Both worked on real MAME.
- README: a note that the TI only sees key presses while it is running (found with `KSCAN`, which works on real MAME, as do programs in several blocks).

## 0.21.5

- **Two made-up test programs for the debugger** in `examples/debugger/`: `kscan-demo.a99` (reads keys with `KSCAN` and shows them) and `blocks-demo.a99` (code and text in two separate `AORG` blocks). Both end with room set aside by `BSS`, like a real program's workspace. Both worked on real MAME.

## 0.21.4

- **Fix: changing a register under "Workspace of this caller" did nothing.** The change was always made in the workspace the chip is using right now, not in the caller's. It is now written into the caller's own workspace in memory (at that frame's workspace address + 2 x the register number).
- Test added in `test/debug-test.js`. Not tried on real MAME yet. The 0.21.3 `.vsix` is left alone.

## 0.21.3

- **Registers no longer vanish when a caller is selected.** When the top line of the Call Stack has no source (a supplied routine such as `VSBW`), VS Code selects the caller instead, and the Variables panel only offered that caller's workspace, so PC, WP and ST seemed to disappear. Every line of the Call Stack now also offers *Registers (where it is stopped now)*.
- Test updated in `test/debug-test.js`. Not tried on real MAME yet. The 0.21.2 `.vsix` is left alone.

## 0.21.2

Fix: **the debugger built its added routines on top of a program's own workspace.**

- A program that ends with room set aside by `BSS` (for example `WRCSPC BSS 32` used with `LWPI WRCSPC`) has no bytes in the assembler's listing for that room, so the debugger thought the memory was free and put the VSBW/VMBW workspace and code right on it. The program and the routines then shared one workspace. It mostly worked by luck, but the registers, the call stack ("via R11" from the program's own R11) and the saved `BLWP` return values were wrong or overwritten.
- `BSS` and `BES` sizes are now read from the listing (decimal, `>hex`, labels and sums such as `2*16+>10`), and the added routines and start-up code go after that space. A size that can't be worked out keeps a generous gap (256 bytes) instead.
- Test added to `test/listing-test.js`. Checked against your `test2.a99`'s real listing (read only): the routines now start at `>A192`, after `WRCSPC`. **Not tried on real MAME yet.** The 0.21.1 `.vsix` is left alone.

## 0.21.1

- **Break at a name or address.** The *Function Breakpoints* box in the Breakpoints panel now works: type a label, `VSBW` / `VMBW` / `VSBR` / `VMBR` / `VWTR` / `KSCAN`, or an address (`>A000`, `0xA000`), and the program stops there. Conditions and hit counts work too. A name that isn't known, or an odd address, gets a plain message.
- The supplied routines now have names the debugger knows, so the Call Stack shows `VSBW+4` instead of a bare address, and you can use `VSBW` in a condition or the Watch box.
- Tests added to `test/debug-test.js` and `test/utils-test.js`. **Not tried on real MAME yet.** The 0.21.0 `.vsix` is left alone.

## 0.21.0

Four more things for the TI-99/4A debugger (the other three computers are not done yet).

- **Programs in more than one block of memory.** A program with several `AORG` lines is loaded as separate pieces, each of which must sit inside `>2000`-`>3FFF` or `>A000`-`>FFFF`. Before, it was refused unless it was one block. The added routines and the start-up code go in the first gap after the last piece.
- **Change a register while stopped.** Variables panel: double-click a value (or **Set Value**) for R0 to R15, WP and ST; flags take `on` / `off`. Debug Console: `R3 = >1F`, and `@SCORE = 10` or `@>8310 = >ABCD` to change a word in memory. Numbers can be decimal, `>hex`, `0x` hex, or a label. **PC can't be changed** (the chip has already read its next instruction); the message says to use a breakpoint instead. New bridge commands `setreg` and `poke`; new `setVariable` / `setExpression` in the debugger.
- **Call stack.** New `lib/callstack.js`. After `BL` the caller is found from R11 (labelled *via R11*, a good guess: it is only kept when the instruction just before the way-back address really is a `BL`, and, for `BL @LABEL`, when you are at or after that label, so an old R11 doesn't invent a caller). After `BLWP` / `XOP` it is exact, from the new R13 and R14. Each caller shows its own registers. Older callers are hidden when a routine saves R11 elsewhere. **Step Out** now also works inside a `BLWP` routine (it runs to the saved PC in R14), not only after `BL`.
- **`KSCAN`.** A program that says `REF KSCAN` now gets it: a small wrapper switches to the console's workspace (`>83E0`), keeps the console's R11, calls the console's own keyboard routine at `>000E`, and switches back. The key is in `>8375` and bit `>20` of `>837C` is set when a key was pressed. Other `REF` names (`GPLLNK`, `XMLLNK`, `DSRLNK`, `NUMASG` ...) are still not supplied; the warning now says they belong to the Editor/Assembler cartridge.
- New tests: `test/callstack-test.js`, plus new cases in `debug-test.js` (set variable, set expression, callers, scopes), `utils-test.js`, `vdp-routines-test.js` (KSCAN on a pretend chip), `listing-test.js` and `mame-test.js` (several blocks), and `mame-lua-check.py` (`setreg`, `poke`, a second block). The wrapper's bytes were checked against xas99.
- **Not tried on real MAME yet:** setting registers and memory, the call stack, several blocks, and KSCAN. Everything was checked against pretend versions of MAME and the chip.
- The 0.20.10 `.vsix` is left alone.

## 0.20.10

Two fixes found when a program went blank and lost the first letter of each message.

- **`VWTR` was the wrong way round.** The register number goes in the left byte of R0 and the value in the right (`LI R0,>0601` = VDP register 6 gets 1). The stand-in routine did the opposite, so `LI R0,>0601` set register 1 to 6, which turns the screen off. Fixed.
- **The first byte of text at an odd address was lost.** For a byte at an odd address (such as `TEXT` right after a one-byte `BYTE` length) xas99 prints the byte further to the right in its listing, and the listing reader missed it, so it was loaded as zero. That is why `THE QUICK BROWN FOX` and `JUMPS...` lost their first letter. The listing is now read by column.
- **New test `test/vdp-routines-test.js`** runs the five stand-in routines (VSBW, VMBW, VSBR, VMBR, VWTR) on a pretend TMS9900 and VDP, checking each against what the Editor/Assembler documents. A regression test for the odd-address byte is in `test/listing-test.js`. Both run from `test/ext-test.js`.
- The 0.20.9 `.vsix` is left alone.

## 0.20.9

Fix: the screen colours. A program started in the debugger used the colours of MAME's start screen (black text on cyan), so it looked different from how it looks in Classic99.

- **A few start-up instructions now run first**, then your program starts: the screen colour is set to light blue and every entry of the colour table (at `>0380`) to white on light blue, the same as when the Editor/Assembler starts a program. The debugger runs them by itself and stops at your first instruction, so you never step through them.
- The Debug Console says so when it happens. A program that sets its own colours is not affected (its own writes come after).
- The start-up code is added after your program in memory (like the VSBW and VMBW routines), so it needs a few more bytes free after the end.
- The test for it is in `test/utils-test.js` and `test/debug-test.js`. The 0.20.8 `.vsix` is left alone.

## 0.20.8

New: **conditional breakpoints and hit counts** when stepping through a TI-99/4A program.

- **Right-click a red dot, choose Edit Breakpoint**, and pick *Expression* or *Hit Count*.
- **Expression:** stop only when it is true. Examples: `R2 = 5`, `R0 >= >0100`, `@SCORE > 9` (the word stored at the label `SCORE`), `R1 & 1` (the lowest bit of R1 is on), `PC <> LOOP`, `R3 = 5 and R0 < 32`. Each side is a register (R0 to R15, PC, WP, ST), a number (`12`, `>1F`, `0x1F`), a label, or `@` and an address or label. Joined by `and` / `&&` / `or` / `||`. Compared as plain 16-bit numbers.
- **Hit count:** `10` stops the 10th time the line is reached; `>=10`, `>10`, `<10`, `==10` and `%10` (every 10th time) also work. With both, the count only goes up when the expression is true.
- A condition that makes no sense turns the dot grey, with a message saying what is wrong and some examples.
- **Stepping always stops where it lands**, even on a line whose condition is false. Only Continue, Step Over and Step Out skip a breakpoint whose condition is not true.
- New `lib/condition.js`, and tests in `test/condition-test.js` and `test/debug-test.js` (run by `test/ext-test.js` too). The 0.20.7 `.vsix` is left alone.

## 0.20.7

Fix: Continue (and Step Over / Step Out) could seem to do nothing when the program was sitting on a breakpoint, because MAME reported the same breakpoint again straight away. The debugger now steps off the breakpoint first, then runs on. The 0.20.6 `.vsix` is left alone.

## 0.20.6

Fix: the routines added in 0.20.4 were never connected to your calls. xas99 writes an address it leaves to the loader as `0000e` (with a letter after it) and the listing reader skipped those lines, so `BLWP @VSBW` still jumped to address 0. They are read now. Checked against a real xas99 listing of a program with `REF VSBW,VMBW`. The 0.20.4 `.vsix` is left alone. (A 0.20.5 `.vsix` was packaged by mistake with old files in it: delete it.)

## 0.20.4

Fix: a program that says `REF VSBW,VMBW` (the usual way to use the Editor/Assembler routines) could not run in the debugger: the loader that normally fills those in isn't there, so the first `BLWP @VSBW` jumped to address 0 and restarted the TI.

- **The debugger now supplies `VSBW`, `VMBW`, `VSBR`, `VMBR` and `VWTR`.** They are small routines written for this extension (`lib/utils99.js`), put in memory just after your program, and every call that names one (`BLWP @VSBW`, `DATA VSBW,...`) is pointed at them. Your own source is not changed.
- **A `REF` it can't supply** (such as `KSCAN`) is named in the Debug Console, with a warning that calling it restarts the TI.
- **The Debug Console now says where each stop happened** (for example `Stopped at >A00A (step)`), to make it easier to see what the debugger did.
- New test `test/utils-test.js` (made-up listing), run by `test/ext-test.js` too. The 0.20.2 `.vsix` and older are left alone. (A 0.20.3 `.vsix` was packaged by mistake with old files in it: delete it.)

## 0.20.2

Fix: the debugger never said "hello" to the script inside MAME, so MAME stayed stopped at the very start of the TI's start-up and your program was never loaded. It now does, so the program is loaded and stops on its first instruction. The 0.20.1 `.vsix` is left alone.

## 0.20.1

Fix for stepping: starting the debugger again while MAME was still open could fail with "Could not connect to MAME on port 2161". Each start now closes the earlier session first and uses its own port. The 0.20.0 `.vsix` is left alone.

## 0.20.0

New: **step through a TI-99/4A program** with breakpoints, on a real emulated TI-99/4A (MAME), using VS Code's own debug buttons.

- **Retro ASM: Debug in MAME (TI-99/4A)** (Ctrl+Shift+P, or *Run and Debug*). Assembles the program with xas99, starts MAME with it loaded, and stops on the first instruction.
- **Breakpoints on your own lines.** Click in the gutter. The extension reads the xas99 listing (`-L`), so a line becomes the right address; comment and data lines can't hold one and say so. Lines in `COPY`'d files work too.
- **Continue, Step Over, Step Into, Step Out and Pause.** Step Over runs a `BL`, `BLWP` or `XOP` call in one go; Step Out runs to the address in R11. A breakpoint inside a call you step over still stops there.
- **Registers and watches.** PC, WP, ST, the status flags and R0 to R15 are shown, and Watch / the Debug Console understand a register, a label (shows the word stored there) or an address (`>8300`).
- **Set up tools lists MAME** and says where to get it. New setting `retroAsm.debug.romFolder` for the folder with `ti99_4a.zip` (empty means the `roms` folder beside `mame.exe`).
- **A plain message when the program can't be debugged:** no `AORG` (no fixed address), code outside the extra 32K memory (`>2000`-`>3FFF`, `>A000`-`>FFFF`), or code in two separate blocks.
- **How it works.** A small script (`mame/ti99-bridge.lua`) runs inside MAME and talks over a text line connection to `127.0.0.1` only (the one place in the extension allowed to open a connection, still checked by a test). MAME's own debugging protocol does not support the TMS9900, so the script drives MAME's debugger instead. The program is started by writing its address into a register the idle TI is about to jump through.
- New files: `lib/listing.js` (reads the listing), `lib/debug.js` (the debugger), `lib/mame.js` (the link to MAME), `mame/ti99-bridge.lua`, plus `B.listingPlan` in `lib/build.js`.
- New tests: `test/listing-test.js`, `test/debug-test.js`, `test/mame-test.js` (all run by `test/ext-test.js`), `test/mame-lua-check.py` and `test/mame-proof.js` (needs real MAME). Made-up code only.
- **Not done yet:** changing registers while stopped, conditional breakpoints, a call stack, programs in more than one block, and the other three computers. F5 on a code file still builds and starts Classic99 as before.
- The 0.19.0 `.vsix` and older are left alone.

## 0.19.0

Two tidy-ups: **line up the columns** for all four computers, and **convert a whole TI-99/4A file to xas99 style**. Both were on the roadmap.

- **Line up the columns (Shift+Alt+L).** Puts the label, the instruction, the operands and a comment at the end of a line into set columns, for the lines you have selected or the whole file. A label starts at the left edge; the other three start at a place set per chip: TI-99/4A 8, 14 and 32, ZX Spectrum 8, 16 and 32, Commodore 64 8, 12 and 32, BBC Micro 4, 12 and 32 (the number of characters in front). A comment keeps at least two spaces before it, so the TI-99/4A one-space comment warning goes away too.
- **Only the spaces change.** The words, the operands (as typed, even `R0, R1`) and the comments are copied as they were. Left as they are: blank lines, whole-line comments, `name = value` and `*=address` lines, lines with `{` or `}`, a BeebAsm line with a label followed by more statements after a colon, and on the TI-99/4A a sum that carries on after a space (`LI R0,5 + 2`). A label too long for its place keeps one space and the rest follows on.
- **The columns are a setting with a start for each chip.** The start is a new `lineUp` section in each chip file (`instruction`, `operands`, `comment`, `commentGap`; checked when the file is read, with a clear message for a mistake). The new `retroAsm.lineUpColumns` setting changes any of them for one chip (`{ "tms9900": { "comment": 30 } }`). `templates/new-dialect.json` has the section too.
- **Not done by itself.** Lining up does not run when you save, and Format Document and Format Selection still only change the letter case.
- **Convert to xas99 style (TI-99/4A).** A new command in Ctrl+Shift+P, **Retro ASM: Convert the whole file to xas99 style (TI-99/4A)**, for the whole file in one undo step. It puts two spaces before every comment that follows code (also one stuck on after a `;`), and takes out spaces next to a comma in the operands (`MOV R0, R1` becomes `MOV R0,R1`). Text in quotes, whole-line comments, comments that already have two spaces or a Tab, and a sum that carries on (`LI R0,5 + 2`) are not touched. Nothing else is converted: other differences between assemblers are not covered. On any other chip it says so and changes nothing.
- New tests in `test/lineup-test.js` (run by `test/ext-test.js` too), using made-up code. They also check that every file in `test/fixtures` keeps the same words, the same warnings and the same number of lines after either change, and that a second run changes nothing.
- Fixed two mistakes in `test/ext-test.js` (found while running it): a file was deleted twice, which stopped the run before it got to the later tests, and an answer of "Allow" was left switched on for the next check.
- The 0.18.0 `.vsix` and older are left alone.

## 0.18.0

New: **BBC BASIC listings (`.bas`)**. Machine code written between `[` and `]` in a BASIC program now gets colours and tooltips.

- **A new file type, BBC BASIC, for `.bas` files.** The BASIC lines (`MODE 1`, `FOR ... NEXT`, `PRINT`, `CALL`) are coloured as BASIC. Everything between `[` and `]` is read as BBC assembly (the 6502 / 65C02 chip), with the same colours as a `.6502` file.
- **Tooltips inside `[ ]`.** Hover an instruction, a number, a label or a `.label`, and you get the same plain-English notes as in a `.6502` file, including the new operating-system and hardware notes (`LDA #19` before `JSR &FFF4` says *wait for the next screen refresh*). Go to definition, find all references, highlighting the same label and the outline list also work on the labels.
- **A plain number given a name in BASIC is understood.** `oswrch = &FFEE` or `LET ptr = &70` on a BASIC line is kept for the assembly to use, so `JSR oswrch` is explained as the OS call. Other BASIC (`P% = code%`, loops, anything with sums) is left alone.
- **No addresses are shown.** In a BASIC program the code lands wherever `P%` says when the program runs, which can't be known from the listing, so tooltips show only sizes (*3 bytes*).
- **Not done, on purpose.** No warnings or underlines in `.bas` files, no cycle counts, no build. Only the `[ ]` parts are read.
- A `[` or `]` inside a quoted string, after `REM`, or in a `DATA` line does not count. `OPT` (as in `[OPT pass%`) is skipped. Line numbers are optional. Lines can end with `\n` or `\r\n`.
- **Roadmap (not in this version):** work out addresses when `P%` is set to a plain number, and warn about labels that are used but never defined (see the README).
- New tests in `test/basic-test.js` (run by `test/ext-test.js` too), with a made-up listing in `test/fixtures/basicdemo.bas`.
- The 0.17.0 `.vsix` and older are left alone.

## 0.17.0

Two BBC Micro helps: warnings for BBC mistakes, and plain-English tooltips for the numbers you give the operating system and the hardware.

- **Tooltips for operating system calls.** Hover the number in `LDA #19` before `JSR osbyte` and it says what that OSBYTE does (*wait for the next screen refresh*). The same for OSWORD, and for `OSWRCH` / `OSASCI`: `LDA #22` says it starts a MODE change, and the next `LDA #1:JSR oswrch` says *MODE 1*. The other VDU codes (colours, cursor moves, graphics) are explained too, and a letter sent to `OSWRCH` says which letter it prints.
- **Tooltips for numbers sent to the hardware.** `STA &FE20` says what the video ULA setting means (MODE, flashing colours), `STA &FE21` names the colour being set, `STA &FE00` / `STA &FE01` name the 6845 screen register and what it controls, `STA &FE40` names the sound or keyboard latch line, and `STA &FE4E` lists which interrupts are being switched on or off.
- **New warnings (BBC only):**
  - a 65C02 instruction (`BRA`, `STZ`, `PHX`, `INC A`, `LDA (&70)` ...) used before a `CPU 1` line, which BeebAsm refuses;
  - code that runs past a `GUARD` address (`CLEAR` takes a guard away again);
  - a write to zero page `&90`-`&FF` in a program that also calls the operating system (a note, not a warning: `&70`-`&8F` is the part kept for your programs);
  - code placed in screen memory for the MODE the program switches to with `VDU 22` (a note).
- The meanings live in `dialects/bbc.json` (`osCalls`, `osTables`, `hardwareValues`, and the `checks` rules), so they can be corrected without touching the code. The other computers are not changed.
- New tests in `test/os-test.js` (run by `test/ext-test.js` too), using made-up code (`test/fixtures/bbcchecks.6502`).
- The 0.16.1 `.vsix` and older are left alone.

## 0.16.1

Fixes for a project that has its own build script.

- **The build script is now given the main source file's name.** A folder with several source files made a script such as `build.bat` stop with *More than one .a99 file here. Say which one*, because the extension ran it with nothing after it. It now runs `build.bat hello.a99` (the main file, the one that pulls in the others, named from the script's own folder). A script that doesn't look at what it is given is not affected. You are asked once more before it runs, because the command is different.
- **A failed build says why.** When nothing could be underlined, the message now includes the last few lines the build printed, instead of only pointing at the output panel.
- New test in `test/ext-test.js` (a script receives the main file's name), using made-up code. **Not checked:** a real `build.bat` on Windows (the test uses a `build.sh`).
- The 0.16.0 `.vsix` and older are left alone.

## 0.16.0

New: **Set up tools**, so each computer's assembler and emulator are easy to get working.

- **A new command, Retro ASM: Set up tools.** It lists what each computer needs (TI-99/4A: xas99, Python, Classic99. Spectrum: sjasmplus, Fuse. C64: KickAssembler, Java, VICE. BBC: BeebAsm, BeebEm), whether it was found and where, and where to get what is missing. Pick a line to open the download page or to choose a copy you already have (remembered in the new `retroAsm.toolPaths` setting). The side panel's Project section shows **Missing: ...** (or **Tools found**) and opens the same list. A failed build because a tool is missing now has a **Set up tools** button.
- **A tools folder.** Unpack downloads into `retro-asm-tools` in your home folder (or the folder in the new `retroAsm.toolsFolder` setting). Tools are found in it and in the folders inside it, whatever those are called (such as `xdt99-3.6.5-Windows`). Before, xas99 and BeebAsm were only found inside your project folder or by a setting.
- **Where tools are looked for:** a file you picked, next to your source, the tools folder, your PATH, then the usual install folders (Program Files, `/Applications` and so on). Only a tool found next to your source is asked about first, as before.
- **Spectrum and C64 now build with no settings.** **Build** runs sjasmplus (Spectrum) or KickAssembler through Java (C64); **F5** starts Fuse with the `.sna` or VICE with `-autostart` and the `.prg`. Before, you had to type both commands into the settings. Your own commands still win.
- **F5 no longer opens an empty emulator.** If the build didn't make the file the emulator needs (no `SAVESNA` line, say), you are told which file is missing.
- **xas99 uses the Python it finds**, not just whatever `python` is on the PATH.
- **Checked:** the sjasmplus build and its error messages with the real sjasmplus 1.24.0; xas99 3.6.5 found in a tools folder and run for real (it made the disc image). **Not checked:** Fuse, VICE, Classic99, BeebEm or KickAssembler themselves (stand-ins only). KickAssembler's own messages are read in two shapes, but neither has been compared with the real one.
- Chip files: the `build` section now says where each tool is (`tool` and `run`, each with `id`, `name`, `find`, `url`, `get`, and `output` for the file the emulator needs). The new-chip template and old chip files with only a `hint` keep working.
- New tests in `test/tools-test.js` (run by `test/ext-test.js` too), using made-up code and stand-in tools.
- **New `QUICKSTART.md`**: one page from install to a built program (get the tools, first program for each computer, the keys worth knowing, and what to do when something doesn't work). It ships inside the extension and the README links to it.
- The 0.15.0 `.vsix` and older are left alone.

## 0.15.0

Two new helps, both found by comparing with other VS Code extensions for the same computers.

- **New warning for a comment with only one space before it** (TI-99/4A). In its normal mode, xas99 reads `LI R0,>10 * set up` as one long operand and stops with an error such as *Unknown symbol: SET UP*. Two or more spaces, a Tab or a `;` are fine, and so are instructions with no operands (`RT * done`). The one space is underlined, and a quick fix (the light bulb, or Ctrl+.) adds the second space. Checked against xas99 3.6.5: the same lines that are warned about fail to assemble, and the fixed lines assemble.
- **Cycle counts beside each line.** A new setting, `retroAsm.showCycles` (off to start with), and a new command, **Retro ASM: Show or hide cycle counts beside the code** (Ctrl+Alt+T / Cmd+Alt+T), put a small grey note at the end of every instruction line: `12+ cycles`, `4+ cycles`, `2/3 cycles`. Hover it for the full explanation. It uses the same numbers as the tooltips and the side panel. Works for all four computers.
- A chip file can turn the new warning on with `"oneSpaceComment": true` in its `checks` section (the TI-99/4A one does).
- New tests in `test/spacing-test.js` (run by `test/ext-test.js` too), using made-up code. The test stand-in for VS Code now knows about inline notes and quick fixes.
- The 0.14.x `.vsix` files are left alone.

## 0.14.2

Documentation only; the extension works exactly as before.

- The README now has a short **Version history** table and a **Roadmap** (first idea: a Game Boy chip).

## 0.14.1

Fix: **end-of-text labels no longer show up as routines.**

- A label that nothing refers to and that has no code or data under it (for example `MSGEND` after a message) used to be listed as a 0-byte routine in the side panel and the Outline, and was coloured like a routine. It is now tucked under whatever is above it, with the plain label colour.
- Nothing else changes. A label that code calls is still a routine, a label reached only by short jumps (`JNE`, `JMP`) is still inside its routine, and an unused label with code under it is still a routine (and still appears under **Never used**).
- New tests in `test/marker-test.js`, using made-up code in `test/fixtures/markers.a99`.

## 0.14.0

New: **a Registers section in the side panel**, so you can see what is in each register (and which memory places you have set) at the line you are on.

- Click in a routine and the **Registers** section lists every register the routine has put something in, down to your line: a number (`R0 >0100`), the address of a label, a copy of another register, or "changed by" the line that changed it. Click one to jump to that line. Memory places you stored to (`MOV R1,@SCORE`, `LD (count),A`, `STA total`) are listed under **Memory set so far**, and hardware addresses are named (`>8C00 (Video chip ...)`).
- **On a call line** (`BL @PRINT`, `CALL put`, `JSR plot`), a **Calling ...** entry shows what the routine needs, what is in those registers now (with a warning if nothing has been put there), which registers it changes, and what it gives back. After the call, the registers it changed say so.
- **Unsure:** after a label that a jump lands on, a register that a loop or a skipped line could have changed is marked unsure. Registers nothing in between touches stay certain.
- **Inside a routine** it lists what the routine expects from its caller: the registers it reads before setting them itself (including what the routines it calls need).
- It uses what you already wrote: the comment above a routine (`; In: R1 = the letter to print`, `; Out: R2 = ...`) and your `; @reg R4 = Player X` lines.
- Works for the TI-99/4A, ZX Spectrum, Commodore 64 and BBC Micro. It reads the code and never runs it; a call to something outside your files is shown as "not known".
- Chip files: a new `registerView` section (`bareIs`, `immediatePrefix`, `bits`) and, on the instructions that load or store, `copy`, `fixed` and `store`. A chip file of your own works without them (you just see "changed by" instead of values).
- New tests: `test/regs-test.js` (run by `test/ext-test.js` too), using made-up code in `test/fixtures/regs*`.

## 0.13.1

Fix: **a picture directly below another one now gets an Edit picture link.**

- Before, only the first of two pictures stacked one under the other (with nothing between them) had the link. The `@sprite` line only marks the block just under it, and the second one had no marker of its own.
- Now a block that sits right below a picture (blank lines and comments between are fine) gets **Edit picture (same shape as above)?** when its bytes fit that shape. Clicking it adds the same `@sprite` line above it and opens it, without asking for a shape. A third one below that gets the link too.
- A block whose name or comments say it is a drawing keeps the old **Edit as a picture?** link, and the shape question.
- New tests in `test/sprite-test.js`, using made-up code.
## 0.13.0

New: **change the letter case, so you never need Caps Lock.**

- When you press Save, instructions, registers (and labels, for chips that ask for it) are changed to the case the chip file asks for. **Shift+Alt+U** does it on demand, for the selected lines or the whole file, and **Format Document** and **Format Selection** work too. Auto-save never changes anything.
- The TI-99/4A changes all four (instructions, directives, registers and labels) to capitals. The other three chips change instructions and registers to capitals and leave directives and labels as typed.
- Never changed: comments, text in quotes, numbers, the file name after `COPY` or `INCLUDE`, and directives that start with a dot.
- A label is changed everywhere it is used in the file. If two labels would become the same (`foo` and `FOO` on a chip that tells them apart), both are left alone and you are told.
- New chip-file section `caseFormat` (`instructions`, `directives`, `registers` and `labels`, each `upper`, `lower` or `keep`). The new-chip template has an example, and a bad value gets a clear message when the chip file loads.
- New setting `retroAsm.formatCaseOnSave`, and a new command, **Retro ASM: Change the letter case of instructions, registers and labels**.
- New tests: `test/case-test.js`, which `test/ext-test.js` runs too. `test/mock-vscode.js` now stands in for text edits, Format Document and saving.

## 0.12.1

Fixes for starting a new file:

- **Switch chip now works on a new file that hasn't been saved yet.** Before, it said the choice couldn't be remembered and the file stayed as TI-99/4A. Now the file is read as the chip you pick straight away; save it with an extension (such as `.6502`) to keep the choice.
- **An empty `.6502` file is read as BBC Micro**, so **Insert starter code** gives BBC code. Before, it gave Commodore 64 code until there was some code in the file to look at. (An empty `.asm` file is still read as C64.)

## 0.12.0

- **A blank picture, quickly.** Type `sprite` (lower case) on an empty line and pick a size from the suggestions (`sprite 8x8`, `sprite 16x16`, and each computer's other shapes, such as `sprite c64` or `sprite mode1`). An empty picture goes in, with its `@sprite` line and a free name (`SPR1`, `sprite1`...) ready to type over. Type a size on the end (`sprite24x16`) for any other size. **sprite ...** runs **New picture here** for several frames.
- New tests: every shape on every computer goes in with no warnings, at the right size, and empty; the suggestions in `test/ext-test.js`.

## 0.11.1

- **File icons:** assembly files (`.a99`, `.z80`, `.6502`, and any others opened as Retro Assembly) now show a small orange chip in the Explorer and on editor tabs, instead of a blank page. VS Code uses it when your file icon theme has no icon of its own for these files, so it works with the built-in theme and doesn't change any other file's icon.

## 0.11.0

New: **the picture editor.** Draw sprites, characters and tiles with the mouse, and the numbers in your code change to match.

- Put a comment starting `@sprite` above a block of data (`* @sprite 16x16`, `; @sprite 8x8`, `// @sprite c64multi`). An **Edit picture** link appears above it and opens the editor beside your code.
- Each stroke rewrites only the numbers that changed, in the style you wrote them (hex, binary or decimal, with your prefix and case). Typing in the code updates the picture. Undo works in both.
- Knows how each computer keeps its pictures: the TI-99/4A's 16x16 sprites (four 8x8 blocks), Spectrum rows, C64 sprites (24x21, 64 bytes apart) and multicolour sprites and characters, and the BBC Micro's 8-row cells with MODE 1 and MODE 2 colour pixels. Any size works too (`@sprite 24x16`).
- Animation frames (several pictures in a row) get a picker. Clear, invert, flip and nudge tools, a real-size preview, and a table of each row's pixels and bytes.
- Blocks named or described as drawings (`PAT_...`, "sprite" ...) get an **Edit as a picture?** link that adds the `@sprite` line for you. Right-click menu: **Edit these bytes as a picture** and **New picture here**.
- Blocks that use names or sums instead of plain numbers open look-only, with the reason.
- Tooltips draw marked blocks in their own shape.
- Fix: word data (`DEFW`, `.word`, `EQUW`) on the Z80 and 6502 is now read low byte first, as those chips store it. Pictures in tooltips used the wrong order before.
- Fix: tooltips no longer guess "16x16 sprite" (the TI's way) for data on the other computers.
- New chip-file settings: a `sprites` section (the picture shapes) and `littleEndian` in `syntax`. The new-chip template has an example of both.
- Example files for all four computers in `examples/sprites`. New setting `retroAsm.pictureLinks`. New tests: `test/sprite-test.js`.

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
